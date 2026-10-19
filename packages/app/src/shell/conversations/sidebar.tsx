import { createEffect, createMemo, For, onCleanup, Show, startTransition } from "solid-js"
import { createStore } from "solid-js/store"
import { skipToken, useQuery, useQueryClient } from "@tanstack/solid-query"
import { DragDropProvider, PointerSensor, useDroppable } from "@dnd-kit/solid"
import { isSortable, useSortable } from "@dnd-kit/solid/sortable"
import { Feedback, PointerActivationConstraints } from "@dnd-kit/dom"
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
import { sessionFormRequest, sessionPermissionRequest } from "@/session/requests/session-request-tree"
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
  const [state, setState] = createStore({
    search: "",
    board: false,
    pending: "",
    editing: "",
    editTitle: "",
    renaming: "",
  })
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
      refetchInterval: 30_000,
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
  const activity = createMemo(() => {
    const ctx = context()
    const result = new Map<string, { loading: boolean; attention: boolean; unread: boolean }>()
    if (!ctx) return result
    for (const root of sessions()) {
      const family = [...new Set([root.id, ...ctx.data.session.family(root.id)])]
      const familySessions = family.flatMap((id) => {
        const info = ctx.data.session.get(id)
        return info ? [info] : []
      })
      const attention =
        !!sessionPermissionRequest(familySessions, ctx.data.session.permission.list, root.id) ||
        !!sessionFormRequest(familySessions, ctx.data.session.form.list, root.id)
      const loading =
        !attention &&
        family.some(
          (id) =>
            ctx.data.session.status(id) === "running" ||
            ctx.data.session.pending.list(id).some((item) => item.type !== "synthetic"),
        )
      result.set(root.id, {
        attention,
        loading,
        unread: !attention && !loading && ctx.notification.session.unread(root.id, root),
      })
    }
    return result
  })
  const groups = createMemo(() => conversationGroups(sessions(), state.search, true))
  const boardGroups = createMemo(() =>
    conversationGroups(sessions(), state.search, saved.history, true).filter(
      (group) => (group.workflow.status ?? "unclassified") !== "idea",
    ),
  )
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

  const remember = (session: SessionInfo) => {
    const conn = connection()
    context()?.data.session.remember(session)
    if (conn)
      cache.setQueryData<SessionInfo[]>(["conversation-sidebar", conn], (sessions) =>
        sessions?.map((item) => (item.id === session.id ? session : item)),
      )
  }

  const update = async (session: SessionInfo, change: typeof Workflow.Type) => {
    const ctx = context()
    if (!ctx) return
    const nextWorkflow = { ...workflow(session), ...change }
    remember({ ...session, metadata: { ...session.metadata, customWorkflow: nextWorkflow } })
    setState("pending", session.id)
    try {
      const current = await ctx.sdk.api.session.get({ sessionID: session.id })
      await ctx.sdk.api.session.update({
        sessionID: session.id,
        metadata: { ...current.metadata, customWorkflow: { ...workflow(current), ...change } },
      })
      remember(await ctx.sdk.api.session.get({ sessionID: session.id }))
      await cache.invalidateQueries({ queryKey: ["conversation-sidebar", connection()] })
    } catch (error) {
      remember(session)
      showToast({ title: language.t("common.requestFailed"), description: String(error) })
    } finally {
      setState("pending", "")
    }
  }

  const rename = async (session: SessionInfo) => {
    const ctx = context()
    const title = state.editTitle.trim()
    setState("editing", "")
    if (!ctx || !title || title === session.title) return
    setState("renaming", session.id)
    remember({ ...session, title })
    try {
      await ctx.sdk.api.session.update({ sessionID: session.id, title })
      remember(await ctx.sdk.api.session.get({ sessionID: session.id }))
      await cache.invalidateQueries({ queryKey: ["conversation-sidebar", connection()] })
    } catch (error) {
      remember(session)
      showToast({ title: language.t("common.requestFailed"), description: String(error) })
    } finally {
      setState("renaming", "")
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
                  done: "☑",
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
    let opening: ReturnType<typeof setTimeout> | undefined
    onCleanup(() => clearTimeout(opening))
    const active = () => {
      const route = layout.route()
      return route.type === "session" && props.group.root.id === route.sessionId
    }
    const startRename = () => {
      clearTimeout(opening)
      setState({ editing: props.group.root.id, editTitle: props.group.root.title ?? "" })
    }
    return (
      <div class="conversation-item">
        <div class="conversation-row" classList={{ active: active() }}>
          <Show
            when={state.editing === props.group.root.id}
            fallback={
              <span
                class="conversation-title"
                role="link"
                tabIndex={0}
                dir="auto"
                title={props.group.root.title}
                onClick={(event) => {
                  if (event.detail > 1) return
                  clearTimeout(opening)
                  opening = setTimeout(() => open(props.group.root), 220)
                }}
                onDblClick={startRename}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return
                  event.preventDefault()
                  open(props.group.root)
                }}
              >
                {props.group.root.title || language.t("command.session.new")}
              </span>
            }
          >
            <input
              class="conversation-title conversation-rename"
              dir="auto"
              aria-label={language.t("conversations.rename", { title: props.group.root.title ?? "" })}
              value={state.editTitle}
              ref={(element) => setTimeout(() => element.select())}
              onInput={(event) => setState("editTitle", event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  void rename(props.group.root)
                }
                if (event.key === "Escape") {
                  event.preventDefault()
                  setState("editing", "")
                }
              }}
              onBlur={() => void rename(props.group.root)}
            />
          </Show>
          <Show when={activity().get(props.group.root.id)}>
            {(state) => (
              <Show
                when={state().attention}
                fallback={
                  <Show
                    when={state().loading}
                    fallback={
                      <Show when={state().unread}>
                        <span
                          class="conversation-unread"
                          aria-label={language.t("conversations.unread")}
                          title={language.t("conversations.unread")}
                        />
                      </Show>
                    }
                  >
                    <span
                      class="conversation-spinner"
                      aria-label={language.t("conversations.running")}
                      title={language.t("conversations.running")}
                    />
                  </Show>
                }
              >
                <span
                  class="conversation-attention"
                  aria-label={language.t("conversations.needsInput")}
                  title={language.t("conversations.needsInput")}
                >
                  !
                </span>
              </Show>
            )}
          </Show>
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

  function BoardCard(props: { group: ConversationGroup; index: number }) {
    const status = () => props.group.workflow.status ?? "unclassified"
    const sortable = useSortable({
      get id() {
        return props.group.root.id
      },
      get index() {
        return props.index
      },
      get group() {
        return status()
      },
    })
    return (
      <article
        ref={sortable.ref}
        role="listitem"
        class="conversation-board-card"
        classList={{ dragging: sortable.isDragSource() }}
        aria-label={props.group.root.title}
      >
        <Row group={props.group} />
        <div class="conversation-board-meta">
          <small>{props.group.directory.split(/[\\/]/).at(-1)}</small>
          <span class="conversation-board-grip" aria-hidden="true" title={language.t("conversations.drag")}>
            ⠿
          </span>
        </div>
      </article>
    )
  }

  function BoardColumn(props: { status: (typeof statuses)[number]; groups: ConversationGroup[] }) {
    const droppable = useDroppable({
      get id() {
        return `board-column:${props.status}`
      },
    })
    return (
      <section
        ref={droppable.ref}
        aria-label={language.t(`conversations.status.${props.status}`)}
        classList={{ "drop-target": droppable.isDropTarget() }}
      >
        <h2>{language.t(`conversations.status.${props.status}`)}</h2>
        <div role="list" class="conversation-board-dropzone">
          <For each={props.groups} fallback={<p class="conversation-empty">{language.t("conversations.dropHere")}</p>}>
            {(group, index) => <BoardCard group={group} index={index()} />}
          </For>
        </div>
      </section>
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
          <DragDropProvider
            sensors={(defaults) => [
              ...defaults.filter((sensor) => sensor !== PointerSensor),
              PointerSensor.configure({
                activationConstraints: [new PointerActivationConstraints.Distance({ value: 4 })],
              }),
            ]}
            plugins={(defaults) => [
              ...defaults.filter((plugin) => plugin !== Feedback),
              Feedback.configure({ dropAnimation: null }),
            ]}
            onDragEnd={(event) => {
              const source = event.operation.source
              const target = event.operation.target
              if (event.canceled || !isSortable(source) || !target) return
              const column = String(target.id)
              const next = column.startsWith("board-column:")
                ? column.slice(13)
                : typeof source.group === "string"
                  ? source.group
                  : undefined
              if (!next || !statuses.includes(next as (typeof statuses)[number])) return
              if (next === source.initialGroup) return
              const group = boardGroups().find((item) => item.root.id === String(source.id))
              if (!group || (group.workflow.status ?? "unclassified") === next) return
              void update(group.root, { status: next as (typeof statuses)[number] })
            }}
          >
            <div class="conversation-columns">
              <For each={statuses}>
                {(status) => (
                  <BoardColumn
                    status={status}
                    groups={boardGroups().filter((group) => (group.workflow.status ?? "unclassified") === status)}
                  />
                )}
              </For>
            </div>
          </DragDropProvider>
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
