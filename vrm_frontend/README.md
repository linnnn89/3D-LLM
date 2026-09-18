# 3D VRM 前端（`vrm_frontend/`）

本目录是 3D 数字人视口，由后端以 `/vrm` 挂载（见 `src/open_llm_vtuber/server.py`），配套启动器见 [`app/README.md`](../app/README.md)。

**所有改动刷新即生效**，无需编译打包。

---

## 1. 目录结构

| 路径 | 说明 |
| --- | --- |
| `index.html` | 页面骨架、importmap（three / three-vrm / three-vrm-animation）、顶部工具条 |
| `app.js` | 全部逻辑：场景、VRM 加载、表情、口型、动作系统、WebSocket、拉起设置窗口 |
| `style.css` | 界面样式 |
| `settings.html` | **全局设置窗口**（LLM / 密钥保险库 / 记忆 / 存储 / ASR） |
| `character.html` | **角色设置窗口**（人设 / 声音 / 3D 形象） |
| `settings.js` | 两个设置窗口共用的逻辑（按 `body[data-settings-page]` 区分模式） |
| `libs/` | 本地化的 three.js、three-vrm、three-vrm-animation、GLTFLoader、OrbitControls |
| `motions/` | `.vrma` 动作文件（缺失时自动降级为程序化动作） |

依赖通过 `index.html` 里的 importmap 解析，全部指向 `libs/` 本地文件，**不依赖 CDN**：

```json
"three": "./libs/three.module.js",
"three/addons/": "./libs/",
"@pixiv/three-vrm": "./libs/three-vrm.module.min.js",
"@pixiv/three-vrm-animation": "./libs/three-vrm-animation.module.min.js"
```

---

## 2. 动作系统（双引擎）

设计原则：**外部 `.vrma` 动捕优先，本地程序化骨骼曲线保底**。同一个动作名，如果 `motions/` 下存在对应文件就用官方动捕，否则自动用代码生成的关键帧，界面不会因为缺文件而失灵。

### 2.1 动作清单（`MOTION_URLS`）

| 动作名 | 期望文件 | 现状 |
| --- | --- | --- |
| `idle` | `motions/idle_loop.vrma` | ✅ 已随项目提供（Pixiv/ChatVRM 官方待机循环，10.4s） |
| `greeting` | `motions/greeting.vrma` | ✅ 已提供（Pixiv VRoid Project 官方动捕，11.8s） |
| `VRMA_01` | `motions/VRMA_01.vrma` | ✅ 与 `greeting` 同一文件（按官方包命名保留） |
| `wave_hand` | `motions/wave_hand.vrma` | ⬜ 缺失 → 走程序化 |
| `shake_head` | `motions/shake_head.vrma` | ⬜ 缺失 → 走程序化 |
| `gentle_nod` | `motions/gentle_nod.vrma` | ⬜ 缺失 → 走程序化 |
| `cheerful_bounce` | `motions/cheerful_bounce.vrma` | ⬜ 缺失 → 走程序化 |
| `shy_tilt` | `motions/shy_tilt.vrma` | ⬜ 缺失 → 走程序化 |
| `surprise_jump` | `motions/surprise_jump.vrma` | ⬜ 缺失 → 走程序化 |
| `pout_turn` | `motions/pout_turn.vrma` | ⬜ 缺失 → 走程序化 |

**补充官方动作的方法**：把 `.vrma` 文件丢进 `motions/` 并命名为上表的期望文件名即可自动生效，一行代码都不用改。若要用别的文件名，在 `MOTION_URLS` 中加一行映射。

Placeholder：目前 `greeting` 用的是 BOOTH 免费包里的 `VRMA_01`（全身展示动作）。若想让它变成真正的"摆手打招呼"，从 [VRoid Project 官方 BOOTH 页](https://vroid.booth.pm/items/5512385) 免费领取动作包后，用其中的 `VRMA_02.vrma` 覆盖 `motions/greeting.vrma`。

### 2.2 程序化动作

`ensureProceduralMotionClips()` 以 `applyNaturalPose()` 之后的自然站姿为基准，用 `rotTrack()` 生成相对 rest 姿态的旋转关键帧。

| 动作 | 效果 |
| --- | --- |
| `wave_hand` | 右臂抬起 + 前臂来回摆动，配合头部轻侧 |
| `shake_head` | 头部偏航左右摆，胸腔轻微跟随 |
| `gentle_nod` | 头部俯仰点头 |
| `shy_tilt` | 头部侧倾 + 低头 |
| `cheerful_bounce` | 髋部上下弹跳 + 头部轻抬 |
| `surprise_jump` | 髋部后缩 + 头部后仰 |
| `pout_turn` | 头部偏航转向 |

> 调整动作幅度 → 改 `rotTrack()` 调用里的欧拉角数组即可。数值是**相对自然站姿的增量弧度**（±0.2 ≈ ±11°）。

### 2.3 触发方式

- **动作演示下拉**（顶部 `🎭 动作演示打样...`）：手动播放一次，用于验证动作。
- **对话情绪联动**：`playNextAudio()` 中按情绪映射（happy→`cheerful_bounce`、surprised→`surprise_jump`、relaxed→`gentle_nod`、angry→`pout_turn`）。
- **点击角色**：`CLICK_REACTIONS` 随机触发表情 + 动作，头顶/身体命中部位不同、台词不同。
- **加载后自动打招呼**：常量 `AUTO_GREETING_ON_LOAD`（默认 `true`）。模型与官方动作都就绪后播放一次 `greeting`；设为 `false` 可关闭。

### 2.4 骨骼绑定

关键帧的 track 名形如 `` `${node.name}.quaternion` ``。three-vrm 的归一化骨骼被命名为 `'Normalized_' + 原始骨骼名`（见 `VRMHumanoidRig._setupTransforms`），因此：

- 归一化骨骼**不会**与模型自身的原始骨骼（如 `hips`、`upper_arm.R`）发生同名冲突；
- 即使原始骨骼名带点号（Blender 风格 `upper_arm.R` → `Normalized_upper_arm.R`），three.js 的 `PropertyBinding` 也能正确解析。

修改动作相关代码后，建议用 `node --check` 做一次语法校验。

---

## 3. 渲染设置（重要）

`initScene()` 中有两处**对卡通渲染很敏感**的设置，改动前请先读这段说明。

### 3.1 不要使用电影级色调映射

```js
renderer.toneMapping = THREE.NoToneMapping;   // 正确
// renderer.toneMapping = THREE.ACESFilmicToneMapping;  // ← 曾经的 bug
```

MToon 是卡通着色，**贴图颜色本身就是最终风格化结果**。ACES 的工作曲线是 `color *= exposure / 0.6`（默认即放大 1.8 倍）再做高光压缩，会显著**压缩浅色贴图的对比度**：实测喜多的脸部贴图经 ACES 后，皮肤与五官的亮度差从 2 个档位被压到 1 个档位，眼睛贴图的层次几乎被抹平，整张脸糊成一片白。

three-vrm 官方示例同样不使用 tone mapping。

### 3.2 光照强度需要克制

```js
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
const mainLight    = new THREE.DirectionalLight(0xfff7ed, 1.2);
const fillLight    = new THREE.DirectionalLight(0xebe4ff, 0.45);
const rimLight     = new THREE.DirectionalLight(0xffd6e0, 0.35);
// 总量 ≈ 2.4
```

MToon 的明暗是两个阶跃档位。光照过强（此前总量 **4.4**）会让模型几乎所有表面都落在亮部，**失去明暗层次而"发平、发白"**，浅色贴图的模型（如喜多）尤其明显。

> 判断标准：模型应当能看出「亮部 / 阴影部」两级分明；若整体一片平坦发白，就是光照过强。

### 3.3 色彩空间

`renderer.outputColorSpace = THREE.SRGBColorSpace`（three.js 默认值），GLTFLoader 会自动把 baseColor 贴图标记为 sRGB。这两项保持默认即可，不要手动改动贴图 colorSpace。

---

## 4. 角色与模型

角色元数据（显示名、缩略字符、模型路径、开场白、快捷问题）硬编码在 `app.js` 的 `CHARACTER_META`；顶部角色下拉在 `index.html` 的 `#config-select`；触碰台词在 `VOICE_LINES`。**新增/移除角色需要同时改这三处**，角色配置文件在项目根的 `characters/*.yaml`。

| 角色 | 模型 | 体积 | 规格 | 状态 |
| --- | --- | --- | --- | --- |
| 喜多郁代 (Kira) | `vrm-models/喜多郁代/喜多郁代.vrm` | 8.5 MB | VRM 0.x，4.1 万顶点 / 6.9 万面 | 正常 |
| 由比滨结衣 | `vrm-models/由比滨结衣/由比滨结衣.vrm` | 15 MB | VRM 1.0，14.9 万顶点 / 4.8 万面 | 正常 |
| 雷电将军 | `vrm-models/雷电将军/雷电将军.vrm` | 12.5 MB | VRM 0.x | 正常 |
| 依蕾娜 | `vrm-models/依蕾娜/依蕾娜.vrm` | 11.6 MB | VRM 0.x，9.6 万顶点 / **16.4 万面** | 已减面优化（原为 56 MB / 106 万顶点 / 105 万面） |

### 模型相关注意事项

- **喜多（VRM 0.x）**：贴图全部内嵌（10 张），无外部依赖。原始骨骼为 Blender 命名风格（`hips`/`upper_arm.R`）。此前"白模、没有五官"是 3.1/3.2 的渲染设置所致，**模型本身没有问题**。
- **依蕾娜**：原本是未优化的高模（106 万顶点 / 105 万面，是其他模型的 20 倍以上，56 MB 中约 50 MB 是几何数据），GPU 每帧要处理的顶点数据高达 71 MB，因而显著掉帧。**已用 [`scripts/optimize_vrm.py`](../scripts/optimize_vrm.py) 减面到 16.4 万面（顶点 106.8 万 → 9.6 万）**，原模型备份在 `temp/eileen_original_backup.vrm`。若外观不满意，用备份还原即可（见下节）。
- **爱蜜莉雅**：模型缺失（此前误放了衣服文件），已归档到 `characters/_archived/zh_爱蜜莉雅.yaml`，前端引用已移除。
- VRM 0.x 模型需要 `VRMUtils.rotateVRM0(vrm)`（已调用），否则会背对相机。

---

## 5. 模型减面优化

当某个角色明显掉帧时，先看它的三角面数：**超过 ~30 万面**就该考虑减面了。参考量级——游戏里的角色模型通常只有 1~20 万面，且配有 LOD；而本视口的角色永远占满屏幕，没有剔除和 LOD 可依赖。

工具：[`scripts/optimize_vrm.py`](../scripts/optimize_vrm.py)（无需 Blender）

```bash
python scripts/optimize_vrm.py 原模型.vrm -o 输出.vrm -si 0.15 -se 0.005
```

它内部做两件事：

1. 调用 **gltfpack**（meshoptimizer 官方工具）做四边形误差网格简化，保留蒙皮权重、UV 与 morph targets；
2. **把 VRM 扩展搬回来**——gltfpack 不认识 `extensions.VRM`，会把它整个丢弃（骨架/表情/弹簧骨骼全失效），但它保持了骨骼节点的相对顺序，只是在节点数组里移动了位置。脚本用 `skin.joints` 逐项交叉验证推算出一个**恒定偏移量**，把扩展中所有引用骨骼节点的字段平移后原样挂回；网格索引、贴图索引、枚举值一律不动。

脚本会打印自检结果（逐骨骼比对节点变换），**自检不通过会以非 0 退出并拒绝生成可用文件**。

参数经验：

| 参数 | 含义 | 建议 |
| --- | --- | --- |
| `-si` | 目标三角面比例 | 0.1~0.2。注意 `-si 1` 表示不简化，此时 `-se` 不生效 |
| `-se` | 形状误差上限 | 0.002~0.01。它使简化自适应：大网格砍得狠，小网格（眼睛等）被保护 |

**注意事项**：

- **务必先备份原模型**，并在浏览器里确认外观、表情、头发摆动都正常后再替换。
- **自检通过 ≠ 能加载**。脚本的自检覆盖骨骼索引、纹理索引、顶点属性及其编码，但真正的渲染行为只有引擎能验证。依蕾娜前两次优化都通过了自检却仍有问题：第一次"骨骼映射 54/54 一致"但加载即报错（贴图被回收），第二次属性齐全却**渲染全黑**（量化改写了 UV）。替换前请务必实际打开页面确认。
- **gltfpack 会回收"仅被 VRM 扩展引用"的贴图**。它只看得懂 glTF 标准材质的纹理引用，像 `_SphereAdd`、`_OutlineWidthTexture` 这类只有 VRM 知道的贴图会被判定为无人使用而删除，`textures` 数组随之变短，VRM 里记录的旧索引就越界了，典型报错是 `Cannot read properties of undefined (reading 'extensions')`（炸在 three.js 的 `GLTFTextureBasisUExtension.loadTexture` 里，很有迷惑性）。脚本会把这类纹理**补回数组末尾**并重映射索引。
- 该脚本**只支持 VRM 0.x**（`extensions.VRM`）；VRM 1.0（`VRMC_vrm`）的扩展结构不同，需另行适配。
- **`-kv` 与 `-noq` 不可省略**（脚本已默认加上）。少了任意一个都会让模型**整个变黑**，且都是"属性看起来没问题、只在渲染时暴露"的坑：
  - 少 `-kv`：gltfpack 按"材质用不用得上"裁剪顶点属性，而 MToon 的法线贴图记在 VRM 扩展里它读不懂，于是把 `NORMAL` 整列删掉——材质却还挂着 `normalTexture`，渲染时法线取 (0,0,0)，`dot(N,L)=0`，全黑；`TEXCOORD_1` 同样被删。
  - 少 `-noq`：量化会把 UV 坐标压缩进 `[0, 1/15]` 这样的窄区间，再在材质上写 `KHR_texture_transform` 补偿；但 **three-vrm 给 VRM 0.x 绑 MToon 贴图时不读这个补偿**（所有 `*UvTransform` 保持单位矩阵），于是所有贴图都去采样纹理左上角的极小区域，同样全黑。量化还会把顶点属性变成整数并给网格节点加 `scale`。
- 全局比例简化会**无差别地砍掉小网格**：伊蕾娜的 `eyes` 网格在 `-si 0.1` 下从 360 面掉到 28 面。这类面部细节建议配合 `-se` 使用，缩小比例、靠误差约束保护。
- 回退：把 `temp/eileen_original_backup.vrm` 复制回 `vrm-models/依蕾娜/依蕾娜.vrm` 即可。

## 6. 设置系统（全局 / 角色两层）

设置被拆成**两个独立的 Windows 窗口**（Edge `--app` 模式，无地址栏，形似原生弹窗），职责严格分离：

| 窗口 | 文件 | 管什么 | 落盘位置 |
| --- | --- | --- | --- |
| 🌐 全局设置 | `settings.html` | LLM 端点/模型/温度、**语音引擎与全部 TTS 合成参数**、API 密钥、长期记忆、数据存储、ASR | `conf.yaml` 的 `character_config.agent_config` / `.tts_config` + `user_settings.json` |
| 👤 角色设置 | `character.html` | 人设 System Prompt、**音色绑定**（fish `reference_id` / edge `voice`）、3D 形象 | 角色 `characters/*.yaml` + `user_settings.json` |

入口：主视口顶部「⚙️ 全局设置」「👤 角色设置」两个按钮，经由 `POST /api/settings/open-window?page=settings|character` 拉起。两个页面共用 `settings.js`，按 `body[data-settings-page]` 区分模式。

> 🚨 **改完 `settings.js` / `app.js` 必须做语法检查**：这类文件是 ES module，**一处语法错误会让整个模块静默不执行**——页面照常渲染（HTML/CSS 仍然有效），但**所有事件监听器一个都不会绑定**，表现为「点哪里都没反应」。这个坑真的踩过（`const edgeVoice` 在同一作用域重复声明）。检查方法：把文件复制成 `.mjs` 再 `node --check`。

### 6.1 为什么 LLM 必须是全局的

上游设计里 `character_config` 是**随角色整体替换**的段，而 `agent_config`（LLM 提供商 + 密钥池）恰好长在里面——于是**每切一个角色就换一套 LLM 配置**。本项目改为全局共用：

- `service_context.handle_config_switch` 在深合并后**强制用 `conf.yaml` 的 `agent_config` 覆盖**，角色 yaml 无法影响 LLM；且每次切换都重新读盘，保证设置改完立即生效。
- 设置面板保存 LLM 时写进**全局 conf.yaml** 的 `agent_config.llm_configs.openai_compatible_llm`——这是后端运行时真正读取的位置。

> ⚠️ **改造前的坑（已修）**：设置面板把 LLM 写进 `agent_settings.basic_memory_agent.llm_settings`，而该字段在 Pydantic 模型 `BasicMemoryAgentConfig` 中**根本不存在**，默认 `extra="ignore"` 会静默丢弃。表现为「设置里改了 API 地址 → 提示保存成功 → 运行时毫无变化」。排查此类"改了不生效"问题时，先确认写入的字段名在后端模型里真实存在。

### 6.2 TTS 同样是「引擎参数全局 / 音色随角色」

同一套 TTS 引擎参数（模型、输出格式、情感表现力、语速、延迟模式、Base URL）对每个角色重复存一份毫无意义，改一次要改 N 个文件。所以按 LLM 同样的方式分层：

| 层 | 内容 | 落盘 |
| --- | --- | --- |
| **全局** | 引擎选择、`model` / `latency` / `format` / `temperature` / `top_p` / `speed` / `base_url`、**默认音色** | `conf.yaml` 的 `character_config.tts_config` |
| **角色** | 仅音色：fish `reference_id` 或 edge `voice` | 角色 `characters/*.yaml` |

- `service_context.handle_config_switch` 用全局 `tts_config` 打底，**只把角色 yaml 里的音色字段搬进来**，引擎与参数一律以全局为准。
- `POST /api/settings/config` 带 `scope: "global" | "character"` 区分来源：全局页提交的 `reference_id` 写进 conf.yaml（默认音色），角色页提交的写进角色 yaml；角色 yaml 里历史遗留的引擎参数会被**主动清除**，避免两处配置打架。
- Fish 官方 `model` 取值必须落在白名单内（`s2.1-pro-free` / `s2.1-pro` / `s2-pro` / `s1` / `drama-3-preview`）。**填错不会报错，Fish 会静默改用付费的 `s2.1-pro`**，随后可能因额度不足返回 402。

### 6.3 保存后如何通知主视口

设置窗口保存成功后写 `localStorage["vtuber:settings-updated"]`；主视口监听到该变化即重新拉取配置并刷新界面，**不再依赖 WebSocket**。因此设置窗口即使与主视口不在同一个连接里也能生效。

## 7. 排错

| 现象 | 排查方向 |
| --- | --- |
| 模型不显示 / 提示"模型未就绪" | 确认 `vrm-models/<角色>/<角色>.vrm` 存在，且路径与 `CHARACTER_META` 一致 |
| 模型是白模、无五官 | 见 3.1 / 3.2：色调映射与光照强度 |
| 模型全黑 | 顶点法线或 UV 被改坏，见第 5 节的 `-kv` / `-noq`。另外 `app.js` 只在模型 URL **变化**时才重新加载，替换文件后要从别的角色切回该角色（或刷新页面）才会真正重载 |
| 动作没反应 | 打开控制台看是否有 `[Motion]` 日志；确认 `currentAnimationMixer` 已建立（模型已加载完成） |
| 动作卡住不回待机 | 检查 one-shot 的 `finished` 回调是否被新动作打断（`currentMotionFinishedHandler` 的清理逻辑） |
| 改了文件但页面没变 | 见 [app/README.md · 3.3](../app/README.md) 缓存说明 |
