# -*- coding: utf-8 -*-
"""Windows DPAPI Key Vault for safely storing API keys across providers."""

import os
import sys
import json
from pathlib import Path
from loguru import logger

# Try loading Windows DPAPI via ctypes
_HAS_DPAPI = False
if sys.platform == "win32":
    try:
        import ctypes
        import ctypes.wintypes

        class DATA_BLOB(ctypes.Structure):
            _fields_ = [
                ("cbData", ctypes.wintypes.DWORD),
                ("pbData", ctypes.POINTER(ctypes.c_byte)),
            ]

        _crypt32 = ctypes.windll.crypt32
        _kernel32 = ctypes.windll.kernel32
        _HAS_DPAPI = True
    except Exception as e:
        logger.warning(f"Failed to initialize Windows DPAPI: {e}")


def _dpapi_encrypt(data: bytes, description: str = "open_llm_vtuber_keys") -> bytes:
    if not _HAS_DPAPI:
        import base64
        return b"PLAIN:" + base64.b64encode(data)

    blob_in = DATA_BLOB(
        len(data),
        ctypes.cast(ctypes.create_string_buffer(data), ctypes.POINTER(ctypes.c_byte)),
    )
    blob_out = DATA_BLOB()
    # CRYPTPROTECT_UI_FORBIDDEN = 0x1
    if not _crypt32.CryptProtectData(
        ctypes.byref(blob_in),
        description,
        None,
        None,
        None,
        0x1,
        ctypes.byref(blob_out),
    ):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(blob_out.pbData, blob_out.cbData)
    finally:
        _kernel32.LocalFree(blob_out.pbData)


def _dpapi_decrypt(data: bytes) -> bytes:
    if not _HAS_DPAPI:
        import base64
        if data.startswith(b"PLAIN:"):
            return base64.b64decode(data[6:])
        return data

    blob_in = DATA_BLOB(
        len(data),
        ctypes.cast(ctypes.create_string_buffer(data), ctypes.POINTER(ctypes.c_byte)),
    )
    blob_out = DATA_BLOB()
    # CRYPTPROTECT_UI_FORBIDDEN = 0x1
    if not _crypt32.CryptUnprotectData(
        ctypes.byref(blob_in),
        None,
        None,
        None,
        None,
        0x1,
        ctypes.byref(blob_out),
    ):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(blob_out.pbData, blob_out.cbData)
    finally:
        _kernel32.LocalFree(blob_out.pbData)


class KeyVault:
    """Manages all provider API keys encrypted with Windows DPAPI."""

    def __init__(self, vault_path: str | Path | None = None):
        self._custom_vault_path = Path(vault_path) if vault_path else None

    @property
    def vault_path(self) -> Path:
        if self._custom_vault_path:
            return self._custom_vault_path
        try:
            from .storage_manager import storage_mgr
            return storage_mgr.get_user_data_dir() / "keys.enc"
        except Exception:
            return Path("data/keys.enc")

    def _ensure_dir(self):
        self.vault_path.parent.mkdir(parents=True, exist_ok=True)

    def load_all_keys(self) -> dict[str, str]:
        """Loads and decrypts all provider keys from vault file."""
        if not self.vault_path.exists():
            return {}
        try:
            encrypted_data = self.vault_path.read_bytes()
            if not encrypted_data:
                return {}
            decrypted_json = _dpapi_decrypt(encrypted_data).decode("utf-8")
            return json.loads(decrypted_json)
        except Exception as e:
            logger.error(f"Failed to read/decrypt key vault at {self.vault_path}: {e}")
            return {}

    def save_all_keys(self, keys: dict[str, str]) -> bool:
        """Encrypts and persists keys dict to vault file."""
        try:
            self._ensure_dir()
            payload = json.dumps(keys, ensure_ascii=False, indent=2).encode("utf-8")
            encrypted_data = _dpapi_encrypt(payload)
            self.vault_path.write_bytes(encrypted_data)
            return True
        except Exception as e:
            logger.error(f"Failed to encrypt/save key vault to {self.vault_path}: {e}")
            return False

    def get_key(self, provider: str, default: str | None = None) -> str | None:
        """Retrieves a single provider's decrypted API key."""
        keys = self.load_all_keys()
        return keys.get(provider.lower().strip()) or default

    def set_key(self, provider: str, key: str) -> bool:
        """Sets or updates a provider's key."""
        keys = self.load_all_keys()
        provider_clean = provider.lower().strip()
        if not key or not key.strip():
            keys.pop(provider_clean, None)
        else:
            keys[provider_clean] = key.strip()
        return self.save_all_keys(keys)

    def get_keys_status(self) -> dict[str, dict]:
        """Returns safe status of configured keys with masking, without leaking plain keys."""
        keys = self.load_all_keys()
        status = {}
        for p, k in keys.items():
            if not k:
                continue
            masked = k[:3] + "..." + k[-4:] if len(k) > 7 else "***"
            status[p] = {
                "configured": True,
                "masked": masked,
                "length": len(k),
            }
        return status


# Global singleton instance
vault = KeyVault()
