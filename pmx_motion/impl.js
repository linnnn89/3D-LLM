/**
 * =========================================================================
 * Open-LLM-VTuber: PMX Motion Implementation Registry (实现绑定中心)
 * 路径: pmx_motion/impl.js
 * 
 * 核心设计原则：
 * 1. 纯实现绑定：汇聚 Cantarella、Kurumi、Tohru 以及通用 PMX (Blend) 的具体动作系统类、姿态函数与剪辑生成函数。
 * 2. 拓扑解耦：不反向依赖 registry.js，杜绝 TDZ 循环引用。
 * 3. 兜底保护：提供 generic 兜底实现，未注册的 PMX 角色自动回落至标准通用系统。
 * =========================================================================
 */

import * as THREE from 'three';
import { BasePmxMotionSystem } from './base_motion.js';

import {
  CantarellaMotionSystem,
  applyCantarellaNaturalPose,
  ensureCantarellaMotionClips,
  CANTARELLA_EXPRESSION_PROFILES
} from '../pmx-models/坎特蕾拉/motion/cantarella_motion.js';

import {
  KurumiMotionSystem,
  applyKurumiNaturalPose,
  ensureKurumiMotionClips,
  KURUMI_EXPRESSION_PROFILES
} from '../pmx-models/时崎狂三/motion/kurumi_motion.js';

import {
  TohruMotionSystem,
  applyTohruNaturalPose,
  ensureTohruMotionClips,
  TOHRU_EXPRESSION_PROFILES
} from '../pmx-models/托尔/motion/tohru_motion.js';

/**
 * 施加 Blender / PMX 角色的标准自然垂手站姿 (Natural Rest Pose)
 * 基于标准 MMD A-Pose (大臂约 40°~45°) 进行解剖学少女立姿微调：
 * - 沉肩：Z 轴微倾 ±0.05 rad，消除斜方肌耸肩紧张感；
 * - 垂臂：从 45° A-Pose 沿 Z 轴进一步下压 0.50 rad；
 * - 前倾防穿模：X 轴轻微前倾 -0.06 rad；
 * - 肘部与手腕微屈：手肘向前自然微屈 (-0.16 rad)，指尖顺势微收偏向内侧。
 */
export function applyNaturalPose(adapter) {
  if (!adapter) return;

  const lShoulder = adapter.resolveBone('leftShoulder');
  const rShoulder = adapter.resolveBone('rightShoulder');
  const lArm = adapter.resolveBone('leftUpperArm');
  const rArm = adapter.resolveBone('rightUpperArm');
  const lElbow = adapter.resolveBone('leftLowerArm');
  const rElbow = adapter.resolveBone('rightLowerArm');
  const lHand = adapter.resolveBone('leftHand');
  const rHand = adapter.resolveBone('rightHand');

  // 1. 沉肩放松
  if (lShoulder) lShoulder.rotation.set(0.0, 0.0, -0.05);
  if (rShoulder) rShoulder.rotation.set(0.0, 0.0, 0.05);

  // 2. 上臂标准下垂微倾
  const armAngleZ = 0.50;
  const armAngleX = -0.06;

  if (lArm) lArm.rotation.set(armAngleX, 0.05, -armAngleZ);
  if (rArm) rArm.rotation.set(armAngleX, -0.05, armAngleZ);

  // 3. 肘部自然向前微屈内敛
  if (lElbow) lElbow.rotation.set(-0.16, 0.08, -0.18);
  if (rElbow) rElbow.rotation.set(-0.16, -0.08, 0.18);

  // 4. 手腕顺势微敛放松
  if (lHand) lHand.rotation.set(-0.05, 0.0, -0.08);
  if (rHand) rHand.rotation.set(-0.05, 0.0, 0.08);

  // 刷新局部变换矩阵并更新世界矩阵
  for (const b of [lShoulder, rShoulder, lArm, rArm, lElbow, rElbow, lHand, rHand]) {
    if (b) b.updateMatrix();
  }

  const rootMesh = adapter.getRootNode ? adapter.getRootNode() : adapter.mesh;
  if (rootMesh) rootMesh.updateMatrixWorld(true);

  // 固化更新 mmd.animationPose，防止 @moeru/three-mmd 运行时在每帧更新前还原回 A-Pose
  if (adapter.mmd && rootMesh && rootMesh.skeleton && rootMesh.skeleton.bones) {
    adapter.mmd.animationPose = rootMesh.skeleton.bones.map((bone) => ({
      position: bone.position.clone(),
      rotation: bone.quaternion.clone()
    }));
  }
}

export function characterBasis(adapter) {
  const left = adapter.resolveBone('leftUpperArm');
  const right = adapter.resolveBone('rightUpperArm');
  if (!left || !right) return null;
  const rootMesh = adapter.getRootNode ? adapter.getRootNode() : adapter.mesh;
  if (rootMesh) rootMesh.updateMatrixWorld(true);
  const rightAxis = new THREE.Vector3()
    .subVectors(right.getWorldPosition(new THREE.Vector3()), left.getWorldPosition(new THREE.Vector3()))
    .normalize();
  const upAxis = new THREE.Vector3(0, 1, 0);
  return {
    right: rightAxis,
    up: upAxis,
    forward: new THREE.Vector3().crossVectors(upAxis, rightAxis).normalize()
  };
}

export function basisToWorld(basis, a, b, c) {
  return new THREE.Vector3()
    .addScaledVector(basis.right, a)
    .addScaledVector(basis.up, b)
    .addScaledVector(basis.forward, c);
}

export function createQuatTrack(boneName, times, quatValues) {
  return new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, quatValues);
}

export function createVectorTrack(boneName, times, vecValues) {
  return new THREE.VectorKeyframeTrack(`${boneName}.position`, times, vecValues);
}

/**
 * 通用 PMX 程序化动作剪辑生成器
 */
export function ensureProceduralPmxMotionClips(adapter, targetClips) {
  if (!adapter) return;

  const clips = targetClips || adapter.activeMotionClips || (adapter.activeMotionClips = {});
  const basis = characterBasis(adapter);
  if (!basis) return;

  const hipsBone = adapter.resolveBone('hips');
  const lShoulder = adapter.resolveBone('leftShoulder');
  const rShoulder = adapter.resolveBone('rightShoulder');
  const rArm = adapter.resolveBone('rightUpperArm');
  const rElbow = adapter.resolveBone('rightLowerArm');
  const rHand = adapter.resolveBone('rightHand');
  const lArm = adapter.resolveBone('leftUpperArm');
  const lElbow = adapter.resolveBone('leftLowerArm');
  const head = adapter.resolveBone('head');
  const spine = adapter.resolveBone('spine');

  // 1. 全身礼貌致意 (pmx_greeting)
  if (head && spine && lShoulder && rShoulder) {
    const times = [0, 0.5, 1.2, 1.8, 2.4];
    const spineRotTrack = createQuatTrack(
      spine.name,
      times,
      [
        ...new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0)).toArray(),
        ...new THREE.Quaternion().setFromEuler(new THREE.Euler(0.26, 0, 0)).toArray(),
        ...new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, 0, 0)).toArray(),
        ...new THREE.Quaternion().setFromEuler(new THREE.Euler(0.15, 0, 0)).toArray(),
        ...new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0)).toArray()
      ]
    );
    const headRotTrack = createQuatTrack(
      head.name,
      times,
      [
        ...new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0)).toArray(),
        ...new THREE.Quaternion().setFromEuler(new THREE.Euler(0.18, 0, 0)).toArray(),
        ...new THREE.Quaternion().setFromEuler(new THREE.Euler(0.24, 0, 0)).toArray(),
        ...new THREE.Quaternion().setFromEuler(new THREE.Euler(0.10, 0, 0)).toArray(),
        ...new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0)).toArray()
      ]
    );
    clips['pmx_greeting'] = new THREE.AnimationClip('pmx_greeting', 2.4, [spineRotTrack, headRotTrack]);
  }

  // 2. 摆手招手 (wave_hand)
  if (rArm && rElbow && rHand) {
    const times = [0, 0.4, 0.8, 1.2, 1.6, 2.0];
    const armTrack = createQuatTrack(
      rArm.name,
      times,
      [
        ...rArm.quaternion.toArray(),
        ...new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, -0.3, 1.35)).toArray(),
        ...new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.15, -0.25, 1.40)).toArray(),
        ...new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.25, -0.35, 1.30)).toArray(),
        ...new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.15, -0.25, 1.40)).toArray(),
        ...rArm.quaternion.toArray()
      ]
    );
    clips['wave_hand'] = new THREE.AnimationClip('wave_hand', 2.0, [armTrack]);
  }

  // 3. 赞同点头 (gentle_nod)
  if (head) {
    const times = [0, 0.25, 0.55, 0.85, 1.2];
    const headTrack = createQuatTrack(
      head.name,
      times,
      [
        ...head.quaternion.toArray(),
        ...new THREE.Quaternion().setFromEuler(new THREE.Euler(0.22, 0, 0)).toArray(),
        ...head.quaternion.toArray(),
        ...new THREE.Quaternion().setFromEuler(new THREE.Euler(0.18, 0, 0)).toArray(),
        ...head.quaternion.toArray()
      ]
    );
    clips['gentle_nod'] = new THREE.AnimationClip('gentle_nod', 1.2, [headTrack]);
  }

  // 4. 轻轻摇头 (shake_head)
  if (head) {
    const times = [0, 0.25, 0.55, 0.85, 1.15, 1.4];
    const headTrack = createQuatTrack(
      head.name,
      times,
      [
        ...head.quaternion.toArray(),
        ...new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.22, 0)).toArray(),
        ...new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -0.22, 0)).toArray(),
        ...new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.16, 0)).toArray(),
        ...new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -0.16, 0)).toArray(),
        ...head.quaternion.toArray()
      ]
    );
    clips['shake_head'] = new THREE.AnimationClip('shake_head', 1.4, [headTrack]);
  }

  // 5. 雀跃起跳 (cheerful_bounce)
  if (hipsBone && spine) {
    const times = [0, 0.25, 0.5, 0.8, 1.2];
    const initialHipsPos = hipsBone.position.clone();
    const hipsPosTrack = createVectorTrack(
      hipsBone.name,
      times,
      [
        ...initialHipsPos.toArray(),
        initialHipsPos.x, initialHipsPos.y + 0.12, initialHipsPos.z,
        initialHipsPos.x, initialHipsPos.y + 0.22, initialHipsPos.z,
        initialHipsPos.x, initialHipsPos.y + 0.05, initialHipsPos.z,
        ...initialHipsPos.toArray()
      ]
    );
    clips['cheerful_bounce'] = new THREE.AnimationClip('cheerful_bounce', 1.2, [hipsPosTrack]);
  }

  // 6. 受惊后缩 (surprise_jump)
  if (hipsBone && spine && head) {
    const times = [0, 0.2, 0.6, 1.1];
    const initialHipsPos = hipsBone.position.clone();
    const hipsPosTrack = createVectorTrack(
      hipsBone.name,
      times,
      [
        ...initialHipsPos.toArray(),
        initialHipsPos.x, initialHipsPos.y + 0.08, initialHipsPos.z - 0.12,
        initialHipsPos.x, initialHipsPos.y + 0.03, initialHipsPos.z - 0.06,
        ...initialHipsPos.toArray()
      ]
    );
    clips['surprise_jump'] = new THREE.AnimationClip('surprise_jump', 1.1, [hipsPosTrack]);
  }

  // 7. 傲娇侧头 (pout_turn)
  if (head && spine) {
    const times = [0, 0.35, 1.1, 1.6];
    const headTrack = createQuatTrack(
      head.name,
      times,
      [
        ...head.quaternion.toArray(),
        ...new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.05, 0.40, 0.12)).toArray(),
        ...new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.05, 0.40, 0.12)).toArray(),
        ...head.quaternion.toArray()
      ]
    );
    clips['pout_turn'] = new THREE.AnimationClip('pout_turn', 1.6, [headTrack]);
  }

  // 8. 歪头害羞 (shy_tilt)
  if (head) {
    const times = [0, 0.4, 1.2, 1.8];
    const headTrack = createQuatTrack(
      head.name,
      times,
      [
        ...head.quaternion.toArray(),
        ...new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12, 0.05, 0.22)).toArray(),
        ...new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12, 0.05, 0.22)).toArray(),
        ...head.quaternion.toArray()
      ]
    );
    clips['shy_tilt'] = new THREE.AnimationClip('shy_tilt', 1.8, [headTrack]);
  }
}

export const DEFAULT_EXPRESSION_PROFILES = {
  base: {
    'neutral': {},
    'happy': { '笑い': 0.85, '口角上げ': 0.70 },
    'sad': { '困る': 0.80, '口角下げ': 0.60 },
    'angry': { '怒り': 0.85, '口角下げ': 0.70 },
    'surprised': { 'びっくり': 0.80, 'あ': 0.60 },
    'relaxed': { '笑い': 0.50, '口角上げ': 0.40 }
  },
  motions: {
    'pmx_greeting': { '笑い': 0.60, '口角上げ': 0.50 },
    'wave_hand': { '笑い': 0.75, '口角上げ': 0.60 },
    'cheerful_bounce': { '笑い': 0.95, '口角上げ': 0.85 },
    'pout_turn': { '怒り': 0.50, '口角下げ': 0.70 },
    'shy_tilt': { '笑い': 0.50, '口角上げ': 0.60 },
    'surprise_jump': { 'びっくり': 0.80, 'あ': 0.60 },
    'gentle_nod': { '口角上げ': 0.60 },
    'shake_head': { '困る': 0.40 }
  }
};

/**
 * 通用 PMX 动作系统 (BlendMotionSystem)
 */
export class BlendMotionSystem extends BasePmxMotionSystem {
  constructor(adapter) {
    super(adapter, {
      profile: DEFAULT_EXPRESSION_PROFILES,
      ensureClipsFn: ensureProceduralPmxMotionClips,
      applyPoseFn: applyNaturalPose
    });
  }

  resolveMotionAlias(motionName) {
    if (!this.activeMotionClips[motionName] && motionName === 'greeting' && this.activeMotionClips['pmx_greeting']) {
      return 'pmx_greeting';
    }
    return motionName;
  }
}

/**
 * 角色动作系统与姿态函数实现查找表
 */
export const PMX_CHARACTER_IMPLS = {
  cantarella: {
    systemClass: CantarellaMotionSystem,
    applyPoseFn: applyCantarellaNaturalPose,
    ensureClipsFn: ensureCantarellaMotionClips,
    expressionProfiles: CANTARELLA_EXPRESSION_PROFILES
  },
  kurumi: {
    systemClass: KurumiMotionSystem,
    applyPoseFn: applyKurumiNaturalPose,
    ensureClipsFn: ensureKurumiMotionClips,
    expressionProfiles: KURUMI_EXPRESSION_PROFILES
  },
  tohru: {
    systemClass: TohruMotionSystem,
    applyPoseFn: applyTohruNaturalPose,
    ensureClipsFn: ensureTohruMotionClips,
    expressionProfiles: TOHRU_EXPRESSION_PROFILES
  },
  generic: {
    systemClass: BlendMotionSystem,
    applyPoseFn: applyNaturalPose,
    ensureClipsFn: ensureProceduralPmxMotionClips,
    expressionProfiles: DEFAULT_EXPRESSION_PROFILES
  }
};

export {
  CantarellaMotionSystem,
  applyCantarellaNaturalPose,
  ensureCantarellaMotionClips,
  CANTARELLA_EXPRESSION_PROFILES,
  KurumiMotionSystem,
  applyKurumiNaturalPose,
  ensureKurumiMotionClips,
  KURUMI_EXPRESSION_PROFILES,
  TohruMotionSystem,
  applyTohruNaturalPose,
  ensureTohruMotionClips,
  TOHRU_EXPRESSION_PROFILES
};
