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
 * =========================================================================
 * Open-LLM-VTuber: PMX & Blend Dedicated Motion System
 * 路径: D:\CODEX PROJECT\Open-LLM-VTuber\pmx_motion\index.js
 * 
 * 本模块为专为 Blender / PMX 角色打造的动作与姿态驱动核心，严格对齐日本标准 MMD 规范：
 * 1. 骨骼寻址命名：100% 遵循日本标准 MMD 汉字命名（全ての親、センター、上半身、頭、腕、ひじ、手首等）。
 * 2. 休止站姿规范：以标准 A-Pose 为基准进行人体工学下垂沉肩微调，并固化至 mmd.animationPose。
 * 3. 动力学驱动规范：身体重心起伏、跳跃一律作用于 センター 骨骼位移，绝不污染舞台定位骨。
 * 4. 旋转附与保护：彻底移除陈旧的侵入式前臂捩骨覆盖逻辑，保护标准 MMD 捩骨系统的纯净性。
 * =========================================================================
 */

/**
 * 标准日本 MMD 骨骼语义映射表
 * 仅保留纯正 MMD 规范命名，废弃陈旧的 3ds Max / Biped 兼容别名。
 */
export const PMX_BONE_MAPPING = {
  'head': ['頭'],
  'neck': ['首'],
  'chest': ['上半身2', '上半身'],
  'spine': ['上半身'],
  'hips': ['センター', 'グルーブ', '下半身'],
  'leftShoulder': ['左肩'],
  'rightShoulder': ['右肩'],
  'leftUpperArm': ['左腕'],
  'rightUpperArm': ['右腕'],
  'leftLowerArm': ['左ひじ'],
  'rightLowerArm': ['右ひじ'],
  'leftHand': ['左手首'],
  'rightHand': ['右手首'],
  'rightThumb': ['右親指１', '右親指０'],
  'rightMiddle': ['右中指１'],
  'leftThumb': ['左親指１', '左親指０'],
  'leftMiddle': ['左中指１']
};

/**
 * 施加 Blender / PMX 角色的标准自然垂手站姿 (Natural Rest Pose)
 * 基于标准 MMD A-Pose (大臂约 40°~45°) 进行解剖学少女立姿微调：
 * - 沉肩：Z 轴微倾 ±0.05 rad，消除斜方肌耸肩紧张感；
 * - 垂臂：从 45° A-Pose 沿 Z 轴进一步下压 0.52 rad (约 30°)，达到 75°~80° 端庄自然立姿；
 * - 前倾防穿模：X 轴轻微前倾 0.12 rad，给大袖口与裙撑预留物理距离；
 * - 肘部与手腕微屈：手肘微屈内敛 (0.20 rad)，指尖顺势微收偏向内侧。
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

  // 2. 上臂标准下垂微倾 (A-Pose 基础上自然下垂 0.50 rad，微前倾 -0.06 rad 防向后反撇)
  const armAngleZ = 0.50;
  const armAngleX = -0.06;

  if (lArm) lArm.rotation.set(armAngleX, 0.05, -armAngleZ);
  if (rArm) rArm.rotation.set(armAngleX, -0.05, armAngleZ);

  // 3. 肘部自然向前微屈内敛 (X 为 -0.16 rad 向前自然微屈，彻底告别反向向后折)
  if (lElbow) lElbow.rotation.set(-0.16, 0.08, -0.18);
  if (rElbow) rElbow.rotation.set(-0.16, -0.08, 0.18);

  // 4. 手腕顺势微敛放松，指尖自然指向身前偏内侧地面
  if (lHand) lHand.rotation.set(-0.05, 0.0, -0.08);
  if (rHand) rHand.rotation.set(-0.05, 0.0, 0.08);

  // 刷新局部变换矩阵并更新世界矩阵
  for (const b of [lShoulder, rShoulder, lArm, rArm, lElbow, rElbow, lHand, rHand]) {
    if (b) b.updateMatrix();
  }

  const rootMesh = adapter.getRootNode() || adapter.mesh;
  if (rootMesh) rootMesh.updateMatrixWorld(true);

  // 关键固化：同步更新 mmd.animationPose，防止 @moeru/three-mmd 运行时在每帧更新前还原回 A-Pose
  if (adapter.mmd && rootMesh && rootMesh.skeleton && rootMesh.skeleton.bones) {
    adapter.mmd.animationPose = rootMesh.skeleton.bones.map((bone) => ({
      position: bone.position.clone(),
      rotation: bone.quaternion.clone()
    }));
  }
}

/**
 * 角色自身基准坐标计算：
 * 右 = 右肩−左肩，上 = +Y，前 = 上×右（正对观众视野）。
 * 自适应不同模型朝向与骨骼差异。
 */
export function characterBasis(adapter) {
  const left = adapter.resolveBone('leftUpperArm');
  const right = adapter.resolveBone('rightUpperArm');
  if (!left || !right) return null;
  const rootMesh = adapter.getRootNode() || adapter.mesh;
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
    .addScaledVector(basis.forward, c)
    .normalize();
}

/**
 * 反解「让 node 指向 targetWorldDir」所需的局部旋转增量。
 * 计算公式：Δ = parentWorld⁻¹ · worldDelta · parentWorld
 * 使得世界增量恒为 worldDelta，无论骨骼的局部坐标系如何定义，都能精确指向 targetWorldDir。
 */
export function solveBoneAim(node, child, targetWorldDir) {
  const parentWorld = node.parent ? node.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
  const currentDir = new THREE.Vector3()
    .subVectors(child.getWorldPosition(new THREE.Vector3()), node.getWorldPosition(new THREE.Vector3()))
    .normalize();
  const worldDelta = new THREE.Quaternion().setFromUnitVectors(
    currentDir,
    targetWorldDir.clone().normalize()
  );
  return parentWorld.clone().invert().multiply(worldDelta).multiply(parentWorld);
}

/**
 * 掌心法线计算：cross(拇指方向, 手指方向)
 */
export function palmNormal(adapter, side = 'right') {
  const hand = adapter.resolveBone(`${side}Hand`);
  const thumb = adapter.resolveBone(`${side}Thumb`);
  const finger = adapter.resolveBone(`${side}Middle`);
  if (!hand || !thumb || !finger) return null;
  const origin = hand.getWorldPosition(new THREE.Vector3());
  const thumbDir = thumb.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
  const fingerDir = finger.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
  return new THREE.Vector3().crossVectors(thumbDir, fingerDir).normalize();
}

/**
 * 为 PMX / Blend 角色生成全套专属标准程序化动作片段 (Clips)
 * 全部动作均基于标准 MMD 骨骼（頭, 上半身, センター, 腕, ひじ, 手首）精确驱动。
 */
export function ensureProceduralPmxMotionClips(adapter, targetClipsMap = {}) {
  if (!adapter) return targetClipsMap;

  const head = adapter.resolveBone('head');
  const chest = adapter.resolveBone('chest');
  const spine = adapter.resolveBone('spine');
  const hips = adapter.resolveBone('hips');
  const rArm = adapter.resolveBone('rightUpperArm');
  const rElbow = adapter.resolveBone('rightLowerArm');
  const rHand = adapter.resolveBone('rightHand');
  const lArm = adapter.resolveBone('leftUpperArm');
  const lElbow = adapter.resolveBone('leftLowerArm');
  const lHand = adapter.resolveBone('leftHand');

  const makeQuatTrack = (bone, times, localEulers) => {
    if (!bone) return null;
    const qRest = bone.quaternion.clone();
    const values = [];
    for (const e of localEulers) {
      const qDelta = new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0], e[1], e[2]));
      const qFinal = new THREE.Quaternion().multiplyQuaternions(qDelta, qRest);
      values.push(qFinal.x, qFinal.y, qFinal.z, qFinal.w);
    }
    return new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values);
  };

  const makePosTrack = (bone, times, deltas) => {
    if (!bone) return null;
    const restPos = bone.position.clone();
    const values = [];
    for (const d of deltas) {
      values.push(restPos.x + (d[0] || 0), restPos.y + (d[1] || 0), restPos.z + (d[2] || 0));
    }
    return new THREE.VectorKeyframeTrack(`${bone.name}.position`, times, values);
  };

  const registerClip = (name, duration, tracks) => {
    const validTracks = tracks.filter(Boolean);
    const clip = new THREE.AnimationClip(name, duration, validTracks);
    clip.userData = { propertyTrack: null };
    targetClipsMap[name] = clip;
    return clip;
  };

  const quatTrack = (bone, restQuat, times, quats) => {
    if (!bone) return null;
    const values = [];
    for (const q of quats) {
      values.push(...q.clone().multiply(restQuat).toArray());
    }
    return new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values);
  };

  // 1. wave_hand (轻柔招手问候, 2.7s - 基于解剖学目标世界指向反解，掌心正对观众，肘部纯屈伸)
  if (rArm && rElbow && rHand) {
    const basis = characterBasis(adapter);
    const rootMesh = adapter.getRootNode() || adapter.mesh;
    if (basis && rootMesh) {
      const UPPER_TARGET = basisToWorld(basis, 0.76, -0.48, 0.44); // 肘尖朝下偏后，在躯干前侧
      const FORE_TARGET = basisToWorld(basis, -0.22, 0.96, -0.13); // 手举至脸颊耳畔侧前方
      const SWING_DEG = 16;
      const VIEWER_DIR = new THREE.Vector3(0, 0, 1);
      const IDENTITY_QUAT = new THREE.Quaternion();

      const qUpRest = rArm.quaternion.clone();
      const qLowRest = rElbow.quaternion.clone();
      const qHandRest = rHand.quaternion.clone();

      // ① 上臂反解指向 UPPER_TARGET
      const dUp = solveBoneAim(rArm, rElbow, UPPER_TARGET);
      rArm.quaternion.copy(qUpRest).premultiply(dUp);
      rootMesh.updateMatrixWorld(true);

      // ② 前臂反解挥摆
      const foreDelta = (swingDeg) => {
        rElbow.quaternion.copy(qLowRest);
        rootMesh.updateMatrixWorld(true);
        const target = FORE_TARGET.clone().applyQuaternion(
          new THREE.Quaternion().setFromAxisAngle(basis.forward, THREE.MathUtils.degToRad(swingDeg))
        );
        return solveBoneAim(rElbow, rHand, target);
      };

      const dSwingIn = foreDelta(-SWING_DEG);
      const dSwingMid = foreDelta(0);
      const dSwingOut = foreDelta(SWING_DEG);

      // ③ 手腕反解掌心对人
      rElbow.quaternion.copy(qLowRest).premultiply(dSwingMid);
      rootMesh.updateMatrixWorld(true);

      const palm = palmNormal(adapter, 'right');
      const handParentWorld = rHand.parent ? rHand.parent.getWorldQuaternion(new THREE.Quaternion()) : null;
      const dHand = (palm && handParentWorld)
        ? handParentWorld
            .clone()
            .invert()
            .multiply(new THREE.Quaternion().setFromUnitVectors(palm, VIEWER_DIR))
            .multiply(handParentWorld)
        : IDENTITY_QUAT;

      // ④ 复位骨骼回休止姿态，避免污染后续计算
      rArm.quaternion.copy(qUpRest);
      rElbow.quaternion.copy(qLowRest);
      rHand.quaternion.copy(qHandRest);
      rootMesh.updateMatrixWorld(true);

      const tracks = [
        // 抬臂 -> 保持 -> 落回
        quatTrack(rArm, qUpRest, [0.0, 0.35, 2.45, 2.7], [
          IDENTITY_QUAT, dUp, dUp, IDENTITY_QUAT
        ]),
        // 前臂挥摆 3 次
        quatTrack(
          rElbow,
          qLowRest,
          [0.0, 0.35, 0.65, 0.95, 1.25, 1.55, 1.85, 2.15, 2.45, 2.7],
          [
            IDENTITY_QUAT, dSwingMid, dSwingOut, dSwingIn, dSwingOut,
            dSwingIn, dSwingOut, dSwingIn, dSwingMid, IDENTITY_QUAT
          ]
        ),
        // 手腕掌心对人
        quatTrack(rHand, qHandRest, [0.0, 0.35, 2.45, 2.7], [
          IDENTITY_QUAT, dHand, dHand, IDENTITY_QUAT
        ])
      ];

      // 头部迎视微笑
      if (head) {
        const tHead = makeQuatTrack(head, [0.0, 0.45, 2.45, 2.7], [
          [0, 0, 0], [0.02, -0.12, 0.07], [0.02, -0.12, 0.07], [0, 0, 0]
        ]);
        if (tHead) tracks.push(tHead);
      }

      registerClip('wave_hand', 2.7, tracks);

      // 1b. pmx_greeting (MMD风 全身礼貌致意打招呼, 3.2s)
      // 右手胸前自然挥动 + 掌心朝向观众 + 屈膝重心下沉(hips -> センター) + 躯干微躬(chest) + 眼神迎视
      const greetingTracks = [
        quatTrack(rArm, qUpRest, [0.0, 0.45, 2.75, 3.2], [
          IDENTITY_QUAT, dUp, dUp, IDENTITY_QUAT
        ]),
        quatTrack(
          rElbow,
          qLowRest,
          [0.0, 0.45, 0.85, 1.25, 1.65, 2.05, 2.45, 2.75, 3.2],
          [
            IDENTITY_QUAT, dSwingMid, dSwingOut, dSwingIn, dSwingOut,
            dSwingIn, dSwingOut, dSwingMid, IDENTITY_QUAT
          ]
        ),
        quatTrack(rHand, qHandRest, [0.0, 0.45, 2.75, 3.2], [
          IDENTITY_QUAT, dHand, dHand, IDENTITY_QUAT
        ])
      ];

      // 重心下沉与屈膝：严格作用于 センター 骨骼位移
      if (hips) {
        const tHips = makePosTrack(hips, [0.0, 0.5, 1.4, 2.4, 3.2], [
          [0, 0, 0],
          [0, -0.12, 0.03],
          [0, -0.12, 0.03],
          [0, -0.04, 0.01],
          [0, 0, 0]
        ]);
        if (tHips) greetingTracks.push(tHips);
      }

      if (chest) {
        const tChest = makeQuatTrack(chest, [0.0, 0.5, 1.5, 2.5, 3.2], [
          [0, 0, 0], [0.06, 0, 0], [0.06, 0, 0], [0.02, 0, 0], [0, 0, 0]
        ]);
        if (tChest) greetingTracks.push(tChest);
      }

      if (head) {
        const tHead = makeQuatTrack(head, [0.0, 0.4, 1.0, 2.0, 2.7, 3.2], [
          [0, 0, 0],
          [0.08, 0, 0],
          [-0.04, -0.08, 0.04],
          [-0.04, -0.08, 0.04],
          [0.02, 0, 0],
          [0, 0, 0]
        ]);
        if (tHead) greetingTracks.push(tHead);
      }

      registerClip('pmx_greeting', 3.2, greetingTracks);
    }
  }

  // 2. gentle_nod (温柔点头, 1.7s)
  if (head) {
    const tracks = [];
    const tHead = makeQuatTrack(head, [0.0, 0.35, 0.7, 1.05, 1.4, 1.7], [
      [0, 0, 0], [0.12, 0, 0], [0, 0, 0], [0.08, 0, 0], [0, 0, 0], [0, 0, 0]
    ]);
    if (tHead) tracks.push(tHead);
    if (chest) {
      const tChest = makeQuatTrack(chest, [0.0, 0.35, 0.7, 1.7], [
        [0, 0, 0], [0.03, 0, 0], [0, 0, 0], [0, 0, 0]
      ]);
      if (tChest) tracks.push(tChest);
    }
    registerClip('gentle_nod', 1.7, tracks);
  }

  // 3. shake_head (轻轻摇头, 1.65s)
  if (head) {
    const tracks = [];
    const tHead = makeQuatTrack(head, [0.0, 0.25, 0.6, 0.95, 1.3, 1.65], [
      [0, 0, 0], [0.02, 0.18, -0.02], [0.02, -0.18, 0.02], [0.02, 0.12, -0.02], [0.02, -0.08, 0.01], [0, 0, 0]
    ]);
    if (tHead) tracks.push(tHead);
    if (chest) {
      const tChest = makeQuatTrack(chest, [0.0, 0.6, 1.3, 1.65], [
        [0, 0, 0], [0, -0.04, 0], [0, 0.04, 0], [0, 0, 0]
      ]);
      if (tChest) tracks.push(tChest);
    }
    registerClip('shake_head', 1.65, tracks);
  }

  // 4. cheerful_bounce (雀跃跳跃, 1.5s - 作用于 センター 骨骼垂直位移)
  {
    const tracks = [];
    if (hips) {
      const tHips = makePosTrack(hips, [0.0, 0.25, 0.55, 0.85, 1.2, 1.5], [
        [0, 0, 0], [0, 0.35, 0], [0, -0.05, 0], [0, 0.20, 0], [0, 0, 0], [0, 0, 0]
      ]);
      if (tHips) tracks.push(tHips);
    }
    if (head) {
      const tHead = makeQuatTrack(head, [0.0, 0.3, 0.6, 1.0, 1.5], [
        [0, 0, 0], [-0.08, 0, 0.04], [0, 0, 0], [-0.05, 0, -0.03], [0, 0, 0]
      ]);
      if (tHead) tracks.push(tHead);
    }
    if (rArm && lArm) {
      const tRArm = makeQuatTrack(rArm, [0.0, 0.3, 0.6, 1.5], [
        [0, 0, 0], [0.10, 0, 0.15], [0, 0, 0], [0, 0, 0]
      ]);
      const tLArm = makeQuatTrack(lArm, [0.0, 0.3, 0.6, 1.5], [
        [0, 0, 0], [0.10, 0, -0.15], [0, 0, 0], [0, 0, 0]
      ]);
      if (tRArm) tracks.push(tRArm);
      if (tLArm) tracks.push(tLArm);
    }
    registerClip('cheerful_bounce', 1.5, tracks);
  }

  // 5. surprise_jump (受惊后缩, 1.4s - 作用于 センター 骨骼 Y/Z 轴位移)
  {
    const tracks = [];
    if (hips) {
      const tHips = makePosTrack(hips, [0.0, 0.15, 0.5, 0.9, 1.4], [
        [0, 0, 0], [0, 0.15, -0.25], [0, 0, -0.15], [0, 0, 0], [0, 0, 0]
      ]);
      if (tHips) tracks.push(tHips);
    }
    if (head) {
      const tHead = makeQuatTrack(head, [0.0, 0.15, 0.5, 1.0, 1.4], [
        [0, 0, 0], [-0.10, 0, 0], [-0.10, 0, 0], [0, 0, 0], [0, 0, 0]
      ]);
      if (tHead) tracks.push(tHead);
    }
    registerClip('surprise_jump', 1.4, tracks);
  }

  // 6. pout_turn (傲娇侧身, 1.5s)
  {
    const tracks = [];
    if (chest) {
      const tChest = makeQuatTrack(chest, [0.0, 0.25, 0.8, 1.2, 1.5], [
        [0, 0, 0], [0, 0.15, 0], [0, 0.15, 0], [0, 0, 0], [0, 0, 0]
      ]);
      if (tChest) tracks.push(tChest);
    }
    if (head) {
      const tHead = makeQuatTrack(head, [0.0, 0.25, 0.8, 1.2, 1.5], [
        [0, 0, 0], [0.06, 0.25, 0.04], [0.06, 0.25, 0.04], [0, 0, 0], [0, 0, 0]
      ]);
      if (tHead) tracks.push(tHead);
    }
    registerClip('pout_turn', 1.5, tracks);
  }

  // 7. shy_tilt (歪头害羞, 2.2s)
  {
    const tracks = [];
    if (head) {
      const tHead = makeQuatTrack(head, [0.0, 0.6, 1.6, 2.2], [
        [0, 0, 0], [0.10, 0.05, 0.22], [0.10, 0.05, 0.22], [0, 0, 0]
      ]);
      if (tHead) tracks.push(tHead);
    }
    if (chest) {
      const tChest = makeQuatTrack(chest, [0.0, 0.6, 1.6, 2.2], [
        [0, 0, 0], [0.03, 0.02, 0.06], [0.03, 0.02, 0.06], [0, 0, 0]
      ]);
      if (tChest) tracks.push(tChest);
    }
    registerClip('shy_tilt', 2.2, tracks);
  }

  // 8. idle (待机呼吸微动循环, 3.6s)
  {
    const tracks = [];
    if (chest) {
      const tChest = makeQuatTrack(chest, [0.0, 0.9, 1.8, 2.7, 3.6], [
        [0, 0, 0], [0.015, 0, 0], [0, 0, 0], [0.015, 0, 0], [0, 0, 0]
      ]);
      if (tChest) tracks.push(tChest);
    }
    if (head) {
      const tHead = makeQuatTrack(head, [0.0, 0.9, 1.8, 2.7, 3.6], [
        [0, 0, 0], [0.008, 0.02, 0.008], [0, 0, 0], [0.008, -0.02, -0.008], [0, 0, 0]
      ]);
      if (tHead) tracks.push(tHead);
    }
    if (rArm && lArm) {
      const tRArm = makeQuatTrack(rArm, [0.0, 0.9, 1.8, 2.7, 3.6], [
        [0, 0, 0], [0, 0, 0.01], [0, 0, 0], [0, 0, 0.01], [0, 0, 0]
      ]);
      const tLArm = makeQuatTrack(lArm, [0.0, 0.9, 1.8, 2.7, 3.6], [
        [0, 0, 0], [0, 0, -0.01], [0, 0, 0], [0, 0, -0.01], [0, 0, 0]
      ]);
      if (tRArm) tracks.push(tRArm);
      if (tLArm) tracks.push(tLArm);
    }
    registerClip('idle', 3.6, tracks);
  }

  return targetClipsMap;
}

/**
 * =========================================================================
 * 角色人设表情管理配方系统 (Character Persona Expression Profiles)
 * 为特定二次元角色（如托尔）量身定制复合形态键组合与动作联动表情
 * =========================================================================
 */


export const DEFAULT_EXPRESSION_PROFILES = {
  emotions: {
    'happy': { '笑い': 0.85, '口角上げ': 0.80 },
    'angry': { '怒り': 0.85, '口角下げ': 0.60 },
    'sad': { '困る': 0.85, '口角下げ': 0.70 },
    'relaxed': { '口角上げ': 0.70, 'ウィンク': 0.60 },
    'surprised': { 'びっくり': 0.85, 'あ': 0.60, '困る': 0.50 },
    'neutral': {}
  },
  actionExpressions: {
    'wave_hand': { '笑い': 0.60, '口角上げ': 0.70 },
    'pmx_greeting': { '口角上げ': 0.80, '笑い': 0.40 },
    'cheerful_bounce': { '笑い': 0.90, '口角上げ': 0.80 },
    'pout_turn': { '怒り': 0.50, '口角下げ': 0.70 },
    'shy_tilt': { '笑い': 0.50, '口角上げ': 0.60 },
    'surprise_jump': { 'びっくり': 0.80, 'あ': 0.60 },
    'gentle_nod': { '口角上げ': 0.60 },
    'shake_head': { '困る': 0.40 }
  }
};

export function getCharacterExpressionProfile(adapter) {
  if (!adapter) return DEFAULT_EXPRESSION_PROFILES;
  const name = (adapter.characterName || '').toLowerCase();
  const id = (adapter.characterId || '').toLowerCase();
  const url = (adapter.url || '').toLowerCase();
  if (id.includes('tohru') || name.includes('托尔') || name.includes('トール') || url.includes('tohru')) {
    return TOHRU_EXPRESSION_PROFILES;
  }
  return DEFAULT_EXPRESSION_PROFILES;
}

/**
 * 独立的 Blend / PMX 动作与表情协同管理器类 (BlendMotionSystem)
 * 继承自全局 BasePmxMotionSystem，全局动作切换自动触发原点复位守卫与生命周期管控
 */
export class BlendMotionSystem extends BasePmxMotionSystem {
  constructor(adapter) {
    super(adapter, {
      profile: getCharacterExpressionProfile(adapter),
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
 * 动作路由器 (MotionRouter)
 * 根据角色类型严格隔离 Blend 动作系统与 VRM 动作系统
 */
class MotionRouter {
  constructor() {
    this.activeSystem = null;
    this.currentModelType = null;
  }

  isCantarellaPmx(adapter) {
    if (!adapter) return false;
    const url = (adapter.url || '').toLowerCase();
    const type = (adapter.type || '').toLowerCase();
    const charId = (adapter.characterId || '').toLowerCase();
    const name = (adapter.characterName || '').toLowerCase();

    // 必须为 PMX/PMD 模型，绝不抢占 VRM 版坎特蕾拉
    const isPmx = type === 'pmx' || url.endsWith('.pmx') || url.endsWith('.pmd') || charId === 'zh_cantarella_pmx_01';
    if (!isPmx) return false;

    return charId === 'zh_cantarella_pmx_01' ||
           url.includes('坎特蕾拉') || url.includes('cantarella') ||
           name.includes('坎特蕾拉') || name.includes('cantarella') || name.includes('カンタレラ');
  }

  isKurumiPmx(adapter) {
    if (!adapter) return false;
    const url = (adapter.url || '').toLowerCase();
    const type = (adapter.type || '').toLowerCase();
    const charId = (adapter.characterId || '').toLowerCase();
    const name = (adapter.characterName || '').toLowerCase();

    const isPmx = type === 'pmx' || url.endsWith('.pmx') || url.endsWith('.pmd') || charId === 'zh_tokisaki_kurumi_01';
    if (!isPmx) return false;

    return charId === 'zh_tokisaki_kurumi_01' ||
           url.includes('时崎狂三') || url.includes('kurumi') ||
           name.includes('时崎狂三') || name.includes('狂三') || name.includes('kurumi');
  }

  isTohruPmx(adapter) {
    if (!adapter) return false;
    const url = (adapter.url || '').toLowerCase();
    const type = (adapter.type || '').toLowerCase();
    const charId = (adapter.characterId || '').toLowerCase();
    const name = (adapter.characterName || '').toLowerCase();

    // 必须为 PMX/PMD 模型，精准识别托尔 (Tohru)
    const isPmx = type === 'pmx' || url.endsWith('.pmx') || url.endsWith('.pmd') || charId === 'zh_tohru_01';
    if (!isPmx) return false;

    return charId === 'zh_tohru_01' ||
           url.includes('托尔') || url.includes('tohru') ||
           name.includes('托尔') || name.includes('トール') || name.includes('tohru');
  }

  isBlendModel(adapter) {
    if (!adapter) return false;
    const url = (adapter.url || '').toLowerCase();
    const type = (adapter.type || '').toLowerCase();
    const charId = (adapter.characterId || '').toLowerCase();
    const name = (adapter.characterName || '').toLowerCase();

    // 仅匹配 PMX/PMD/Blend，非 VRM 模型
    const isNonVrm = type === 'pmx' || type === 'blend' ||
                     url.endsWith('.pmx') || url.endsWith('.pmd') || url.endsWith('.blend') ||
                     charId === 'zh_tohru_01';
    if (!isNonVrm) return false;

    return charId === 'zh_tohru_01' ||
           name.includes('托尔') || name.includes('トール') || name.includes('tohru') ||
           type === 'pmx' || type === 'blend';
  }

  route(adapter) {
    if (!adapter) return;

    // 1. 优先匹配：坎特蕾拉专属 PMX 动作系统 (CantarellaMotionSystem)
    if (this.isCantarellaPmx(adapter)) {
      this.currentModelType = 'cantarella';
      console.log(`[MotionRouter] 🍷 路由 -> 坎特蕾拉专属 PMX 动作系统 (CantarellaMotionSystem, 角色: ${adapter.characterName || 'Cantarella'})`);
      this.activeSystem = new CantarellaMotionSystem(adapter);
      adapter.cantarellaMotionSystem = this.activeSystem;
      adapter.blendMotionSystem = this.activeSystem;
      this.activeSystem.init();
      return;
    }

    // 2. 优先匹配：时崎狂三专属 PMX 动作与魅惑表情系统 (KurumiMotionSystem)
    if (this.isKurumiPmx(adapter)) {
      this.currentModelType = 'kurumi';
      console.log(`[MotionRouter] ⏳ 路由 -> 时崎狂三专属 PMX 动作系统 (KurumiMotionSystem, 角色: ${adapter.characterName || 'Kurumi'})`);
      this.activeSystem = new KurumiMotionSystem(adapter);
      adapter.kurumiMotionSystem = this.activeSystem;
      adapter.blendMotionSystem = this.activeSystem;
      this.activeSystem.init();
      return;
    }

    // 3. 优先匹配：托尔专属 PMX 动作与龙女仆表情系统 (TohruMotionSystem)
    if (this.isTohruPmx(adapter)) {
      this.currentModelType = 'tohru';
      console.log(`[MotionRouter] 🐉 路由 -> 托尔专属 PMX 动作系统 (TohruMotionSystem, 角色: ${adapter.characterName || 'Tohru'})`);
      this.activeSystem = new TohruMotionSystem(adapter);
      adapter.tohruMotionSystem = this.activeSystem;
      adapter.blendMotionSystem = this.activeSystem;
      this.activeSystem.init();
      return;
    }

    // 4. 匹配：通用 Blend / PMX 动作系统 (BlendMotionSystem)
    if (this.isBlendModel(adapter)) {
      this.currentModelType = 'blend';
      console.log(`[MotionRouter] 🔄 路由 -> Blend / PMX 独立动作系统 (角色: ${adapter.characterName || 'Unknown'})`);
      this.activeSystem = new BlendMotionSystem(adapter);
      adapter.blendMotionSystem = this.activeSystem;
      this.activeSystem.init();
      return;
    }

    // 4. 回退：VRM 原生动作系统 (喜多郁代 / 由比滨结衣 / 雷电将军 / 弗洛洛 / 坎特蕾拉VRM)
    this.currentModelType = 'vrm';
    console.log(`[MotionRouter] 🔄 路由 -> VRM 原生动作系统 (角色: ${adapter.characterName || 'Unknown'})`);
    this.activeSystem = null;
    if (typeof adapter.setupMotionMixer === 'function') {
      adapter.setupMotionMixer();
    }
  }

  playMotion(name) {
    if (this.activeSystem && typeof this.activeSystem.playMotion === 'function') {
      return this.activeSystem.playMotion(name);
    }
    // VRM 回退至全局原有 playMotion
    if (typeof window.playMotion === 'function') {
      window.playMotion(name);
      return true;
    }
    return false;
  }

  playIdleMotion() {
    if (this.activeSystem && typeof this.activeSystem.playIdleMotion === 'function') {
      return this.activeSystem.playIdleMotion();
    }
    return false;
  }

  setEmotion(preset, weight) {
    if (this.activeSystem && typeof this.activeSystem.setEmotion === 'function') {
      this.activeSystem.setEmotion(preset, weight);
      return true;
    }
    return false;
  }

  update(delta, elapsedTime) {
    if (this.activeSystem && typeof this.activeSystem.update === 'function') {
      this.activeSystem.update(delta, elapsedTime);
    }
  }

  destroy() {
    if (this.activeSystem) {
      try {
        this.activeSystem.destroy();
      } catch (e) {
        console.warn('[MotionRouter] 销毁 activeSystem 异常:', e);
      }
      this.activeSystem = null;
    }
    this.currentModelType = null;
  }
}

export const motionRouter = new MotionRouter();

export {
  BasePmxMotionSystem,
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
