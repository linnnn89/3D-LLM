import unittest
import asyncio
import tempfile
import os
import shutil
import sys

# Ensure src is in python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))

from open_llm_vtuber.memory.models import (
    MemorySettings,
    HistoryRetrievalSettings,
    MemoryGenerationSettings,
)
from open_llm_vtuber.memory.repository import MemoryRepository
from open_llm_vtuber.memory.service import MemoryService
from open_llm_vtuber.memory.interface import MemoryInterface


class TestMemoryRepository(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.db_path = os.path.join(self.temp_dir, "test_memory.sqlite")
        self.repo = MemoryRepository(self.db_path)

    def tearDown(self):
        self.repo.close()
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)

    def test_bank_and_revision(self):
        char_id = "test_char_1"

        # 1. Read empty bank
        bank = self.repo.read_bank(char_id)
        self.assertEqual(bank.character_id, char_id)
        self.assertEqual(bank.body, "")
        self.assertEqual(bank.revision, 0)

        # 2. Write bank with valid revision
        updated = self.repo.write_bank(char_id, "这是第一段记忆", expected_revision=0)
        self.assertEqual(updated.revision, 1)
        self.assertEqual(updated.body, "这是第一段记忆")

        # 3. Revision conflict should raise error
        with self.assertRaises(ValueError):
            self.repo.write_bank(char_id, "试图用旧版本号更新", expected_revision=0)

        # 4. Write without expected_revision should succeed
        updated2 = self.repo.write_bank(char_id, "第二段记忆")
        self.assertEqual(updated2.revision, 2)
        self.assertEqual(updated2.body, "第二段记忆")

    def test_turns_and_fts5_retrieval(self):
        char_id = "kita_ikuyo"
        session_id = "sess_01"

        # 1. Index turns
        self.repo.index_turn(
            character_id=char_id,
            session_id=session_id,
            user_id="u1",
            user_content="喜多同学，你平时喜欢喝奶茶还是咖啡？",
            assistant_id="a1",
            assistant_content="[joy]私、カフェ巡りが大好きで、特に甘いキャラメルラテが好きなんです！",
        )
        self.repo.index_turn(
            character_id=char_id,
            session_id=session_id,
            user_id="u2",
            user_content="明天我们一起去下北泽的LiveHouse排练吉他吧！",
            assistant_id="a2",
            assistant_content="[happy]はい！後藤さんや虹夏ちゃん、リョウ先輩と一緒に頑張ります！",
        )

        # 2. Check pending turns
        self.assertEqual(self.repo.pending_turns(char_id, session_id), 2)

        # 3. Test FTS5 Trigram retrieval (query >= 3 chars)
        retrieval_settings = HistoryRetrievalSettings(
            enabled=True,
            scope="current_conversation",
            token_budget=1000,
            maximum_results=5,
        )
        snippets = self.repo.retrieve(
            character_id=char_id,
            session_id=session_id,
            query="下北泽排练",
            settings=retrieval_settings,
        )
        self.assertEqual(len(snippets), 1)
        self.assertIn("下北泽", snippets[0].turn.user_content)
        self.assertEqual(snippets[0].turn.assistant_id, "a2")

        # 4. Test short keyword search (LIKE fallback for < 3 chars)
        snippets_short = self.repo.retrieve(
            character_id=char_id,
            session_id=session_id,
            query="吉他",
            settings=retrieval_settings,
        )
        self.assertGreaterEqual(len(snippets_short), 1)
        self.assertIn("吉他", snippets_short[0].turn.user_content)

        # 5. Test excluded IDs
        snippets_excluded = self.repo.retrieve(
            character_id=char_id,
            session_id=session_id,
            query="下北泽",
            settings=retrieval_settings,
            excluded_ids=["u2", "a2"],
        )
        self.assertEqual(len(snippets_excluded), 0)


class TestMemoryAsyncService(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.db_path = os.path.join(self.temp_dir, "test_memory_async.sqlite")
        self.repo = MemoryRepository(self.db_path)

    async def asyncTearDown(self):
        self.repo.close()
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)

    async def test_memory_service_and_auto_drain(self):
        char_id = "elaina"
        session_id = "sess_wander"

        llm_calls = []

        async def mock_llm_generate(messages, gen_settings):
            llm_calls.append(messages)
            return "灰の魔女イレイナは旅の途中で旅行者と出会い、美味しいパンを食べた。"

        settings = MemorySettings(
            auto_generate_enabled=True,
            update_interval_turns=2,  # Trigger every 2 turns
            maximum_source_user_turns=5,
        )

        service = MemoryService(
            repository=self.repo,
            llm_generate_fn=mock_llm_generate,
            get_character_info_fn=lambda cid: {"name": "イレイナ", "persona": "灰の魔女", "user_profile": "旅人"},
            settings=settings,
        )

        # Turn 1
        self.repo.index_turn(char_id, session_id, "u1", "イレイナさん、こんにちは！", "a1", "こんにちは、旅の魔女のイレイナです。")
        service.after_turn(char_id, session_id)
        await asyncio.sleep(0.05)
        self.assertEqual(len(llm_calls), 0)  # Pending turns = 1 < 2

        # Turn 2 -> should trigger auto-update!
        self.repo.index_turn(char_id, session_id, "u2", "このパンをどうぞ！", "a2", "わぁ、とっても美味しそうなパンですね！")
        service.after_turn(char_id, session_id)

        # Wait for async background task to complete
        for _ in range(25):
            await asyncio.sleep(0.05)
            if len(llm_calls) > 0:
                break

        self.assertEqual(len(llm_calls), 1)
        bank = self.repo.read_bank(char_id)
        self.assertIn("灰の魔女イレイナ", bank.body)
        self.assertEqual(bank.revision, 1)
        self.assertEqual(self.repo.pending_turns(char_id, session_id), 0)  # Checkpoint advanced!

        # Test Manual Draft generation
        self.repo.index_turn(char_id, session_id, "u3", "次の街はどこですか？", "a3", "次は時計塔のある街へ向かいます。")
        draft = await service.update(char_id, session_id)
        self.assertIsNotNone(draft)
        self.assertEqual(draft.kind, "update")
        self.assertEqual(self.repo.read_bank(char_id).revision, 1)  # Not applied yet

        # Commit Draft with user edit
        updated_bank = service.commit_draft(char_id, draft.id, "イレイナは時計塔のある街を目指している。", expected_revision=1)
        self.assertEqual(updated_bank.revision, 2)
        self.assertEqual(updated_bank.body, "イレイナは時計塔のある街を目指している。")
        self.assertIsNone(self.repo.read_draft(char_id))

        # Test Compression
        compress_draft = await service.compress(char_id)
        self.assertEqual(compress_draft.kind, "compression")
        self.assertIsNotNone(self.repo.read_draft(char_id))

        # Discard Draft
        service.discard_draft(char_id, compress_draft.id)
        self.assertIsNone(self.repo.read_draft(char_id))

        service.dispose()


class TestMemoryInterfaceFacade(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.db_path = os.path.join(self.temp_dir, "test_memory_facade.sqlite")
        self.interface = MemoryInterface(
            db_path=self.db_path,
            settings=MemorySettings(update_interval_turns=5),
        )

    def tearDown(self):
        self.interface.close()
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)

    def test_interface_facade(self):
        char_id = "yui"
        session_id = "sess_service_club"

        # 1. Preset memory bank
        self.interface.save_bank(char_id, "由比ヶ浜結衣は総武高校の生徒で、奉仕部に所属している。")

        # 2. Record some dialogue
        self.interface.record_turn(
            character_id=char_id,
            session_id=session_id,
            user_id="u10",
            user_content="结衣，今天放学后社团活动还做饼干吗？",
            assistant_id="a10",
            assistant_content="[happy]うん！ヒッキーとゆきのんと一緒にクッキー作るよ！",
        )

        # 3. Get prompt injection
        memory_text, recall_text = self.interface.get_prompt_injection(
            character_id=char_id,
            session_id=session_id,
            user_text="今天社团活动我们做饼干还是蛋糕？",
        )

        self.assertIn("奉仕部に所属している", memory_text)
        self.assertIn("クッキー作るよ", recall_text)
        self.assertIn("【関連する過去の会話の記憶】", recall_text)


if __name__ == "__main__":
    unittest.main()
