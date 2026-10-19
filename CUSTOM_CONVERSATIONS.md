# Custom conversation workspace

## UI

- The desktop-width conversation sidebar shows pins first, then expandable folders.
- The sidebar shows all history, newest first, with pins first and then project folders. Search
  covers all indexed titles and paths. Transcript-body search is not implemented.
- The board is the active-work view: it shows the last seven days by default; **Show older than
  seven days** widens it. Idea chats stay in the sidebar and do not appear on the board.
- Each row shows a running spinner, an amber **!** for a pending permission/form, or a blue dot
  for unread activity after completion.
- Click a row's status icon to choose a board phase (Planning, Implementation, QA, Merged),
  a flag (Ready), or an off-board state (Unclassified, Idea, Blocked, Shelved). Ready is a
  checkered-flag modifier, not a fifth column. Double-click a title to rename it inline.
- `plugins/workflow` auto-fills phases: first prompt → Planning, first edit/write/patch →
  Implementation, open PR → QA, merged PR → Merged. It polls each loaded project every 30
  seconds with `gh pr list --head <branch> --state all`; it never infers from chat completion,
  never runs on a default branch, and preserves deliberate Idea/Blocked/Shelved/Merged choices.
  It requires authenticated `gh`; failures are ignored. The sidebar refetches every 30 seconds.
- The `start_implementation` tool (used by agentic engineering) switches the same conversation
  from Astra planning to Build + DeepSeek Flash and sets Implementation. No new chat is created.
- Board cards are draggable anywhere on the card between phase columns. Dropping updates the
  same durable metadata and clears Ready; within-column ordering is not persisted.
- The Projects header has a `+` that opens the directory picker.
- Imported historical Codex tool calls render as collapsed tool records instead of raw JSON.
- Hover/focus a row to pin/unpin it. Pins and statuses live in native session metadata
  (`customWorkflow`), so the sidebar and board use the same data.
- **Board** opens status columns; the status chooser moves a card between columns.
  Escape closes the board. Sidebar visibility is `Cmd+Shift+B`; the existing Home shortcut is retained.
- Astra and DeepSeek V4.1 Flash 1017 are preferred picker entries when their providers are connected.
  Model choice is optional and may change within a conversation. Linked phase sessions remain deferred:
  <https://github.com/DunnyBunny1/opencode/issues/1>.
- Astra's separate Standard/Fast/Ultrafast selector uses configured `custom-<speed>-<reasoning>`
  variants. These pass `serviceTier` and `reasoningEffort` to the existing OpenAI integration;
  reasoning changes preserve speed. Availability, quota and pricing are provider-controlled.
- The approval chooser uses the existing project-level auto-approval setting. “Full access ·
  auto-approve” accepts permission requests; configured denials still apply. It does not alter OS
  sandboxing or globally loosen permissions merely by displaying the control.

## Codex import

The custom global `opencode.jsonc` references `~/.codex/AGENTS.md`, `~/.codex/RTK.md`, and
`~/.codex/skills`, preserving the originals as the source of truth. Credentials are not copied
from Codex; the existing custom OpenCode provider credentials are retained.

`script/import-codex.py` requires Python 3.14 (stdlib Zstandard support). It reads Codex's
SQLite thread index and plain/compressed rollout files, then uses the custom backend's native
session-import API. It never opens the OpenCode database for writing and makes no model requests.

```sh
python3 script/custom-snapshot.py
python3 script/import-codex.py             # dry run
python3 script/import-codex.py --apply     # additive, deterministic session/message IDs
```

Existing imported IDs are skipped, including if the user has continued or edited the imported chat.
This is a snapshot import, not ongoing synchronization. Codex names, pins, folder assignments,
archive state, timestamps and available subagent parent links are retained. Leading status labels
are mapped to the enum; original titles remain intact. Native import updates its import timestamp,
so the sidebar uses original activity/idle timestamps for historical recency.

Readable user/assistant messages and historical tool records are imported. Tools are transcript text,
never pending executable calls. Injected Codex AGENTS/environment wrappers and developer/system
messages are not activated as current instructions. Encrypted reasoning and binary/image payloads
remain in the original rollout; image placeholders point out this limitation. Each imported session
records its original Codex ID and rollout path. Raw source files are never modified.

Private reports live under `~/.local/share/opencode-custom/imports/`.
`--refresh-labels` changes raw Codex titles only while they still match the initial import.
The globally configured `plugins/codex-history` plugin filters imported harness instruction wrappers
from outgoing primary, compaction and generation requests, using provenance that survives forks.
It preserves imported titles rather than sending their flattened history to title generation.
Existing history remains intact; no session deletion/replacement is needed. New user instructions
and non-imported chats are unaffected.

## Verification

Use `CUSTOM_DESKTOP.md` for native build/install/rollback. Do not restart the active app or server.
Browser preview/testing can use a separate frontend connected explicitly to the existing service.
The Home and Composer E2E keeper suites cover sidebar persistence/search/status, board focus,
deletion, speed/reasoning and approval selection. Python conversion coverage lives in
`script/tests/test_import_codex.py`.
