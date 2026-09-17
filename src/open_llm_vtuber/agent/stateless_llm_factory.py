from typing import Type

from loguru import logger

from .stateless_llm.stateless_llm_interface import StatelessLLMInterface
from .stateless_llm.stateless_llm_with_template import (
    AsyncLLMWithTemplate as StatelessLLMWithTemplate,
)
from .stateless_llm.openai_compatible_llm import AsyncLLM as OpenAICompatibleLLM
from .stateless_llm.ollama_llm import OllamaLLM
from .stateless_llm.claude_llm import AsyncLLM as ClaudeLLM


class LLMFactory:
    @staticmethod
    def create_llm(llm_provider, **kwargs) -> Type[StatelessLLMInterface]:
        """Create an LLM based on the configuration.

        Args:
            llm_provider: The type of LLM to create
            **kwargs: Additional arguments
        """
        logger.info(f"Initializing LLM: {llm_provider}")

        if (
            llm_provider == "openai_compatible_llm"
            or llm_provider == "openai_llm"
            or llm_provider == "gemini_llm"
            or llm_provider == "zhipu_llm"
            or llm_provider == "deepseek_llm"
            or llm_provider == "groq_llm"
            or llm_provider == "mistral_llm"
            or llm_provider == "lmstudio_llm"
        ):
            base_url = (kwargs.get("base_url") or "").strip().rstrip("/")
            # Enforce base_url stops at /v1 (remove any trailing /chat or /chat/completions)
            if base_url.endswith("/chat/completions"):
                base_url = base_url[:-len("/chat/completions")].rstrip("/")
            elif base_url.endswith("/chat"):
                base_url = base_url[:-len("/chat")].rstrip("/")

            api_key = kwargs.get("llm_api_key")
            if not api_key or api_key in ("KEY_VAULT", "default_api_key", "z"):
                try:
                    from ..security.key_vault import vault
                    detected = None
                    lower_url = base_url.lower()
                    lower_model = str(kwargs.get("model") or "").lower()
                    if "deepseek" in lower_url or "deepseek" in lower_model:
                        detected = "deepseek"
                    elif "openrouter" in lower_url:
                        detected = "openrouter"
                    elif "commandcode" in lower_url:
                        detected = "commandcode"
                    elif "opencode" in lower_url:
                        detected = "opencode"

                    if detected:
                        vault_key = vault.get_key(detected)
                        if vault_key:
                            api_key = vault_key
                    if not api_key or api_key in ("KEY_VAULT", "default_api_key", "z"):
                        api_key = vault.get_key("custom") or vault.get_key("openai") or api_key
                except Exception as err:
                    logger.warning(f"Failed to lookup key from vault: {err}")

            return OpenAICompatibleLLM(
                model=kwargs.get("model"),
                base_url=base_url,
                llm_api_key=api_key or "z",
                organization_id=kwargs.get("organization_id"),
                project_id=kwargs.get("project_id"),
                temperature=kwargs.get("temperature", 1.0),
            )
        if llm_provider == "stateless_llm_with_template":
            return StatelessLLMWithTemplate(
                model=kwargs.get("model"),
                base_url=kwargs.get("base_url"),
                llm_api_key=kwargs.get("llm_api_key"),
                organization_id=kwargs.get("organization_id"),
                template=kwargs.get("template"),
                project_id=kwargs.get("project_id"),
            )
        if llm_provider == "ollama_llm":
            return OllamaLLM(
                model=kwargs.get("model"),
                base_url=kwargs.get("base_url"),
                llm_api_key=kwargs.get("llm_api_key"),
                organization_id=kwargs.get("organization_id"),
                project_id=kwargs.get("project_id"),
                temperature=kwargs.get("temperature"),
                keep_alive=kwargs.get("keep_alive"),
                unload_at_exit=kwargs.get("unload_at_exit"),
            )

        elif llm_provider == "llama_cpp_llm":
            from .stateless_llm.llama_cpp_llm import LLM as LlamaLLM

            return LlamaLLM(
                model_path=kwargs.get("model_path"),
            )
        elif llm_provider == "claude_llm":
            return ClaudeLLM(
                system=kwargs.get("system_prompt"),
                base_url=kwargs.get("base_url"),
                model=kwargs.get("model"),
                llm_api_key=kwargs.get("llm_api_key"),
            )
        else:
            raise ValueError(f"Unsupported LLM provider: {llm_provider}")


# Creating an LLM instance using a factory
# llm_instance = LLMFactory.create_llm("ollama", **config_dict)
