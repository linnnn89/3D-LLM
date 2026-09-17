"""Description: This file contains the implementation of the `AsyncLLM` class.
This class is responsible for handling asynchronous interaction with OpenAI API compatible
endpoints for language generation.
"""

import re
from typing import AsyncIterator, List, Dict, Any
from urllib.parse import urlparse

from openai import (
    AsyncStream,
    AsyncOpenAI,
    APIError,
    APIConnectionError,
    RateLimitError,
    NotGiven,
    NOT_GIVEN,
)
from openai.types.chat import ChatCompletionChunk
from openai.types.chat.chat_completion_chunk import ChoiceDeltaToolCall
from loguru import logger

from .stateless_llm_interface import StatelessLLMInterface
from ...mcpp.types import ToolCallObject


# OpenRouter 上思考是**强制性**的模型，关不掉（参照 live2Dchat 的清单）。
_FORCED_REASONING_MODELS = {"deepseek-r1", "deepseek-r1-0528"}

# 响应开头的思考块标签。只有**开头**的这类块才是元数据，
# 正文中间出现的标签应当原样保留。
_LEADING_THINK_RE = re.compile(r"<(think|thinking|analysis)>", re.IGNORECASE)


def openrouter_reasoning_off(base_url: str, model: str) -> bool:
    """判断是否应为该模型显式关闭"思考"。

    OpenRouter 上的 DeepSeek 推理模型默认会输出思考内容，这些内容会混进
    语音合成与前端对话流（表现为角色念出一大段推理过程）。参照 live2Dchat
    的做法：对支持该开关的模型传 `reasoning={"enabled": false}`。

    仅对 OpenRouter 且模型 id 以 `deepseek/` 开头时生效；deepseek-r1 系列的
    思考是强制性的，传了也没用，这里直接跳过。
    """
    try:
        if (urlparse(base_url).hostname or "") != "openrouter.ai":
            return False
    except Exception:
        return False

    model_id = (model or "").strip().lower().split(":")[0]
    if not model_id.startswith("deepseek/"):
        return False
    return model_id[len("deepseek/") :] not in _FORCED_REASONING_MODELS


class _LeadingReasoningStripper:
    """流式剥离响应**开头**的思考块（`<think>…</think>` 等）。

    我们是边收边发（每个 chunk 直接送 TTS），所以不能像非流式那样"收完再剥" ——
    标签可能被切在 chunk 边界上。这里用一个最小状态机：

    - 在确认开头是否为主题块之前，先缓冲；
    - 一旦确认**不是**标签，立刻把缓冲原样吐出，之后全程透传（正文里的
      标签因此不会被误伤）；
    - 是标签则丢弃到匹配的结束标签，其余内容照常输出。
    """

    _MAX_PROBE = 24  # 超过这个长度还判不出来，就当它不是标签

    def __init__(self) -> None:
        self._buffer = ""
        self._state = "probing"  # probing -> skipping -> passthrough
        self._closing = ""

    def feed(self, text: str) -> str:
        if not text:
            return ""
        if self._state == "passthrough":
            return text

        self._buffer += text

        if self._state == "probing":
            stripped = self._buffer.lstrip()
            match = _LEADING_THINK_RE.match(stripped)
            if match:
                self._state = "skipping"
                self._closing = f"</{match.group(1)}>"
                self._buffer = stripped[match.end() :]
            elif len(stripped) < self._MAX_PROBE and stripped.startswith("<"):
                return ""  # 还可能是标签，继续攒
            else:
                self._state = "passthrough"
                out, self._buffer = self._buffer, ""
                return out

        if self._state == "skipping":
            idx = self._buffer.lower().find(self._closing)
            if idx == -1:
                if len(self._buffer) > 8192:  # 兜底：别无限攒下去
                    self._state = "passthrough"
                    out, self._buffer = self._buffer, ""
                    return out
                return ""
            out = self._buffer[idx + len(self._closing) :].lstrip()
            self._state = "passthrough"
            self._buffer = ""
            return out

        return text


class AsyncLLM(StatelessLLMInterface):
    def __init__(
        self,
        model: str,
        base_url: str,
        llm_api_key: str = "z",
        organization_id: str = "z",
        project_id: str = "z",
        temperature: float = 1.0,
    ):
        """
        Initializes an instance of the `AsyncLLM` class.

        Parameters:
        - model (str): The model to be used for language generation.
        - base_url (str): The base URL for the OpenAI API.
        - organization_id (str, optional): The organization ID for the OpenAI API. Defaults to "z".
        - project_id (str, optional): The project ID for the OpenAI API. Defaults to "z".
        - llm_api_key (str, optional): The API key for the OpenAI API. Defaults to "z".
        - temperature (float, optional): What sampling temperature to use, between 0 and 2. Defaults to 1.0.
        """
        self.base_url = base_url
        self.model = model
        self.temperature = temperature
        self.client = AsyncOpenAI(
            base_url=base_url,
            organization=organization_id,
            project=project_id,
            api_key=llm_api_key,
        )
        self.support_tools = True

        # OpenRouter 的 DeepSeek 推理模型默认会输出思考内容，一旦混进
        # 对话流就会被送去 TTS —— 表现为角色念出一大段推理过程。
        # 参照 live2Dchat：对支持该开关的模型显式传 reasoning={"enabled": false}。
        self.reasoning_off = openrouter_reasoning_off(base_url, model)

        logger.info(
            f"Initialized AsyncLLM with the parameters: {self.base_url}, {self.model}"
            + ("  [已关闭思考输出]" if self.reasoning_off else "")
        )

    async def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        system: str = None,
        tools: List[Dict[str, Any]] | NotGiven = NOT_GIVEN,
    ) -> AsyncIterator[str | List[ChoiceDeltaToolCall]]:
        """
        Generates a chat completion using the OpenAI API asynchronously.

        Parameters:
        - messages (List[Dict[str, Any]]): The list of messages to send to the API.
        - system (str, optional): System prompt to use for this completion.
        - tools (List[Dict[str, str]], optional): List of tools to use for this completion.

        Yields:
        - str: The content of each chunk from the API response.
        - List[ChoiceDeltaToolCall]: The tool calls detected in the response.

        Raises:
        - APIConnectionError: When the server cannot be reached
        - RateLimitError: When a 429 status code is received
        - APIError: For other API-related errors
        """
        stream = None
        # Tool call related state variables
        accumulated_tool_calls = {}
        in_tool_call = False

        try:
            # If system prompt is provided, add it to the messages
            messages_with_system = messages
            if system:
                messages_with_system = [
                    {"role": "system", "content": system},
                    *messages,
                ]
            logger.debug(f"Messages: {messages_with_system}")

            available_tools = tools if self.support_tools else NOT_GIVEN

            stream: AsyncStream[
                ChatCompletionChunk
            ] = await self.client.chat.completions.create(
                messages=messages_with_system,
                model=self.model,
                stream=True,
                temperature=self.temperature,
                tools=available_tools,
                # DeepSeek 推理模型默认会输出思考内容，一旦混进对话流就会
                # 被送去 TTS。可关闭的模型在这里显式关掉（见 __init__）。
                extra_body=(
                    {"reasoning": {"enabled": False}}
                    if self.reasoning_off
                    else NOT_GIVEN
                ),
            )
            logger.debug(
                f"Tool Support: {self.support_tools}, Available tools: {available_tools}"
            )

            # 兜底：万一服务端仍然吐出思考块（例如思考不可关闭的模型），
            # 只剥离**开头**的那一段，正文里的标签原样保留。
            stripper = _LeadingReasoningStripper()

            async for chunk in stream:
                # Guard against chunks with missing choices field (e.g., from OpenWebUI)
                if not chunk.choices:
                    continue

                if self.support_tools:
                    has_tool_calls = (
                        hasattr(chunk.choices[0].delta, "tool_calls")
                        and chunk.choices[0].delta.tool_calls
                    )

                    if has_tool_calls:
                        logger.debug(
                            f"Tool calls detected in chunk: {chunk.choices[0].delta.tool_calls}"
                        )
                        in_tool_call = True
                        # Process tool calls in the current chunk
                        for tool_call in chunk.choices[0].delta.tool_calls:
                            index = (
                                tool_call.index if hasattr(tool_call, "index") else 0
                            )

                            # Initialize tool call for this index if needed
                            if index not in accumulated_tool_calls:
                                accumulated_tool_calls[index] = {
                                    "index": index,
                                    "id": getattr(tool_call, "id", None),
                                    "type": getattr(tool_call, "type", None),
                                    "function": {"name": "", "arguments": ""},
                                }

                            # Update tool call information
                            if hasattr(tool_call, "id") and tool_call.id:
                                accumulated_tool_calls[index]["id"] = tool_call.id
                            if hasattr(tool_call, "type") and tool_call.type:
                                accumulated_tool_calls[index]["type"] = tool_call.type

                            # Update function information
                            if hasattr(tool_call, "function"):
                                if (
                                    hasattr(tool_call.function, "name")
                                    and tool_call.function.name
                                ):
                                    accumulated_tool_calls[index]["function"][
                                        "name"
                                    ] = tool_call.function.name
                                if (
                                    hasattr(tool_call.function, "arguments")
                                    and tool_call.function.arguments
                                ):
                                    accumulated_tool_calls[index]["function"][
                                        "arguments"
                                    ] += tool_call.function.arguments

                        continue

                    # If we were in a tool call but now we're not, yield the tool call result
                    elif in_tool_call and not has_tool_calls:
                        in_tool_call = False
                        # Convert accumulated tool calls to the required format and output
                        logger.info(f"Complete tool calls: {accumulated_tool_calls}")

                        # Use the from_dict method to create a ToolCallObject instance from a dictionary
                        complete_tool_calls = [
                            ToolCallObject.from_dict(tool_data)
                            for tool_data in accumulated_tool_calls.values()
                        ]

                        yield complete_tool_calls
                        accumulated_tool_calls = {}  # Reset for potential future tool calls

                # Process regular content chunks
                if len(chunk.choices) == 0:
                    logger.info("Empty chunk received")
                    continue
                elif chunk.choices[0].delta.content is None:
                    chunk.choices[0].delta.content = ""
                text = stripper.feed(chunk.choices[0].delta.content)
                if text:
                    yield text

            # If stream ends while still in a tool call, make sure to yield the tool call
            if in_tool_call and accumulated_tool_calls:
                logger.info(f"Final tool call at stream end: {accumulated_tool_calls}")

                # Create a ToolCallObject instance from a dictionary using the from_dict method.
                complete_tool_calls = [
                    ToolCallObject.from_dict(tool_data)
                    for tool_data in accumulated_tool_calls.values()
                ]

                yield complete_tool_calls

        except APIConnectionError as e:
            logger.error(
                f"Error calling the chat endpoint: Connection error. Failed to connect to the LLM API. \nCheck the configurations and the reachability of the LLM backend. \nSee the logs for details. \nTroubleshooting with documentation: https://open-llm-vtuber.github.io/docs/faq#%E9%81%87%E5%88%B0-error-calling-the-chat-endpoint-%E9%94%99%E8%AF%AF%E6%80%8E%E4%B9%88%E5%8A%9E \n{e.__cause__}"
            )
            yield "Error calling the chat endpoint: Connection error. Failed to connect to the LLM API. Check the configurations and the reachability of the LLM backend. See the logs for details. Troubleshooting with documentation: [https://open-llm-vtuber.github.io/docs/faq#%E9%81%87%E5%88%B0-error-calling-the-chat-endpoint-%E9%94%99%E8%AF%AF%E6%80%8E%E4%B9%88%E5%8A%9E]"

        except RateLimitError as e:
            logger.error(
                f"Error calling the chat endpoint: Rate limit exceeded: {e.response}"
            )
            yield "Error calling the chat endpoint: Rate limit exceeded. Please try again later. See the logs for details."

        except APIError as e:
            if "does not support tools" in str(e):
                self.support_tools = False
                logger.warning(
                    f"{self.model} does not support tools. Disabling tool support."
                )
                yield "__API_NOT_SUPPORT_TOOLS__"
                return
            logger.error(f"LLM API: Error occurred: {e}")
            logger.info(f"Base URL: {self.base_url}")
            logger.info(f"Model: {self.model}")
            logger.info(f"Messages: {messages}")
            logger.info(f"temperature: {self.temperature}")
            yield "Error calling the chat endpoint: Error occurred while generating response. See the logs for details."

        finally:
            # make sure the stream is properly closed
            # so when interrupted, no more tokens will being generated.
            if stream:
                logger.debug("Chat completion finished.")
                await stream.close()
                logger.debug("Stream closed.")
