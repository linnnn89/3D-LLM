from typing import Literal
from fish_audio_sdk import Session, TTSRequest
from loguru import logger
from .tts_interface import TTSInterface


class TTSEngine(TTSInterface):
    """
    Fish TTS that calls the FishTTS API service.
    """

    file_extension: str = "wav"

    def __init__(
        self,
        api_key: str = "",
        reference_id="7f92f8afb8ec43bf81429cc1c9199cb1",
        latency: Literal["normal", "balanced"] = "balanced",
        base_url="https://api.fish.audio",
        model: str = "s2-pro-free",
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
            f"\nFish TTS API initialized with model: {model} baseurl: {base_url} reference_id: {reference_id}, latency: {latency}"
        )

        self.reference_id = reference_id
        self.latency = latency
        self.model = model
        self.session = Session(apikey=api_key or "anonymous", base_url=base_url)
        # Inject model header according to official Fish Audio documentation
        if hasattr(self.session, "_sync_client") and self.session._sync_client:
            self.session._sync_client.headers["model"] = self.model

    def generate_audio(self, text, file_name_no_ext=None):
        file_name = self.generate_cache_file_name(file_name_no_ext, self.file_extension)

        try:
            with open(file_name, "wb") as f:
                for chunk in self.session.tts(
                    TTSRequest(
                        text=text, reference_id=self.reference_id, latency=self.latency
                    )
                ):
                    f.write(chunk)

        except Exception as e:
            logger.critical(f"\nError: Fish TTS API fail to generate audio: {e}")
            return None

        return file_name
