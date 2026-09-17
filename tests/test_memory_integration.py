import unittest
import tempfile
import os
import shutil
import sys

# Ensure src is in python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))

from open_llm_vtuber.memory.config import (
    DEFAULT_MEMORY_SETTINGS,
    build_memory_settings,
)
from open_llm_vtuber.memory.repository import MemoryRepository
from open_llm_vtuber.agent.agents.basic_memory_agent import BasicMemoryAgent
from open_llm_vtuber.agent.input_types import BatchInput, TextData, TextSource


class _StubLLM:
    """Minimal stateless-LLM stand-in; these tests never stream a completion."""

    def __init__(self):
        self.model = "stub"

    async def chat_completion(self, messages, system=None, tools=None):
        for chunk in []:
            yield chunk


class TestMemorySettingsSource(unittest.TestCase):
    """The settings center writes global.memory; the subsystem must actually read it."""

    def test_defaults_are_used_without_overrides(self):
        settings = build_memory_settings({})
        self.assertTrue(settings.auto_generate_enabled)
        self.assertEqual(settings.update_interval_turns, 10)
        self.assertTrue(settings.retrieval.enabled)
        self.assertEqual(settings.retrieval.maximum_results, 6)
        self.assertEqual(settings.retrieval.scope, "current_conversation")

    def test_overrides_apply_and_bad_values_degrade_to_defaults(self):
        settings = build_memory_settings(
            {
                "update_interval_turns": "3",
                "retrieval_enabled": False,
                "retrieval_scope": "same_character",
                "retrieval_max_results": "not-a-number",
                "memory_model": "  gpt-x  ",
            }
        )
        self.assertEqual(settings.update_interval_turns, 3)
        self.assertFalse(settings.retrieval.enabled)
        self.assertEqual(settings.retrieval.scope, "same_character")
        self.assertEqual(
            settings.retrieval.maximum_results,
            DEFAULT_MEMORY_SETTINGS["retrieval_max_results"],
        )
        self.assertEqual(settings.update_generation.model, "gpt-x")

    def test_unknown_retrieval_scope_falls_back(self):
        settings = build_memory_settings({"retrieval_scope": "everything"})
        self.assertEqual(settings.retrieval.scope, "current_conversation")


class TestMemoryPromptInjection(unittest.TestCase):
    """Long-term memory must reach the prompt without polluting the rolling history."""

    def setUp(self):
        self.agent = BasicMemoryAgent(
            llm=_StubLLM(),
            system="persona",
            live2d_model=None,
        )

    def test_memory_context_reaches_prompt_but_not_history(self):
        batch = BatchInput(
            texts=[
                TextData(
                    source=TextSource.INPUT,
                    content="今日は何を食べた？",
                    from_name="user",
                )
            ],
            metadata={"memory_context": "【長期記憶】私はパンが好き。"},
        )

        messages = self.agent._to_messages(batch)
        user_message = messages[-1]
        joined = "".join(
            part["text"]
            for part in user_message["content"]
            if part.get("type") == "text"
        )

        self.assertIn("長期記憶", joined)
        self.assertIn("今日は何を食べた？", joined)

        # Injected memory stays out of the sliding window, or it would accumulate
        # on every turn and eventually crowd out the actual conversation.
        self.assertEqual(len(self.agent._memory), 1)
        self.assertNotIn("長期記憶", self.agent._memory[0]["content"])

    def test_without_memory_context_the_prompt_is_unchanged(self):
        batch = BatchInput(
            texts=[
                TextData(source=TextSource.INPUT, content="こんにちは", from_name="user")
            ]
        )

        messages = self.agent._to_messages(batch)
        content = messages[-1]["content"]
        self.assertEqual(len(content), 1)
        self.assertEqual(content[0]["text"], "こんにちは")


class TestRepositoryReadPathRegression(unittest.TestCase):
    """Guards the repository fixes: no writes while reading, idempotent turn indexing."""

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.repo = MemoryRepository(os.path.join(self.temp_dir, "regression.sqlite"))

    def tearDown(self):
        self.repo.close()
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_read_bank_does_not_create_rows_and_write_creates_it(self):
        self.assertEqual(self.repo.read_bank("ghost").revision, 0)

        cursor = self.repo.conn.cursor()
        cursor.execute(
            "SELECT COUNT(*) AS cnt FROM memory_banks WHERE character_id = ?",
            ("ghost",),
        )
        self.assertEqual(cursor.fetchone()["cnt"], 0)

        written = self.repo.write_bank("ghost", "はじめての記憶")
        self.assertEqual(written.revision, 1)
        self.assertEqual(self.repo.read_bank("ghost").body, "はじめての記憶")

    def test_index_turn_is_idempotent_for_the_same_ids(self):
        first = self.repo.index_turn("c1", "s1", "u1", "hello", "a1", "hi")
        again = self.repo.index_turn("c1", "s1", "u1", "hello", "a1", "hi")

        self.assertEqual(first.sequence, again.sequence)
        self.assertEqual(self.repo.pending_turns("c1", "s1"), 1)


if __name__ == "__main__":
    unittest.main()
