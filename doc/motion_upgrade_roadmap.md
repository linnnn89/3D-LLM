# 肢体与全身动作联动待升级规划 (Motion Upgrade Roadmap)

## 一、当前现状与技术边界

### 1. VRM 3D 渲染层 —— 动作引擎**已落地**（2026-09-18 更新）

前端已接入完整的动作系统（`vrm_frontend/app.js`），不再是"只有表情与头部微动"：

- **双引擎**：外部 `.vrma` 动捕优先，文件缺失时由程序化骨骼关键帧保底。同一个动作名，`motions/` 下有对应文件就用文件，否则自动降级，界面不会因缺文件而失灵（`ensureProceduralMotionClips()`）。
- **播放与过渡**：`THREE.AnimationMixer` + `createVRMAnimationClip()` 重定向；`playMotion()` 用 `crossFadeFrom` 接入、one-shot 结束后 `fadeOut(0.35)` 交还待机。
- **跨模型通用**：动作数值一律按**世界系语义**书写并做 VRM 0.x/1.0 的坐标系基差补偿，三个角色（2 个 VRM 0.x + 1 个 VRM 1.0）共享同一份动作定义。
- **资源现状**：`idle` / `greeting` / `VRMA_01` 三个 `.vrma` 已随项目提供；`wave_hand`、`shake_head`、`gentle_nod`、`cheerful_bounce`、`surprise_jump`、`pout_turn`、`shy_tilt` 七个仍走程序化保底。
- **触发方式**：动作演示下拉（手动）、对话情绪映射（`playNextAudio()`）、点击角色（`CLICK_REACTIONS`）、模型加载后自动打招呼（`AUTO_GREETING_ON_LOAD`）。

> 制作规范（坐标系、工具 API、几何硬约束、验收流程）见 [`vrm_motion_guide.md`](vrm_motion_guide.md)；
> 接口与动作清单见 [`../vrm_frontend/README.md` §2](../vrm_frontend/README.md)。

### 2. 协议层 —— 仍未定义动作字段（主要瓶颈）

后端下发给前端的动作包数据结构（`src/open_llm_vtuber/agent/output_types.py`）仍是：

```python
@dataclass
class Actions:
    expressions: Optional[List[str] | List[int]] = None
    pictures: Optional[List[str]] = None
    sounds: Optional[List[str]] = None
```

**没有 `motions` / `gestures` 字段。** 因此当下的所有肢体动作都由前端本地事件触发，**大模型无法通过输出文本主动触发动作** —— 这是"能播动作"和"动作能表达语义"之间的最后一环。

### 3. Live2D 渲染层 —— 动作仍只绑定鼠标点击

现有的动作仅绑定在 `tap_body` / `tap_head` 等交互事件上，大模型同样无法主动触发。

---

## 二、后续待升级功能规划 (Roadmap)

### 阶段 1：数据协议与大模型动作标签扩展 ⬜ 未开始（优先级最高）

- 在 `Actions` 数据模型中增加 `motions: Optional[List[str]] = None`。
- 在动作提取管线中引入动作关键词解析器（例如识别 `[motion:wave]`、`[motion:nod]`）。
- 对 LLM 发出的动作标签做清洗，避免被朗读或污染 TTS 输入。
- 前端在收到 `actions.motions` 时调用已有的 `playMotion(name)` —— 播放侧已就绪，**只差协议与解析**。

### 阶段 2：VRM 3D 前端动作引擎接入 ✅ 已完成

- [x] 引入 VRMA 标准动画库，支持加载 `.vrma` 全身动作剪辑
- [x] 基于 `AnimationMixer` 的淡入淡出（CrossFade），动作与待机之间不跳变
- [x] 程序化动作保底，缺文件时自动降级
- [x] 动作跨 VRM 0.x / 1.0 通用（坐标系基差补偿）
- [x] 单一来源的动作制作规范与验收流程（[`vrm_motion_guide.md`](vrm_motion_guide.md)）

剩余（不在本阶段原始范围内，按需再做）：

- ⬜ **动作分层驱动**：允许动作只作用于上半身或手臂，同时保持眼球追踪与下半身站立。
  现状是每个 clip 整段播放、无分层。
- ⬜ **补齐动作资源**：上表七个动作仍是程序化保底，若拿到成品动作包可逐个替换为 `.vrma`。

### 阶段 3：Live2D 文本驱动动作扩展 ⬜ 未开始

- 在 Live2D 前端 WebSocket 消息中监听 `actions.motions`，动态调用 Cubism `MotionManager` 播放指定的 `motion3.json`。
- 依赖阶段 1 先落地，否则没有消息可监听。

---

*记录时间：2026-09-17*
*更新时间：2026-09-18（阶段 2 落地，补当前现状与剩余项）*
