from typing import Union, List, Dict, Any, Optional
import asyncio
import json
import uuid
from loguru import logger
import numpy as np

from .conversation_utils import (
    create_batch_input,
    process_agent_output,
    send_conversation_start_signals,
    process_user_input,
    finalize_conversation_turn,
    cleanup_conversation,
    EMOJI_LIST,
)
from .types import WebSocketSend
from .tts_manager import TTSTaskManager
from ..chat_history_manager import store_message
from ..service_context import ServiceContext

# Import necessary types from agent outputs
from ..agent.output_types import SentenceOutput, AudioOutput


# =============================================================================
# [架构导航 / 核心流水线] 单人对话全链路执行器 (Single Conversation Turn Pipeline)
# -----------------------------------------------------------------------------
# 角色职责: 编排一轮单人对话的全部异步流水线阶段。
# 阶段总览:
#   [阶段 1] 发送开场与 "Thinking..." 就绪信号
#   [阶段 2] 输入转化 (ASR 音频转文字 或 文本透传)
#   [阶段 3] 长程记忆双路检索与上下文注入 (MemoryBank + BM25 检索历史)
#   [阶段 4] 包装 BatchInput 并将 Human 消息存入对话历史
#   [阶段 5] Agent 流式生成 (消费 agent_output_stream，分流处理 tool_call_status 与句子合成)
#   [阶段 6] 等待所有异步并发 TTS 任务完成 (asyncio.gather) 并下发 backend-synth-complete
#   [阶段 7] 轮次收尾 finalize_conversation_turn
#   [阶段 8] AI 完整回复持久化存盘，并触发长程记忆异步写入 (record_turn)
#   [阶段 9] 打断取消捕获 (CancelledError) 与资源强制清理 (cleanup_conversation)
# 高危注意:
#   - 流水线支持随时被 handle_individual_interrupt 抛出的 CancelledError 截断；
#   - 必须通过 finally 块执行 cleanup_conversation，确保 TTS 任务队列被取消释放。
# =============================================================================
async def process_single_conversation(
    context: ServiceContext,
    websocket_send: WebSocketSend,
    client_uid: str,
    user_input: Union[str, np.ndarray],
    images: Optional[List[Dict[str, Any]]] = None,
    session_emoji: str = np.random.choice(EMOJI_LIST),
    metadata: Optional[Dict[str, Any]] = None,
) -> str:
    """Process a single-user conversation turn

    Args:
        context: Service context containing all configurations and engines
        websocket_send: WebSocket send function
        client_uid: Client unique identifier
        user_input: Text or audio input from user
        images: Optional list of image data
        session_emoji: Emoji identifier for the conversation
        metadata: Optional metadata for special processing flags

    Returns:
        str: Complete response text
    """
    # [并发控制器] 为本轮对话创建独立的 TTSTaskManager 实例
    tts_manager = TTSTaskManager()
    full_response = ""  # Initialize full_response here

    try:
        # [阶段 1: 开场就绪信号] 通知前端重置状态机并展示思考中占位符
        await send_conversation_start_signals(websocket_send)
        logger.info(f"New Conversation Chain {session_emoji} started!")

        # [阶段 2: 用户输入转写] 若为麦克风原始 PCM 则调用 ASR 引擎识别为文本
        input_text = await process_user_input(
            user_input, context.asr_engine, websocket_send
        )

        # [阶段 3: 长程记忆双路召回] 提取持久 MemoryBank 并检索相关历史对话片段
        batch_metadata = dict(metadata) if metadata else {}
        memory_interface = context.memory_interface
        if memory_interface is not None and input_text:
            try:
                bank_text, recall_text = memory_interface.get_prompt_injection(
                    character_id=context.character_config.conf_uid,
                    session_id=context.history_uid or "",
                    user_text=input_text,
                )
                memory_context = "\n\n".join(
                    part for part in (bank_text, recall_text) if part
                )
                if memory_context:
                    batch_metadata["memory_context"] = memory_context
                    logger.debug(
                        f"Recalled {len(memory_context)} chars of long-term memory."
                    )
            except Exception as e:
                logger.error(f"Failed to build long-term memory context: {e}")

        # [阶段 4: 批次输入构建与历史存盘]
        batch_input = create_batch_input(
            input_text=input_text,
            images=images,
            from_name=context.character_config.human_name,
            metadata=batch_metadata,
        )

        # Store user message (check if we should skip storing to history)
        skip_history = metadata and metadata.get("skip_history", False)
        if context.history_uid and not skip_history:
            store_message(
                conf_uid=context.character_config.conf_uid,
                history_uid=context.history_uid,
                role="human",
                content=input_text,
                name=context.character_config.human_name,
            )

        if skip_history:
            logger.debug("Skipping storing user input to history (proactive speak)")

        logger.info(f"User input: {input_text}")
        if images:
            logger.info(f"With {len(images)} images")

        try:
            # [阶段 5: 核心 Agent 生成与流式消费]
            # agent.chat 生成异步生成器，产出 SentenceOutput (文本句子) 或 Dict (工具状态)
            agent_output_stream = context.agent_engine.chat(batch_input)

            async for output_item in agent_output_stream:
                if (
                    isinstance(output_item, dict)
                    and output_item.get("type") == "tool_call_status"
                ):
                    # [工具调用状态回传] 即时将 MCP 工具调用进度通知前端显示
                    output_item["name"] = context.character_config.character_name
                    logger.debug(f"Sending tool status update: {output_item}")

                    await websocket_send(json.dumps(output_item))

                elif isinstance(output_item, (SentenceOutput, AudioOutput)):
                    # [流式音频/句子派发] 经过 process_agent_output 转交 tts_manager 并发合成
                    response_part = await process_agent_output(
                        output=output_item,
                        character_config=context.character_config,
                        live2d_model=context.live2d_model,
                        tts_engine=context.tts_engine,
                        websocket_send=websocket_send,  # Pass websocket_send for audio/tts messages
                        tts_manager=tts_manager,
                        translate_engine=context.translate_engine,
                    )
                    # Ensure response_part is treated as a string before concatenation
                    response_part_str = (
                        str(response_part) if response_part is not None else ""
                    )
                    full_response += response_part_str  # Accumulate text response
                else:
                    logger.warning(
                        f"Received unexpected item type from agent chat stream: {type(output_item)}"
                    )
                    logger.debug(f"Unexpected item content: {output_item}")

        except Exception as e:
            logger.exception(
                f"Error processing agent response stream: {e}"
            )  # Log with stack trace
            await websocket_send(
                json.dumps(
                    {
                        "type": "error",
                        "message": f"Error processing agent response: {str(e)}",
                    }
                )
            )
            # full_response will contain partial response before error
        # --- End processing agent response ---

        # [阶段 6: 并发 TTS 任务收敛] 等待全部后台合成完毕，发出合成完成通知
        if tts_manager.task_list:
            await asyncio.gather(*tts_manager.task_list)
            await websocket_send(json.dumps({"type": "backend-synth-complete"}))

        # [阶段 7: 轮次终态收尾]
        await finalize_conversation_turn(
            tts_manager=tts_manager,
            websocket_send=websocket_send,
            client_uid=client_uid,
        )

        # [阶段 8: AI回复存盘与长记忆自动摄入]
        if context.history_uid and full_response:  # Check full_response before storing
            store_message(
                conf_uid=context.character_config.conf_uid,
                history_uid=context.history_uid,
                role="ai",
                content=full_response,
                name=context.character_config.character_name,
                avatar=context.character_config.avatar,
            )
            logger.info(f"AI response: {full_response}")

            # Index the completed turn for long-term memory. Once enough turns
            # accumulate, the memory service schedules background synthesis.
            if (
                context.memory_interface is not None
                and input_text
                and not skip_history
            ):
                try:
                    turn_key = uuid.uuid4().hex
                    context.memory_interface.record_turn(
                        character_id=context.character_config.conf_uid,
                        session_id=context.history_uid,
                        user_id=f"{turn_key}:user",
                        user_content=input_text,
                        assistant_id=f"{turn_key}:assistant",
                        assistant_content=full_response,
                    )
                except Exception as e:
                    logger.error(f"Failed to index turn into long-term memory: {e}")

        return full_response  # Return accumulated full_response

    # [阶段 9: 打断与异常安全收尾]
    except asyncio.CancelledError:
        logger.info(f"🤡👍 Conversation {session_emoji} cancelled because interrupted.")
        raise
    except Exception as e:
        logger.error(f"Error in conversation chain: {e}")
        await websocket_send(
            json.dumps({"type": "error", "message": f"Conversation error: {str(e)}"})
        )
        raise
    finally:
        # 强制清理未完成的 TTS 发送任务
        cleanup_conversation(tts_manager, session_emoji)
