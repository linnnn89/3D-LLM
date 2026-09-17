# -*- coding: utf-8 -*-
"""Storage and User Profile Directory Manager.
Resolves Windows Documents folder dynamically, manages user data directory,
and handles data migration for keys.enc, memory.sqlite, and user_settings.json.
"""

import os
import sys
import shutil
import json
from pathlib import Path
from loguru import logger

CONFIG_POINTER_FILE = Path("data/storage_config.json")


def get_default_user_data_dir() -> Path:
    """Dynamically get the Windows User's 'My Documents' folder and return Documents/LLM-3D-CHAT."""
    if sys.platform == "win32":
        try:
            import ctypes
            import ctypes.wintypes
            CSIDL_PERSONAL = 5  # My Documents
            buf = ctypes.create_unicode_buffer(ctypes.wintypes.MAX_PATH)
            # SHGFP_TYPE_CURRENT = 0
            if ctypes.windll.shell32.SHGetFolderPathW(None, CSIDL_PERSONAL, None, 0, buf) == 0:
                doc_path = Path(buf.value)
                if doc_path.exists():
                    return doc_path / "LLM-3D-CHAT"
        except Exception as e:
            logger.warning(f"Could not resolve Documents folder via Win32 Shell: {e}")

    # Fallback to E:\我的文档 if exists or ~/Documents
    candidate_e = Path(r"E:\我的文档")
    if candidate_e.exists():
        return candidate_e / "LLM-3D-CHAT"

    return Path.home() / "Documents" / "LLM-3D-CHAT"


class StorageManager:
    def __init__(self):
        self._cached_dir: Path | None = None

    def get_user_data_dir(self) -> Path:
        """Get the active user data directory, falling back to default."""
        if self._cached_dir:
            return self._cached_dir

        # Check pointer config file
        if CONFIG_POINTER_FILE.exists():
            try:
                data = json.loads(CONFIG_POINTER_FILE.read_text(encoding="utf-8"))
                custom_dir = data.get("user_data_dir")
                if custom_dir:
                    p = Path(custom_dir)
                    p.mkdir(parents=True, exist_ok=True)
                    self._cached_dir = p
                    return p
            except Exception as e:
                logger.warning(f"Failed to read storage_config.json: {e}")

        default_dir = get_default_user_data_dir()
        default_dir.mkdir(parents=True, exist_ok=True)
        self._cached_dir = default_dir
        return default_dir

    def set_user_data_dir(self, new_dir_str: str, migrate: bool = True) -> tuple[bool, str]:
        """Change user data directory and optionally migrate existing data."""
        try:
            new_path = Path(new_dir_str).resolve()
            new_path.mkdir(parents=True, exist_ok=True)
            old_path = self.get_user_data_dir()

            if migrate and old_path != new_path and old_path.exists():
                logger.info(f"Migrating user data from {old_path} to {new_path}...")
                for item in old_path.glob("*"):
                    dest = new_path / item.name
                    if item.is_file():
                        shutil.copy2(item, dest)
                        logger.info(f"Migrated file: {item.name}")
                    elif item.is_dir():
                        if dest.exists():
                            shutil.rmtree(dest)
                        shutil.copytree(item, dest)
                        logger.info(f"Migrated directory: {item.name}")

            # Save pointer
            CONFIG_POINTER_FILE.parent.mkdir(parents=True, exist_ok=True)
            CONFIG_POINTER_FILE.write_text(
                json.dumps({"user_data_dir": str(new_path)}, ensure_ascii=False, indent=2),
                encoding="utf-8"
            )
            self._cached_dir = new_path
            return True, f"成功迁移并设定用户数据目录为: {new_path}"
        except Exception as e:
            logger.error(f"Failed to set/migrate user data dir: {e}")
            return False, str(e)

    def reset_to_default(self, migrate: bool = True) -> tuple[bool, str]:
        """Reset user data directory to default Documents/LLM-3D-CHAT."""
        default_dir = get_default_user_data_dir()
        return self.set_user_data_dir(str(default_dir), migrate=migrate)


storage_mgr = StorageManager()
