"""Fish Audio TTS。

直接调用官方 REST 端点（https://api.fish.audio/v1/tts），**不使用 fish_audio_sdk**。

为什么弃用 SDK：实测同一把密钥、同一台机器、同一个代理下，
`httpx` 直连 REST 返回 200 并成功合成音频，而 SDK 返回 401
（`this route requires an api-key or Authorization: Bearer <api key> header`）。
SDK 把请求方式、model header、错误详情都封装掉了，出问题时无从排查；
REST 直连则完全可控，且能把 Fish 的原始拒绝原因透出来。

请求结构参照隔壁 live2Dchat 已验证可用的实现：
    headers: Authorization: Bearer <key> / Content-Type: application/json
             Accept: audio/mpeg / model: <engine>
    body:    { text, format, reference_id, prosody?, temperature?, top_p? }
"""

import json
from typing import Literal

import httpx
from loguru import logger

from .tts_interface import TTSInterface

# 官方 TTS 端点（注意：不是 base_url + 路径自行拼接）
FISH_TTS_ENDPOINT = "https://api.fish.audio/v1/tts"

# 单次合成的音频上限，防御异常大的响应
MAX_AUDIO_BYTES = 32 * 1024 * 1024

# 合成超时（秒）。Fish 对长文本的合成可能较慢
REQUEST_TIMEOUT = 120.0

# 连通性探测用的默认音色：/v1/tts 允许不带 reference_id
DEFAULT_PROBE_VOICE = "35c8e5ae5239435f8d9c26c86802b86d"


def _fish_detail(raw: str) -> str:
    """Fish 会在响应体里说明拒绝原因（如 {"message":"Reference not found"}）。

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
        400: "请求参数不被接受，请检查音色 ID / 模型 / 朗读文本",
        401: "API 密钥无效或已过期，请在「全局设置 → 密钥保险库」更新",
        402: "账户额度不足，或所选模型未获授权（模型名填错时 Fish 会静默回退到付费的 s2.1-pro）",
        403: "请求被拒绝，请检查密钥权限与音色的访问权限",
        404: "未找到所选音色或模型，请检查 reference_id 与模型设置",
        422: "请求参数不被接受，请检查音色 ID / 模型 / 朗读文本",
        429: "请求过于频繁，请稍后再试",
        503: "Fish 服务暂时不可用，请稍后再试",
    }.get(status, "")


class TTSEngine(TTSInterface):
    """Fish Audio TTS（REST 直连）。"""

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
        # 未显式提供密钥时，从 Windows DPAPI 密钥库取
        if not api_key or api_key in ("KEY_VAULT", "default_api_key"):
            try:
                from ..security.key_vault import vault

                api_key = vault.get_key("fish_audio") or vault.get_key("fish.audio") or ""
            except Exception as err:
                logger.warning(f"Could not load Fish Audio key from vault: {err}")

        if not api_key:
            logger.warning(
                "Fish TTS: 未获取到 API 密钥，合成将失败。"
                "请在「全局设置 → 密钥保险库」填写 Fish Audio 密钥。"
            )

        self.api_key = api_key
        self.reference_id = reference_id
        self.latency = latency
        self.model = model
        self.format = format
        self.temperature = temperature
        self.top_p = top_p
        self.speed = speed

        # 端点：允许 base_url 指向自建/镜像，默认走官方
        endpoint = (base_url or "").strip().rstrip("/")
        if not endpoint:
            endpoint = FISH_TTS_ENDPOINT
        elif not endpoint.endswith("/v1/tts"):
            endpoint = f"{endpoint}/v1/tts"
        self.endpoint = endpoint

        # 落盘扩展名必须与请求的输出格式一致：SDK/REST 的默认格式是 mp3，
        # 若沿用 "wav" 扩展名就会写出「内容是 mp3、文件名叫 .wav」的坏文件。
        self.file_extension = format

        logger.info(
            f"\nFish TTS 初始化（REST 直连）endpoint: {self.endpoint}, model: {model}, "
            f"reference_id: {reference_id}, latency: {latency}, format: {format}, "
            f"temperature: {temperature}, top_p: {top_p}, speed: {speed}, "
            f"api_key: {'已配置' if api_key else '缺失'}"
        )

    def _build_payload(self, text: str) -> dict:
        payload = {
            "text": text,
            "format": self.format,
            "reference_id": self.reference_id,
        }
        # 可选参数：仅在非默认值时下发，避免无意改变 Fish 的行为
        if self.latency:
            payload["latency"] = self.latency
        if self.temperature is not None:
            payload["temperature"] = float(self.temperature)
        if self.top_p is not None:
            payload["top_p"] = float(self.top_p)
        if self.speed is not None and abs(float(self.speed) - 1.0) > 1e-6:
            payload["prosody"] = {"speed": float(self.speed)}
        return payload

    def generate_audio(self, text, file_name_no_ext=None):
        file_name = self.generate_cache_file_name(file_name_no_ext, self.file_extension)

        if not self.api_key:
            logger.critical(
                "\nFish TTS 合成失败: 未配置 API 密钥。"
                "请在「全局设置 → 密钥保险库」填写 Fish Audio 密钥。"
            )
            return None

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
            "model": self.model,
        }

        try:
            with httpx.Client(timeout=REQUEST_TIMEOUT, follow_redirects=False) as client:
                with client.stream(
                    "POST", self.endpoint, headers=headers, json=self._build_payload(text)
                ) as resp:
                    if resp.status_code != 200:
                        raw = resp.read().decode("utf-8", errors="replace")
                        hint = _fish_status_hint(resp.status_code)
                        detail = _fish_detail(raw)
                        note = (
                            "（Fish Audio 在国内通常需要代理，请确认代理已开启且本程序能走代理）"
                            if resp.status_code in (0, 502, 503)
                            else ""
                        )
                        parts = [p for p in (hint, detail, note) if p]
                        logger.critical(
                            f"\nFish TTS 合成失败: "
                            f"{' | '.join(parts) if parts else f'HTTP {resp.status_code}'}"
                        )
                        return None

                    content_type = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
                    if content_type and not content_type.startswith("audio/") and content_type != "application/octet-stream":
                        raw = resp.read().decode("utf-8", errors="replace")
                        logger.critical(
                            f"\nFish TTS 合成失败: 返回的不是音频（{content_type}）"
                            f"{' | ' + _fish_detail(raw) if _fish_detail(raw) else ''}"
                        )
                        return None

                    total = 0
                    with open(file_name, "wb") as f:
                        for chunk in resp.iter_bytes():
                            total += len(chunk)
                            if total > MAX_AUDIO_BYTES:
                                raise ValueError("音频超过 32 MiB，请缩短朗读文本")
                            f.write(chunk)

                    if total == 0:
                        logger.critical("\nFish TTS 合成失败: Fish 返回了空音频")
                        return None

            return file_name

        except httpx.TimeoutException:
            logger.critical(f"\nFish TTS 合成失败: 请求超过 {int(REQUEST_TIMEOUT)} 秒未完成，请缩短文本或稍后重试")
            return None
        except Exception as e:
            raw = str(e)
            logger.critical(
                f"\nFish TTS 合成失败: {raw[:200]}"
                "（若为连接/SSL 错误，通常是代理问题：Fish Audio 在国内需要可用的代理）"
            )
            return None
