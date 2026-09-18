# VRM 骨骼动作制作指南（打骨架 / 做动作）

面向**以后往这个项目里加动作、换模型、调骨架**的人（或 agent）。

目标只有一个：让你做出的动作**在三个角色上都成立**，而不是只在你调试用的那个模型上成立。

配套阅读：
- 现象与返工记录 → [`pitfalls.md` §2.7 / §2.8](pitfalls.md)
- 动作系统的接口与清单 → [`../vrm_frontend/README.md` §2](../vrm_frontend/README.md)
- 当前的动作待办规划 → [`motion_upgrade_roadmap.md`](motion_upgrade_roadmap.md)

---

## 一、先记住三件事

写任何骨骼旋转之前，先把这三条背下来。它们解释了本项目 90% 的「动作只在某个角色上对」。

1. **归一化骨骼的 identity 就是 T-pose。** `humanoid.getNormalizedBoneNode(name)` 返回的骨骼，旋转置为单位阵时模型就是标准 T-pose。所以「把手臂放下来」在数值上是很大的旋转（z 轴 ±1.22 rad ≈ 70°），不是小修正。
2. **rig 根的世界朝向**按 VRM 版本不同：VRM 1.0 是单位阵，**VRM 0.x 是 Ry(π)**（`VRMUtils.rotateVRM0()` 把整个 `vrm.scene` 绕 Y 转了 180°）。
3. **所以「这组旋转写在哪个坐标系里」必须显式声明。** 同一个数字，声明成「父级局部系的增量」还是「世界系的增量」，在 VRM 0.x 上会得到**互相镜像**的结果。

第 3 条是踩过最贵的一个坑：`wave_hand` 曾经用一组手调欧拉角，在由比滨结衣（VRM 1.0）上完全正确，在喜多郁代 / 雷电将军（VRM 0.x）上却是**上臂本该下放却上举、前臂本该竖起却下垂**。**这不是「数值没调好」，是表示法错了。**

---

## 二、坐标系与版本差异（全部实测）

对三个角色分别加载后读出的值：

| 项 | 由比滨结衣 | 喜多郁代 | 雷电将军 |
| --- | --- | --- | --- |
| `vrm.meta.metaVersion` | `"1"` | `"0"` | `"0"` |
| `vrm.scene.rotation.y` | `0` | `π` | `π` |
| `normalizedHumanBonesRoot` 世界四元数 | `(0,0,0,1)` | `(0,1,0,0)` | `(0,1,0,0)` |
| 归一化骨骼静止时的局部旋转 | 单位阵 | 单位阵 | 单位阵 |
| 该骨骼局部增量 E 的实际世界效果 | `E` | `Ry(π)·E·Ry(π)⁻¹` | 同左 |

最后一行是关键：世界增量等于 `P · E · P⁻¹`（`P` = 该骨骼父级的世界四元数）。VRM 0.x 下 `P = Ry(π)`，而「绕 Y 转 180° 的共轭」对旋转向量的作用就是 **x、z 分量取反** —— 于是同一组数字被镜像。

判据（一条命令就能确认，不用猜）：

```js
vrm.scene.updateMatrixWorld(true);
vrm.humanoid.normalizedHumanBonesRoot
  .getWorldQuaternion(new THREE.Quaternion())   // VRM 1.0 → (0,0,0,1)；VRM 0.x → (0,1,0,0)
```

> upstream 的 `createVRMAnimationClip` 用的也是同一套数学，只是它把结果硬编码成两个已知情形：
> `Ne(vrmAnim, humanoid, meta.metaVersion)` 里对 `metaVersion === '0'` 把四元数的 **x、z 取反**
> （`values.map((v, i) => i % 2 === 0 ? -v : v)`），位移轨道同理（x、z 取反，再按 `normalizedRestPose.hips` 缩放）。
> 本项目不枚举版本，而是从实测的 `P` 推——对任意姿态都成立。

---

## 三、两条合法路径

### 路径 A：外部 `.vrma` 动作文件（首选）

`motions/*.vrma` 存的是归一化骨骼的**绝对**旋转（identity = T-pose），与模型无关；`createVRMAnimationClip` 在绑定时负责把版本基差抵掉。**换模型不用改动作，加文件不用改代码。**

用法：把 `.vrma` 放进 `vrm_frontend/motions/`，文件名对齐 `MOTION_URLS`（见 `vrm_frontend/README.md` §2.1）。有动捕或成品动作包时优先走这条路。

### 路径 B：程序化动作（缺文件保底、或需要参数化时）

`ensureProceduralMotionClips()` 里的动作。三条纪律：

1. 旋转关键帧一律用 **`rotTrack(node, times, worldEulers)`**，欧拉角按**世界系**语义写（函数内部会做 `P⁻¹·E·P` 换算）。
2. 需要「让某骨骼指向某个方向」时，**用 `solveBoneAim()` 反解，不要手填角度**。
3. 目标指向用**角色自身基**表达，不要硬编码世界坐标。

> 旧代码里的 `rotTrack` 是「在父级局部系里左乘写死欧拉角」，没有版本补偿。现在已经改成世界系语义，
> 所以**既有那些手调数值（点头 / 摇头 / 侧头 / 弹跳）在 VRM 0.x 上不再镜像**，而对 VRM 1.0 是逐位恒等变换、观感不变。

---

## 四、工具 API 速查

全部在 `vrm_frontend/app.js` §2。

| 函数 | 语义 | 备注 |
| --- | --- | --- |
| `rigBaseQuaternion(vrm)` | 归一化骨架的基准世界四元数 | 等于 `P`（骨骼静止时） |
| `authoredEulerToLocal(baseQuat, euler)` | 把「按 VRM 1.0 调好的欧拉角」换算成当前模型的局部旋转 `P⁻¹·E·P` | 给手工数值用；对 1.0 是恒等 |
| `solveBoneAim(node, child, targetWorldDir)` | 反解「让 `node` 指向 `targetWorldDir`」所需的**局部**旋转增量 | 读实时的父级世界四元数 |
| `characterBasis(vrm)` | 角色自身基：`right` = 右肩−左肩、`up` = +Y、`forward` = up×right | 实测三个模型都是 `(-1,0,0) / (0,1,0) / (0,0,1)` |
| `basisToWorld(basis, a, b, c)` | 基系数 → 世界方向（已归一化） | 用它表达「意图」 |
| `palmNormal(vrm, side)` | 掌心朝向 = `cross(拇指方向, 手指方向)` | T-pose 下 ≈ (0,−1,0)，即掌心朝下，符号已核对 |
| `quatTrack(node, restQuat, times, quats)` | 底层：局部增量四元数 → 关键帧轨道 | 传单位四元数即「回到 rest」 |
| `rotTrack(node, times, worldEulers)` | 世界系欧拉角 → 关键帧轨道 | 程序化动作的常规入口 |

**基的方向约定**（`characterBasis` 实测输出，三模型一致）：

```
right   = 右肩 − 左肩 = (-1, 0, 0)      // 角色自己的右手边在世界的 −X
up      = (0, 1, 0)
forward = up × right = (0, 0, 1)        // 指向观众
```

因此基系数 `(a, b, c)` 的含义是：`a` 沿角色右手边、`b` 向上、`c` 朝观众。例如 `wave_hand` 的上臂目标是
`(0.76, −0.48, 0.44)` = 往外下方伸 29° 并略微前收。

---

## 五、SOP：加一个程序化动作

以 `wave_hand` 为模板（源码见 `app.js` 的 `ensureProceduralMotionClips()` 第 5 节）。

```
1. 定意图        用基系数写出每段骨骼的目标世界指向，别写世界坐标
2. 复位基准      applyNaturalPose(vrm); vrm.scene.updateMatrixWorld(true)
3. 记 rest        qUpRest / qLowRest / qHandRest = 各骨骼 quaternion.clone()
4. 解上臂        dUp = solveBoneAim(upper, lower, 上臂目标)
                 把它**真的施加**上去：upper.quaternion.copy(qUpRest).premultiply(dUp)
                 → updateMatrixWorld(true)     ← 前臂的解依赖父骨骼已经摆好
5. 解前臂        每个键之前先 lower.quaternion.copy(qLowRest) 复位，再 solveBoneAim
                 （不复位的话，上一次的姿态会污染这一次的「当前指向」，解出来的结果是错的）
6. 解手腕        先把前臂摆到你要的基准位（如摆动中位），再把掌心法线转到观众方向
7. 复原          把三条骨骼 copy 回第 3 步记下的 rest，再 updateMatrixWorld
8. 建轨道        quatTrack(...)，每个轨道的首尾用单位四元数回到 rest
9. 验证          见第七节，别用肉眼
```

骨架代码：

```js
const basis = characterBasis(vrm);
const UPPER = basisToWorld(basis, 0.76, -0.48, 0.44);   // 基系数 → 世界方向
const VIEWER_DIR = new THREE.Vector3(0, 0, 1);

applyNaturalPose(vrm);
const qUpRest = rUpperArm.quaternion.clone();
const qLowRest = rLowerArm.quaternion.clone();

const dUp = solveBoneAim(rUpperArm, rLowerArm, UPPER);
rUpperArm.quaternion.copy(qUpRest).premultiply(dUp);
vrm.scene.updateMatrixWorld(true);                       // ★ 顺序不能颠倒

const foreDelta = (swingDeg) => {
  rLowerArm.quaternion.copy(qLowRest);                   // ★ 每个键先复位
  vrm.scene.updateMatrixWorld(true);
  const target = FORE.clone().applyQuaternion(
    new THREE.Quaternion().setFromAxisAngle(basis.forward, THREE.MathUtils.degToRad(swingDeg))
  );
  return solveBoneAim(rLowerArm, rHand, target);
};
```

> **为什么不能手填角度**：`wave_hand` 最初那组数值在由比滨上是对的，在 VRM 0.x 上镜像；
> 换成按指向反解之后，三个模型给出的结果**完全一致**（肘弯 133.6°、上臂离水平 −28.7°、掌心与观众夹角 0.0°）。

---

## 六、几何硬约束（决定动作能做成什么样）

相机是固定的、取景是**半身**，这限死了动作的自由度。

```
camera = PerspectiveCamera(30, aspect, 0.1, 20)   位置 (0, 1.36, 1.25) → 看向 (0, 1.30, 0)
z = 0 平面可见范围：y ∈ [0.965, 1.635]（不随窗口尺寸变）
                    x ∈ ±0.3353 × aspect（随窗口宽高比变）
```

实测（各模型按头骨高度归一化之后）：

| 量 | 由比滨结衣 | 喜多郁代 | 雷电将军 |
| --- | --- | --- | --- |
| head 骨世界 Y | 1.4111 | 1.4111 | 1.4111 |
| 右肩世界坐标 | (−0.085, 1.291) | (−0.084, 1.299) | (−0.110, 1.291) |
| 上臂长 | 0.227 m | 0.203 m | 0.213 m |
| 前臂长 | 0.202 m | 0.214 m | 0.193 m |
| **肩 → 腕** | **0.428 m** | **0.415 m** | **0.406 m** |
| 自然站姿的手世界 Y | 0.882 | 0.901 | 0.898 |

由此得到几条**会反复咬人的**结论：

- **自然站姿的手在画外**（y ≈ 0.89 < 0.965）。取景是半身像，只有把手抬到脸侧才会进入画面 —— 所以挥手类动作的「起手」必然是从画外进来的，不要试图让它从画面里开始。
- **水平余量只有 ≈0.28–0.30 m，而手臂伸直有 ≈0.41–0.43 m。**（aspect 1.15 时画面左缘在 x = −0.386，右肩在 x ≈ −0.09。）所以**手臂一旦伸直或大幅外摆就一定出画**，这不是参数问题，是几何上限。
- **最易出画的是指尖**（`rightMiddleDistal`）而不是手腕骨 —— 判定高度和边界都要按指尖算。
- **「肘下放」与「手举高」几何互斥**：肘要垂在肩下、手又要举到脸侧，只能靠肘弯。肘弯到 133° 已经是「偏紧」的一端（人肘约 145°）。
- **摆动类动作要按两端判**，不能只看中位。`wave_hand` 前臂目标最初定为几乎竖直的 `(−0.05, 0.99, −0.13)`，中位指尖 ndc 只有 −0.79（画内），但**向外摆到 +16° 时是 −1.04，出画**；把前臂目标改成 `(−0.22, 0.96, −0.13)`（略朝脸侧收）后，两端变成 −0.33 / −0.86，三模型都稳住。

> 取景随窗口宽高比变化，而桌宠窗口的三个档位都是 0.68 左右的竖幅（340×500 / 520×760 / 700×1000），
> 横向可见只有 ±0.228 m —— **在桌宠里任何抬手都会贴到边缘**。这是取景的既有特性，不是动作本身的问题；
> 验收请用浏览器窗口（如 900×780，aspect ≈ 1.15）。

---

## 七、验收方法（不许肉眼）

**静态自检通过 ≠ 渲染正确；一眼看着像也不等于对。** 按下面顺序做：

### 7.1 骨骼数值（判据最硬，先做这个）

用 three-vrm 在浏览器里加载**真实模型**，复刻 `app.js` 的 `normalizeModelScale()`（**不复刻会把「模型更大」误读成「动作跑偏」**），然后量出：

- 上臂 / 前臂的世界指向、**肘弯角**（< 20° 一定是直杆）
- 肘、手、**指尖**的世界坐标与 NDC（`v.clone().project(同参数相机)`，`|ndc| > 1` 即出画）
- **掌心法线与 +Z 的夹角**（朝观众应为 0°；先量 T-pose 是否为 (0,−1,0) 确认符号约定）

> 本仓库曾用 `temp/_wavecheck/probe.mjs` + `run_probe.mjs` 做这件事。`temp/` 是 gitignore 的，
> 换台机器不一定还在，但**方法本身就是上面这几句**，重建一个探针页只要几十行。
> 要点：静态伺服必须给 `.mjs` 发 `text/javascript` MIME 且带 `Cache-Control: no-store`，
> 否则 Chrome 会启发式缓存，你会拿着旧的 `app.js` 量半天。

### 7.2 真实页面截图

用 CDP 驱动**真实页面**、派发 `#motion-select` 的 `change` 事件（等价于用户在下拉里选），连续截图。

- 软渲染下截图很慢：**必须看 `+Xs` 时间戳和日志里 `▶ 播放肢体动作` 的时间戳是否对齐** —— 帧不一定落在动作窗口内。
- 像素差对比**必须先测噪声底噪**：同配置重复运行本身就有约 5% 差异（idle 循环相位不同），否则会把噪声当信号。

### 7.3 三个角色都要过

**只在开发用的那个模型上验证过的动作，视为未完成。** 一次过三个角色，逐项对照 7.1 的数值与截图。

---

## 八、已知会咬人的点（速查）

| 症状 | 根因 | 去处 |
| --- | --- | --- |
| 动作只在一个角色上正确，VRM 0.x 上镜像 | 写死欧拉角缺版本基差补偿 | §二 / [pitfalls §2.8](pitfalls.md) |
| 手臂像一根水平外伸的直杆 | 只抬上臂没给肘弯（肘弯 < 20°） | [pitfalls §2.7](pitfalls.md) |
| 玩家看到的是手背/侧面 | 没驱动 `rightHand`，掌心继承 T-pose（朝下） | [pitfalls §2.7](pitfalls.md) |
| 自动打招呼播完后姿势一直不对 | one-shot 播完没淡出，权重 1 永久和 idle 混合 | [pitfalls §2.7](pitfalls.md) |
| 指尖出画 | 按手腕骨定的边界 / 只看摆动中位 | §六 / §七 |
| 角色头部被裁掉 | 模型世界尺寸不同（不是相机太近） | [pitfalls §3.6](pitfalls.md) |
| 静态自检都过了但模型全黑 | 减面工具改坏了顶点属性 | [pitfalls §2.1–2.3](pitfalls.md) |

---

## 九、新增角色 / 换模型的清单

1. 模型放进 `vrm-models/<角色>/<角色>.vrm`，对齐 `CHARACTER_META`（**三处**：`app.js` 的 `CHARACTER_META`、`index.html` 的 `#config-select`、角色 yaml）。
2. 确认 `metaVersion`（0.x 必须走 `VRMUtils.rotateVRM0`，代码已调用）。
3. 看控制台 `[VRM] 尺寸归一化：head 骨 X → ×Y`，应满足 `head 骨 × 系数 ≈ 1.4111`。
4. 复测 **§7.1 的骨骼数值**：把设计意图（基系数）代进去，看三个模型是否给出同一组结果 —— 如果新模型与既有模型不一致，先怀疑取值前没做 `normalizeModelScale`。
5. `applyNaturalPose` 的自然站姿在三个模型上都应是**肘在肩下、手在 y ≈ 0.89**；若某个模型手臂上举，说明该骨骼链的 `P` 不是预期的 `Ry(π)`，去查 §二 的判据。

---

*记录时间：2026-09-18*
*状态：持续追加。发现新的「只在某个模型上成立」的写法，就补进第八节。*
