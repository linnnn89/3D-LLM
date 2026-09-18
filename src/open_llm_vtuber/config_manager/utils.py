# config_manager/utils.py
import yaml
from pathlib import Path
from typing import Union, Dict, Any, TypeVar
from pydantic import BaseModel, ValidationError
import os
import re
import chardet
from loguru import logger

from .main import Config

T = TypeVar("T", bound=BaseModel)


def read_yaml(config_path: str) -> Dict[str, Any]:
    """
    Read the specified YAML configuration file with environment variable substitution
    and guess encoding. Return the configuration data as a dictionary.

    Args:
        config_path: Path to the YAML configuration file.

    Returns:
        Configuration data as a dictionary.

    Raises:
        FileNotFoundError: If the configuration file is not found.
        IOError: If the configuration file cannot be read.
    """

    if not os.path.exists(config_path):
        raise FileNotFoundError(f"Configuration file not found: {config_path}")

    content = load_text_file_with_guess_encoding(config_path)
    if not content:
        raise IOError(f"Failed to read configuration file: {config_path}")

    # Replace environment variables
    pattern = re.compile(r"\$\{(\w+)\}")

    def replacer(match):
        env_var = match.group(1)
        return os.getenv(env_var, match.group(0))

    content = pattern.sub(replacer, content)

    try:
        return yaml.safe_load(content)
    except yaml.YAMLError as e:
        logger.critical(f"Error parsing YAML file: {e}")
        raise e


def validate_config(config_data: dict) -> Config:
    """
    Validate configuration data against the Config model.

    Args:
        config_data: Configuration data to validate.

    Returns:
        Validated Config object.

    Raises:
        ValidationError: If the configuration fails validation.
    """
    try:
        return Config(**config_data)
    except ValidationError as e:
        logger.critical(f"Error validating configuration: {e}")
        logger.error("Configuration data:")
        logger.error(config_data)
        raise e


def load_text_file_with_guess_encoding(file_path: str) -> str | None:
    """
    Load a text file with guessed encoding.

    Parameters:
    - file_path (str): The path to the text file.

    Returns:
    - str: The content of the text file or None if an error occurred.
    """
    encodings = ["utf-8", "utf-8-sig", "gbk", "gb2312", "ascii", "cp936"]

    for encoding in encodings:
        try:
            with open(file_path, "r", encoding=encoding) as file:
                return file.read()
        except UnicodeDecodeError:
            continue
    # If common encodings fail, try chardet to guess the encoding
    try:
        with open(file_path, "rb") as file:
            raw_data = file.read()
        detected = chardet.detect(raw_data)
        if detected["encoding"]:
            return raw_data.decode(detected["encoding"])
    except Exception as e:
        logger.error(f"Error detecting encoding for config file {file_path}: {e}")
    return None


def save_config(config: BaseModel, config_path: Union[str, Path]):
    """
    Saves a Pydantic model to a YAML configuration file.

    Args:
        config: The Pydantic model to save.
        config_path: Path to the YAML configuration file.
    """
    config_file = Path(config_path)
    config_data = config.model_dump(
        by_alias=True, exclude_unset=True, exclude_none=True
    )

    try:
        with open(config_file, "w", encoding="utf-8") as f:
            yaml.dump(config_data, f, allow_unicode=True)
    except yaml.YAMLError as e:
        raise yaml.YAMLError(f"Error writing YAML file: {e}")


def scan_config_alts_directory(config_alts_dir: str) -> list[dict]:
    """
    Scan the config_alts directory and return a list of config information.
    Each config info contains the filename and its display name from the config.

    Parameters:
    - config_alts_dir (str): The path to the config_alts directory.

    Returns:
    - list[dict]: A list of dicts containing config info:
        - filename: The actual config file name
        - name: Display name from config, falls back to filename if not specified
    """
    config_files = []

    # Add default config first
    default_config = read_yaml("conf.yaml")
    config_files.append(
        {
            "filename": "conf.yaml",
            "name": default_config.get("character_config", {}).get(
                "conf_name", "conf.yaml"
            )
            if default_config
            else "conf.yaml",
        }
    )

    # Scan other configs
    # 只扫顶层目录，不递归：handle_config_switch 是用
    # os.path.join(config_alts_dir, filename) 定位配置的，而这里返回的 filename
    # 只有 basename，所以嵌套目录里的配置根本加载不到，列出来也点不动。
    # `characters/_archived/` 这类归档目录正是靠这一点被排除在角色列表之外的。
    if os.path.isdir(config_alts_dir):
        for entry in os.scandir(config_alts_dir):
            if not entry.is_file() or not entry.name.endswith(".yaml"):
                continue
            config: dict = read_yaml(entry.path)
            config_files.append(
                {
                    "filename": entry.name,
                    "name": config.get("character_config", {}).get(
                        "conf_name", entry.name
                    )
                    if config
                    else entry.name,
                }
            )
    logger.debug(f"Found config files: {config_files}")
    return config_files


def scan_bg_directory() -> list[str]:
    bg_files = []
    bg_dir = "backgrounds"
    # 只扫顶层：前端是用 `/bg/<filename>` 取图的，嵌套目录里的图片拼出来的 URL
    # 会 404，列进选择器只会得到一个点不动的空背景。
    if os.path.isdir(bg_dir):
        for entry in os.scandir(bg_dir):
            if entry.is_file() and entry.name.endswith((".jpg", ".jpeg", ".png", ".gif")):
                bg_files.append(entry.name)
    return bg_files
