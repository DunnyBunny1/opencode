import type { SessionInfo } from "@opencode/client/promise"
import { Option, Schema } from "effect"

export const statuses = [
  "unclassified",
  "idea",
  "in-progress",
  "blocked",
  "ready",
  "shelved",
  "done",
  "merged",
] as const
export const Workflow = Schema.Struct({
  status: Schema.optional(Schema.Literals(statuses)),
  pinned: Schema.optional(Schema.Boolean),
  pullRequest: Schema.optional(Schema.Number),
  mergedAt: Schema.optional(Schema.String),
})

const Codex = Schema.Struct({ updatedAt: Schema.Number, sidebarDirectory: Schema.optional(Schema.String) })

export function workflow(session: SessionInfo): typeof Workflow.Type {
  return Option.getOrElse(Schema.decodeUnknownOption(Workflow)(session.metadata?.customWorkflow), () => ({}))
}

export function conversationGroups(sessions: SessionInfo[], search: string, history: boolean) {
  const needle = search.trim().toLocaleLowerCase()

  return sessions
    .map((root) => {
      const imported = Option.getOrUndefined(Schema.decodeUnknownOption(Codex)(root.metadata?.codex))
      return {
        root,
        // Native import sets time.updated to import time. Historical activity must stay historical.
        updated: imported ? Math.max(imported.updatedAt, root.time.idle ?? root.time.created) : root.time.updated,
        directory: imported?.sidebarDirectory ?? root.location.directory,
        workflow: workflow(root),
      }
    })
    .filter((group) => {
      if (needle)
        return `${group.root.title ?? ""} ${group.root.location.directory}`.toLocaleLowerCase().includes(needle)
      if (group.workflow.pinned) return true
      if (history) return true

      return !group.root.time.archived && group.updated >= Date.now() - 7 * 24 * 60 * 60 * 1000
    })
    .toSorted((a, b) => b.updated - a.updated || a.root.id.localeCompare(b.root.id))
}

export type ConversationGroup = ReturnType<typeof conversationGroups>[number]
