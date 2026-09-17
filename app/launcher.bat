@echo off
chcp 65001 >nul
title Open-LLM-VTuber 3D 本地桌面客户端
cd /d "%~dp0.."
uv run python app/launcher.py
if errorlevel 1 (
    pause
)
