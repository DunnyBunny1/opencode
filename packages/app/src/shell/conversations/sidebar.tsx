import { createEffect, createMemo, For, onCleanup, Show, startTransition } from "solid-js"
import { createStore } from "solid-js/store"
import { skipToken, useQuery, useQueryClient } from "@tanstack/solid-query"
import { Schema } from "effect"
import { Icon } from "@opencode/ui/icon"
import { ResizeHandle } from "@opencode/ui/resize-handle"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import type { SessionInfo } from "@opencode/client/promise"
import { useServerCtx } from "@/runtime/server/runtime"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { useLanguage } from "@/runtime/i18n/language"
import { useLayout } from "@/shell/state/layout"
import { useTabs } from "@/shell/tabs/tabs"
import { useCommand } from "@/shell/commands/command"
import { showToast } from "@/shell/notifications/toast"
import { listAllSessions } from "@/session/list"
import { conversationGroups, statuses, workflow, type ConversationGroup, type Workflow } from "./model"
import "./sidebar.css"

const preferences = Persistence.struct({
  opened: Schema.Boolean,
  width: Schema.Finite,
  history: Schema.Boolean,
  collapsed: Persistence.record(Schema.Boolean),
})

export function ConversationSidebar() {
  const language = useLanguage()
  const servers = useServers()
  const layout = useLayout()
  const tabs = useTabs()
  const command = useCommand()
  const cache = useQueryClient()
  const dialog = useDialog()
  let boardTrigger: HTMLButtonElement | undefined
  const [saved, save] = persisted(Persist.global("custom-conversations"), preferences, {
    opened: true,
    width: 290,
    history: false,
    collapsed: {},
  })
  const [state, setState] = createStore({ search: "", board: false, pending: "" })
  const connection = createMemo(() => {
    const route = layout.route()
    const key = route.type === "session" ? route.server : layout.home.selection().server

    return servers.visible.find((server) => ServerConnection.key(server) === key) ?? servers.visible[0]
  })
  const context = useServerCtx(connection)
  const query = useQuery(() => {
    const ctx = context()
    const conn = connection()

    return {
      queryKey: ["conversation-sidebar", conn],
      enabled: !!ctx && ctx.sdk.connection.status() === "connected",
      queryFn: ctx
        ? () => listAllSessions(ctx.sdk.api.session, { parentID: null, order: "desc", limit: 500 })
        : skipToken,
      select: (sessions: SessionInfo[]) => () => sessions,
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    }
  })
  const sessions = createMemo(() => {
    const ctx = context()
    const known = ctx?.data.session.list() ?? []
    const merged = [...new Map([...(query.data?.() ?? []), ...known].map((session) => [session.id, session])).values()]

    return ctx?.data.session.apply(merged).filter((session) => !session.parentID) ?? []
  })
  createEffect(() => {
    const ctx = context()
    const conn = connection()
    if (!ctx) return
    onCleanup(
      ctx.sdk.event.on("session.deleted", (event) => {
        cache.setQueryData<SessionInfo[]>(["conversation-sidebar", conn], (sessions) =>
          sessions?.filter((session) => session.id !== event.data.sessionID),
        )
      }),
    )
  })
  const groups = createMemo(() => conversationGroups(sessions(), state.search, saved.history))
  const pinned = createMemo(() => groups().filter((group) => group.workflow.pinned))
  const projects = createMemo(() => {
    const groupsByDirectory = Map.groupBy(
      groups().filter((group) => !group.workflow.pinned),
      (group) => group.directory,
    )
    for (const project of context()?.projects.list() ?? [])
      if (!groupsByDirectory.has(project.worktree) && !state.search) groupsByDirectory.set(project.worktree, [])

    return [...groupsByDirectory].toSorted(([a], [b]) => a.localeCompare(b))
  })

  command.register(() => [
    {
      id: "sidebar.toggle",
      title: language.t("conversations.toggle"),
      category: language.t("command.category.view"),
      keybind: "mod+shift+b",
      onSelect: () => save("opened", (opened) => !opened),
    },
  ])

  const open = (session: SessionInfo) => {
    const conn = connection()
    const ctx = context()
    if (!conn || !ctx) return
    ctx.data.session.remember(session)
    void startTransition(() => {
      tabs.select(tabs.addSessionTab({ server: ServerConnection.key(conn), sessionId: session.id }))
      if (state.board) dialog.close()
    })
  }

  const update = async (session: SessionInfo, change: typeof Workflow.Type) => {
    const ctx = context()
    if (!ctx) return
    setState("pending", session.id)
    try {
      const current = await ctx.sdk.api.session.get({ sessionID: session.id })
      await ctx.sdk.api.session.update({
        sessionID: session.id,
        metadata: { ...current.metadata, customWorkflow: { ...workflow(current), ...change } },
      })
      const next = await ctx.sdk.api.session.get({ sessionID: session.id })
      ctx.data.session.remember(next)
      await cache.invalidateQueries({ queryKey: ["conversation-sidebar", connection()] })
    } catch (error) {
      showToast({ title: language.t("common.requestFailed"), description: String(error) })
    } finally {
      setState("pending", "")
    }
  }

  function Status(props: { group: ConversationGroup }) {
    const status = () => props.group.workflow.status ?? "unclassified"
    return (
      <span class="conversation-status" data-status={status()} title={language.t(`conversations.status.${status()}`)}>
        <Show
          when={status() === "merged"}
          fallback={
            <span aria-hidden="true">
              {
                {
                  unclassified: "○",
                  idea: "💡",
                  "in-progress": "◐",
                  blocked: "⛔",
                  ready: "✓",
                  shelved: "☾",
                  done: "✓",
                  merged: "",
                }[status()]
              }
            </span>
          }
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            aria-hidden="true"
          >
            <circle cx="6" cy="5" r="2" />
            <circle cx="6" cy="19" r="2" />
            <circle cx="18" cy="19" r="2" />
            <path d="M6 7v10m0-10c0 8 12 2 12 10" />
          </svg>
        </Show>
        <select
          aria-label={language.t("conversations.statusLabel", { title: props.group.root.title ?? "" })}
          value={status()}
          disabled={!!state.pending}
          onChange={(event) => {
            const status = statuses.find((status) => status === event.currentTarget.value)
            if (status) void update(props.group.root, { status })
          }}
        >
          <For each={statuses}>
            {(status) => <option value={status}>{language.t(`conversations.status.${status}`)}</option>}
          </For>
        </select>
      </span>
    )
  }

  function Row(props: { group: ConversationGroup }) {
    const active = () => {
      const route = layout.route()
      return route.type === "session" && props.group.root.id === route.sessionId
    }
    return (
      <div class="conversation-item">
        <div class="conversation-row" classList={{ active: active() }}>
          <button
            class="conversation-title"
            dir="auto"
            title={props.group.root.title}
            onClick={() => open(props.group.root)}
          >
            {props.group.root.title || language.t("command.session.new")}
          </button>
          <Status group={props.group} />
          <button
            class="conversation-pin"
            aria-label={language.t(props.group.workflow.pinned ? "conversations.unpin" : "conversations.pin")}
            disabled={!!state.pending}
            onClick={() => void update(props.group.root, { pinned: !props.group.workflow.pinned })}
          >
            {props.group.workflow.pinned ? "★" : "☆"}
          </button>
        </div>
      </div>
    )
  }

  const showBoard = () => {
    setState("board", true)
    void dialog.show(
      () => (
        <Dialog
          size="x-large"
          class="conversation-board"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            boardTrigger?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitleGroup title={language.t("conversations.board")} />
          </DialogHeader>
          <div class="conversation-board-filters">
            <input
              type="search"
              aria-label={language.t("conversations.search")}
              placeholder={language.t("conversations.search")}
              value={state.search}
              onInput={(event) => setState("search", event.currentTarget.value)}
            />
            <label class="conversation-history">
              <input
                type="checkbox"
                checked={saved.history}
                onChange={(event) => save("history", event.currentTarget.checked)}
              />
              {language.t("conversations.history")}
            </label>
          </div>
          <div class="conversation-columns">
            <For each={statuses}>
              {(status) => (
                <section>
                  <h2>{language.t(`conversations.status.${status}`)}</h2>
                  <For each={groups().filter((group) => (group.workflow.status ?? "unclassified") === status)}>
                    {(group) => (
                      <article>
                        <Row group={group} />
                        <small>{group.directory.split(/[\\/]/).at(-1)}</small>
                      </article>
                    )}
                  </For>
                </section>
              )}
            </For>
          </div>
        </Dialog>
      ),
      () => setState("board", false),
    )
  }

  return (
    <>
      <Show
        when={saved.opened}
        fallback={
          <button
            class="conversation-reopen"
            aria-label={language.t("conversations.toggle")}
            onClick={() => save("opened", true)}
          >
            <Icon name="chevron-right" />
          </button>
        }
      >
        <aside
          class="conversation-sidebar"
          aria-label={language.t("conversations.title")}
          style={{ width: `${saved.width}px` }}
        >
          <div class="conversation-toolbar">
            <strong>{language.t("conversations.title")}</strong>
            <button ref={boardTrigger} onClick={showBoard} aria-haspopup="dialog" aria-expanded={state.board}>
              {language.t("conversations.board")}
            </button>
            <button aria-label={language.t("conversations.toggle")} onClick={() => save("opened", false)}>
              <Icon name="chevron-left" />
            </button>
          </div>
          <input
            type="search"
            aria-label={language.t("conversations.search")}
            placeholder={language.t("conversations.search")}
            value={state.search}
            onInput={(event) => setState("search", event.currentTarget.value)}
          />
          <label class="conversation-history">
            <input
              type="checkbox"
              checked={saved.history}
              onChange={(event) => save("history", event.currentTarget.checked)}
            />
            {language.t("conversations.history")}
          </label>
          <Show when={query.isError}>
            <button onClick={() => void query.refetch()}>{language.t("conversations.retry")}</button>
          </Show>
          <div class="conversation-scroll">
            <h2>{language.t("conversations.pinned")}</h2>
            <For each={pinned()} fallback={<p class="conversation-empty">{language.t("conversations.noPinned")}</p>}>
              {(group) => <Row group={group} />}
            </For>
            <h2>{language.t("conversations.projects")}</h2>
            <For each={projects()}>
              {([directory, items]) => (
                <section>
                  <button
                    class="conversation-project"
                    aria-expanded={!saved.collapsed[directory]}
                    title={directory}
                    onClick={() => save("collapsed", directory, !saved.collapsed[directory])}
                  >
                    <Icon name={saved.collapsed[directory] ? "chevron-right" : "chevron-down"} />
                    <Icon name="folder" />
                    <span>{directory.split(/[\\/]/).filter(Boolean).at(-1) ?? directory}</span>
                    <small>{items.length}</small>
                  </button>
                  <Show when={!saved.collapsed[directory]}>
                    <div class="conversation-project-items">
                      <For each={items}>{(group) => <Row group={group} />}</For>
                    </div>
                  </Show>
                </section>
              )}
            </For>
            <Show when={!query.isPending && groups().length === 0}>
              <p class="conversation-empty">{language.t("conversations.empty")}</p>
            </Show>
          </div>
          <ResizeHandle
            direction="horizontal"
            size={saved.width}
            min={220}
            max={480}
            onResize={(width) => save("width", width)}
            class="-end-1"
          />
        </aside>
      </Show>
    </>
  )
}
