import type { SessionInfo } from "@opencode/client/promise"
import { Option, Schema } from "effect"

export const boardStatuses = ["planning", "implementation", "qa", "merged"] as const
export const offBoardStatuses = ["idea", "blocked", "shelved"] as const
export const statuses = ["unclassified", ...boardStatuses, ...offBoardStatuses] as const

// Stored values include old names so existing sessions decode without losing their metadata.
const storedStatuses = [...statuses, "in-progress", "ready", "done"] as const

export const Workflow = Schema.Struct({
  status: Schema.optional(Schema.Literals(storedStatuses)),
  ready: Schema.optional(Schema.Boolean),
  pinned: Schema.optional(Schema.Boolean),
  pullRequest: Schema.optional(Schema.Number),
  mergedAt: Schema.optional(Schema.String),
})

const Codex = Schema.Struct({ updatedAt: Schema.Number, sidebarDirectory: Schema.optional(Schema.String) })

export function workflow(session: SessionInfo): typeof Workflow.Type {
  // Keep old stored names readable while exposing only current phases to the UI.
  const decoded = Option.getOrUndefined(Schema.decodeUnknownOption(Workflow)(session.metadata?.customWorkflow))
  const value: typeof Workflow.Type = decoded ?? {}
  if (value.status === "in-progress") return { ...value, status: "implementation" }
  if (value.status === "done") return { ...value, status: "qa" }
  if (value.status === "ready") return { ...value, status: "qa", ready: true }
  return value
}

export function conversationGroups(sessions: SessionInfo[], search: string, history: boolean, board = false) {
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
      // The sidebar is the full archive; the board is the active work view.
      if (!board || history) return true

      return !group.root.time.archived && group.updated >= Date.now() - 7 * 24 * 60 * 60 * 1000
    })
    .toSorted((a, b) => b.updated - a.updated || a.root.id.localeCompare(b.root.id))
}

export type ConversationGroup = ReturnType<typeof conversationGroups>[number]
