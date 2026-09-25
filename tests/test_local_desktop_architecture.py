import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))

from open_llm_vtuber.agent.transformers import actions_extractor, display_processor
from open_llm_vtuber.config_manager import read_yaml, validate_config
from open_llm_vtuber.live2d_model import Live2dModel
from open_llm_vtuber.server import WebSocketServer
from open_llm_vtuber.service_context import ServiceContext
from open_llm_vtuber.utils.sentence_divider import (
    SentenceWithTags,
    TagInfo,
    TagState,
)
from open_llm_vtuber.websocket_handler import WebSocketHandler


class LocalDesktopArchitectureTests(unittest.IsolatedAsyncioTestCase):
    def test_server_creates_missing_avatar_directory(self):
        original_cwd = Path.cwd()
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            for name in ("live2d-models", "backgrounds", "frontend"):
                (root / name).mkdir()
            try:
                os.chdir(root)
                WebSocketServer(config=None)
                self.assertTrue((root / "avatars").is_dir())
            finally:
                os.chdir(original_cwd)

    async def test_emotions_keep_2d_ids_and_supply_vrm_labels_without_live2d(self):
        async def source():
            yield SentenceWithTags("[joy]Hello.", [TagInfo("", TagState.NONE)])

        for model, expected_expression in (
            (Live2dModel("mao_pro"), 3),
            (None, None),
        ):
            pipeline = display_processor(None)(actions_extractor(model)(source))
            output = [item async for item in pipeline()]

            self.assertEqual(len(output), 1)
            _, display_text, actions = output[0]
            self.assertEqual(display_text.text, "Hello.")
            self.assertEqual(actions.emotions, ["joy"])
            self.assertEqual(
                actions.expressions,
                [expected_expression] if expected_expression is not None else None,
            )

    async def test_disconnect_closes_session_resources_but_preserves_shared_agent(self):
        context = ServiceContext()
        shared_agent = AsyncMock()
        mcp_client = AsyncMock()
        context.agent_engine = shared_agent
        context.mcp_client = mcp_client

        handler = WebSocketHandler(default_context_cache=ServiceContext())
        handler.client_contexts["desktop-test"] = context

        with patch(
            "open_llm_vtuber.websocket_handler.handle_client_disconnect",
            new=AsyncMock(),
        ):
            await handler.handle_disconnect("desktop-test")

        mcp_client.aclose.assert_awaited_once()
        shared_agent.close.assert_not_awaited()
        self.assertNotIn("desktop-test", handler.client_contexts)

        owned_context = ServiceContext()
        owned_agent = AsyncMock()
        owned_context.agent_engine = owned_agent
        owned_context._owns_agent_engine = True
        await owned_context.close()
        owned_agent.close.assert_awaited_once()

    async def test_legacy_streaming_fields_are_ignored_by_the_local_config_schema(self):
        for template in ("conf.default.yaml", "conf.ZH.default.yaml"):
            with self.subTest(template=template):
                raw_config = read_yaml(f"config_templates/{template}")
                raw_config["system_config"]["enable_proxy"] = True
                raw_config["live_config"] = {"bilibili_live": {"room_ids": [123]}}

                config = validate_config(raw_config)

                self.assertFalse(hasattr(config.system_config, "enable_proxy"))
                self.assertFalse(hasattr(config, "live_config"))
                self.assertNotIn("live_config", config.model_dump())


if __name__ == "__main__":
    unittest.main()
