import * as THREE from 'three';
import { BasePmxMotionSystem } from '../../../pmx_motion/base_motion.js';

/**
 * =========================================================================
 * Open-LLM-VTuber: 托尔 (Tohru) 专属 MMD / PMX 动作与龙女仆表情驱动系统
 * 路径: pmx-models/托尔/motion/tohru_motion.js
 * 
 * 核心设计原则：
 * 1. 狂爱、元气、忠诚巨龙女仆人设：
 *    - 姿态热情端庄，大臂自然下垂贴合女仆裙侧，微前倾避开袖套穿模；
 *    - 招牌动作矩阵：
 *      ① tohru_love_hug: 小林狂爱·飞扑拥抱 (小林さーん！身体前冲飞扑，满面灿烂笑容)
 *      ② tohru_tail_meat: 特制尻尾肉·料理邀尝 (双手恭敬托递，单眼俏皮放电Wink)
 *      ③ tohru_dragon_roar: 灭世龙威·冷峻怒颜 (身躯紧绷蓄力，倒八字怒眉，嘴角紧绷威慑)
 *      ④ tohru_maid_curtsy: 端庄龙女仆·提裙致意 (双膝微屈，双手微提裙摆，温婉颔首)
 *      ⑤ tohru_happy_bounce: 元气欢呼·雀跃起跳 (欢呼跃起，Center骨骼动力学起伏)
 *      ⑥ wave_hand: 热情摆手招手 (手肘严格向前微屈，彻底杜绝向后反折穿模)
 *      ⑦ gentle_nod / shake_head / pout_turn: 乖巧颔首、委屈扁嘴摇头、傲娇别头
 * 2. 专属形态键精准测绘配方：
 *    - 彻底纠正原作者形态键命名反转：
 *      * '口角下げ': 真实位移为嘴角正向上扬 (+dY) -> 微笑、大笑
 *      * '口角上げ': 真实位移为嘴角负向下沉 (-dY) -> 撇嘴、生气紧绷
 *      * 'ウィンク２': 单侧右眼俏皮笑眼闭合 (左眼明亮睁开)
 *      * '笑い': 双眼月牙弯弯笑
 *      * '怒り': 倒八字怒眉
 *      * '困る': 八字下垂愁眉
 *      * 'ω': 波浪萌态大口 (适度权重避免畸变)
 * 3. 毫秒级阻尼平滑插值 (THREE.MathUtils.damp) 与环境守卫 (Node.js 自动化测试兼容)。
 * =========================================================================
 */

export const TOHRU_BONE_MAPPING = {
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
 * 施加托尔专属端庄元气自然垂手站姿 (Tohru Dragon Maid Natural Rest Pose)
 * 消除标准 MMD 40°~45° A-Pose 僵硬大字姿态：
 * - 沉肩：Z 轴微倾 ±0.05 rad，消除耸肩紧张感；
 * - 垂臂：从 A-Pose 沿 Z 轴进一步下垂 0.50 rad，微前倾 -0.06 rad 防止大袖向后反撇穿模；
 * - 肘部自然向前微屈内敛 (X 为 -0.16 rad，微偏身前内敛)；
 * - 手腕顺势自然微收，指尖自然指向身前偏内侧；
 * - 固化写入 mmd.animationPose，杜绝 @moeru/three-mmd 运行时每帧还原。
 */
export function applyTohruNaturalPose(adapter) {
  if (!adapter) return;

  const lShoulder = adapter.resolveBone('leftShoulder');
  const rShoulder = adapter.resolveBone('rightShoulder');
  const lArm = adapter.resolveBone('leftUpperArm');
  const rArm = adapter.resolveBone('rightUpperArm');
  const lElbow = adapter.resolveBone('leftLowerArm');
  const rElbow = adapter.resolveBone('rightLowerArm');
  const lHand = adapter.resolveBone('leftHand');
  const rHand = adapter.resolveBone('rightHand');

  // 1. 锁骨微沉肩放松
  if (lShoulder) lShoulder.rotation.set(0.0, 0.0, -0.05);
  if (rShoulder) rShoulder.rotation.set(0.0, 0.0, 0.05);

  // 2. 双臂端庄自然下垂微前倾 (Z 轴 0.50 rad，X 轴 -0.06 rad)
  const armAngleZ = 0.50;
  const armAngleX = -0.06;
  if (lArm) lArm.rotation.set(armAngleX, 0.05, -armAngleZ);
  if (rArm) rArm.rotation.set(armAngleX, -0.05, armAngleZ);

  // 3. 肘部自然向前微屈内敛 (X 为 -0.16 rad 向前自然微屈)
  if (lElbow) lElbow.rotation.set(-0.16, 0.08, -0.18);
  if (rElbow) rElbow.rotation.set(-0.16, -0.08, 0.18);

  // 4. 手腕顺势微敛放松，指尖自然指向身前地面
  if (lHand) lHand.rotation.set(-0.05, 0.0, -0.08);
  if (rHand) rHand.rotation.set(-0.05, 0.0, 0.08);

  for (const b of [lShoulder, rShoulder, lArm, rArm, lElbow, rElbow, lHand, rHand]) {
    if (b) b.updateMatrix();
  }

  const rootMesh = adapter.getRootNode() || adapter.mesh;
  if (rootMesh) rootMesh.updateMatrixWorld(true);

  // 固化至 mmd.animationPose
  if (adapter.mmd && rootMesh && rootMesh.skeleton && rootMesh.skeleton.bones) {
    adapter.mmd.animationPose = rootMesh.skeleton.bones.map((bone) => ({
      position: bone.position.clone(),
      rotation: bone.quaternion.clone()
    }));
  }
}

/**
 * 角色基准坐标系计算
 */
function characterBasis(adapter) {
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

function basisToWorld(basis, a, b, c) {
  return new THREE.Vector3()
    .addScaledVector(basis.right, a)
    .addScaledVector(basis.up, b)
    .addScaledVector(basis.forward, c)
    .normalize();
}

function solveBoneAim(node, child, targetWorldDir) {
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
 * 为托尔生成全套专属定制动作片段 (Clips)
 */
export function ensureTohruMotionClips(adapter, targetClipsMap = {}) {
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

  // 1. tohru_love_hug (小林狂爱·飞扑拥抱, 3.5s)
  // 小林さーん！下蹲蓄力 -> 前冲跃起飞扑(センター Z+0.22, Y+0.14) -> 双臂热情前大张环抱 -> 稳稳落地
  {
    const tracks = [];
    if (hips) {
      const tHips = makePosTrack(hips, [0.0, 0.5, 1.4, 2.2, 2.9, 3.5], [
        [0, 0, 0],
        [0, -0.08, -0.05],
        [0, 0.14, 0.22],
        [0, 0.12, 0.20],
        [0, -0.04, 0.05],
        [0, 0, 0]
      ]);
      if (tHips) tracks.push(tHips);
    }
    if (chest) {
      const tChest = makeQuatTrack(chest, [0.0, 0.5, 1.4, 2.2, 2.9, 3.5], [
        [0, 0, 0],
        [0.08, 0, 0],
        [-0.06, 0, 0],
        [-0.04, 0, 0],
        [0.04, 0, 0],
        [0, 0, 0]
      ]);
      if (tChest) tracks.push(tChest);
    }
    if (head) {
      const tHead = makeQuatTrack(head, [0.0, 0.5, 1.4, 2.2, 2.9, 3.5], [
        [0, 0, 0],
        [-0.05, 0, 0],
        [0.10, 0, 0],
        [0.08, 0, 0],
        [-0.02, 0, 0],
        [0, 0, 0]
      ]);
      if (tHead) tracks.push(tHead);
    }
    // 双臂大张热情拥抱
    if (rArm && lArm) {
      const tRArm = makeQuatTrack(rArm, [0.0, 0.5, 1.4, 2.2, 2.9, 3.5], [
        [0, 0, 0],
        [-0.10, 0, 0.10],
        [0.45, -0.20, 0.35],
        [0.40, -0.15, 0.30],
        [0.10, 0, 0.08],
        [0, 0, 0]
      ]);
      const tLArm = makeQuatTrack(lArm, [0.0, 0.5, 1.4, 2.2, 2.9, 3.5], [
        [0, 0, 0],
        [-0.10, 0, -0.10],
        [0.45, 0.20, -0.35],
        [0.40, 0.15, -0.30],
        [0.10, 0, -0.08],
        [0, 0, 0]
      ]);
      if (tRArm) tracks.push(tRArm);
      if (tLArm) tracks.push(tLArm);
    }
    if (rElbow && lElbow) {
      const tRElbow = makeQuatTrack(rElbow, [0.0, 0.5, 1.4, 2.2, 2.9, 3.5], [
        [0, 0, 0],
        [-0.10, 0, 0.10],
        [-0.35, -0.15, 0.20],
        [-0.30, -0.10, 0.15],
        [-0.08, 0, 0.05],
        [0, 0, 0]
      ]);
      const tLElbow = makeQuatTrack(lElbow, [0.0, 0.5, 1.4, 2.2, 2.9, 3.5], [
        [0, 0, 0],
        [-0.10, 0, -0.10],
        [-0.35, 0.15, -0.20],
        [-0.30, 0.10, -0.15],
        [-0.08, 0, -0.05],
        [0, 0, 0]
      ]);
      if (tRElbow) tracks.push(tRElbow);
      if (tLElbow) tracks.push(tLElbow);
    }
    registerClip('tohru_love_hug', 3.5, tracks);
  }

  // 2. tohru_tail_meat (特制尻尾肉·料理邀尝, 3.6s)
  // 双手向前平托餐盘状呈递 + 上身探出期待 + 单眼放电
  {
    const tracks = [];
    if (chest) {
      const tChest = makeQuatTrack(chest, [0.0, 0.7, 1.8, 2.8, 3.6], [
        [0, 0, 0],
        [0.08, 0, 0],
        [0.08, 0, 0],
        [0.02, 0, 0],
        [0, 0, 0]
      ]);
      if (tChest) tracks.push(tChest);
    }
    if (head) {
      const tHead = makeQuatTrack(head, [0.0, 0.7, 1.8, 2.8, 3.6], [
        [0, 0, 0],
        [-0.05, 0.04, 0.06],
        [-0.05, 0.04, 0.06],
        [0, 0, 0],
        [0, 0, 0]
      ]);
      if (tHead) tracks.push(tHead);
    }
    // 双手在胸腹前如平托餐盘呈递
    if (rArm && lArm) {
      const tRArm = makeQuatTrack(rArm, [0.0, 0.7, 1.8, 2.8, 3.6], [
        [0, 0, 0],
        [0.32, -0.12, 0.18],
        [0.32, -0.12, 0.18],
        [0.08, 0, 0.05],
        [0, 0, 0]
      ]);
      const tLArm = makeQuatTrack(lArm, [0.0, 0.7, 1.8, 2.8, 3.6], [
        [0, 0, 0],
        [0.32, 0.12, -0.18],
        [0.32, 0.12, -0.18],
        [0.08, 0, -0.05],
        [0, 0, 0]
      ]);
      if (tRArm) tracks.push(tRArm);
      if (tLArm) tracks.push(tLArm);
    }
    if (rElbow && lElbow) {
      const tRElbow = makeQuatTrack(rElbow, [0.0, 0.7, 1.8, 2.8, 3.6], [
        [0, 0, 0],
        [-0.60, -0.20, 0.15],
        [-0.60, -0.20, 0.15],
        [-0.15, 0, 0.05],
        [0, 0, 0]
      ]);
      const tLElbow = makeQuatTrack(lElbow, [0.0, 0.7, 1.8, 2.8, 3.6], [
        [0, 0, 0],
        [-0.60, 0.20, -0.15],
        [-0.60, 0.20, -0.15],
        [-0.15, 0, -0.05],
        [0, 0, 0]
      ]);
      if (tRElbow) tracks.push(tRElbow);
      if (tLElbow) tracks.push(tLElbow);
    }
    if (rHand && lHand) {
      const tRHand = makeQuatTrack(rHand, [0.0, 0.7, 1.8, 2.8, 3.6], [
        [0, 0, 0],
        [0.15, 0.20, 0.05],
        [0.15, 0.20, 0.05],
        [0.03, 0, 0],
        [0, 0, 0]
      ]);
      const tLHand = makeQuatTrack(lHand, [0.0, 0.7, 1.8, 2.8, 3.6], [
        [0, 0, 0],
        [0.15, -0.20, -0.05],
        [0.15, -0.20, -0.05],
        [0.03, 0, 0],
        [0, 0, 0]
      ]);
      if (tRHand) tracks.push(tRHand);
      if (tLHand) tracks.push(tLHand);
    }
    registerClip('tohru_tail_meat', 3.6, tracks);
  }

  // 3. tohru_dragon_roar (灭世龙威·冷峻怒颜, 3.2s)
  // 重心下沉蓄力(hips Y-0.12) -> 躯干昂立挺胸威慑 -> 双手微张威吓 -> 杀气沉静
  {
    const tracks = [];
    if (hips) {
      const tHips = makePosTrack(hips, [0.0, 0.5, 1.5, 2.4, 3.2], [
        [0, 0, 0],
        [0, -0.10, 0.02],
        [0, -0.08, 0.02],
        [0, -0.02, 0],
        [0, 0, 0]
      ]);
      if (tHips) tracks.push(tHips);
    }
    if (chest) {
      const tChest = makeQuatTrack(chest, [0.0, 0.5, 1.5, 2.4, 3.2], [
        [0, 0, 0],
        [-0.08, 0, 0],
        [-0.08, 0, 0],
        [-0.02, 0, 0],
        [0, 0, 0]
      ]);
      if (tChest) tracks.push(tChest);
    }
    if (head) {
      const tHead = makeQuatTrack(head, [0.0, 0.5, 1.5, 2.4, 3.2], [
        [0, 0, 0],
        [-0.08, 0, 0],
        [-0.08, 0, 0],
        [-0.02, 0, 0],
        [0, 0, 0]
      ]);
      if (tHead) tracks.push(tHead);
    }
    if (rArm && lArm) {
      const tRArm = makeQuatTrack(rArm, [0.0, 0.5, 1.5, 2.4, 3.2], [
        [0, 0, 0],
        [0.15, -0.10, 0.28],
        [0.15, -0.10, 0.28],
        [0.04, 0, 0.08],
        [0, 0, 0]
      ]);
      const tLArm = makeQuatTrack(lArm, [0.0, 0.5, 1.5, 2.4, 3.2], [
        [0, 0, 0],
        [0.15, 0.10, -0.28],
        [0.15, 0.10, -0.28],
        [0.04, 0, -0.08],
        [0, 0, 0]
      ]);
      if (tRArm) tracks.push(tRArm);
      if (tLArm) tracks.push(tLArm);
    }
    if (rElbow && lElbow) {
      const tRElbow = makeQuatTrack(rElbow, [0.0, 0.5, 1.5, 2.4, 3.2], [
        [0, 0, 0],
        [-0.25, 0, 0.20],
        [-0.25, 0, 0.20],
        [-0.06, 0, 0.05],
        [0, 0, 0]
      ]);
      const tLElbow = makeQuatTrack(lElbow, [0.0, 0.5, 1.5, 2.4, 3.2], [
        [0, 0, 0],
        [-0.25, 0, -0.20],
        [-0.25, 0, -0.20],
        [-0.06, 0, -0.05],
        [0, 0, 0]
      ]);
      if (tRElbow) tracks.push(tRElbow);
      if (tLElbow) tracks.push(tLElbow);
    }
    registerClip('tohru_dragon_roar', 3.2, tracks);
  }

  // 4. tohru_maid_curtsy (端庄龙女仆·提裙致意, 3.4s)
  // 双膝微屈(hips Y-0.12) + 躯干端庄前倾 + 双手微展虚提女仆裙摆 + 温婉颔首
  {
    const tracks = [];
    if (hips) {
      const tHips = makePosTrack(hips, [0.0, 0.7, 1.7, 2.6, 3.4], [
        [0, 0, 0],
        [0, -0.12, 0.02],
        [0, -0.12, 0.02],
        [0, -0.03, 0.01],
        [0, 0, 0]
      ]);
      if (tHips) tracks.push(tHips);
    }
    if (chest) {
      const tChest = makeQuatTrack(chest, [0.0, 0.7, 1.7, 2.6, 3.4], [
        [0, 0, 0],
        [0.10, 0, 0],
        [0.10, 0, 0],
        [0.02, 0, 0],
        [0, 0, 0]
      ]);
      if (tChest) tracks.push(tChest);
    }
    if (head) {
      const tHead = makeQuatTrack(head, [0.0, 0.6, 1.6, 2.5, 3.4], [
        [0, 0, 0],
        [0.06, 0, 0],
        [-0.02, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ]);
      if (tHead) tracks.push(tHead);
    }
    if (rArm && lArm) {
      const tRArm = makeQuatTrack(rArm, [0.0, 0.7, 1.7, 2.6, 3.4], [
        [0, 0, 0],
        [0.08, -0.06, 0.22],
        [0.08, -0.06, 0.22],
        [0.02, 0, 0.05],
        [0, 0, 0]
      ]);
      const tLArm = makeQuatTrack(lArm, [0.0, 0.7, 1.7, 2.6, 3.4], [
        [0, 0, 0],
        [0.08, 0.06, -0.22],
        [0.08, 0.06, -0.22],
        [0.02, 0, -0.05],
        [0, 0, 0]
      ]);
      if (tRArm) tracks.push(tRArm);
      if (tLArm) tracks.push(tLArm);
    }
    if (rElbow && lElbow) {
      const tRElbow = makeQuatTrack(rElbow, [0.0, 0.7, 1.7, 2.6, 3.4], [
        [0, 0, 0],
        [-0.15, -0.08, 0.16],
        [-0.15, -0.08, 0.16],
        [-0.04, 0, 0.04],
        [0, 0, 0]
      ]);
      const tLElbow = makeQuatTrack(lElbow, [0.0, 0.7, 1.7, 2.6, 3.4], [
        [0, 0, 0],
        [-0.15, 0.08, -0.16],
        [-0.15, 0.08, -0.16],
        [-0.04, 0, -0.04],
        [0, 0, 0]
      ]);
      if (tRElbow) tracks.push(tRElbow);
      if (tLElbow) tracks.push(tLElbow);
    }
    registerClip('tohru_maid_curtsy', 3.4, tracks);
  }

  // 5. tohru_happy_bounce (元气欢呼·雀跃起跳, 2.4s)
  // 下蹲蓄力 -> 元气起跳 (hips Y+0.20) -> 双臂欢呼微扬 -> 落地缓冲
  {
    const tracks = [];
    if (hips) {
      const tHips = makePosTrack(hips, [0.0, 0.35, 0.75, 1.25, 1.75, 2.4], [
        [0, 0, 0],
        [0, -0.08, -0.02],
        [0, 0.20, 0.04],
        [0, -0.06, -0.01],
        [0, 0.03, 0],
        [0, 0, 0]
      ]);
      if (tHips) tracks.push(tHips);
    }
    if (chest) {
      const tChest = makeQuatTrack(chest, [0.0, 0.35, 0.75, 1.25, 1.75, 2.4], [
        [0, 0, 0],
        [0.05, 0, 0],
        [-0.06, 0, 0],
        [0.04, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ]);
      if (tChest) tracks.push(tChest);
    }
    if (head) {
      const tHead = makeQuatTrack(head, [0.0, 0.35, 0.75, 1.25, 1.75, 2.4], [
        [0, 0, 0],
        [-0.06, 0, 0],
        [0.10, 0, 0],
        [-0.04, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ]);
      if (tHead) tracks.push(tHead);
    }
    if (rArm && lArm) {
      const tRArm = makeQuatTrack(rArm, [0.0, 0.35, 0.75, 1.25, 1.75, 2.4], [
        [0, 0, 0],
        [0.10, 0, 0.15],
        [0.55, -0.15, 0.40],
        [0.20, 0, 0.15],
        [0.05, 0, 0.05],
        [0, 0, 0]
      ]);
      const tLArm = makeQuatTrack(lArm, [0.0, 0.35, 0.75, 1.25, 1.75, 2.4], [
        [0, 0, 0],
        [0.10, 0, -0.15],
        [0.55, 0.15, -0.40],
        [0.20, 0, -0.15],
        [0.05, 0, -0.05],
        [0, 0, 0]
      ]);
      if (tRArm) tracks.push(tRArm);
      if (tLArm) tracks.push(tLArm);
    }
    if (rElbow && lElbow) {
      const tRElbow = makeQuatTrack(rElbow, [0.0, 0.35, 0.75, 1.25, 1.75, 2.4], [
        [0, 0, 0],
        [-0.20, 0, 0.15],
        [-0.60, 0, 0.30],
        [-0.25, 0, 0.15],
        [-0.05, 0, 0],
        [0, 0, 0]
      ]);
      const tLElbow = makeQuatTrack(lElbow, [0.0, 0.35, 0.75, 1.25, 1.75, 2.4], [
        [0, 0, 0],
        [-0.20, 0, -0.15],
        [-0.60, 0, -0.30],
        [-0.25, 0, -0.15],
        [-0.05, 0, 0],
        [0, 0, 0]
      ]);
      if (tRElbow) tracks.push(tRElbow);
      if (tLElbow) tracks.push(tLElbow);
    }
    registerClip('tohru_happy_bounce', 2.4, tracks);
  }

  // 6. wave_hand (热情摆手打招呼, 2.8s)
  // 基于角色自身基准反解朝向，手肘严格向前微屈，彻底告别反折
  {
    const basis = characterBasis(adapter);
    const tracks = [];
    if (basis && rArm && rElbow) {
      const dirUp = basisToWorld(basis, 0.35, 0.55, 0.76);
      const qAim = solveBoneAim(rArm, rElbow, dirUp);
      const qRest = rArm.quaternion.clone();
      const qUp = qAim.multiply(qRest);

      tracks.push(new THREE.QuaternionKeyframeTrack(
        `${rArm.name}.quaternion`,
        [0.0, 0.6, 2.2, 2.8],
        [
          qRest.x, qRest.y, qRest.z, qRest.w,
          qUp.x, qUp.y, qUp.z, qUp.w,
          qUp.x, qUp.y, qUp.z, qUp.w,
          qRest.x, qRest.y, qRest.z, qRest.w
        ]
      ));

      const qElbowRest = rElbow.quaternion.clone();
      // 手肘向前微屈内敛 (X=-0.75 屈臂，微带左右摆动)
      const qE1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.75, 0.05, -0.15)).multiply(qElbowRest);
      const qE2 = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.75, 0.20, 0.18)).multiply(qElbowRest);
      const qE3 = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.75, -0.10, -0.20)).multiply(qElbowRest);

      tracks.push(new THREE.QuaternionKeyframeTrack(
        `${rElbow.name}.quaternion`,
        [0.0, 0.6, 1.0, 1.4, 1.8, 2.2, 2.8],
        [
          qElbowRest.x, qElbowRest.y, qElbowRest.z, qElbowRest.w,
          qE1.x, qE1.y, qE1.z, qE1.w,
          qE2.x, qE2.y, qE2.z, qE2.w,
          qE3.x, qE3.y, qE3.z, qE3.w,
          qE2.x, qE2.y, qE2.z, qE2.w,
          qE1.x, qE1.y, qE1.z, qE1.w,
          qElbowRest.x, qElbowRest.y, qElbowRest.z, qElbowRest.w
        ]
      ));
    }
    if (head) {
      const tHead = makeQuatTrack(head, [0.0, 0.6, 1.4, 2.2, 2.8], [
        [0, 0, 0],
        [0.02, -0.06, -0.06],
        [0.02, 0.04, 0.04],
        [0.02, -0.04, -0.04],
        [0, 0, 0]
      ]);
      if (tHead) tracks.push(tHead);
    }
    registerClip('wave_hand', 2.8, tracks);
  }

  // 7. gentle_nod (乖巧轻颔首, 1.8s)
  {
    const tracks = [];
    if (head) {
      const tHead = makeQuatTrack(head, [0.0, 0.45, 0.9, 1.35, 1.8], [
        [0, 0, 0],
        [0.14, 0, 0],
        [-0.03, 0, 0],
        [0.08, 0, 0],
        [0, 0, 0]
      ]);
      if (tHead) tracks.push(tHead);
    }
    if (chest) {
      const tChest = makeQuatTrack(chest, [0.0, 0.45, 0.9, 1.8], [
        [0, 0, 0], [0.03, 0, 0], [-0.01, 0, 0], [0, 0, 0]
      ]);
      if (tChest) tracks.push(tChest);
    }
    registerClip('gentle_nod', 1.8, tracks);
  }

  // 8. shake_head (委屈扁嘴轻摇头, 2.4s)
  {
    const tracks = [];
    if (head) {
      const tHead = makeQuatTrack(head, [0.0, 0.4, 0.9, 1.4, 1.9, 2.4], [
        [0, 0, 0],
        [0.02, 0.18, 0.06],
        [0.02, -0.18, -0.06],
        [0.02, 0.12, 0.04],
        [0.01, -0.06, -0.02],
        [0, 0, 0]
      ]);
      if (tHead) tracks.push(tHead);
    }
    registerClip('shake_head', 2.4, tracks);
  }

  // 9. pout_turn (傲娇侧身别头, 2.0s)
  {
    const tracks = [];
    if (chest) {
      const tChest = makeQuatTrack(chest, [0.0, 0.4, 1.1, 1.5, 2.0], [
        [0, 0, 0], [0.02, 0.18, 0], [0.02, 0.18, 0], [0, 0, 0], [0, 0, 0]
      ]);
      if (tChest) tracks.push(tChest);
    }
    if (head) {
      const tHead = makeQuatTrack(head, [0.0, 0.4, 1.1, 1.5, 2.0], [
        [0, 0, 0], [0.05, 0.30, 0.06], [0.05, 0.30, 0.06], [0, 0, 0], [0, 0, 0]
      ]);
      if (tHead) tracks.push(tHead);
    }
    registerClip('pout_turn', 2.0, tracks);
  }

  // 10. idle (待机呼吸与龙女仆轻微身姿微动, 3.6s)
  {
    const tracks = [];
    if (chest) {
      const tChest = makeQuatTrack(chest, [0.0, 0.9, 1.8, 2.7, 3.6], [
        [0, 0, 0], [0.018, 0, 0], [0, 0, 0], [0.018, 0, 0], [0, 0, 0]
      ]);
      if (tChest) tracks.push(tChest);
    }
    if (head) {
      const tHead = makeQuatTrack(head, [0.0, 0.9, 1.8, 2.7, 3.6], [
        [0, 0, 0], [0.008, 0.012, 0.006], [0, 0, 0], [0.008, -0.012, -0.006], [0, 0, 0]
      ]);
      if (tHead) tracks.push(tHead);
    }
    if (rArm && lArm) {
      const tRArm = makeQuatTrack(rArm, [0.0, 0.9, 1.8, 2.7, 3.6], [
        [0, 0, 0], [0, 0, 0.012], [0, 0, 0], [0, 0, 0.012], [0, 0, 0]
      ]);
      const tLArm = makeQuatTrack(lArm, [0.0, 0.9, 1.8, 2.7, 3.6], [
        [0, 0, 0], [0, 0, -0.012], [0, 0, 0], [0, 0, -0.012], [0, 0, 0]
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
 * 托尔专属人设表情配方系统 (Tohru Persona Expression Profiles)
 * 严格契合托尔原生 13 个 Morph 测绘数据：
 * 口角下げ = 微笑上扬, 口角上げ = 紧绷下沉, ウィンク２ = 俏皮单眼
 * =========================================================================
 */
export const TOHRU_EXPRESSION_PROFILES = {
  emotions: {
    // 平静 (neutral): 常态女仆温和微扬嘴角，告别僵死面瘫
    'neutral': {
      '口角下げ': 0.18
    },
    // 喜 (happy): 双眼弯弯月牙笑眼 + 甜美微扬大笑容 (狂爱小林)
    'happy': {
      '笑い': 0.85,
      '口角下げ': 0.85
    },
    // 怒 (angry): 倒八字威严怒眉 + 嘴角紧绷下沉凝视 (龙威威慑)
    'angry': {
      '怒り': 0.95,
      '口角上げ': 0.85,
      '真面目': 0.40
    },
    // 哀 (sad): 委屈八字下垂眉 + 嘴角深撇可怜巴巴 (尾巴肉被拒绝)
    'sad': {
      '困る': 0.90,
      '口角上げ': 0.85
    },
    // 乐 (relaxed): 单眼俏皮笑眼 Wink (左眼明亮) + 得意微扬嘴角
    'relaxed': {
      'ウィンク２': 0.85,
      '口角下げ': 0.70
    },
    // 惊 (surprised): 圆张嘴倒吸气 + 八字受惊失措眉
    'surprised': {
      'あ': 0.65,
      '困る': 0.60
    }
  },
  actionExpressions: {
    'tohru_love_hug': {
      '笑い': 0.90,
      '口角下げ': 0.95,
      'あ': 0.30
    },
    'tohru_tail_meat': {
      'ウィンク２': 0.85,
      '口角下げ': 0.80,
      'ω': 0.25
    },
    'tohru_dragon_roar': {
      '怒り': 1.0,
      '口角上げ': 0.95,
      '真面目': 0.50
    },
    'tohru_maid_curtsy': {
      '口角下げ': 0.75,
      '笑い': 0.25
    },
    'tohru_happy_bounce': {
      '笑い': 0.90,
      '口角下げ': 0.90,
      'あ': 0.35
    },
    'wave_hand': {
      '口角下げ': 0.85,
      '笑い': 0.40
    },
    'gentle_nod': {
      '口角下げ': 0.50
    },
    'shake_head': {
      '困る': 0.70,
      '口角上げ': 0.75
    },
    'pout_turn': {
      '怒り': 0.70,
      '口角上げ': 0.90
    },
    'pmx_greeting': {
      '口角下げ': 0.80,
      '笑い': 0.30
    },
    'greeting': {
      '口角下げ': 0.80,
      '笑い': 0.30
    },
    'cheerful_bounce': {
      '笑い': 0.90,
      '口角下げ': 0.90,
      'あ': 0.35
    },
    'surprise_jump': {
      'あ': 0.65,
      '困る': 0.60
    },
    'shy_tilt': {
      '口角下げ': 0.70,
      'ウィンク２': 0.50
    }
  }
};

/**
 * 托尔专属动作与表情驱动系统调度类 (TohruMotionSystem)
 * 继承自全局 BasePmxMotionSystem，全局动作切换自动触发原点复位守卫与生命周期管控
 */
export class TohruMotionSystem extends BasePmxMotionSystem {
  constructor(adapter) {
    super(adapter, {
      profile: TOHRU_EXPRESSION_PROFILES,
      ensureClipsFn: ensureTohruMotionClips,
      applyPoseFn: applyTohruNaturalPose,
      defaultMorphNames: [
        '困る', '怒り', '口角上げ', '口角下げ', 'あ', 'ω',
        'まばたき', 'ウィンク', 'ウィンク右', 'ウィンク２', 'ｳｨﾝｸ２右', '真面目', '笑い'
      ]
    });
  }

  resolveMotionAlias(motionName) {
    if (this.activeMotionClips[motionName]) return motionName;
    if (motionName === 'greeting' || motionName === 'pmx_greeting') return 'tohru_maid_curtsy';
    if (motionName === 'cheerful_bounce') return 'tohru_happy_bounce';
    if (motionName === 'shy_tilt') return 'tohru_tail_meat';
    return motionName;
  }
}
