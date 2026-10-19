import { Plugin } from "@opencode/plugin"

const protectedStatuses = new Set(["idea", "blocked", "shelved", "merged"])
const checked = new Map<string, number>()
const checking = new Set<string>()
const implementationTools = new Set(["edit", "write", "patch"])

export function shouldAutoUpdate(status: string | undefined) {
  return !status || !protectedStatuses.has(status)
}

export function normalizeStatus(status: string | undefined) {
  if (status === "in-progress") return "implementation"
  if (status === "done" || status === "ready") return "qa"
  if (status === "unclassified") return undefined
  return status
}

export function parsePullRequest(output: string) {
  const value: unknown = JSON.parse(output)
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const number = "number" in item ? item.number : undefined
    const state = "state" in item ? item.state : undefined
    const mergedAt = "mergedAt" in item ? item.mergedAt : undefined
    if (typeof number !== "number" || typeof state !== "string") return []
    return [{ number, state, mergedAt: typeof mergedAt === "string" ? mergedAt : undefined }]
  })
}

export default Plugin.define({
  id: "custom.workflow",
  async setup(ctx) {
    const workflow = (session: { metadata?: Record<string, unknown> }) => {
      const value = session.metadata?.customWorkflow
      return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
    }

    const setStatus = async (sessionID: string, status: string, extra: Record<string, unknown> = {}) => {
      const session = await ctx.session.get({ sessionID })
      const current = workflow(session)
      if (!shouldAutoUpdate(typeof current.status === "string" ? current.status : undefined)) return
      if (normalizeStatus(typeof current.status === "string" ? current.status : undefined) === status) return
      await ctx.session.update({
        sessionID,
        metadata: {
          ...session.metadata,
          customWorkflow: { ...current, ...extra, status, ready: false },
        },
      })
    }

    await ctx.session.hook("prompt", async (event) => {
      const session = await ctx.session.get({ sessionID: event.sessionID })
      const current = workflow(session)
      const status = normalizeStatus(typeof current.status === "string" ? current.status : undefined)
      if (status) return
      await setStatus(event.sessionID, "planning")
    })

    await ctx.tool.hook("execute.after", async (event) => {
      if (!implementationTools.has(event.tool)) return
      await setStatus(event.sessionID, "implementation")
    })

    await ctx.tool.transform((editor) => {
      editor.add({
        name: "start_implementation",
        description:
          "Use when the user approves the plan and asks to implement it. Switches this conversation from planning with Astra to implementation with DeepSeek Flash.",
        input: { type: "object", properties: {}, additionalProperties: false },
        execute: async (_input, context) => {
          await ctx.session.switchAgent({ sessionID: context.sessionID, agent: "build" })
          await ctx.session.switchModel({
            sessionID: context.sessionID,
            model: { providerID: "openrouter", id: "deepseek/deepseek-v4.1-flash-1017" },
          })
          await setStatus(context.sessionID, "implementation")
          return {
            content: `Switched to implementation with DeepSeek Flash in this conversation. Review runs inside implementation; ask for QA when the implementation is ready.`,
          }
        },
      })
    })

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
              shouldAutoUpdate(
                normalizeStatus(
                  typeof workflow(session).status === "string" ? (workflow(session).status as string) : undefined,
                ),
              ),
          )
          .slice(0, 10)
        for (const session of candidates) await check(session.id).catch(() => undefined)
      } finally {
        running = false
      }
    }
    void poll().catch((error) => console.error("workflow: poll failed", error))
    const timer = setInterval(() => void poll().catch((error) => console.error("workflow: poll failed", error)), 30_000)
    return () => clearInterval(timer)

    async function check(sessionID: string) {
      if (checking.has(sessionID)) return
      checking.add(sessionID)
      try {
        const session = await ctx.session.get({ sessionID })
        if (session.parentID) return
        const current = workflow(session)
        if (!shouldAutoUpdate(typeof current.status === "string" ? current.status : undefined)) return
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
        if (Date.now() - (checked.get(key) ?? 0) < 60_000) return
        checked.set(key, Date.now())
        const gh = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh"].find((path) => Bun.file(path).size > 0)
        if (!gh) return
        const process = Bun.spawn(
          [gh, "pr", "list", "--head", branch, "--state", "all", "--json", "number,state,mergedAt", "--limit", "1"],
          {
            cwd: session.location.directory,
            stdout: "pipe",
            stderr: "ignore",
            signal: AbortSignal.timeout(10_000),
            env: { ...Bun.env, GH_CONFIG_DIR: Bun.env.GH_CONFIG_DIR ?? `${Bun.env.HOME}/.config/gh` },
          },
        )
        if ((await process.exited) !== 0) return
        const pr = parsePullRequest(await new Response(process.stdout).text()).at(0)
        if (!pr) return
        if (pr.state === "MERGED") {
          await setStatus(sessionID, "merged", { pullRequest: pr.number, mergedAt: pr.mergedAt })
          return
        }
        if (pr.state === "OPEN") {
          await setStatus(sessionID, "qa", { pullRequest: pr.number })
          return
        }
      } finally {
        checking.delete(sessionID)
      }
    }
  },
})
