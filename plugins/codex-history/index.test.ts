import { expect, test } from "bun:test"
import { Message } from "../../packages/ai/src/index"
import type { Plugin } from "@opencode/plugin"
import plugin from "./index"

test("all model-request hooks exclude imported harness wrappers without changing stored or new user history", async () => {
  type Request = { sessionID: string; messages: Message[]; result?: string }
  const hooks = new Map<string, (event: Request) => void | Promise<void>>()
  // Only the host registration boundary is stubbed; the production setup and all registered hooks execute.
  await plugin.setup({
    session: {
      get: async ({ sessionID }: { sessionID: string }) =>
        sessionID === "ses_regular" ? {} : { title: "Imported name", metadata: { codex: { id: "original" } } },
      hook: async (kind: string, hook: (event: Request) => void | Promise<void>) => {
        hooks.set(kind, hook)
        return { dispose: async () => {} }
      },
    },
  } as unknown as Plugin.Context)
  expect([...hooks.keys()]).toEqual(["context", "compaction", "generate", "title"])
  const original = [
    Message.make({
      id: "msg_fork_old",
      role: "user",
      metadata: { codex: { line: 1, type: "message" } },
      content: "# AGENTS.md instructions for /old\nObsolete",
    }),
    Message.make({
      id: "msg_fork_env",
      role: "user",
      metadata: { codex: { line: 2, type: "message" } },
      content: "<environment_context>Old environment</environment_context>",
    }),
    Message.make({ id: "msg_codex_request", role: "user", content: "Implement the sidebar" }),
    Message.make({
      id: "msg_new",
      role: "user",
      content: "# AGENTS.md instructions for /new\nNew explicit instructions",
    }),
  ]
  for (const [kind, hook] of hooks) {
    const imported: Request = { sessionID: "ses_native_fork", messages: original }
    await hook(imported)
    if (kind === "title") {
      expect(imported.result).toBe("Imported name")
      const regular: Request = { sessionID: "ses_regular", messages: original }
      await hook(regular)
      expect(regular.result).toBeUndefined()
      continue
    }
    expect(imported.messages.map((message) => message.id)).toEqual(["msg_codex_request", "msg_new"])
    expect(original).toHaveLength(4)
  }
})
