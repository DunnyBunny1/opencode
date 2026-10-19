import { Plugin } from "@opencode/plugin"

const protectedStatuses = new Set(["idea", "blocked", "shelved", "merged"])
const checked = new Map<string, number>()
const checking = new Set<string>()

export function shouldMarkMerged(status: string | undefined) {
  return !status || !protectedStatuses.has(status)
}

function workflowStatus(workflow: unknown) {
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) return undefined
  const status = "status" in workflow ? workflow.status : undefined
  return typeof status === "string" ? status : undefined
}

export function parseMergedPullRequests(output: string) {
  const value: unknown = JSON.parse(output)
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const number = "number" in item ? item.number : undefined
    const mergedAt = "mergedAt" in item ? item.mergedAt : undefined
    return typeof number === "number" && typeof mergedAt === "string" ? [{ number, mergedAt }] : []
  })
}

export default Plugin.define({
  id: "custom.auto-merged",
  async setup(ctx) {
    let running = false
    const poll = async () => {
      if (running) return
      running = true
      try {
        const page = await ctx.session.list({ directory: ctx.location.directory, limit: 50, order: "desc" })
        const recent = Date.now() - 7 * 24 * 60 * 60 * 1000
        const candidates = page.data
          .filter(
            (session) =>
              !session.parentID &&
              !session.metadata?.codex &&
              !session.time.archived &&
              session.time.updated >= recent &&
              shouldMarkMerged(workflowStatus(session.metadata?.customWorkflow)),
          )
          .slice(0, 10)
        for (const session of candidates) await check(session.id).catch(() => undefined)
      } finally {
        running = false
      }
    }
    void poll().catch((error) => console.error("auto-merged: poll failed", error))
    const timer = setInterval(() => void poll().catch((error) => console.error("auto-merged: poll failed", error)), 30_000)
    return () => clearInterval(timer)

    async function check(sessionID: string) {
      if (checking.has(sessionID)) return
      checking.add(sessionID)
      try {
        const session = await ctx.session.get({ sessionID })
        if (session.parentID) return
        const workflow = session.metadata?.customWorkflow
        const current = workflow && typeof workflow === "object" && !Array.isArray(workflow) ? workflow : {}
        if (!shouldMarkMerged(workflowStatus(current))) return
        const branchProcess = Bun.spawn(["/usr/bin/git", "branch", "--show-current"], {
          cwd: session.location.directory,
          stdout: "pipe",
          stderr: "ignore",
          signal: AbortSignal.timeout(5_000),
        })
        if ((await branchProcess.exited) !== 0) return
        const branch = (await new Response(branchProcess.stdout).text()).trim()
        if (!branch || ["main", "master", "dev", "trunk"].includes(branch)) return
        const key = `${session.location.directory}\0${branch}`
        const previous = checked.get(key) ?? 0
        if (Date.now() - previous < 60_000) return
        checked.set(key, Date.now())
        const gh = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh"].find((path) => Bun.file(path).size > 0)
        if (!gh) return
        const home = Bun.env.HOME
        const process = Bun.spawn(
          [gh, "pr", "list", "--head", branch, "--state", "merged", "--json", "number,mergedAt", "--limit", "1"],
          {
            cwd: session.location.directory,
            stdout: "pipe",
            stderr: "ignore",
            signal: AbortSignal.timeout(10_000),
            env: { ...Bun.env, GH_CONFIG_DIR: Bun.env.GH_CONFIG_DIR ?? `${home}/.config/gh` },
          },
        )
        if ((await process.exited) !== 0) return
        const latest = parseMergedPullRequests(await new Response(process.stdout).text()).at(0)
        if (!latest) return
        const latestSession = await ctx.session.get({ sessionID })
        const metadata = latestSession.metadata ?? {}
        const existing = metadata.customWorkflow
        const existingWorkflow: Record<string, unknown> =
          existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {}
        if (!shouldMarkMerged(workflowStatus(existingWorkflow))) return
        // Reusing a branch must not re-apply a merge the user has already classified afterwards.
        if (existingWorkflow.pullRequest === latest.number && existingWorkflow.mergedAt === latest.mergedAt) return
        await ctx.session.update({
          sessionID,
          metadata: {
            ...metadata,
            customWorkflow: {
              ...existingWorkflow,
              status: "merged",
              pullRequest: latest.number,
              mergedAt: latest.mergedAt,
            },
          },
        })
      } finally {
        checking.delete(sessionID)
      }
    }
  },
})
