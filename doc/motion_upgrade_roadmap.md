# 肢体与全身动作联动待升级规划 (Motion Upgrade Roadmap)

## 一、当前现状与技术边界

在当前的 Open-LLM-VTuber 系统中，角色模型的表现力仅限于**面部表情与头部微动**，暂不支持手脚、肢体或全身动作（如挥手、踱步、跳舞、叉腰等）：

1. **协议层限制（`output_types.py`）**：
   - 后端下发给前端的动作包数据结构为：
     ```python
     @dataclass
     class Actions:
         expressions: Optional[List[str] | List[int]] = None
         pictures: Optional[List[str]] = None
         sounds: Optional[List[str]] = None
     ```
   - 协议中尚未定义 `motions` 或 `gestures` 等动作字段。

2. **3D VRM 渲染层现状（`vrm_frontend/app.js`）**：
   - 现有的模型动态完全依靠纯数学的**程序化驱动（Procedural Animation）**：
     - **待机呼吸**：`updateIdle` 通过正弦波驱动 `chest` 与 `spine` 周期起伏；
     - **随机眨眼**：`updateBlink` 计时器驱动眼部 BlendShape；
     - **实时唇形**：`updateLipSync` 通过 Web Audio FFT 音频频段动态调制 `aa` 与 `oh` 口型；
     - **头部微姿态**：在 `setEmotion` 触发时微调头骨（`head`）俯仰角度。
   - **缺少动作库与播放器**：前端未集成动画混合器（AnimationMixer），未加载骨骼动画片段（VRMA / FBX）。

3. **Live2D 渲染层现状**：
   - 现有的动作仅绑定在鼠标点击（`tap_body` / `tap_head`）等交互事件中，大模型无法通过输出文本标签主动触发动作。

---

## 二、后续待升级功能规划 (Roadmap)

### 阶段 1：数据协议与大模型动作标签扩展
- 在 `Actions` 数据模型中增加 `motions: Optional[List[str]] = None`。
- 在 `live2d_model.py` / 动作提取管线中引入动作关键词解析器（例如支持识别 `[motion:wave]`、`[motion:nod]` 或分句动作映射）。
- 对 LLM 发出的动作标签进行清洗，避免朗读或污染 TTS 输入。

### 阶段 2：VRM 3D 前端动作引擎接入
- **引入 VRMA (VRM Animation) 标准动画库**：
  - 支持加载 `.vrma` 格式的标准全身动作剪辑（如问候挥手、鞠躬、害羞手足无措、点头等通用动作）。
  - 基于 Three.js 的 `AnimationMixer` 实现动作的平滑淡入淡出（CrossFade），使动作在待机呼吸与动作播放之间自然过渡，而不发生骨骼瞬间跳变。
- **动作分层驱动**：
  - 允许动作只作用于上半身或手臂，同时保持眼球追踪和下半身静止站立。

### 阶段 3：Live2D 文本驱动动作扩展
- 在 Live2D 前端 WebSocket 消息中监听 `actions.motions`，动态调用 Cubism MotionManager 播放指定的 motion3.json。

---
*记录时间：2026-09-17*  
*状态：待升级规划中（Backlog）*
