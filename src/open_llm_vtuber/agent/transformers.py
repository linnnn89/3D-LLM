# =============================================================================
# [架构导航 / 核心流水线] LLM 输出流式转换装饰器链 (Agent Stream Transformers)
# -----------------------------------------------------------------------------
# 角色职责:
#   将大语言模型（LLM）吐出的原始 Token 字符流逐级转换为可供前端渲染与 TTS 播放的富数据结构。
# 管道级联顺序 (执行从内到外，外层包裹内层):
#   Token流 (LLM)
#     ↓ [1. sentence_divider]: 累积字符按标点/pysbd分句，识别标签状态 (SentenceWithTags)
#     ↓ [2. actions_extractor]: 从句子提取情绪关键词并解析为 Live2D 动作 (Actions)
#     ↓ [3. display_processor]: 剥离 [joy] 等情绪标签，构建前端字幕对象 (DisplayText)
#     ↓ [4. tts_filter]: 过滤特殊符号/括号，跳过 think 标签，封装为最终 (SentenceOutput)
# 高危注意:
#   - 字典透传原则: 管道全程必须无条件透传 isinstance(item, dict)（如 tool_call_status），
#     绝不可将其误当作字符串处理或吞没，否则 MCP 工具状态将无法送达前端。
# =============================================================================

import re
from typing import AsyncIterator, Tuple, Callable, List, Union, Dict, Any
from functools import wraps
from .output_types import Actions, SentenceOutput, DisplayText
from ..utils.tts_preprocessor import tts_filter as filter_text
from ..live2d_model import Live2dModel
from ..config_manager import TTSPreprocessorConfig
from ..utils.sentence_divider import SentenceDivider
from ..utils.sentence_divider import SentenceWithTags, TagState
from loguru import logger

# 情绪标签的通用形态：``[joy]`` / ``[happy_2]`` 之类由提示词约定的短标记。
# 只在模型没提供 emotionMap（例如 VRM 模式）或标签不在 map 中时用作兜底。
_EMOTION_TAG_RE = re.compile(r"\[\s*[A-Za-z_][A-Za-z0-9_]{0,19}\s*\]")


# =============================================================================
# [管道阶段 1] 句子切分与标签状态追踪 (Sentence Divider)
# =============================================================================
def sentence_divider(
    faster_first_response: bool = True,
    segment_method: str = "pysbd",
    valid_tags: List[str] = None,
):
    """
    Decorator that transforms token stream into sentences with tags

    Args:
        faster_first_response: bool - Whether to enable faster first response
        segment_method: str - Method for sentence segmentation
        valid_tags: List[str] - List of valid tags to process
    """

    def decorator(
        func: Callable[
            ..., AsyncIterator[Union[str, Dict[str, Any]]]
        ],  # Expects str or dict
    ) -> Callable[
        ..., AsyncIterator[Union[SentenceWithTags, Dict[str, Any]]]
    ]:  # Yields SentenceWithTags or dict
        @wraps(func)
        async def wrapper(
            *args, **kwargs
        ) -> AsyncIterator[Union[SentenceWithTags, Dict[str, Any]]]:
            divider = SentenceDivider(
                faster_first_response=faster_first_response,
                segment_method=segment_method,
                valid_tags=valid_tags or [],
            )
            stream_from_func = func(*args, **kwargs)

            # Process the mixed stream using the updated SentenceDivider
            async for item in divider.process_stream(stream_from_func):
                if isinstance(item, SentenceWithTags):
                    logger.debug(f"sentence_divider yielding sentence: {item}")
                elif isinstance(item, dict):
                    logger.debug(f"sentence_divider yielding dict: {item}")
                yield item  # Yield either SentenceWithTags or dict
            # Flushing is handled within divider.process_stream

        return wrapper

    return decorator


# =============================================================================
# [管道阶段 2] 动作与情绪表情提取器 (Actions Extractor)
# -----------------------------------------------------------------------------
# 核心职责: 识别文本中的情绪标签，通过 live2d_model.extract_emotion 匹配并生成 Actions.expressions
# =============================================================================
def actions_extractor(live2d_model: Live2dModel):
    """
    Decorator that extracts actions from sentences, passing through dicts.
    """

    def decorator(
        func: Callable[
            ..., AsyncIterator[Union[SentenceWithTags, Dict[str, Any]]]
        ],  # Input type hint
    ) -> Callable[
        ..., AsyncIterator[Union[Tuple[SentenceWithTags, Actions], Dict[str, Any]]]
    ]:  # Output type hint
        @wraps(func)
        async def wrapper(
            *args, **kwargs
        ) -> AsyncIterator[
            Union[Tuple[SentenceWithTags, Actions], Dict[str, Any]]
        ]:  # Yield type hint
            stream = func(*args, **kwargs)
            async for item in stream:
                if isinstance(item, SentenceWithTags):
                    sentence = item
                    actions = Actions()
                    # Only extract emotions for non-tag text
                    if not any(
                        tag.state in [TagState.START, TagState.END]
                        for tag in sentence.tags
                    ):
                        expressions = live2d_model.extract_emotion(sentence.text)
                        if expressions:
                            actions.expressions = expressions
                    yield sentence, actions  # Yield the tuple
                elif isinstance(item, dict):
                    # Pass through dictionaries
                    yield item
                else:
                    logger.warning(
                        f"actions_extractor received unexpected type: {type(item)}"
                    )

        return wrapper

    return decorator


# =============================================================================
# [管道阶段 3] 前端显示文本清洗处理器 (Display Processor)
# -----------------------------------------------------------------------------
# 核心职责:
#   - 剥离正文中嵌入的情绪标记（如 [joy]），防止元数据污染聊天界面字幕；
#   - 构造供前端显示的 DisplayText 对象。
# =============================================================================
def display_processor(live2d_model: Live2dModel | None = None):
    """
    Decorator that processes text for display, passing through dicts.

    除了处理 think 标签外，这里还负责**把情绪标签从显示文本中移除**。
    情绪标签（如 ``[joy]``）是给角色表情用的元数据：actions_extractor 会把
    它们解析成 actions.expressions，但句子文本本身仍带着标签。若不在这里
    剥离，对话栏就会原样显示出 ``[joy]``。

    （TTS 那条路有 filter_text 清洗，所以语音听起来是正常的；显示这条路
    过去完全没有清洗，这正是「记忆里能提取、对话栏却带标签」的原因。）
    """

    def _strip_emotion_tags(text: str) -> str:
        """移除情绪标签。

        优先用模型自带的 emotionMap 精确匹配；若模型没提供（例如 VRM 模式）
        或标签不在 map 中，则退化为剥离形如 ``[joy]`` / ``[happy_2]`` 的短标签。
        无标签时原样返回，避免对正文做无谓改动。
        """
        if not text or "[" not in text:
            return text

        cleaned = text
        emo_map = getattr(live2d_model, "emo_map", None) if live2d_model else None
        if emo_map:
            cleaned = live2d_model.remove_emotion_keywords(cleaned)

        if "[" in cleaned:
            cleaned = _EMOTION_TAG_RE.sub("", cleaned)

        # 标签被移除后可能留下多余空格，但保留原缩进语义
        return cleaned

    def decorator(
        func: Callable[
            ..., AsyncIterator[Union[Tuple[SentenceWithTags, Actions], Dict[str, Any]]]
        ],  # Input type hint
    ) -> Callable[
        ...,
        AsyncIterator[
            Union[Tuple[SentenceWithTags, DisplayText, Actions], Dict[str, Any]]
        ],
    ]:  # Output type hint
        @wraps(func)
        async def wrapper(
            *args, **kwargs
        ) -> AsyncIterator[
            Union[Tuple[SentenceWithTags, DisplayText, Actions], Dict[str, Any]]
        ]:  # Yield type hint
            stream = func(*args, **kwargs)

            async for item in stream:
                if (
                    isinstance(item, tuple)
                    and len(item) == 2
                    and isinstance(item[0], SentenceWithTags)
                ):
                    sentence, actions = item
                    text = sentence.text
                    # Handle think tag states
                    for tag in sentence.tags:
                        if tag.name == "think":
                            if tag.state == TagState.START:
                                text = "("
                            elif tag.state == TagState.END:
                                text = ")"

                    # 情绪标签是给表情用的元数据，不应出现在对话栏里
                    text = _strip_emotion_tags(text)

                    display = DisplayText(text=text)  # Simplified DisplayText creation
                    yield sentence, display, actions  # Yield the tuple
                elif isinstance(item, dict):
                    # Pass through dictionaries
                    yield item
                else:
                    logger.warning(
                        f"display_processor received unexpected type: {type(item)}"
                    )

        return wrapper

    return decorator


# =============================================================================
# [管道阶段 4] TTS 音频预处理与 SentenceOutput 封装器 (TTS Filter)
# -----------------------------------------------------------------------------
# 核心职责:
#   - 过滤发音障碍符号（括号、特殊标点）；
#   - 彻底跳过 <think> 思考标签内容的朗读（tts 置空，仅保留显示）；
#   - 组装 SentenceOutput(display_text, tts_text, actions) 投递给下游。
# =============================================================================
def tts_filter(
    tts_preprocessor_config: TTSPreprocessorConfig = None,
):
    """
    Decorator that filters text for TTS, passing through dicts.
    Skips TTS for think tag content.
    """

    def decorator(
        func: Callable[
            ...,
            AsyncIterator[
                Union[Tuple[SentenceWithTags, DisplayText, Actions], Dict[str, Any]]
            ],
        ],  # Input type hint
    ) -> Callable[
        ..., AsyncIterator[Union[SentenceOutput, Dict[str, Any]]]
    ]:  # Output type hint
        @wraps(func)
        async def wrapper(
            *args, **kwargs
        ) -> AsyncIterator[Union[SentenceOutput, Dict[str, Any]]]:  # Yield type hint
            stream = func(*args, **kwargs)
            config = tts_preprocessor_config or TTSPreprocessorConfig()

            async for item in stream:
                if (
                    isinstance(item, tuple)
                    and len(item) == 3
                    and isinstance(item[1], DisplayText)
                ):
                    sentence, display, actions = item
                    if any(tag.name == "think" for tag in sentence.tags):
                        tts = ""
                    else:
                        tts = filter_text(
                            text=display.text,
                            remove_special_char=config.remove_special_char,
                            ignore_brackets=config.ignore_brackets,
                            ignore_parentheses=config.ignore_parentheses,
                            ignore_asterisks=config.ignore_asterisks,
                            ignore_angle_brackets=config.ignore_angle_brackets,
                        )

                    logger.debug(f"[{display.name}] display: {display.text}")
                    logger.debug(f"[{display.name}] tts: {tts}")

                    yield SentenceOutput(
                        display_text=display,
                        tts_text=tts,
                        actions=actions,
                    )
                elif isinstance(item, dict):
                    # Pass through dictionaries
                    yield item
                else:
                    logger.warning(f"tts_filter received unexpected type: {type(item)}")

        return wrapper

    return decorator
