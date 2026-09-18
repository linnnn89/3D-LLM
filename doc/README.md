For full documentation, please visit our [documentation site](https://open-llm-vtuber.github.io/) or view the [source repository](https://github.com/Open-LLM-VTuber/open-llm-vtuber.github.io).

> **Note:**  
> The `sample_conf` directory contains legacy sample configuration files for running various models with sherpa-onnx. These files are deprecated and will be removed after we extract the relevant sherpa-onnx information.

## 规划文档 / Roadmaps
- [肢体与全身动作联动待升级规划](motion_upgrade_roadmap.md)

## 桌宠 / Desktop Pet
- [Windows 3D AI 桌宠 — 架构研究与可行性分析](desktop_pet_feasibility_20260918.md) —— 仓库审计、Renderer 选型（为何选 Electron 而非 Godot / Unity / Lively）、能力清单与开发路线
- [无框窗口 UI 工程规范](desktop_pet_ui_design_20260918.md) —— 透明 / 穿透 / 拖动 / 分层 / z-order 的工程约束，§12 为逐项实测结果

> 实现与运行方式见 [`desktop/README.md`](../desktop/README.md)。

## 工程记录 / Engineering Notes
- [踩坑与失败记录](pitfalls.md) —— 每次返工与长时间排查的根因、判据与教训，只记已付出代价的失败
