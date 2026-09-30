"""Entry-point logging; constructors must never replace process-wide sinks."""
import sys
import time
from pathlib import Path
from loguru import logger


def prune_logs(files, max_bytes=20 * 1024 * 1024, max_age=14 * 86400):
    # Only the caller's own prefix participates. Never prune chat history or backups.
    entries = sorted((Path(file) for file in files), key=lambda p: p.stat().st_mtime, reverse=True)
    total = 0
    for path in entries:
        stat = path.stat()
        if time.time() - stat.st_mtime > max_age or total + stat.st_size > max_bytes:
            path.unlink(missing_ok=True)
        else:
            total += stat.st_size


def configure_logging(level="INFO", directory="logs", prefix="backend"):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    logger.remove()
    logger.add(sys.stderr, level=level, backtrace=False, diagnose=False)
    prune_logs(directory.glob(f"{prefix}_*.log"))
    logger.add(
        directory / (prefix + "_{time:YYYY-MM-DD}.log"),
        rotation="2 MB",
        retention=prune_logs,
        level=level,
        backtrace=level == "DEBUG",
        diagnose=False,
        format="{time:YYYY-MM-DD HH:mm:ss.SSS} | {level} | {name}:{function}:{line} | {message}",
    )
