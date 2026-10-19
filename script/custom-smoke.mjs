import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import path from "node:path"

const require = createRequire(new URL("../packages/app/package.json", import.meta.url))
const { _electron: electron } = require("@playwright/test")
const bundle = path.resolve(process.argv[2])
const isolated = !process.argv.includes("--live-profile")
if (
  !isolated &&
  execFileSync("ps", ["-axo", "comm="], { encoding: "utf8" })
    .split("\n")
    .some((line) => line.endsWith("/Contents/MacOS/OpenCode Custom"))
) {
  throw new Error("Custom app is running. Ask before interrupting an active session, then retry.")
}
const home = path.join(homedir(), ".local/share/opencode-custom")
const scratch = path.join(homedir(), "Library/Application Support/OpenCode Custom Builds/smoke")
if (isolated) mkdirSync(scratch, { recursive: true, mode: 0o700 })
const root = isolated ? mkdtempSync(path.join(scratch, "profile-")) : home
if (isolated) {
  mkdirSync(path.join(root, "desktop"), { mode: 0o700 })
  // A valid empty legacy profile skips first-install onboarding without copying personal data.
  writeFileSync(path.join(root, "desktop/default.dat"), "{}", { mode: 0o600 })
}
const original = path.join(homedir(), ".local/state/opencode/service.json")
const before = readFileSync(original, "utf8")
const live = path.join(home, "state/opencode/service.json")
const liveBefore = existsSync(live) ? readFileSync(live, "utf8") : undefined
const cli = path.join(bundle, "Contents/Resources/opencode-cli")
const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex")
const env = {
  ...process.env,
  XDG_DATA_HOME: path.join(root, "data"),
  XDG_CONFIG_HOME: path.join(root, "config"),
  XDG_STATE_HOME: path.join(root, "state"),
  XDG_CACHE_HOME: path.join(root, "cache"),
  OPENCODE_DB: path.join(root, "data/opencode/opencode.db"),
}
const desktop = await electron.launch({
  executablePath: path.join(bundle, "Contents/MacOS/OpenCode Custom"),
  env: isolated ? { ...env, OPENCODE_CUSTOM_ROOT: root } : env,
  timeout: 60000,
})
try {
  const page = await desktop.firstWindow()
  await page.getByPlaceholder("Search sessions").waitFor({ timeout: 60000 })
  const registration = JSON.parse(readFileSync(path.join(root, "state/opencode/service.json"), "utf8"))
  // API discovery is scoped exclusively to the custom service.
  const info = JSON.parse(execFileSync(cli, ["api", "get", "/api/info"], { env, encoding: "utf8" }))
  const executable = execFileSync("ps", ["-p", String(info.pid), "-o", "comm="], { encoding: "utf8" }).trim()
  assert.equal(info.pid, registration.pid, "Desktop must start the server before the API probe")
  assert(
    executable.includes(isolated ? path.join(root, "desktop/cli/") : "ai.opencode.desktop.custom/cli/"),
    executable,
  )
  assert.equal(hash(executable), hash(cli))
  assert.equal(readFileSync(original, "utf8"), before, "Original server registration changed")
  if (isolated && liveBefore) assert.equal(readFileSync(live, "utf8"), liveBefore, "Active custom service changed")
  await page.getByRole("complementary", { name: "Conversations" }).waitFor()
  await page.screenshot({ path: path.join(bundle, "../custom-smoke.png") })
  const report = {
    bundle,
    pid: info.pid,
    executable,
    sha256: hash(cli),
    appSha256: hash(path.join(bundle, "Contents/Resources/app.asar")),
    originalServiceUnchanged: true,
    isolated,
    profile: root,
  }
  writeFileSync(path.join(bundle, "../custom-smoke.json"), JSON.stringify(report, null, 2))
  console.log(report)
} finally {
  await desktop.close()
  if (isolated && existsSync(path.join(root, "state/opencode/service.json"))) {
    execFileSync(cli, ["service", "stop"], { env, stdio: "ignore" })
  }
}
