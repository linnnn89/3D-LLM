# PMX & Blend Dedicated Motion System

**路径**: `D:\CODEX PROJECT\Open-LLM-VTuber\pmx_motion`

本模块是专为 Blender / MMD (.pmx) 角色模型打造的独立动作与姿态驱动系统，与 VRM 的 `.vrma` 体系实现物理隔离与双轨并行驱动。

---

## 一、系统架构与设计原则

1. **完全解耦与双轨路由**：
   - VRM 模型由原生 `@pixiv/three-vrm-animation` 管线驱动；
   - Blender / PMX 模型由本目录的 `BlendMotionSystem` 基于 `@moeru/three-mmd` 运行时驱动；
   - 通过 `motionRouter` 自动识别模型类别（`.vrm` vs `.pmx` / `.blend`）实现无缝派发。
2. **纯粹标准驱动（零运行时打补丁）**：
   - 彻底废除旧版在前端通过内存扫描重定向蒙皮（`repairPmxSkinning`）及手动覆盖前臂捩骨的陈旧兼容代码；
   - **核心哲学**：模型资产在 Blender 导入期必须 100% 达到日本标准 MMD 规范，动作脚本只负责基于标准骨骼执行高质量动作反解与调度。
3. **自然少女休止姿态与基底固化**：
   - 消除 MMD 模型默认 40°~45° A-Pose 的僵硬张臂，施加人体工学沉肩垂手（75°~80° 放松立姿）与肘部微敛；
   - 实时将调整后的四元数与位移写入 `mmd.animationPose`，杜绝 `@moeru/three-mmd` 底层在每帧更新时还原回原始大字姿态。

---

## 二、后续开发与资产导入工作标准 (Standard Operating Procedure)

所有属于 Blend 组的后续角色模型与动作扩展，**必须无条件遵循以下 5 大日本 MMD 标准**：

### 1. 骨骼命名与层级标准（Bone Hierarchy Checklist）

所有核心骨骼必须使用日本标准全角汉字/假名，层级关系如下：

```text
全ての親 (Root 舞台定位)
 └─ センター (Center 重心与起伏)
     ├─ 下半身 (Pelvis 骨盆倾斜)
     │   ├─ 左足 / 右足 (Thigh 大腿)
     │   │   └─ 左ひざ / 右ひざ (Calf 小腿)
     │   │       └─ 左足首 / 右足首 (Ankle 脚踝)
     │   │           └─ 左つま先 / 右つま先 (Toe 脚尖)
     │   └─ (受 足ＩＫ 与 つま先ＩＫ 逆运动学驱动)
     └─ 上半身 (Spine 脊柱下段)
         └─ 上半身2 (Chest 胸腔与呼吸)
             ├─ 首 (Neck 颈部)
             │   └─ 頭 (Head 头部注视与微动)
             └─ 左肩 / 右肩 (Shoulder 锁骨沉肩)
                 └─ 左腕 / 右腕 (UpperArm 上臂)
                     └─ 左ひじ / 右ひじ (Forearm 前臂)
                         └─ 左手首 / 右手首 (Wrist 手腕)
                             └─ 手指十指链 (親指/人指/中指/薬指/小指)
```

> [!IMPORTANT]
> - **IK 骨骼**：双下肢必须具备标准 IK 链（`左足ＩＫ`、`右足ＩＫ`、`左つま先ＩＫ`、`右つま先ＩＫ`）。
> - **捩骨规范（Twist Bones）**：
>   - `腕捩`（`左腕捩`、`右腕捩`）是 **大臂捩骨**（父级为 `腕`）；
>   - `手捩`（`左手捩`、`右手捩`）是 **前臂捩骨**（父级为 `ひじ`）；
>   - 捩骨在 MMD 中属于物理旋转附与骨（appendTransform），**严禁在动作脚本中手动向捩骨注入旋转覆盖**。

### 2. 初始姿态标准 (Rest Pose)

- **休止基准**：必须保存为标准 **A-Pose**（双臂自然下倾约 35°~45°，手背朝外微偏前，掌心自然内敛）。
- **禁止项**：严禁保存为 T-Pose、双手高举或不对称非标姿态，否则在运行时套用标准休止矩阵会导致肢体严重穿模。

### 3. 重心与动力学驱动标准 (Center Dynamics)

- **位移归属**：所有引起角色重心升降、腾空跳跃、受惊后退的位移通道，**必须且只能作用于 `センター`（Center）骨骼的 `position`**。
- **禁止项**：严禁直接位移 `全ての親`（仅供场景调度）或 `下半身`（仅负责下肢旋转）。

### 4. 表情与形态键标准 (Morphs / Blendshapes)

面部形态键必须统一使用 MMD 规范名称，由适配器自动建立映射缓存：

| 语义槽位 | 规范 MMD 形态键名称 | 说明 |
| :--- | :--- | :--- |
| `blink` | `まばたき` | 双眼眨眼 |
| `blinkRight` / `Left` | `ウィンク右` / `ウィンク` | 单眼眨眼 |
| `aa` (元音 A) | `あ`、`口_あ` | 音频口型驱动主要通道 |
| `oh` (元音 O) | `お`、`口_お` | 音频口型驱动辅助通道 |
| `happy` | `笑い`、`にっこり`、`笑顔` | 开心微笑 |
| `sad` | `困る`、`悲しい` | 悲伤困惑 |
| `angry` | `怒り` | 生气皱眉 |
| `surprised` | `びっくり`、`驚き` | 惊讶睁眼张嘴 |

### 5. 建模导出前自检 (Pre-flight Inspection SOP)

在新模型放入项目前，需在 Blender 中完成以下四项核对：
1. **顶点组孤立核查**：确保面部、眼球、舌头等所有零件的网格顶点均绑定至有效骨骼（如 `頭`），严禁残留无权重顶点或误绑至 Root 骨骼。
2. **副骨精简**：从游戏解包或 3ds Max 导出的非标辅助骨（如 `ForeTwist`、`Roll` 骨骼），若未在 PMX 中配置标准 MMD 旋转附与，须在 Blender 中将其顶点权重合并入主肢体骨（如 `ひじ`）后删除副骨。
3. **坐标系与尺度**：模型总高约为 MMD 标准高度（约 18~20 MMD 单位，头骨世界高度约在 18~22 范围），便于运行时执行尺寸归一化。
4. **命名编码**：确保骨骼、材质、形态键名称均为 UTF-8 编码的标准字符，避免乱码。

---

## 三、文件目录清单

- [index.js](file:///d:/CODEX%20PROJECT/Open-LLM-VTuber/pmx_motion/index.js)：核心逻辑入口
  - `PMX_BONE_MAPPING`：标准 MMD 骨骼语义槽位映射字典
  - `applyNaturalPose(adapter)`：标准沉肩垂臂姿态计算与 `mmd.animationPose` 固化
  - `ensureProceduralPmxMotionClips(adapter, map)`：专属标准程序化动作集（`idle`, `wave_hand`, `pmx_greeting`, `gentle_nod`, `shake_head`, `cheerful_bounce`, `surprise_jump`, `pout_turn`, `shy_tilt`）
  - `BlendMotionSystem`：MMD 独立动作混合调度器
  - `motionRouter`：VRM 与 Blend 双轨动作路由中枢
