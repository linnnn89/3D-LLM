from typing import Type, Optional
from .asr_interface import ASRInterface


class ASRFactory:
    @staticmethod
    def get_asr_system(system_name: Optional[str], **kwargs) -> Optional[Type[ASRInterface]]:
        """
        Factory for ASR engines.
        Simplified to support external cloud API recognition only (no local model weights).
        """
        if not system_name or system_name.lower() in ("none", "disabled", "false"):
            return None

        if system_name == "groq_whisper_asr":
            from .groq_whisper_asr import VoiceRecognition as GroqWhisperASR

            return GroqWhisperASR(
                api_key=kwargs.get("api_key"),
                model=kwargs.get("model"),
                lang=kwargs.get("lang"),
            )
        elif system_name == "azure_asr":
            from .azure_asr import VoiceRecognition as AzureASR

            return AzureASR(
                subscription_key=kwargs.get("api_key"),
                region=kwargs.get("region"),
                languages=kwargs.get("languages", ["en-US", "zh-CN"]),
            )
        else:
            raise ValueError(
                f"Unknown or removed local ASR system: {system_name}. "
                f"Only cloud API ASR ('groq_whisper_asr', 'azure_asr') or text mode is supported."
            )
