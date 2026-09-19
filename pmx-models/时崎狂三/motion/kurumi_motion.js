import * as THREE from 'three';
import { BasePmxMotionSystem } from '../../../pmx_motion/base_motion.js';

/**
 * =========================================================================
 * Open-LLM-VTuber: 时崎狂三 (Tokisaki Kurumi) 专属 MMD / PMX 动作与魅惑表情驱动系统
 * 路径: pmx-models/时崎狂三/motion/kurumi_motion.js
 * 
 * 核心设计原则：
 * 1. 狂气、魅惑、优雅的哥特萝莉大小姐人设：
 *    - 姿态端庄而暗藏曼妙魔女风范，手臂沿哥特灵装自然下垂内敛；
 *    - 动作融合经典 MMD 舞台仪态与狂三原作招牌动作：提裙礼、掩唇轻笑“うふふ…”、
 *      招牌指枪放电“Bang~”、撩发回眸等；
 * 2. 专属精细魅惑表情系统：
 *    - 深度绑定狂三全部 27 个形态键（Reye_close, Leye_close, Reye_close_smile,
 *      Leye_close_smile, Eye_angry, Eye_sorrow, Eye_SP01~SP05, Mouth_smile,
 *      Mouth_angry, Mouth_SP01~SP04, Eyebrow_SP01~SP06 等）；
 *    - 招牌 Wink 闭合右眼，完美展露左眼金色时钟之瞳与眼底罗马数字；
 *    - 彻底杜绝 Mouth_SP02 等违背人体解剖物理结构的大圆形嘴畸变；
 *    - 微笑与露齿浅笑（Mouth_smile + Mouth_SP03）呈现极致魅惑与大小姐气质；
 * 3. 毫秒级阻尼插值与音频口型防冲突保护。
 * =========================================================================
 */

export const KURUMI_BONE_MAPPING = {
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
 * 施加狂三专属哥特大小姐优雅站姿 (Kurumi Gothic Rest Pose)
 */
export function applyKurumiNaturalPose(adapter) {
  if (!adapter) return;

  const lShoulder = adapter.resolveBone('leftShoulder');
  const rShoulder = adapter.resolveBone('rightShoulder');
  const lArm = adapter.resolveBone('leftUpperArm');
  const rArm = adapter.resolveBone('rightUpperArm');
  const lElbow = adapter.resolveBone('leftLowerArm');
  const rElbow = adapter.resolveBone('rightLowerArm');
  const lHand = adapter.resolveBone('leftHand');
  const rHand = adapter.resolveBone('rightHand');
  const chest = adapter.resolveBone('chest');
  const head = adapter.resolveBone('head');

  // 1. 锁骨微沉肩放松，显露颈部与锁骨优雅线条
  if (lShoulder) lShoulder.rotation.set(0.0, 0.0, -0.05);
  if (rShoulder) rShoulder.rotation.set(0.0, 0.0, 0.05);

  // 2. 双臂端庄柔和下垂贴合灵装裙撑 (沿 Z 轴下垂 0.50 rad，微前倾 -0.06 rad 防向后反撇)
  if (lArm) lArm.rotation.set(-0.06, 0.04, -0.50);
  if (rArm) rArm.rotation.set(-0.06, -0.04, 0.50);

  // 3. 肘部自然向前微屈内敛 (X 为 -0.16 rad 向前自然微屈)
  if (lElbow) lElbow.rotation.set(-0.16, 0.06, -0.16);
  if (rElbow) rElbow.rotation.set(-0.16, -0.06, 0.16);

  // 4. 手腕与指尖顺势向前微敛放松，指尖朝下偏身前
  if (lHand) lHand.rotation.set(-0.05, 0.0, -0.06);
  if (rHand) rHand.rotation.set(-0.05, 0.0, 0.06);

  // 5. 脊柱胸腔微挺，保持哥特礼服挺拔
  if (chest) chest.rotation.set(0.015, 0.0, 0.0);

  // 6. 头部下颌微颔，目光沉静正对前方
  if (head) head.rotation.set(0.02, 0.0, 0.0);

  for (const b of [lShoulder, rShoulder, lArm, rArm, lElbow, rElbow, lHand, rHand, chest, head]) {
    if (b) b.updateMatrix();
  }

  const rootMesh = adapter.getRootNode() || adapter.mesh;
  if (rootMesh) rootMesh.updateMatrixWorld(true);

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
 * 为时崎狂三生成全套专属定制动作片段 (Clips)
 * 动作设计严格基于狂三角色背景与经典 MMD 动作设计，不套用坎特蕾拉动作
 */
export function ensureKurumiMotionClips(adapter, targetClipsMap = {}) {
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

  // 1. kurumi_curtsy (哥特大小姐提裙行礼问候, 3.4s)
  // 双膝微屈(hips重心下沉0.12) + 躯干微躬颔首 + 双手优雅微展提裙摆 + 眼神凝视微笑
  {
    const tracks = [];
    if (hips) {
      const tHips = makePosTrack(hips, [0.0, 0.6, 1.6, 2.6, 3.4], [
        [0, 0, 0],
        [0, -0.12, 0.02],
        [0, -0.12, 0.02],
        [0, -0.04, 0.01],
        [0, 0, 0]
      ]);
      if (tHips) tracks.push(tHips);
    }
    if (chest) {
      const tChest = makeQuatTrack(chest, [0.0, 0.6, 1.6, 2.6, 3.4], [
        [0, 0, 0],
        [0.08, 0, 0],
        [0.08, 0, 0],
        [0.02, 0, 0],
        [0, 0, 0]
      ]);
      if (tChest) tracks.push(tChest);
    }
    if (head) {
      const tHead = makeQuatTrack(head, [0.0, 0.5, 1.4, 2.4, 3.4], [
        [0, 0, 0],
        [0.06, 0, 0],
        [-0.04, 0, 0],
        [-0.02, 0, 0],
        [0, 0, 0]
      ]);
      if (tHead) tracks.push(tHead);
    }
    // 双手微展虚提灵装裙摆
    if (rArm && lArm) {
      const tRArm = makeQuatTrack(rArm, [0.0, 0.6, 1.6, 2.6, 3.4], [
        [0, 0, 0],
        [0.10, -0.05, 0.22],
        [0.10, -0.05, 0.22],
        [0.03, 0, 0.06],
        [0, 0, 0]
      ]);
      const tLArm = makeQuatTrack(lArm, [0.0, 0.6, 1.6, 2.6, 3.4], [
        [0, 0, 0],
        [0.10, 0.05, -0.22],
        [0.10, 0.05, -0.22],
        [0.03, 0, -0.06],
        [0, 0, 0]
      ]);
      if (tRArm) tracks.push(tRArm);
      if (tLArm) tracks.push(tLArm);
    }
    if (rElbow && lElbow) {
      const tRElbow = makeQuatTrack(rElbow, [0.0, 0.6, 1.6, 2.6, 3.4], [
        [0, 0, 0],
        [-0.12, -0.08, 0.15],
        [-0.12, -0.08, 0.15],
        [-0.03, 0, 0.04],
        [0, 0, 0]
      ]);
      const tLElbow = makeQuatTrack(lElbow, [0.0, 0.6, 1.6, 2.6, 3.4], [
        [0, 0, 0],
        [-0.12, 0.08, -0.15],
        [-0.12, 0.08, -0.15],
        [-0.03, 0, -0.04],
        [0, 0, 0]
      ]);
      if (tRElbow) tracks.push(tRElbow);
      if (tLElbow) tracks.push(tLElbow);
    }
    if (rHand && lHand) {
      const tRHand = makeQuatTrack(rHand, [0.0, 0.6, 1.6, 2.6, 3.4], [
        [0, 0, 0],
        [-0.05, 0.08, 0.12],
        [-0.05, 0.08, 0.12],
        [0, 0, 0],
        [0, 0, 0]
      ]);
      const tLHand = makeQuatTrack(lHand, [0.0, 0.6, 1.6, 2.6, 3.4], [
        [0, 0, 0],
        [-0.05, -0.08, -0.12],
        [-0.05, -0.08, -0.12],
        [0, 0, 0],
        [0, 0, 0]
      ]);
      if (tRHand) tracks.push(tRHand);
      if (tLHand) tracks.push(tLHand);
    }

    registerClip('kurumi_curtsy', 3.4, tracks);
    // 兼容通用 greeting / pmx_greeting 路由
    registerClip('pmx_greeting', 3.4, tracks);
    registerClip('greeting', 3.4, tracks);
  }

  // 2. kurumi_tease_whisper (魅惑掩唇轻笑“うふふ…”, 3.0s)
  // 右手柔和抬至唇前微掩 + 指尖轻聚 + 身姿微侧 + 头部微倾 + 胸腔轻颤
  {
    const tracks = [];
    if (rArm) {
      const tRArm = makeQuatTrack(rArm, [0.0, 0.5, 1.8, 2.4, 3.0], [
        [0, 0, 0],
        [0.48, -0.22, 0.52],
        [0.48, -0.22, 0.52],
        [0.15, -0.05, 0.18],
        [0, 0, 0]
      ]);
      if (tRArm) tracks.push(tRArm);
    }
    if (rElbow) {
      const tRElbow = makeQuatTrack(rElbow, [0.0, 0.5, 1.8, 2.4, 3.0], [
        [0, 0, 0],
        [-0.92, -0.35, 0.42],
        [-0.92, -0.35, 0.42],
        [-0.25, -0.10, 0.12],
        [0, 0, 0]
      ]);
      if (tRElbow) tracks.push(tRElbow);
    }
    if (rHand) {
      const tRHand = makeQuatTrack(rHand, [0.0, 0.5, 1.8, 2.4, 3.0], [
        [0, 0, 0],
        [-0.18, 0.25, 0.15],
        [-0.18, 0.25, 0.15],
        [-0.05, 0.08, 0.05],
        [0, 0, 0]
      ]);
      if (tRHand) tracks.push(tRHand);
    }
    if (chest) {
      // 身体微侧与轻颤
      const tChest = makeQuatTrack(chest, [0.0, 0.5, 0.9, 1.2, 1.5, 1.8, 2.4, 3.0], [
        [0, 0, 0],
        [0.02, 0.08, 0.03],
        [0.035, 0.08, 0.03],
        [0.02, 0.08, 0.03],
        [0.035, 0.08, 0.03],
        [0.02, 0.08, 0.03],
        [0.01, 0.03, 0.01],
        [0, 0, 0]
      ]);
      if (tChest) tracks.push(tChest);
    }
    if (head) {
      const tHead = makeQuatTrack(head, [0.0, 0.5, 1.8, 2.4, 3.0], [
        [0, 0, 0],
        [0.04, -0.08, 0.12],
        [0.04, -0.08, 0.12],
        [0.01, -0.02, 0.04],
        [0, 0, 0]
      ]);
      if (tHead) tracks.push(tHead);
    }

    registerClip('kurumi_tease_whisper', 3.0, tracks);
    // 兼容日常招手 wave_hand
    registerClip('wave_hand', 3.0, tracks);
  }

  // 3. kurumi_finger_gun (招牌指枪放电“Bang~”, 2.8s)
  // 右臂平举前伸指向正前方，食指瞄准观众，右眼单眨眼放电，邪魅坏笑定格
  {
    const tracks = [];
    if (rArm) {
      const tRArm = makeQuatTrack(rArm, [0.0, 0.45, 1.8, 2.3, 2.8], [
        [0, 0, 0],
        [0.65, -0.15, 0.40],
        [0.65, -0.15, 0.40],
        [0.20, -0.05, 0.12],
        [0, 0, 0]
      ]);
      if (tRArm) tracks.push(tRArm);
    }
    if (rElbow) {
      const tRElbow = makeQuatTrack(rElbow, [0.0, 0.45, 1.8, 2.3, 2.8], [
        [0, 0, 0],
        [-0.45, -0.12, 0.18],
        [-0.45, -0.12, 0.18],
        [-0.10, -0.02, 0.05],
        [0, 0, 0]
      ]);
      if (tRElbow) tracks.push(tRElbow);
    }
    if (rHand) {
      const tRHand = makeQuatTrack(rHand, [0.0, 0.45, 1.8, 2.3, 2.8], [
        [0, 0, 0],
        [0.08, 0.12, -0.05],
        [0.08, 0.12, -0.05],
        [0, 0, 0],
        [0, 0, 0]
      ]);
      if (tRHand) tracks.push(tRHand);
    }
    if (chest) {
      const tChest = makeQuatTrack(chest, [0.0, 0.45, 1.8, 2.3, 2.8], [
        [0, 0, 0],
        [0.03, 0.10, -0.02],
        [0.03, 0.10, -0.02],
        [0.01, 0.03, 0.0],
        [0, 0, 0]
      ]);
      if (tChest) tracks.push(tChest);
    }
    if (head) {
      const tHead = makeQuatTrack(head, [0.0, 0.45, 1.8, 2.3, 2.8], [
        [0, 0, 0],
        [0.02, -0.06, 0.08],
        [0.02, -0.06, 0.08],
        [0, 0, 0],
        [0, 0, 0]
      ]);
      if (tHead) tracks.push(tHead);
    }

    registerClip('kurumi_finger_gun', 2.8, tracks);
  }

  // 4. kurumi_hair_stroke (慵懒撩发回眸, 3.2s)
  // 左手轻抚耳侧长马尾发丝，头部微倾，眼神魅惑回眸
  {
    const tracks = [];
    if (lArm) {
      const tLArm = makeQuatTrack(lArm, [0.0, 0.55, 1.9, 2.5, 3.2], [
        [0, 0, 0],
        [0.42, 0.18, -0.48],
        [0.42, 0.18, -0.48],
        [0.12, 0.05, -0.15],
        [0, 0, 0]
      ]);
      if (tLArm) tracks.push(tLArm);
    }
    if (lElbow) {
      const tLElbow = makeQuatTrack(lElbow, [0.0, 0.55, 1.9, 2.5, 3.2], [
        [0, 0, 0],
        [-0.88, 0.30, -0.38],
        [-0.88, 0.30, -0.38],
        [-0.22, 0.08, -0.10],
        [0, 0, 0]
      ]);
      if (tLElbow) tracks.push(tLElbow);
    }
    if (lHand) {
      const tLHand = makeQuatTrack(lHand, [0.0, 0.55, 1.9, 2.5, 3.2], [
        [0, 0, 0],
        [-0.12, -0.20, -0.10],
        [-0.12, -0.20, -0.10],
        [0, 0, 0],
        [0, 0, 0]
      ]);
      if (tLHand) tracks.push(tLHand);
    }
    if (head) {
      const tHead = makeQuatTrack(head, [0.0, 0.55, 1.9, 2.5, 3.2], [
        [0, 0, 0],
        [0.05, 0.12, -0.15],
        [0.05, 0.12, -0.15],
        [0.01, 0.03, -0.04],
        [0, 0, 0]
      ]);
      if (tHead) tracks.push(tHead);
    }
    if (chest) {
      const tChest = makeQuatTrack(chest, [0.0, 0.55, 1.9, 2.5, 3.2], [
        [0, 0, 0],
        [0.02, -0.08, -0.03],
        [0.02, -0.08, -0.03],
        [0, 0, 0],
        [0, 0, 0]
      ]);
      if (tChest) tracks.push(tChest);
    }

    registerClip('kurumi_hair_stroke', 3.2, tracks);
    // 兼容 shy_tilt
    registerClip('shy_tilt', 3.2, tracks);
  }

  // 5. gentle_nod (优雅轻颔首, 1.8s)
  if (head) {
    const tracks = [];
    const tHead = makeQuatTrack(head, [0.0, 0.35, 0.7, 1.1, 1.45, 1.8], [
      [0, 0, 0], [0.10, 0, 0], [0, 0, 0], [0.06, 0, 0], [0, 0, 0], [0, 0, 0]
    ]);
    if (tHead) tracks.push(tHead);
    if (chest) {
      const tChest = makeQuatTrack(chest, [0.0, 0.35, 0.7, 1.8], [
        [0, 0, 0], [0.02, 0, 0], [0, 0, 0], [0, 0, 0]
      ]);
      if (tChest) tracks.push(tChest);
    }
    registerClip('gentle_nod', 1.8, tracks);
  }

  // 6. shake_head (戏谑轻摇头, 1.8s)
  if (head) {
    const tracks = [];
    const tHead = makeQuatTrack(head, [0.0, 0.3, 0.7, 1.1, 1.45, 1.8], [
      [0, 0, 0], [0.02, 0.16, -0.02], [0.02, -0.16, 0.02], [0.02, 0.10, -0.01], [0.02, -0.06, 0.01], [0, 0, 0]
    ]);
    if (tHead) tracks.push(tHead);
    if (chest) {
      const tChest = makeQuatTrack(chest, [0.0, 0.7, 1.4, 1.8], [
        [0, 0, 0], [0, -0.03, 0], [0, 0.03, 0], [0, 0, 0]
      ]);
      if (tChest) tracks.push(tChest);
    }
    registerClip('shake_head', 1.8, tracks);
  }

  // 7. kurumi_giggle (狂三式优雅轻颤笑, 2.0s - 替代通用粗暴的跳跃)
  // 躯干与胸腔起伏微颤 + 右手抚胸 + 头部轻晃
  {
    const tracks = [];
    if (chest) {
      const tChest = makeQuatTrack(chest, [0.0, 0.3, 0.6, 0.9, 1.2, 1.5, 2.0], [
        [0, 0, 0],
        [0.03, 0, 0.02],
        [0.01, 0, 0.0],
        [0.03, 0, 0.02],
        [0.01, 0, 0.0],
        [0.02, 0, 0.01],
        [0, 0, 0]
      ]);
      if (tChest) tracks.push(tChest);
    }
    if (rArm) {
      const tRArm = makeQuatTrack(rArm, [0.0, 0.4, 1.4, 2.0], [
        [0, 0, 0],
        [0.22, -0.12, 0.25],
        [0.22, -0.12, 0.25],
        [0, 0, 0]
      ]);
      if (tRArm) tracks.push(tRArm);
    }
    if (rElbow) {
      const tRElbow = makeQuatTrack(rElbow, [0.0, 0.4, 1.4, 2.0], [
        [0, 0, 0],
        [-0.40, -0.15, 0.18],
        [-0.40, -0.15, 0.18],
        [0, 0, 0]
      ]);
      if (tRElbow) tracks.push(tRElbow);
    }
    if (head) {
      const tHead = makeQuatTrack(head, [0.0, 0.3, 0.6, 1.0, 1.5, 2.0], [
        [0, 0, 0],
        [-0.04, 0.02, 0.04],
        [0.02, 0, 0],
        [-0.03, -0.02, -0.03],
        [0.01, 0, 0],
        [0, 0, 0]
      ]);
      if (tHead) tracks.push(tHead);
    }

    registerClip('kurumi_giggle', 2.0, tracks);
    // 兼容 cheerful_bounce
    registerClip('cheerful_bounce', 2.0, tracks);
  }

  // 8. pout_turn (傲娇侧身回眸, 1.8s)
  {
    const tracks = [];
    if (chest) {
      const tChest = makeQuatTrack(chest, [0.0, 0.35, 1.0, 1.4, 1.8], [
        [0, 0, 0], [0.01, 0.16, 0], [0.01, 0.16, 0], [0, 0, 0], [0, 0, 0]
      ]);
      if (tChest) tracks.push(tChest);
    }
    if (head) {
      const tHead = makeQuatTrack(head, [0.0, 0.35, 1.0, 1.4, 1.8], [
        [0, 0, 0], [0.04, 0.28, 0.05], [0.04, 0.28, 0.05], [0, 0, 0], [0, 0, 0]
      ]);
      if (tHead) tracks.push(tHead);
    }
    registerClip('pout_turn', 1.8, tracks);
  }

  // 9. surprise_jump (优雅防备微后移, 1.5s)
  {
    const tracks = [];
    if (hips) {
      const tHips = makePosTrack(hips, [0.0, 0.2, 0.6, 1.0, 1.5], [
        [0, 0, 0], [0, 0.08, -0.15], [0, 0, -0.10], [0, 0, 0], [0, 0, 0]
      ]);
      if (tHips) tracks.push(tHips);
    }
    if (head) {
      const tHead = makeQuatTrack(head, [0.0, 0.2, 0.6, 1.1, 1.5], [
        [0, 0, 0], [-0.08, 0, 0], [-0.08, 0, 0], [0, 0, 0], [0, 0, 0]
      ]);
      if (tHead) tracks.push(tHead);
    }
    registerClip('surprise_jump', 1.5, tracks);
  }

  // 10. idle (待机呼吸微动循环, 3.6s)
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
        [0, 0, 0], [0.008, 0.015, 0.008], [0, 0, 0], [0.008, -0.015, -0.008], [0, 0, 0]
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
 * 时崎狂三专属表情配方系统 (Kurumi Persona Expression Profiles)
 * 严格绑定模型 27 个形态键，坚决排除 Mouth_SP02 等畸变嘴型
 * =========================================================================
 */
export const KURUMI_EXPRESSION_PROFILES = {
  emotions: {
    // 平静 (neutral): 从容神秘的大小姐常态，嘴角微扬浅笑 + 眼眸微含魅意半垂
    'neutral': {
      'Mouth_smile': 0.25,
      'Eye_SP02': 0.15
    },
    // 喜 (happy): 魅惑轻笑（“うふふ…”），优雅甜美微笑 + 露齿微启 + 弯月笑眼微眯
    'happy': {
      'Mouth_smile': 0.85,
      'Mouth_SP03': 0.35,
      'Reye_close_smile': 0.50,
      'Leye_close_smile': 0.50,
      'Eyebrow_SP02': 0.15
    },
    // 怒 (angry): 冷艳狂气怒容，倒八字冷艳怒眉 + 嘴角紧绷冷酷下撇 + 危险视线收拢聚焦
    'angry': {
      'Eye_angry': 0.85,
      'Eyebrow_SP06': 0.60,
      'Mouth_angry': 0.85,
      'Eye_SP02': 0.50
    },
    // 哀 (sad): 假装可怜的撒娇捉弄，八字下垂愁眉 + 朱唇微抿微启 + 眼波柔化
    'sad': {
      'Eye_sorrow': 0.85,
      'Eyebrow_SP04': 0.50,
      'Mouth_SP04': 0.65,
      'Eye_SP02': 0.25
    },
    // 乐 (relaxed): 招牌挑逗 Wink 坏笑，右眼单眨眼(金色时钟眼完整闪耀) + 嘴角挑逗坏笑露齿 + 单侧戏谑扬眉
    'relaxed': {
      'Reye_close_smile': 0.90,
      'Mouth_smile': 0.85,
      'Mouth_SP03': 0.60,
      'Eyebrow_SP03': 0.35
    },
    // 惊 (surprised): 高贵微惊，双眉轻挑微扬 + 贝齿微启轻抽气 + 微汗细节 (严禁任何 Mouth_SP02 圆形嘴)
    'surprised': {
      'Eyebrow_SP05': 0.85,
      'Mouth_SP04': 0.45,
      'Eye_SP03': 0.35
    }
  },
  actionExpressions: {
    'kurumi_curtsy': {
      'Mouth_smile': 0.65,
      'Eye_SP02': 0.25
    },
    'pmx_greeting': {
      'Mouth_smile': 0.65,
      'Eye_SP02': 0.25
    },
    'greeting': {
      'Mouth_smile': 0.65,
      'Eye_SP02': 0.25
    },
    'kurumi_tease_whisper': {
      'Mouth_smile': 0.85,
      'Mouth_SP03': 0.40,
      'Reye_close_smile': 0.45,
      'Leye_close_smile': 0.45
    },
    'wave_hand': {
      'Mouth_smile': 0.85,
      'Mouth_SP03': 0.40,
      'Reye_close_smile': 0.45,
      'Leye_close_smile': 0.45
    },
    'kurumi_finger_gun': {
      'Reye_close_smile': 0.95,
      'Mouth_smile': 0.85,
      'Mouth_SP03': 0.60,
      'Eyebrow_SP03': 0.40
    },
    'kurumi_hair_stroke': {
      'Mouth_smile': 0.45,
      'Eye_SP02': 0.40,
      'Eyebrow_SP02': 0.20
    },
    'shy_tilt': {
      'Mouth_smile': 0.45,
      'Eye_SP02': 0.40,
      'Eyebrow_SP02': 0.20
    },
    'kurumi_giggle': {
      'Mouth_smile': 0.85,
      'Mouth_SP03': 0.35,
      'Reye_close_smile': 0.60,
      'Leye_close_smile': 0.60
    },
    'cheerful_bounce': {
      'Mouth_smile': 0.85,
      'Mouth_SP03': 0.35,
      'Reye_close_smile': 0.60,
      'Leye_close_smile': 0.60
    },
    'pout_turn': {
      'Eye_angry': 0.60,
      'Mouth_angry': 0.60,
      'Eye_SP02': 0.40
    },
    'gentle_nod': {
      'Mouth_smile': 0.45
    },
    'shake_head': {
      'Eye_SP02': 0.30,
      'Mouth_angry': 0.30
    },
    'surprise_jump': {
      'Eyebrow_SP05': 0.65,
      'Mouth_SP04': 0.35
    }
  }
};

/**
 * 时崎狂三专属动作与表情驱动系统调度类 (KurumiMotionSystem)
 * 继承自全局 BasePmxMotionSystem，全局动作切换自动触发原点复位守卫与生命周期管控
 */
export class KurumiMotionSystem extends BasePmxMotionSystem {
  constructor(adapter) {
    super(adapter, {
      profile: KURUMI_EXPRESSION_PROFILES,
      ensureClipsFn: ensureKurumiMotionClips,
      applyPoseFn: applyKurumiNaturalPose,
      defaultMorphNames: [
        'Reye_close', 'Leye_close', 'Reye_close_smile', 'Leye_close_smile',
        'Eye_sorrow', 'Eye_angry', 'Eye_scissors',
        'Eyebrow_SP01', 'Eyebrow_SP02', 'Eyebrow_SP03', 'Eyebrow_SP04', 'Eyebrow_SP05', 'Eyebrow_SP06',
        'Eye_SP01', 'Eye_SP02', 'Eye_SP03', 'Eye_SP04', 'Eye_SP05',
        'Mouth_ah', 'Mouth_ie', 'Mouth_oh', 'Mouth_smile', 'Mouth_angry',
        'Mouth_SP01', 'Mouth_SP03', 'Mouth_SP04'
      ]
    });
  }

  resolveMotionAlias(motionName) {
    if (this.activeMotionClips[motionName]) return motionName;
    if (motionName === 'greeting' || motionName === 'pmx_greeting') return 'kurumi_curtsy';
    if (motionName === 'wave_hand') return 'kurumi_tease_whisper';
    if (motionName === 'cheerful_bounce') return 'kurumi_giggle';
    if (motionName === 'shy_tilt') return 'kurumi_hair_stroke';
    return motionName;
  }
}
