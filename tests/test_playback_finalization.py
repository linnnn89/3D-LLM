import asyncio
import json
import unittest
from unittest.mock import patch

from open_llm_vtuber.conversations import conversation_utils
from open_llm_vtuber.conversations.tts_manager import TTSTaskManager
from open_llm_vtuber.message_handler import message_handler


class PlaybackFinalizationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncTearDown(self):
        message_handler.cleanup_client("playback-test")

    async def test_immediate_ack_finishes_turn_once(self):
        sent = []
        manager = TTSTaskManager()
        manager.has_audio_output = True
        manager._sender_task = asyncio.create_task(
            manager._process_payload_queue(self._send(sent))
        )
        payload = {"type": "audio", "_playback_duration_seconds": 1.25}
        manager.record_audio_payload(payload)
        self.assertEqual(manager.total_playback_duration_seconds, 1.25)
        self.assertNotIn("_playback_duration_seconds", payload)
        await manager._payload_queue.put((payload, 0))
        manager.task_list.append(asyncio.create_task(asyncio.sleep(0)))
        message_handler.handle_message(
            "playback-test",
            {"type": "frontend-capabilities", "features": ["playback-complete"]},
        )

        async def send(raw):
            message = json.loads(raw)
            sent.append(message)
            if message["type"] == "backend-synth-complete":
                message_handler.handle_message(
                    "playback-test", {"type": "frontend-playback-complete"}
                )

        await conversation_utils.finalize_conversation_turn(
            manager, send, "playback-test"
        )
        self.assertEqual(
            [message["type"] for message in sent],
            ["audio", "backend-synth-complete", "force-new-message", "control"],
        )
        self.assertEqual(sent[-1]["text"], "conversation-chain-end")
        manager._sender_task.cancel()
        await asyncio.gather(manager._sender_task, return_exceptions=True)

    async def test_legacy_client_skips_ack_and_missing_ack_times_out(self):
        sent = []

        async def send(raw):
            sent.append(json.loads(raw)["type"])

        legacy_manager = TTSTaskManager()
        legacy_manager.has_audio_output = True
        await conversation_utils.finalize_conversation_turn(
            legacy_manager, send, "playback-test"
        )
        self.assertEqual(sent, ["force-new-message", "control"])

        sent.clear()
        modern_manager = TTSTaskManager()
        modern_manager.has_audio_output = True
        modern_manager.task_list.append(asyncio.create_task(asyncio.sleep(0)))
        message_handler.handle_message(
            "playback-test",
            {"type": "frontend-capabilities", "features": ["playback-complete"]},
        )
        with patch.object(conversation_utils, "PLAYBACK_ACK_GRACE_SECONDS", 0.01):
            await conversation_utils.finalize_conversation_turn(
                modern_manager, send, "playback-test"
            )
        self.assertEqual(
            sent, ["backend-synth-complete", "force-new-message", "control"]
        )

    @staticmethod
    def _send(sent):
        async def send(raw):
            sent.append(json.loads(raw))

        return send


if __name__ == "__main__":
    unittest.main()
