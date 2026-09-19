# 时崎狂三 (Tokisaki Kurumi) 专属 PMX 动作与魅惑表情系统规范文档

**路径**: `D:\CODEX PROJECT\Open-LLM-VTuber\pmx-models\时崎狂三\motion`

本目录是专为《约会大作战》角色「时崎狂三 (PMX)」量身打造的独立动作、姿态与魅惑表情形态键驱动核心。遵循与坎特蕾拉相同的动作系统剥离架构。

---

## 一、系统架构与人设定位

1. **狂气、魅惑、优雅的哥特萝莉大小姐姿态 (Kurumi Gothic Rest Pose)**：
   - 双臂沿哥特礼服自然微倾下垂 (沿 Z 轴 0.50 rad，微前倾 -0.06 rad 防裙撑穿模)；
   - 肘部自然向前微屈内敛 (-0.16 rad)，指尖自然放松内敛；
   - 脊柱胸腔微挺，保持端庄高贵的贵族大小姐仪态；
2. **专属魅惑表情形态键深度绑定 (严禁 Mouth_SP02 畸变嘴型)**：
   - **平静 (`neutral`)**：嘴角微抿浅笑 (`Mouth_smile`: 0.25)，眼眸微含魅意半垂 (`Eye_SP02`: 0.15)；
   - **喜 (`happy`)**：魅惑轻笑（“うふふ…”），优雅甜笑 (`Mouth_smile`: 0.85) + 朱唇微启露贝齿 (`Mouth_SP03`: 0.35) + 弯月笑眼微眯 (`Reye_close_smile`: 0.50, `Leye_close_smile`: 0.50)；
   - **怒 (`angry`)**：冷艳狂气怒容，倒八字冷艳怒眉 (`Eye_angry`: 0.85, `Eyebrow_SP06`: 0.60) + 嘴角紧绷冷酷下撇 (`Mouth_angry`: 0.85) + 危险视线收拢聚焦 (`Eye_SP02`: 0.50)；
   - **哀 (`sad`)**：假装可怜的撒娇捉弄，八字下垂愁眉 (`Eye_sorrow`: 0.85, `Eyebrow_SP04`: 0.50) + 朱唇微抿微启 (`Mouth_SP04`: 0.65) + 眼波柔化 (`Eye_SP02`: 0.25)；
   - **乐 (`relaxed`)**：招牌挑逗 Wink 坏笑，右眼单眨眼 (`Reye_close_smile`: 0.90，金色时钟瞳闪烁) + 嘴角挑逗坏笑露齿 (`Mouth_smile`: 0.85, `Mouth_SP03`: 0.60) + 单侧戏谑扬眉 (`Eyebrow_SP03`: 0.35)；
   - **惊 (`surprised`)**：高贵微惊，双眉轻挑微扬 (`Eyebrow_SP05`: 0.85) + 贝齿微启轻抽气 (`Mouth_SP04`: 0.45) + 冷汗细节 (`Eye_SP03`: 0.35)；彻底排除大圆嘴 `Mouth_SP02`。

---

## 二、专属动作清单 (Motion Clips)

| 动作名称 | 说明 | 联动面部特征 |
| :--- | :--- | :--- |
| `kurumi_curtsy` | 哥特千金提裙行礼 (初见优雅致意) | 屈膝微躬 + 双手虚提灵装裙摆 + 从容浅笑 |
| `kurumi_tease_whisper` | 魅惑掩唇轻笑 (亲密低语“うふふ…”) | 右手轻抬掩唇 + 身姿微侧 + 弯月笑眼露齿轻笑 |
| `kurumi_finger_gun` | 招牌指枪放电“Bang~” (心跳暴击) | 食指枪口瞄准前方 + 右眼单眨眼 + 邪魅坏笑 |
| `kurumi_hair_stroke` | 慵懒撩发回眸 (魔女风情) | 左手轻抚耳侧长马尾 + 头部倾侧回眸 + 慵懒半垂眸 |
| `kurumi_giggle` | 狂三式优雅轻笑 (克制而迷人) | 胸腔轻颤起伏 + 右手微抚胸前 + 甜笑露齿 |
| `gentle_nod` | 优雅轻颔首 (赞许倾听) | 头部从容微颔 + 嘴角浅笑 |
| `shake_head` | 戏谑轻摇头 (玩味否定) | 优雅微摇头 + 眼神微敛 |
| `surprise_jump` | 优雅防备微后移 | 重心微后移 + 警戒微侧 |
| `idle` | 狂三专属待机呼吸 | 胸腔起伏与微幅从容呼吸晃动 |

---

## 三、代码路由绑定规范

在 `pmx_motion/index.js` 及 `vrm_frontend/app.js` 的 `MotionRouter` 中配置判定：
当模型为 `zh_tokisaki_kurumi_01` 或路径包含 `时崎狂三` / `kurumi` 时，自动实例化并路由到 `KurumiMotionSystem`，加载路径为 `/pmx-models/时崎狂三/motion/kurumi_motion.js`。
