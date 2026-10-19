"""Install only smoke-tested candidates; keep previous bundles for explicit rollback."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

os.umask(0o077)
repo = Path(__file__).resolve().parent.parent
target = Path("/Applications/OpenCode Custom.app")
archive = Path.home() / "Library/Application Support/OpenCode Custom Builds"
archive.mkdir(parents=True, exist_ok=True)
running = subprocess.check_output(["ps", "-axo", "comm="], text=True)
if any(line.endswith("/Contents/MacOS/OpenCode Custom") for line in running.splitlines()):
    raise SystemExit("Custom app is running. Ask before quitting an active session, then retry.")

source = Path(sys.argv[1]).resolve()
report = json.loads((source.parent / "custom-smoke.json").read_text())
digest = hashlib.sha256((source / "Contents/Resources/opencode-cli").read_bytes()).hexdigest()
app_digest = hashlib.sha256((source / "Contents/Resources/app.asar").read_bytes()).hexdigest()
if report["sha256"] != digest or report["appSha256"] != app_digest or not report["originalServiceUnchanged"]:
    raise SystemExit("Candidate does not match its successful smoke report")
subprocess.run(["codesign", "--verify", "--deep", "--strict", str(source)], check=True)
subprocess.run(["python3", str(repo / "script/custom-snapshot.py")], check=True)
stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
stage = archive / stamp
stage.mkdir()
shutil.copytree(source, stage / target.name, symlinks=True)
shutil.copy2(source.parent / "custom-smoke.json", stage / "custom-smoke.json")
subprocess.run(["codesign", "--verify", "--deep", "--strict", str(stage / target.name)], check=True)
if target.exists():
    previous = archive / (stamp + "-previous")
    previous.mkdir()
    target.rename(previous / target.name)
    installed = archive / "installed-smoke.json"
    if installed.exists():
        shutil.copy2(installed, previous / "custom-smoke.json")
try:
    shutil.copytree(stage / target.name, target, symlinks=True)
    shutil.copy2(stage / "custom-smoke.json", archive / "installed-smoke.json")
except BaseException:
    if target.exists():
        shutil.rmtree(target)
    if "previous" in locals():
        (previous / target.name).rename(target)
    raise
print(f"Installed {target}; rollback candidate: {stage / target.name}")
