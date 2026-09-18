# PMX & Blend Dedicated Motion System
**路径**: D:\\CODEX PROJECT\\Open-LLM-VTuber\\pmx_motion

本目录独立承接所有 Blender 导出模型与 MMD (.pmx) 角色的动作系统，与 VRM 体系完全物理隔离。

## 目录结构
- index.js: 核心入口模块
  - PMX_BONE_MAPPING: 骨骼映射表 (兼容 MMD / 3dsMax Biped / Blender 骨骼命名)
  - pplyNaturalPose(adapter): 自然沉肩垂手休止姿态计算与 mmd.animationPose 固化
  - nsureProceduralPmxMotionClips(adapter, map): 专属动作片段集 (idle, wave, nod, shake, bounce, jump, pout, shy)
  - BlendMotionSystem: 专属动作混合与调度器
  - motionRouter: 动作路由分发中心 (自动识别角色并派发至 Blend 还是 VRM)

## 设计原则
1. **解耦隔离**: VRM 模型继续使用原本基于 @pixiv/three-vrm-animation 的 .vrma 动作管线，互不干扰。
2. **人体工学沉肩垂臂**: 消除模型默认的 ^\circ$ A-Pose 僵硬耸肩，实现端庄自然的少女下垂站姿与 3.6s 呼吸微动。
3. **矩阵固化**: 实时将调整后的四元数写入 mmd.animationPose，防止底层的每帧更新覆盖为 A-Pose。
