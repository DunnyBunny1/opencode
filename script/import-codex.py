"""Import Codex's local transcripts through OpenCode's native import API.

Dry run by default. Source files are read-only; deterministic IDs make --apply resumable.
Raw rollouts remain the authoritative copy for encrypted reasoning and binary attachments.
"""
import argparse
import base64
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import urllib.error
import urllib.request
from compression import zstd


def millis(value):
    return int(datetime.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)


def session_id(value):
    return "ses_codex_" + value.replace("-", "")


def injected_guidance(text):
    return text.startswith(("# AGENTS.md instructions for ", "<environment_context>"))


def content_text(value):
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "\n".join(content_text(item) for item in value)
    if isinstance(value, dict):
        if "text" in value:
            return value["text"]
        if value.get("type") in {"input_image", "image", "image_url"}:
            return "[Image attachment preserved in the original Codex rollout]"
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def rollout_lines(source):
    with (zstd.open(source, "rt") if source.suffix == ".zst" else source.open()) as stream:
        yield from stream


def convert(row, pinned):
    messages = []
    title = row.get("name") or row["title"]
    model = row.get("model") or "gpt-6-astra"
    source = Path(row["rollout_path"])
    for index, line in enumerate(rollout_lines(source)):
        item = json.loads(line)
        payload = item.get("payload", {})
        if item.get("type") == "turn_context":
            model = payload.get("model", model)
        if item.get("type") != "response_item":
            continue
        kind = payload.get("type")
        timestamp = millis(item["timestamp"])
        base = {
            "id": "msg_codex_" + hashlib.sha256(f'{row["id"]}:{index}'.encode()).hexdigest()[:32],
            "metadata": {"codex": {"type": kind, "line": index + 1}},
            "time": {"created": timestamp},
        }
        if kind == "message" and payload.get("role") in {"user", "assistant"}:
            text = content_text(payload.get("content", []))
            if payload["role"] == "user":
                if injected_guidance(text):
                    continue
                messages.append({**base, "type": "user", "text": text, "files": [], "agents": [], "skills": []})
                continue
        elif kind in {"function_call", "custom_tool_call", "function_call_output", "custom_tool_call_output", "web_search_call"}:
            text = "Historical Codex tool record (already executed):\n" + content_text({
                key: value for key, value in payload.items()
                if key not in {"internal_chat_message_metadata_passthrough", "id"}
            })
        elif kind == "reasoning":
            text = content_text(payload.get("summary", []))
            if not text:
                continue
            text = "Historical reasoning summary:\n" + text
        else:
            # Old developer/system instructions and transport events are not new runtime instructions.
            continue
        messages.append({
            **base, "type": "assistant", "agent": "build",
            "model": {"providerID": "openai", "id": model},
            "content": [{"type": "text", "text": text}],
            "time": {"created": timestamp, "completed": timestamp}, "finish": "stop",
        })

    created = row.get("created_at_ms") or row["created_at"] * 1000
    updated = row.get("updated_at_ms") or row["updated_at"] * 1000
    metadata = {
        "codex": {"id": row["id"], "rollout": str(source), "directory": row["cwd"], "updatedAt": updated},
        "customWorkflow": {"pinned": row["id"] in pinned or bool(row.get("is_pinned"))},
    }
    if row.get("sidebarDirectory"):
        metadata["codex"]["sidebarDirectory"] = row["sidebarDirectory"]
    status = re.match(r"^\((ready|shelved|idea|blocked|merged|done|wip|in.progress)\)", title, re.I)
    if status:
        metadata["customWorkflow"]["status"] = {"wip": "in-progress", "in progress": "in-progress"}.get(status[1].lower(), status[1].lower())
    time = {"created": created, "updated": updated, "idle": updated, "viewed": updated}
    if row["archived"]:
        time["archived"] = (row.get("archived_at") or row["updated_at"]) * 1000
    info = {
        "id": session_id(row["id"]), "title": title, "projectID": "global",
        "agent": "build", "model": {"providerID": "openai", "id": "gpt-6-astra"},
        "cost": 0, "tokens": {"input": 0, "output": 0, "reasoning": 0, "cache": {"read": 0, "write": 0}},
        "time": time, "location": {"directory": row["cwd"]}, "metadata": metadata,
    }
    return {"info": info, "messages": messages, "location": {"directory": row["cwd"]}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--refresh-labels", action="store_true", help="Repair initial-import titles only while they still match Codex's raw title")
    parser.add_argument("--root", type=Path, default=Path.home() / ".local/share/opencode-custom")
    args = parser.parse_args()
    os.umask(0o077)
    source = Path.home() / ".codex"
    with sqlite3.connect(f"file:{source}/state_5.sqlite?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        rows = [dict(row) for row in db.execute("SELECT * FROM threads ORDER BY created_at ASC")]
        pinned = {row[0] for row in db.execute("SELECT t.id FROM threads t JOIN thread_sections s ON t.thread_section_id=s.id WHERE s.name='Pinned'")}
    desktop = json.loads((source / ".codex-global-state.json").read_text())
    pinned.update(desktop.get("pinned-thread-ids", []))
    projects = desktop.get("local-projects", {})
    assignments = desktop.get("thread-project-assignments", {})
    for row in rows:
        path = Path(row["rollout_path"])
        if not path.is_file() and Path(str(path) + ".zst").is_file():
            row["rollout_path"] = str(path) + ".zst"
        project = projects.get(assignments.get(row["id"], {}).get("projectId"), {})
        if project.get("rootPaths"):
            row["sidebarDirectory"] = project["rootPaths"][0]
    parents = {}
    for row in rows:
        if not row["source"].startswith("{"):
            continue
        value = json.loads(row["source"]).get("subagent", {})
        if isinstance(value, dict):
            parents[row["id"]] = value.get("thread_spawn", {}).get("parent_thread_id")

    registration = json.loads((args.root / "state/opencode/service.json").read_text())
    if not registration["url"].startswith("http://127.0.0.1:"):
        raise SystemExit("Expected the custom local server")
    headers = {"Authorization": "Basic " + base64.b64encode(f'opencode:{registration["password"]}'.encode()).decode(), "Content-Type": "application/json"}
    def request(path, body=None, method=None):
        req = urllib.request.Request(registration["url"] + path, data=json.dumps(body).encode() if body else None, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=120) as response:
            if response.status == 204:
                return None
            return json.load(response)

    health = request("/api/info")
    if "custom" not in json.dumps(health):
        raise SystemExit("Refusing to import into a non-custom backend")
    report = {"imported": [], "existing": [], "relabelled": [], "missing": [], "failed": [], "messages": 0}
    available = set()
    for row in rows[:args.limit]:
        sid = session_id(row["id"])
        if args.apply:
            try:
                existing = request("/api/session/" + sid)["data"]
                if args.refresh_labels and row.get("name") and existing["title"] == row["title"]:
                    metadata = existing.get("metadata", {})
                    status = re.match(r"^\((ready|shelved|idea|blocked|merged|done|wip|in.progress)\)", row["name"], re.I)
                    workflow = metadata.get("customWorkflow", {})
                    if status and not workflow.get("status"):
                        metadata["customWorkflow"] = {**workflow, "status": {"wip": "in-progress", "in progress": "in-progress"}.get(status[1].lower(), status[1].lower())}
                    request("/api/session/" + sid, {"title": row["name"], "metadata": metadata}, "PATCH")
                    report["relabelled"].append(row["id"])
                report["existing"].append(row["id"])
                available.add(row["id"])
                continue
            except urllib.error.HTTPError as error:
                if error.code != 404:
                    raise
        if not Path(row["rollout_path"]).is_file():
            report["missing"].append(row["id"])
            continue
        try:
            data = convert(row, pinned)
            parent = parents.get(row["id"])
            if parent in available:
                data["info"]["parentID"] = session_id(parent)
            if args.apply:
                request("/api/experimental/session/import", data)
                imported = request("/api/session/" + sid)["data"]
                if imported["metadata"]["codex"]["id"] != row["id"]:
                    raise ValueError("Imported source ID mismatch")
            report["imported"].append(row["id"])
            report["messages"] += len(data["messages"])
            available.add(row["id"])
        except (ValueError, OSError, urllib.error.HTTPError) as error:
            report["failed"].append({"id": row["id"], "error": str(error)})
        if len(report["imported"]) % 50 == 0:
            print({key: len(value) if isinstance(value, list) else value for key, value in report.items()}, flush=True)
    destination = args.root / "imports"
    destination.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    (destination / f"codex-{'import' if args.apply else 'dry-run'}-{stamp}.json").write_text(json.dumps(report, indent=2))
    print({key: len(value) if isinstance(value, list) else value for key, value in report.items()})
    if report["failed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
