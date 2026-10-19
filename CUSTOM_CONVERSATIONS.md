# Custom conversation workspace

## UI

- The desktop-width conversation sidebar shows pins first, then expandable folders.
- Unpinned history defaults to the last seven days. Search covers all indexed titles and paths;
  **Show older than seven days** includes archived/older entries. Transcript-body search is not implemented.
- Click a row's status icon to choose Unclassified, Idea, In progress, Blocked, Ready,
  Shelved, Done, or Merged. Status is manual; it does not infer GitHub PR state.
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
