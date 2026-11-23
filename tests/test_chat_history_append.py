"""Regression tests for appending a message to a chat history file."""

import json
import os
import stat
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from typing import TextIO
from unittest.mock import patch

from src.open_llm_vtuber import chat_history_manager as history


class ChatHistoryAppendTest(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.addCleanup(os.chdir, os.getcwd())
        os.chdir(directory.name)
        self.path = Path("chat_history/demo/session.json")
        self.path.parent.mkdir(parents=True)
        self.entries = [
            {"role": "metadata", "custom": {"标签": ["雪"]}},
            {"role": "human", "content": "上一条", "name": "雪", "extra": 7},
        ]
        self.original = json.dumps(self.entries, ensure_ascii=False).encode("utf-8")
        self.path.write_bytes(self.original)

    def append(self) -> None:
        history.store_message("demo", "session", "ai", "新消息🌱", "助手", "图.png")

    def assert_only_history_exists(self) -> None:
        self.assertEqual(list(self.path.parent.iterdir()), [self.path])

    def assert_successful_append(self) -> None:
        self.append()
        content = self.path.read_text(encoding="utf-8")
        entries = json.loads(content)
        self.assertEqual(entries[:-1], self.entries)
        self.assertEqual(content, json.dumps(entries, ensure_ascii=False, indent=2))
        message = entries[-1].copy()
        datetime.fromisoformat(message.pop("timestamp"))
        self.assertEqual(
            message,
            {"role": "ai", "content": "新消息🌱", "name": "助手", "avatar": "图.png"},
        )
        self.assert_only_history_exists()

    def test_normal_append(self) -> None:
        self.assert_successful_append()

    @unittest.skipUnless(os.name == "posix", "POSIX mode bits")
    def test_private_history_permissions(self) -> None:
        self.path.chmod(0o600)
        self.append()
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o600)

    def test_missing_history(self) -> None:
        self.path.unlink()
        history.store_message("demo", "session", "human", "hello")
        (message,) = json.loads(self.path.read_text(encoding="utf-8"))
        datetime.fromisoformat(message.pop("timestamp"))
        self.assertEqual(message, {"role": "human", "content": "hello"})
        self.assert_only_history_exists()

    def test_transient_read_error(self) -> None:
        with patch.object(history.json, "load", side_effect=OSError("上一条")):
            with patch.object(history.logger, "error") as diagnostic:
                self.append()
        diagnostic.assert_called_once()
        self.assertNotIn("上一条", str(diagnostic.call_args))
        self.assertNotIn("新消息", str(diagnostic.call_args))
        self.assertEqual(self.path.read_bytes(), self.original)
        self.assert_only_history_exists()
        self.assert_successful_append()

    def test_invalid_existing_history(self) -> None:
        for invalid in (b'[{"role":', b'{"metadata": true}', b"\xff"):
            with self.subTest(raw=invalid):
                self.path.write_bytes(invalid)
                for _ in range(2):
                    with patch.object(history.logger, "error") as diagnostic:
                        self.append()
                    diagnostic.assert_called_once()
                    self.assertEqual(self.path.read_bytes(), invalid)
                    self.assert_only_history_exists()
                self.path.write_bytes(self.original)
                self.assert_successful_append()

    def test_partial_dump(self) -> None:
        def interrupt_dump(data: list, file: TextIO, **kwargs: object) -> None:
            file.write("[{")
            raise OSError("interrupted write")

        with patch.object(history.json, "dump", side_effect=interrupt_dump):
            with self.assertRaisesRegex(OSError, "interrupted write"):
                self.append()
        self.assertEqual(self.path.read_bytes(), self.original)
        self.assert_only_history_exists()
        self.assert_successful_append()

    def test_sync_or_replace_failure(self) -> None:
        for operation in ("fsync", "replace"):
            with self.subTest(operation=operation):
                self.path.write_bytes(self.original)
                with patch.object(
                    history.os, operation, side_effect=OSError(operation)
                ):
                    with self.assertRaisesRegex(OSError, operation):
                        self.append()
                self.assertEqual(self.path.read_bytes(), self.original)
                self.assert_only_history_exists()
                self.assert_successful_append()
