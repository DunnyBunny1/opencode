import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: "custom.codex-history",
  async setup(ctx) {
    // Preserve the imported transcript while excluding old harness instructions from every model request.
    for (const kind of ["context", "compaction", "generate"] as const) {
      await ctx.session.hook(kind, (event) => {
        event.messages = event.messages.filter((message) => {
          // Provenance survives native forks, unlike session and message IDs.
          const source = message.metadata?.codex
          if (
            typeof source !== "object" ||
            source === null ||
            !("line" in source) ||
            typeof source.line !== "number" ||
            !("type" in source) ||
            source.type !== "message"
          )
            return true
          return (
            message.role !== "user" ||
            !message.content.some(
              (part) =>
                part.type === "text" &&
                (part.text.startsWith("# AGENTS.md instructions for ") ||
                  part.text.startsWith("<environment_context>")),
            )
          )
        })
      })
    }
    // Title generation flattens history into an ID-less message. Imported names are already authoritative.
    await ctx.session.hook("title", async (event) => {
      const session = await ctx.session.get({ sessionID: event.sessionID })
      if (session.metadata?.codex && session.title) event.result = session.title
    })
  },
})
