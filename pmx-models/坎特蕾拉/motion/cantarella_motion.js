import * as THREE from 'three';
import { BasePmxMotionSystem } from '../../../pmx_motion/base_motion.js';

/**
 * =========================================================================
 * Open-LLM-VTuber: 坎特蕾拉 (Cantarella) 专属 MMD / PMX 动作驱动系统
 * 路径: pmx-models/坎特蕾拉/motion/cantarella_motion.js
 * 
 * 核心设计原则：
 * 1. 妖媚、魅惑、成熟的人设与身姿：
 *    - 摆脱僵硬直立，塑造挺胸微侧的曼妙 S 曲线；
 *    - 手臂自然下垂贴合修身礼服，肘部与指尖柔和内敛如兰花；
 * 2. 符合人体解剖学与生理连动的「魅惑吐舌·声痕显现」王牌动作：
 *    - 严格遵循六阶段生理时序：
 *      ① 预备期：挑衅扬眉、下眼睑微提魅惑凝视、右手柔美抚颌、躯干微探；
 *      ② 张口拉伸期：双唇横向延展 (口横広げ 0.88)、唇齿自然微启 (い２ 0.50)，为舌头预留解剖空间；
 *      ③ 吐舌向下与声痕共鸣期：舌头顺滑由口中探出并自然下垂 (ぺろっ２ 1.0)，舌面声痕材质金光绽放 (聲痕光 1.0 + Emissive 高光)；
 *      ④ 极值挑逗定格：指尖微动、眼波流转，维持声痕高光展示；
 *      ⑤ 缩舌与邪魅坏笑期：舌头利落收回牙关，嘴唇合拢并拉出极具侵略性的成熟坏笑 (にやり 0.90 + 口角上げ 0.65)；
 *      ⑥ 优雅收势：右手优雅垂落，从容平复至待机；
 * 3. 专属动作套件：
 *    - cantarella_seduce_tongue: 魅惑吐舌·声痕显现 (王牌特写)
 *    - cantarella_graceful_greeting: 成熟曼妙致意 (抚胸微躬)
 *    - cantarella_alluring_whisper: 魅惑邀约低语 (掩唇私语)
 *    - cantarella_poison_tease: 危险毒药挑逗 (戏谑冷艳)
 *    - cantarella_arrogant_turn: 冷艳傲然侧身 (回眸睥睨)
 * =========================================================================
 */

export const CANTARELLA_BONE_MAPPING = {
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
 * 施加坎特蕾拉专属优雅曼妙站姿 (Cantarella S-Curve Rest Pose)
 */
export function applyCantarellaNaturalPose(adapter) {
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

  // 1. 锁骨优雅沉肩
  if (lShoulder) lShoulder.rotation.set(0.0, 0.0, -0.06);
  if (rShoulder) rShoulder.rotation.set(0.0, 0.0, 0.06);

  // 2. 双臂端庄柔和下垂 (沿 Z 轴下压 0.52 rad，大臂自然微前倾 -0.06 rad 防向后反折)
  if (lArm) lArm.rotation.set(-0.06, 0.04, -0.52);
  if (rArm) rArm.rotation.set(-0.06, -0.04, 0.52);

  // 3. 肘部自然向前微屈与优雅微敛 (X 为 -0.16 rad 向前自然微屈，彻底告别反关节向后折)
  if (lElbow) lElbow.rotation.set(-0.16, 0.08, -0.16);
  if (rElbow) rElbow.rotation.set(-0.16, -0.08, 0.16);

  // 4. 手腕与指尖顺势向前微收（兰花指般曼妙，手掌停留在身侧偏前）
  if (lHand) lHand.rotation.set(-0.05, 0.0, -0.06);
  if (rHand) rHand.rotation.set(-0.05, 0.0, 0.06);

  // 5. 脊柱与胸部优雅挺拔中微带曼妙身段
  if (chest) chest.rotation.set(-0.02, 0.0, 0.015);

  // 6. 头部轻微优雅倾侧，从容冷艳
  if (head) head.rotation.set(0.015, -0.02, 0.02);

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
 * 为坎特蕾拉生成全套专属定制程序化动作片段
 */
export function ensureCantarellaMotionClips(adapter, targetClipsMap = {}) {
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

  const quatTrack = (bone, restQuat, times, quats) => {
    if (!bone) return null;
    const values = [];
    for (const q of quats) {
      values.push(...q.clone().multiply(restQuat).toArray());
    }
    return new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values);
  };

  const registerClip = (name, duration, tracks) => {
    const validTracks = tracks.filter(Boolean);
    const clip = new THREE.AnimationClip(name, duration, validTracks);
    clip.userData = { propertyTrack: null };
    targetClipsMap[name] = clip;
    return clip;
  };

  // -------------------------------------------------------------------------
  // 1. 王牌核心动作：cantarella_seduce_tongue (魅惑吐舌·声痕显现, 3.8s)
  // 肢体动势：右手轻盈自下而上抬起至右颌侧/颊边，如魔女施法魅惑微倾身；
  // 头部微敛仰角放电，胸腔微前倾微侧探，极具侵略性与成熟妖娆；最后优雅从容垂手复位。
  // -------------------------------------------------------------------------
  {
    const tracks = [];
    // 胸腔动势：微前倾微向右侧转，亲近镜头
    if (chest) {
      const tChest = makeQuatTrack(chest, 
        [0.0, 0.6, 1.2, 2.2, 2.8, 3.4, 3.8], 
        [
          [0, 0, 0],
          [0.05, 0.04, 0.02],
          [0.07, 0.05, 0.03],
          [0.07, 0.05, 0.03],
          [0.04, 0.02, 0.01],
          [0.01, 0, 0],
          [0, 0, 0]
        ]
      );
      if (tChest) tracks.push(tChest);
    }

    // 头部动势：下巴微敛、眼神由下向上撩人锁定观众，吐舌时头部微仰傲然垂眸
    if (head) {
      const tHead = makeQuatTrack(head,
        [0.0, 0.5, 1.0, 1.6, 2.4, 3.0, 3.5, 3.8],
        [
          [0, 0, 0],
          [0.08, 0.06, -0.04],  // 预备期微颔首撩人
          [0.04, 0.03, -0.02],  // 张口期
          [-0.03, 0.02, 0.01],  // 吐舌声痕展现期：微仰首女王般俯瞰
          [-0.03, 0.02, 0.01],  // 极值定格
          [0.05, 0.04, -0.02],  // 缩舌勾笑期
          [0.01, 0, 0],
          [0, 0, 0]
        ]
      );
      if (tHead) tracks.push(tHead);
    }

    // 右臂动势：从容抬至颌侧，指尖如兰花般衬托面部与唇舌特写
    if (rArm) {
      const tRArm = makeQuatTrack(rArm,
        [0.0, 0.6, 1.2, 2.4, 3.0, 3.5, 3.8],
        [
          [0, 0, 0],
          [-0.25, 0.20, -0.35], // 抬大臂
          [-0.40, 0.28, -0.45], // 托腮侧近
          [-0.40, 0.28, -0.45], // 维持高潮
          [-0.20, 0.15, -0.25], // 开始放下
          [-0.05, 0.04, -0.08],
          [0, 0, 0]
        ]
      );
      if (tRArm) tracks.push(tRArm);
    }

    if (rElbow) {
      const tRElbow = makeQuatTrack(rElbow,
        [0.0, 0.6, 1.2, 2.4, 3.0, 3.5, 3.8],
        [
          [0, 0, 0],
          [0.45, -0.20, 0.35],
          [0.70, -0.30, 0.50],
          [0.70, -0.30, 0.50],
          [0.35, -0.15, 0.25],
          [0.10, -0.05, 0.08],
          [0, 0, 0]
        ]
      );
      if (tRElbow) tracks.push(tRElbow);
    }

    if (rHand) {
      const tRHand = makeQuatTrack(rHand,
        [0.0, 0.6, 1.2, 2.4, 3.0, 3.5, 3.8],
        [
          [0, 0, 0],
          [0.15, 0.10, 0.15],
          [0.25, 0.15, 0.22],
          [0.25, 0.15, 0.22],
          [0.12, 0.08, 0.10],
          [0.04, 0.02, 0.03],
          [0, 0, 0]
        ]
      );
      if (tRHand) tracks.push(tRHand);
    }

    // 左臂微调：身体前倾时左臂顺势自然微摆
    if (lArm) {
      const tLArm = makeQuatTrack(lArm,
        [0.0, 0.8, 2.4, 3.8],
        [
          [0, 0, 0],
          [0.04, 0.02, 0.06],
          [0.04, 0.02, 0.06],
          [0, 0, 0]
        ]
      );
      if (tLArm) tracks.push(tLArm);
    }

    // 重心微动 (センター 骨骼位移)
    if (hips) {
      const tHips = makePosTrack(hips,
        [0.0, 0.7, 2.3, 3.5, 3.8],
        [
          [0, 0, 0],
          [0.01, -0.03, 0.04],
          [0.01, -0.03, 0.04],
          [0.0, -0.01, 0.01],
          [0, 0, 0]
        ]
      );
      if (tHips) tracks.push(tHips);
    }

    registerClip('cantarella_seduce_tongue', 3.8, tracks);
  }

  // -------------------------------------------------------------------------
  // 2. cantarella_graceful_greeting (成熟曼妙致意, 3.4s)
  // 右手轻抚左胸前（端庄华贵），上身微躬侧倾，眼波流转含笑致意
  // -------------------------------------------------------------------------
  {
    const tracks = [];
    if (chest) {
      const tChest = makeQuatTrack(chest,
        [0.0, 0.7, 1.8, 2.8, 3.4],
        [
          [0, 0, 0],
          [0.10, 0.06, -0.03],
          [0.10, 0.06, -0.03],
          [0.03, 0.02, -0.01],
          [0, 0, 0]
        ]
      );
      if (tChest) tracks.push(tChest);
    }
    if (head) {
      const tHead = makeQuatTrack(head,
        [0.0, 0.6, 1.6, 2.7, 3.4],
        [
          [0, 0, 0],
          [0.12, -0.05, 0.04],
          [0.12, -0.05, 0.04],
          [0.03, -0.01, 0.01],
          [0, 0, 0]
        ]
      );
      if (tHead) tracks.push(tHead);
    }
    if (rArm && rElbow && rHand) {
      const tRArm = makeQuatTrack(rArm,
        [0.0, 0.7, 1.8, 2.8, 3.4],
        [
          [0, 0, 0],
          [-0.20, 0.35, -0.25],
          [-0.20, 0.35, -0.25],
          [-0.06, 0.10, -0.08],
          [0, 0, 0]
        ]
      );
      const tRElbow = makeQuatTrack(rElbow,
        [0.0, 0.7, 1.8, 2.8, 3.4],
        [
          [0, 0, 0],
          [0.65, -0.25, 0.35],
          [0.65, -0.25, 0.35],
          [0.20, -0.08, 0.10],
          [0, 0, 0]
        ]
      );
      const tRHand = makeQuatTrack(rHand,
        [0.0, 0.7, 1.8, 2.8, 3.4],
        [
          [0, 0, 0],
          [0.20, 0.10, 0.15],
          [0.20, 0.10, 0.15],
          [0.05, 0.02, 0.04],
          [0, 0, 0]
        ]
      );
      if (tRArm) tracks.push(tRArm);
      if (tRElbow) tracks.push(tRElbow);
      if (tRHand) tracks.push(tRHand);
    }
    if (hips) {
      const tHips = makePosTrack(hips,
        [0.0, 0.7, 1.8, 2.9, 3.4],
        [
          [0, 0, 0],
          [0, -0.06, 0.02],
          [0, -0.06, 0.02],
          [0, -0.02, 0.01],
          [0, 0, 0]
        ]
      );
      if (tHips) tracks.push(tHips);
    }
    registerClip('cantarella_graceful_greeting', 3.4, tracks);
  }

  // -------------------------------------------------------------------------
  // 3. cantarella_alluring_whisper (魅惑邀约低语, 3.2s)
  // 身躯微前探，右手食指轻点朱唇侧方，眼神聚焦撩拨
  // -------------------------------------------------------------------------
  {
    const tracks = [];
    if (chest) {
      const tChest = makeQuatTrack(chest,
        [0.0, 0.6, 1.8, 2.6, 3.2],
        [
          [0, 0, 0],
          [0.08, 0.05, 0.02],
          [0.08, 0.05, 0.02],
          [0.02, 0.01, 0],
          [0, 0, 0]
        ]
      );
      if (tChest) tracks.push(tChest);
    }
    if (head) {
      const tHead = makeQuatTrack(head,
        [0.0, 0.5, 1.7, 2.5, 3.2],
        [
          [0, 0, 0],
          [0.04, -0.08, 0.06],
          [0.04, -0.08, 0.06],
          [0.01, -0.02, 0.01],
          [0, 0, 0]
        ]
      );
      if (tHead) tracks.push(tHead);
    }
    if (rArm && rElbow && rHand) {
      const tRArm = makeQuatTrack(rArm,
        [0.0, 0.6, 1.8, 2.6, 3.2],
        [
          [0, 0, 0],
          [-0.32, 0.22, -0.38],
          [-0.32, 0.22, -0.38],
          [-0.10, 0.06, -0.12],
          [0, 0, 0]
        ]
      );
      const tRElbow = makeQuatTrack(rElbow,
        [0.0, 0.6, 1.8, 2.6, 3.2],
        [
          [0, 0, 0],
          [0.60, -0.22, 0.45],
          [0.60, -0.22, 0.45],
          [0.18, -0.06, 0.12],
          [0, 0, 0]
        ]
      );
      if (tRArm) tracks.push(tRArm);
      if (tRElbow) tracks.push(tRElbow);
    }
    registerClip('cantarella_alluring_whisper', 3.2, tracks);
  }

  // -------------------------------------------------------------------------
  // 4. cantarella_poison_tease (危险毒药挑逗, 3.0s)
  // 优雅侧身甩发，双臂微扬，展现蛇蝎魔女不可捉摸的危险感
  // -------------------------------------------------------------------------
  {
    const tracks = [];
    if (chest) {
      const tChest = makeQuatTrack(chest,
        [0.0, 0.5, 1.6, 2.4, 3.0],
        [
          [0, 0, 0],
          [-0.03, 0.12, 0.04],
          [-0.03, 0.12, 0.04],
          [0, 0.03, 0.01],
          [0, 0, 0]
        ]
      );
      if (tChest) tracks.push(tChest);
    }
    if (head) {
      const tHead = makeQuatTrack(head,
        [0.0, 0.5, 1.6, 2.4, 3.0],
        [
          [0, 0, 0],
          [-0.05, 0.18, -0.04],
          [-0.05, 0.18, -0.04],
          [0, 0.04, -0.01],
          [0, 0, 0]
        ]
      );
      if (tHead) tracks.push(tHead);
    }
    registerClip('cantarella_poison_tease', 3.0, tracks);
  }

  // -------------------------------------------------------------------------
  // 5. cantarella_arrogant_turn (冷艳傲然侧身, 2.4s)
  // 高傲昂起下巴，冷艳回眸
  // -------------------------------------------------------------------------
  {
    const tracks = [];
    if (chest) {
      const tChest = makeQuatTrack(chest,
        [0.0, 0.4, 1.4, 2.0, 2.4],
        [
          [0, 0, 0],
          [0, -0.15, -0.02],
          [0, -0.15, -0.02],
          [0, -0.04, 0],
          [0, 0, 0]
        ]
      );
      if (tChest) tracks.push(tChest);
    }
    if (head) {
      const tHead = makeQuatTrack(head,
        [0.0, 0.4, 1.4, 2.0, 2.4],
        [
          [0, 0, 0],
          [-0.08, -0.24, 0.05],
          [-0.08, -0.24, 0.05],
          [-0.02, -0.06, 0.01],
          [0, 0, 0]
        ]
      );
      if (tHead) tracks.push(tHead);
    }
    registerClip('cantarella_arrogant_turn', 2.4, tracks);
  }

  // -------------------------------------------------------------------------
  // 6. idle (坎特蕾拉专属曼妙呼吸待机, 4.0s)
  // -------------------------------------------------------------------------
  {
    const tracks = [];
    if (chest) {
      const tChest = makeQuatTrack(chest,
        [0.0, 1.0, 2.0, 3.0, 4.0],
        [
          [0, 0, 0],
          [0.012, 0.005, 0.005],
          [0, 0, 0],
          [0.012, 0.005, 0.005],
          [0, 0, 0]
        ]
      );
      if (tChest) tracks.push(tChest);
    }
    if (head) {
      const tHead = makeQuatTrack(head,
        [0.0, 1.0, 2.0, 3.0, 4.0],
        [
          [0, 0, 0],
          [0.006, 0.015, 0.008],
          [0, 0, 0],
          [0.006, -0.015, -0.008],
          [0, 0, 0]
        ]
      );
      if (tHead) tracks.push(tHead);
    }
    if (rArm && lArm) {
      const tRArm = makeQuatTrack(rArm,
        [0.0, 1.0, 2.0, 3.0, 4.0],
        [
          [0, 0, 0],
          [0.004, 0, 0.008],
          [0, 0, 0],
          [0.004, 0, 0.008],
          [0, 0, 0]
        ]
      );
      const tLArm = makeQuatTrack(lArm,
        [0.0, 1.0, 2.0, 3.0, 4.0],
        [
          [0, 0, 0],
          [0.004, 0, -0.008],
          [0, 0, 0],
          [0.004, 0, -0.008],
          [0, 0, 0]
        ]
      );
      if (tRArm) tracks.push(tRArm);
      if (tLArm) tracks.push(tLArm);
    }
    registerClip('idle', 4.0, tracks);
  }

  // -------------------------------------------------------------------------
  // 兼容通用动作（赞同点头、轻轻摇头、轻柔招手、通用全身致意）
  // -------------------------------------------------------------------------
  if (head) {
    // gentle_nod (优雅轻颔首, 1.8s)
    const tracks = [];
    const tHead = makeQuatTrack(head, [0.0, 0.35, 0.7, 1.1, 1.5, 1.8], [
      [0, 0, 0], [0.09, -0.02, 0.01], [0, 0, 0], [0.06, -0.01, 0.01], [0, 0, 0], [0, 0, 0]
    ]);
    if (tHead) tracks.push(tHead);
    if (chest) {
      const tChest = makeQuatTrack(chest, [0.0, 0.35, 0.7, 1.8], [
        [0, 0, 0], [0.025, 0, 0], [0, 0, 0], [0, 0, 0]
      ]);
      if (tChest) tracks.push(tChest);
    }
    registerClip('gentle_nod', 1.8, tracks);

    // shake_head (冷艳微摇头, 1.8s)
    const tracksShake = [];
    const tHeadShake = makeQuatTrack(head, [0.0, 0.3, 0.7, 1.1, 1.5, 1.8], [
      [0, 0, 0], [-0.02, 0.16, -0.02], [-0.02, -0.16, 0.02], [-0.01, 0.10, -0.01], [-0.01, -0.06, 0.01], [0, 0, 0]
    ]);
    if (tHeadShake) tracksShake.push(tHeadShake);
    registerClip('shake_head', 1.8, tracksShake);
  }

  // 映射别名确保各处调用无缝兼容
  if (targetClipsMap['cantarella_graceful_greeting']) {
    targetClipsMap['pmx_greeting'] = targetClipsMap['cantarella_graceful_greeting'];
    targetClipsMap['greeting'] = targetClipsMap['cantarella_graceful_greeting'];
  }
  if (targetClipsMap['cantarella_alluring_whisper']) {
    targetClipsMap['wave_hand'] = targetClipsMap['cantarella_alluring_whisper'];
  }

  return targetClipsMap;
}

/**
 * 坎特蕾拉人设专属表情配方字典 (Cantarella Persona Profiles)
 */
export const CANTARELLA_EXPRESSION_PROFILES = {
  emotions: {
    // 喜：优雅从容的成熟媚笑，下眼睑微提，眼波盈盈
    'happy': {
      '笑い': 0.65,
      'にやり': 0.55,
      '下眼上': 0.50,
      '口角上げ': 0.60
    },
    // 怒：高傲施压、冷艳蔑视
    'angry': {
      '怒り': 0.85,
      'ジト目': 0.85,
      '挑発する': 0.65,
      '口角下げ': 0.50
    },
    // 哀：慵懒微怨、若有所思
    'sad': {
      '困る': 0.65,
      'じと目': 0.50,
      '口角下げ': 0.40
    },
    // 乐：玩味戏谑、单眼微眨撩逗
    'relaxed': {
      'ウィンク右': 0.75,
      '挑発する': 0.75,
      'にやり': 0.80,
      '下眼上': 0.45
    },
    // 惊：成熟女人的假意惊讶，微敛双眸而非慌乱
    'surprised': {
      'びっくり': 0.55,
      'あ３': 0.35,
      '下眼上': 0.30
    },
    // 平：从容不迫的冷艳贵妇常态（微带媚态基调）
    'neutral': {
      '下眼上': 0.15,
      'にやり': 0.10
    }
  },
  actionExpressions: {
    'cantarella_graceful_greeting': {
      '笑い': 0.45,
      '口角上げ': 0.42,
      '下眼上': 0.35,
      '目下': 0.20
    },
    'cantarella_alluring_whisper': {
      'ジト目': 0.35,
      '下眼上': 0.40,
      '目下': 0.25,
      '挑発する': 0.18,
      'にやり': 0.32,
      '口角上げ': 0.35
    },
    'cantarella_poison_tease': {
      'ジト目': 0.45,
      '下眼上': 0.45,
      '目下': 0.35,
      '挑発する': 0.20,
      'にやり': 0.38,
      '口角上げ': 0.30
    },
    'cantarella_arrogant_turn': {
      'ジト目': 0.50,
      '下眼上': 0.35,
      '目下': 0.30,
      '挑発する': 0.20,
      '口角下げ': 0.15
    },
    'gentle_nod': {
      '笑い': 0.40,
      '口角上げ': 0.35
    },
    'shake_head': {
      'ジト目': 0.35,
      '口角下げ': 0.20
    }
  }
};

/**
 * 坎特蕾拉专属动作与表情驱动调度系统类 (CantarellaMotionSystem)
 * 继承自全局 BasePmxMotionSystem，全局动作切换自动触发原点复位守卫与生命周期管控
 */
export class CantarellaMotionSystem extends BasePmxMotionSystem {
  constructor(adapter) {
    super(adapter, {
      profile: CANTARELLA_EXPRESSION_PROFILES,
      ensureClipsFn: ensureCantarellaMotionClips,
      applyPoseFn: applyCantarellaNaturalPose,
      defaultMorphNames: [
        'まばたき', 'ウィンク', 'ウィンク右', '笑い', 'びっくり', '怒り', '困る',
        'ジト目', 'じと目', '下眼上', '目下', '挑発する', '挑発する右',
        'あ', 'あ２', 'あ３', 'い', 'い２', 'い３', 'お',
        'にやり', 'にやり２', '口角上げ', '口角下げ', '口角下げ２',
        '口横広げ', '口横狭め', 'ぺろっ', 'ぺろっ２', '聲痕光', '聲痕消'
      ]
    });

    this.voiceMarkMaterial = null;
    this.voiceMarkOrigEmissive = null;
    this.initVoiceMarkMaterial();
  }

  initVoiceMarkMaterial() {
    if (!this.mesh) return;
    const mats = Array.isArray(this.mesh.material) ? this.mesh.material : [this.mesh.material];
    // 材质 11 为声痕材质，或按名称寻找
    if (mats[11]) {
      this.voiceMarkMaterial = mats[11];
    } else {
      for (const m of mats) {
        if (m && m.name && (m.name.includes('声') || m.name.includes('痕') || m.name.includes('mark') || m.name.includes('tacet'))) {
          this.voiceMarkMaterial = m;
          break;
        }
      }
    }
    if (this.voiceMarkMaterial && this.voiceMarkMaterial.emissive) {
      this.voiceMarkOrigEmissive = this.voiceMarkMaterial.emissive.clone();
    }
  }

  resolveMotionAlias(motionName) {
    if (this.activeMotionClips[motionName]) return motionName;
    if (motionName === 'greeting' || motionName === 'pmx_greeting') return 'cantarella_graceful_greeting';
    if (motionName === 'wave_hand') return 'cantarella_alluring_whisper';
    return motionName;
  }

  resetExpressions(immediate = true) {
    super.resetExpressions(immediate);
    if (this.voiceMarkMaterial && this.voiceMarkMaterial.emissive && this.voiceMarkOrigEmissive) {
      this.voiceMarkMaterial.emissive.copy(this.voiceMarkOrigEmissive);
    }
  }

  updateFacialExpressions(delta) {
    this.updateFacialAndVoiceMark(delta);
  }

  /**
   * 核心生理连动更新：唇舌运动、声痕发光、眼波与表情插值
   */
  updateFacialAndVoiceMark(delta) {
    if (!this.mesh || !this.mesh.morphTargetDictionary || !this.mesh.morphTargetInfluences) return;
    const dict = this.mesh.morphTargetDictionary;
    const influences = this.mesh.morphTargetInfluences;

    const targetWeights = {};

    // ★ 关键防护：动作专属表情与基准情绪绝对互斥！
    if (this.activeActionExpression) {
      for (const [mName, w] of Object.entries(this.activeActionExpression)) {
        targetWeights[mName] = w;
      }
    } else {
      const baseTargets = this.profile.emotions?.[this.currentBaseEmotion] ||
                          this.profile.emotions?.['neutral'] || {};
      for (const [mName, w] of Object.entries(baseTargets)) {
        targetWeights[mName] = w * this.baseEmotionWeight;
      }
    }

    let voiceMarkGlow = 0.0;

    // 3. 王牌动作【cantarella_seduce_tongue】的六阶段生理时序高阶精确控制
    if (this.currentMotionName === 'cantarella_seduce_tongue' && this.currentMotionAction) {
      const t = this.currentMotionTime;

      // 阶段 1: [0.0s - 0.5s] 预备期：冷艳垂眸微眯、眉形从容平舒、下眼睑微提魅惑凝视、视线渐下沉俯视
      if (t < 0.5) {
        const p = t / 0.5;
        const ease = p * p * (3 - 2 * p);
        targetWeights['ジト目'] = 0.25 + ease * 0.15;   // 0.25 -> 0.40 沉静半垂眸
        targetWeights['下眼上'] = 0.25 + ease * 0.17;   // 0.25 -> 0.42 魅惑眼波微抬
        targetWeights['目下'] = ease * 0.30;             // 视线下移，高贵俯瞰
        targetWeights['挑発する'] = ease * 0.16;         // 0.0 -> 0.16 极其优雅自然的微挑眉，绝无夸张吊眉
        targetWeights['にやり'] = 0.15 + ease * 0.15;   // 0.15 -> 0.30 似笑非笑从容浅笑
        targetWeights['口横広げ'] = 0.0;
        targetWeights['い２'] = 0.0;
        targetWeights['ぺろっ'] = 0.0;
        targetWeights['ぺろっ２'] = 0.0;
        voiceMarkGlow = 0.0;
      }
      // 阶段 2: [0.5s - 1.0s] 朱唇微启：双唇优雅自然横向微展、牙关娇艳微张（符合人体解剖规律，为舌尖探出预留空间）
      else if (t >= 0.5 && t < 1.0) {
        const p = (t - 0.5) / 0.5;
        const ease = p * p * (3 - 2 * p);
        targetWeights['ジト目'] = 0.40;
        targetWeights['下眼上'] = 0.42;
        targetWeights['目下'] = 0.30;
        targetWeights['挑発する'] = 0.16;
        targetWeights['にやり'] = 0.30 * (1.0 - ease); // 微张口时平滑过渡
        targetWeights['口横広げ'] = ease * 0.28;       // 优雅微展 0.28
        targetWeights['い２'] = ease * 0.30;           // 唇齿微启 0.30
        targetWeights['ぺろっ'] = 0.0;
        targetWeights['ぺろっ２'] = 0.0;
        voiceMarkGlow = 0.0;
      }
      // 阶段 3: [1.0s - 2.2s] 舌尖优雅平顺探出，声痕华丽共鸣发光（彻底杜绝下唇穿模，舌面声痕清晰展露）
      else if (t >= 1.0 && t < 2.2) {
        const pTongue = Math.min(1.0, (t - 1.0) / 0.4); // 0.4s 内顺滑探出
        const easeTongue = pTongue * pTongue * (3 - 2 * pTongue);
        const pGlow = Math.min(1.0, Math.max(0.0, (t - 1.2) / 0.4)); // 舌尖探出后声痕亮起

        targetWeights['口横広げ'] = 0.28;
        targetWeights['い２'] = 0.30;
        targetWeights['ぺろっ'] = easeTongue * 0.85;   // 0.85 优雅探出于上下唇之间，彻底消除下唇穿模
        targetWeights['ぺろっ２'] = 0.0;
        targetWeights['聲痕光'] = pGlow * 1.0;
        targetWeights['ジト目'] = 0.40;                 // 双眼对称冷艳垂眸
        targetWeights['下眼上'] = 0.42;                 // 眼眸深邃妩媚
        targetWeights['目下'] = 0.30;                   // 居高临下女王俯视
        targetWeights['挑発する'] = 0.16;               // 贵妇沉着微挑眉
        voiceMarkGlow = pGlow;
      }
      // 阶段 4: [2.2s - 2.7s] 极值定格展示：维持舌面声痕金色高光与冷艳神情
      else if (t >= 2.2 && t < 2.7) {
        targetWeights['口横広げ'] = 0.28;
        targetWeights['い２'] = 0.30;
        targetWeights['ぺろっ'] = 0.85;
        targetWeights['ぺろっ２'] = 0.0;
        targetWeights['聲痕光'] = 1.0;
        targetWeights['ジト目'] = 0.40;
        targetWeights['下眼上'] = 0.42;
        targetWeights['目下'] = 0.30;
        targetWeights['挑発する'] = 0.16;
        voiceMarkGlow = 1.0;
      }
      // 阶段 5: [2.7s - 3.3s] 舌尖柔顺缩回，双唇合拢，嘴角扬起深邃神秘的从容浅笑
      else if (t >= 2.7 && t < 3.3) {
        const pRetract = (t - 2.7) / 0.6;
        const easeRetract = pRetract * pRetract * (3 - 2 * pRetract);
        targetWeights['ぺろっ'] = (1.0 - easeRetract) * 0.85; // 柔顺缩回牙关内
        targetWeights['ぺろっ２'] = 0.0;
        targetWeights['聲痕光'] = (1.0 - easeRetract) * 1.0;
        targetWeights['い２'] = (1.0 - easeRetract) * 0.30;     // 唇齿合拢
        targetWeights['口横広げ'] = (1.0 - easeRetract) * 0.28;
        // 转为成熟典雅的从容浅笑
        targetWeights['にやり'] = easeRetract * 0.38;          // 0.38 克制坏笑
        targetWeights['口角上げ'] = easeRetract * 0.42;        // 嘴角微翘
        targetWeights['ジト目'] = 0.38;
        targetWeights['下眼上'] = 0.40;
        targetWeights['目下'] = (1.0 - easeRetract) * 0.30 + 0.10;
        targetWeights['挑発する'] = 0.15;
        voiceMarkGlow = (1.0 - easeRetract);
      }
      // 阶段 6: [3.3s - 3.8s] 从容定韵，平复回归优雅站姿
      else {
        const pSettle = (t - 3.3) / 0.5;
        const easeSettle = pSettle * pSettle * (3 - 2 * pSettle);
        targetWeights['にやり'] = (1.0 - easeSettle) * 0.38;
        targetWeights['口角上げ'] = (1.0 - easeSettle) * 0.42;
        targetWeights['ジト目'] = (1.0 - easeSettle) * 0.38;
        targetWeights['下眼上'] = (1.0 - easeSettle) * 0.40;
        targetWeights['目下'] = (1.0 - easeSettle) * 0.10;
        targetWeights['挑発する'] = (1.0 - easeSettle) * 0.15;
        voiceMarkGlow = 0.0;
      }
    }

    // 4. 驱动材质 11 声痕自发光 (Emissive Glow)
    if (this.voiceMarkMaterial && this.voiceMarkMaterial.emissive) {
      if (voiceMarkGlow > 0.01) {
        this.voiceMarkMaterial.emissive.setRGB(
          1.0 * voiceMarkGlow,
          0.85 * voiceMarkGlow,
          0.4 * voiceMarkGlow
        );
        if (this.voiceMarkMaterial.emissiveIntensity !== undefined) {
          this.voiceMarkMaterial.emissiveIntensity = 2.0 * voiceMarkGlow;
        }
        this.voiceMarkMaterial.needsUpdate = true;
      } else if (this.voiceMarkOrigEmissive) {
        this.voiceMarkMaterial.emissive.copy(this.voiceMarkOrigEmissive);
        if (this.voiceMarkMaterial.emissiveIntensity !== undefined) {
          this.voiceMarkMaterial.emissiveIntensity = 0.0;
        }
      }
    }

    // 5. 毫秒级阻尼插值更新形态键
    const speed = 14.0;
    for (const mName of this.controlledMorphNames) {
      const idx = dict[mName];
      if (idx === undefined) continue;

      if (window.isPlayingAudio && (mName === 'あ' || mName === '口_あ')) {
        continue;
      }

      const target = targetWeights[mName] || 0.0;
      const current = this.currentMorphWeights[mName] || 0.0;
      const next = THREE.MathUtils.damp(current, target, speed, delta);
      this.currentMorphWeights[mName] = next;
      influences[idx] = next;
    }
  }
}
