from typing import Type
from .tts_interface import TTSInterface


class TTSFactory:
    @staticmethod
    def get_tts_engine(engine_type: str, **kwargs) -> Type[TTSInterface]:
        """
        Factory for TTS engines.
        Simplified to support external cloud API voice synthesis only (no local model weights).
        """
        if engine_type == "fish_api_tts":
            from .fish_api_tts import TTSEngine as FishAPITTSEngine

            return FishAPITTSEngine(
                api_key=kwargs.get("api_key"),
                reference_id=kwargs.get("reference_id"),
                latency=kwargs.get("latency", "balanced"),
                base_url=kwargs.get("base_url", "https://api.fish.audio"),
                model=kwargs.get("model", "s2-pro-free"),
            )
        elif engine_type == "edge_tts":
            from .edge_tts import TTSEngine as EdgeTTSEngine

            return EdgeTTSEngine(kwargs.get("voice"))
        elif engine_type == "azure_tts":
            from .azure_tts import TTSEngine as AzureTTSEngine

            return AzureTTSEngine(
                kwargs.get("api_key"),
                kwargs.get("region"),
                kwargs.get("voice"),
                kwargs.get("pitch"),
                kwargs.get("rate"),
            )
        elif engine_type == "openai_tts":
            from .openai_tts import TTSEngine as OpenAITTSEngine

            return OpenAITTSEngine(
                model=kwargs.get("model"),
                voice=kwargs.get("voice"),
                api_key=kwargs.get("api_key"),
                base_url=kwargs.get("base_url"),
                file_extension=kwargs.get("file_extension", "mp3"),
            )
        elif engine_type == "siliconflow_tts":
            from .siliconflow_tts import SiliconFlowTTS

            return SiliconFlowTTS(
                api_url=kwargs.get("api_url"),
                api_key=kwargs.get("api_key"),
                default_model=kwargs.get("default_model"),
                default_voice=kwargs.get("default_voice"),
                sample_rate=kwargs.get("sample_rate"),
                response_format=kwargs.get("response_format"),
                stream=kwargs.get("stream"),
                speed=kwargs.get("speed"),
                gain=kwargs.get("gain"),
            )
        elif engine_type == "minimax_tts":
            from .minimax_tts import TTSEngine as MinimaxTTSEngine

            return MinimaxTTSEngine(
                group_id=kwargs.get("group_id"),
                api_key=kwargs.get("api_key"),
                model=kwargs.get("model", "speech-02-turbo"),
                voice_id=kwargs.get("voice_id", "female-shaonv"),
                pronunciation_dict=kwargs.get("pronunciation_dict", ""),
            )
        elif engine_type == "elevenlabs_tts":
            from .elevenlabs_tts import TTSEngine as ElevenLabsTTSEngine

            return ElevenLabsTTSEngine(
                api_key=kwargs.get("api_key"),
                voice_id=kwargs.get("voice_id"),
                model_id=kwargs.get("model_id", "eleven_multilingual_v2"),
                output_format=kwargs.get("output_format", "mp3_44100_128"),
                stability=kwargs.get("stability", 0.5),
                similarity_boost=kwargs.get("similarity_boost", 0.5),
                style=kwargs.get("style", 0.0),
                use_speaker_boost=kwargs.get("use_speaker_boost", True),
            )
        elif engine_type == "cartesia_tts":
            from .cartesia_tts import TTSEngine as CartesiaTTSEngine

            return CartesiaTTSEngine(
                api_key=kwargs.get("api_key"),
                voice_id=kwargs.get("voice_id"),
                model_id=kwargs.get("model_id", "sonic-3"),
                output_format=kwargs.get("output_format", "wav"),
                language=kwargs.get("language", "en"),
                emotion=kwargs.get("emotion", "neutral"),
                volume=kwargs.get("volume", 1.0),
                speed=kwargs.get("speed", 1.0),
            )
        else:
            raise ValueError(
                f"Unknown or removed local TTS engine: {engine_type}. "
                f"Supported cloud engines: 'fish_api_tts', 'edge_tts', 'azure_tts', 'openai_tts', "
                f"'siliconflow_tts', 'minimax_tts', 'elevenlabs_tts', 'cartesia_tts'."
            )
