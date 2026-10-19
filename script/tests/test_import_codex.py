import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from compression import zstd

spec = importlib.util.spec_from_file_location("codex_import", Path(__file__).parents[1] / "import-codex.py")
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


class TranscriptImport(unittest.TestCase):
    def test_compressed_history_is_stable_and_does_not_activate_old_instructions_or_tools(self):
        events = [
            {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "# AGENTS.md instructions for /old\nObsolete guidance"}]},
            {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "<environment_context>\nObsolete environment\n</environment_context>"}]},
            {"type": "message", "role": "developer", "content": [{"type": "input_text", "text": "Old runtime instruction"}]},
            {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "Please fix it"}]},
            {"type": "function_call", "name": "shell", "arguments": '{"command":"echo historical"}'},
            {"type": "function_call_output", "output": "historical"},
            {"type": "reasoning", "summary": [], "encrypted_content": "opaque-private-state"},
            {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "Fixed"}]},
        ]
        text = "\n".join(json.dumps({"timestamp": "2026-10-01T12:00:00Z", "type": "response_item", "payload": item}) for item in events)
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "rollout.jsonl"
            source.write_text(text)
            row = {"id": "abc-123", "rollout_path": str(source), "model": "gpt-6-astra", "title": "(blocked) Test", "cwd": directory, "created_at": 1790856000, "updated_at": 1790856000, "archived": 1}
            plain = importer.convert(row, {row["id"]})
            compressed = Path(str(source) + ".zst")
            with zstd.open(compressed, "wt") as stream:
                stream.write(text)
            zipped = importer.convert({**row, "rollout_path": str(compressed)}, {row["id"]})
            self.assertEqual(plain["messages"], zipped["messages"])
            self.assertEqual([item["type"] for item in plain["messages"]], ["user", "assistant", "assistant", "assistant"])
            self.assertEqual(plain["messages"][0]["text"], "Please fix it")
            self.assertEqual(plain["messages"][-1]["content"], [{"type": "text", "text": "Fixed"}])
            self.assertNotIn("opaque-private-state", json.dumps(plain))
            self.assertNotIn("Old runtime instruction", json.dumps(plain))
            self.assertNotIn("Obsolete guidance", json.dumps(plain))
            self.assertNotIn("Obsolete environment", json.dumps(plain))
            self.assertTrue(all(part["type"] == "text" for message in plain["messages"][1:] for part in message["content"]))
            self.assertEqual(plain["info"]["metadata"]["customWorkflow"], {"pinned": True, "status": "blocked"})
            self.assertEqual(plain["info"]["time"]["archived"], 1790856000000)
            self.assertEqual(source.read_text(), text)


if __name__ == "__main__":
    unittest.main()
