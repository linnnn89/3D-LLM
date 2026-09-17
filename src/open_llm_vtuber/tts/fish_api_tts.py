import json
from typing import Literal

from fish_audio_sdk import Session, TTSRequest
from loguru import logger

from .tts_interface import TTSInterface


def _fish_detail(raw: str) -> str:
    """Fish 会在响应体里说明拒绝原因（例如 {"message":"Reference not found"}）。

    把这段细节透出来，才能区分「密钥错了」和「音色 ID 不存在」——
    否则调用方只能看到一句语焉不详的异常。
    """
    text = (raw or "").strip()
    if not text:
        return ""
    try:
        value = json.loads(text)
        msg = value.get("message") or value.get("reason")
        if isinstance(msg, str) and msg.strip():
            return " ".join(msg.split())[:200]
    except Exception:
        pass
    return " ".join(text.split())[:200]


def _fish_status_hint(status) -> str:
    """把 HTTP 状态翻译成人能看懂的处置建议。"""
    try:
        status = int(status)
    except (TypeError, ValueError):
        return ""
    return {
        400: "请求参数不被接受，请检查音色 ID / 模型 / 文本",
        401: "API 密钥无效或已过期，请在「全局设置 → 密钥保险库」更新",
        402: "账户额度不足，或所选模型未获授权（模型名填错时 Fish 会静默回退到付费的 s2.1-pro）",
        403: "请求被拒绝，请检查密钥权限与音色的访问权限",
        404: "未找到所选音色或模型，请检查 reference_id 与模型设置",
        422: "请求参数不被接受，请检查音色 ID / 模型 / 文本",
        429: "请求过于频繁，请稍后再试",
        503: "Fish 服务暂时不可用，请稍后再试",
    }.get(status, "")


class TTSEngine(TTSInterface):
    """
    Fish TTS that calls the FishTTS API service.

    对齐官方 TTS 端点（https://api.fish.audio/v1/tts）的可用参数：
    text / reference_id / model / format / latency / temperature / top_p / prosody。
    """

    file_extension: str = "wav"

    def __init__(
        self,
        api_key: str = "",
        reference_id="7f92f8afb8ec43bf81429cc1c9199cb1",
        latency: Literal["normal", "balanced"] = "balanced",
        base_url="https://api.fish.audio",
        model: str = "s2.1-pro-free",
        format: Literal["wav", "pcm", "mp3"] = "wav",
        temperature: float = 0.7,
        top_p: float = 0.7,
        speed: float = 1.0,
    ):
        """
        Initialize the Fish TTS API.
        """
        # Resolve API key from Windows DPAPI Key Vault if not explicitly provided
        if not api_key or api_key in ("KEY_VAULT", "default_api_key"):
            try:
                from ..security.key_vault import vault

                api_key = vault.get_key("fish_audio") or vault.get_key("fish.audio") or ""
            except Exception as err:
                logger.warning(f"Could not load Fish Audio key from vault: {err}")

        logger.info(
            f"\nFish TTS API initialized with model: {model} baseurl: {base_url} "
            f"reference_id: {reference_id}, latency: {latency}, format: {format}, "
            f"temperature: {temperature}, top_p: {top_p}, speed: {speed}"
        )

        self.reference_id = reference_id
        self.latency = latency
        self.model = model
        self.format = format
        self.temperature = temperature
        self.top_p = top_p
        self.speed = speed

        # 关键：落盘扩展名必须与请求的输出格式一致。
        # SDK 的 TTSRequest.format 默认是 mp3，若沿用 "wav" 扩展名就会写出
        # "内容是 mp3、文件名叫 .wav" 的坏文件，播放端会直接失败。
        self.file_extension = format

        # prosody 是可选嵌套对象，只在语速非默认时才构造
        self.prosody = None
        if abs(float(speed) - 1.0) > 1e-6:
            try:
                from fish_audio_sdk.schemas import Prosody

                self.prosody = Prosody(speed=float(speed))
            except Exception as err:
                logger.warning(f"Fish TTS: 无法构造 prosody(speed={speed}): {err}")

        self.session = Session(apikey=api_key or "anonymous", base_url=base_url)
        # Inject model header according to official Fish Audio documentation
        if hasattr(self.session, "_sync_client") and self.session._sync_client:
            self.session._sync_client.headers["model"] = self.model

    def generate_audio(self, text, file_name_no_ext=None):
        file_name = self.generate_cache_file_name(file_name_no_ext, self.file_extension)

        try:
            req = TTSRequest(
                text=text,
                reference_id=self.reference_id,
                latency=self.latency,
                format=self.format,
                temperature=self.temperature,
                top_p=self.top_p,
            )
            if self.prosody is not None:
                req.prosody = self.prosody

            with open(file_name, "wb") as f:
                for chunk in self.session.tts(req):
                    f.write(chunk)

        except Exception as e:
            # 尽量把 Fish 的真实拒绝原因透出来，而不是只留一句通用异常
            raw = str(e)
            status = None
            for attr in ("status_code", "status", "code"):
                status = getattr(e, attr, None)
                if status is not None:
                    break
            if status is None:
                resp = getattr(e, "response", None)
                status = getattr(resp, "status_code", None)
            hint = _fish_status_hint(status)
            detail = _fish_detail(getattr(e, "body", "") or raw)
            parts = [p for p in (hint, detail) if p]
            logger.critical(
                f"\nFish TTS 合成失败: {' | '.join(parts) if parts else raw[:200]}"
            )
            return None

        return file_name
