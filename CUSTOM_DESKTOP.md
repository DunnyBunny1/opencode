# Donovan's OpenCode fork

Canonical checkout: `~/Code/opencode`; `~/Developer/opencode` is a symlink to it.
GitHub: `origin` = `DunnyBunny1/opencode`, `upstream` = `anomalyco/opencode`.
Personal branch: `personal-desktop`. Push only to origin; never force-push synchronization.

## Local environment

macOS arm64, Xcode selected at `/Applications/Xcode.app/Contents/Developer`,
Bun 1.4.3 (repository accepts ^1.4.2), Node and GitHub CLI installed.
V2 desktop uses Electron, not Tauri; Rust is not required.
`bun install --frozen-lockfile` installs Electron and native PTY dependencies.

## App and data

`/Applications/OpenCode Custom.app` has bundle ID `ai.opencode.desktop.custom`.
It uses the dev channel to disable official automatic updates, no URL handler,
and a locally compiled CLI with a unique custom version. It never selects a CLI from PATH.
The bundle is ad-hoc signed for this Mac, not notarized for distribution.

Custom server data/config/state/cache: `~/.local/share/opencode-custom/`.
Custom desktop settings: `~/Library/Application Support/ai.opencode.desktop.custom/`.
Initial sessions, credentials, settings, drafts and window state were snapshotted from the
original app using SQLite's online backup API. Copied execution claims are cleared so
existing work does not run twice. Chromium disposable caches are not imported.
The original app/data remain in place and active. **New work in the two apps diverges.**
Do not replace one database with the other to synchronize later sessions.
The original `~/.config/opencode/AGENTS.md` is copied into the custom config at seeding;
keep its self-development instructions in sync when changing global guidance.

## Safe development and deployment

From this checkout:

```sh
bash script/custom-sync.sh
# Review new upstream commits, then git merge upstream/dev; stop and ask on risky conflicts.
bash script/custom-build.sh
python3 script/custom-install.py 'packages/desktop/dist/mac-arm64/OpenCode Custom.app'
node script/custom-smoke.mjs '/Applications/OpenCode Custom.app'
open '/Applications/OpenCode Custom.app'
```

Sync fetches at most once per calendar day and reports commits to integrate. It does not
discard local changes or silently resolve conflicts. After acceptance, commit and push
the personal branch to origin. Update origin/dev by fast-forward only when appropriate.

Build runs the full lint/typecheck, desktop tests, local CLI compilation, Electron build,
packaging, ad-hoc signing and GUI/API smoke test. Production prebuild refuses a custom
build without an explicit local CLI distribution. Tests make no inference requests.
Do not run smoke/build against an active custom app/session without permission: smoke
opens and closes its own window, and version changes may restart the custom server.
The scripts refuse if a custom desktop window is running. For interactive source development:
`OPENCODE_CUSTOM=1 bun run dev:desktop` (uses the isolated custom profile).

Installation requires a successful smoke report matching both backend and app archive
hashes and verifies the signature. It backs up data, archives the candidate and previous
bundle, then copies to the separate Applications path. A failed copy restores the old bundle.
No script stops the original app or service. Ask before any active-session restart.

## Rollback

Known-good bundles and reports live in
`~/Library/Application Support/OpenCode Custom Builds/<timestamp>/`.
After approval to close the custom app, restore a chosen tested version with:

```sh
python3 script/custom-install.py "$HOME/Library/Application Support/OpenCode Custom Builds/<timestamp>/OpenCode Custom.app"
node script/custom-smoke.mjs '/Applications/OpenCode Custom.app'
```

This restores code, not the database. For schema-changing upgrades, assess backward
compatibility before rollout. Consistent private data backups are in
`~/Library/Application Support/OpenCode Custom Backups/<timestamp>/`.
Restore a data snapshot only with explicit approval, both relevant processes stopped,
and a fresh backup of current data; restoration loses changes since that snapshot.
The original `/Applications/OpenCode.app` remains an independent fallback.

`python3 script/custom-snapshot.py` makes another custom-data backup.
`seed` is first-install only and refuses to overwrite an existing profile.

## Acceptance evidence (2026-10-19)

Upstream integrated through `815de9950b` (clean fast-forward).
Full check: 34 packages successful. Desktop suite: 130 passed, 1 skipped, 0 failed.
Packaged and installed GUI launched and restored the imported session listing.
API PID resolves to `ai.opencode.desktop.custom/cli/<custom-version>-arm64/opencode-cli`;
SHA-256 matches the bundled backend, and original service registration stays unchanged.
Reports and screenshots are produced beside the tested bundle. No model request was made.
