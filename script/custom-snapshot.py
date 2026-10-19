"""Private, consistent SQLite snapshots; never copy live WAL files."""
import datetime
import os
import json
import socket
from pathlib import Path
import shutil
import sqlite3
import sys

os.umask(0o077)
home = Path.home()
root = home / ".local/share/opencode-custom"
backup = home / "Library/Application Support/OpenCode Custom Backups" / datetime.datetime.now().strftime("%Y%m%d-%H%M%S")


def snapshot(source, target):
    if not source.exists():
        return
    target.mkdir(parents=True, exist_ok=True)
    for item in source.iterdir():
        if source.name.startswith("ai.opencode.desktop") and not (
            item.name in {"drafts.sqlite", "opencode.settings"}
            or item.name.startswith("window-state-")
            or item.name.endswith(".dat")
        ):
            continue
        if item.is_symlink() or item.name.startswith("Singleton") or item.name.endswith(("-wal", "-shm", "-journal")):
            continue
        if item.name in {"cli", "Cache", "Code Cache", "GPUCache", "compile-cache", "Crashpad", "logs", "log", "shell"}:
            continue
        dest = target / item.name
        if item.is_dir():
            snapshot(item, dest)
            continue
        with item.open("rb") as stream:
            sqlite = stream.read(16) == b"SQLite format 3\x00"
        if sqlite:
            with sqlite3.connect(f"file:{item}?mode=ro", uri=True) as src, sqlite3.connect(dest) as dst:
                src.backup(dst)
                assert dst.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        else:
            shutil.copy2(item, dest)


if sys.argv[1:] == ["seed"]:
    if root.exists() or (home / "Library/Application Support/ai.opencode.desktop.custom").exists():
        raise SystemExit("Custom profile already exists; refusing to overwrite it")
    snapshot(home / ".local/share/opencode", backup / "data/opencode")
    snapshot(home / ".config/opencode", backup / "config/opencode")
    snapshot(home / "Library/Application Support/ai.opencode.desktop", backup / "desktop")
    shutil.copytree(backup / "data", root / "data")
    # Imported history must not resume work still executing in the original app.
    with sqlite3.connect(root / "data/opencode/opencode.db") as db:
        db.execute("UPDATE session_v2 SET time_suspended = NULL, resume_attempts = 0")
    shutil.copytree(backup / "config", root / "config")
    # A copied fixed port/password would compete with the active original service.
    (root / "config/opencode/service.json").unlink(missing_ok=True)
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    (root / "config/opencode/service.json").write_text(json.dumps({"port": port}))
    shutil.copytree(backup / "desktop", home / "Library/Application Support/ai.opencode.desktop.custom")
else:
    snapshot(root / "data", backup / "data")
    snapshot(root / "config", backup / "config")
    snapshot(home / "Library/Application Support/ai.opencode.desktop.custom", backup / "desktop")
print(backup)
