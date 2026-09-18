import * as THREE from 'three';

/**
 * =========================================================================
 * Open-LLM-VTuber: PMX & Blend Dedicated Motion System
 * 目录: D:\\CODEX PROJECT\\Open-LLM-VTuber\\pmx_motion\\index.js
 * 
 * 本模块与 VRM 动作系统完全物理隔离，专为 Blender / PMX 角色打造：
 * 1. 骨骼语义映射 (PMX / MMD / Biped / 3dsMax 兼容)
 * 2. 沉肩垂手自然站姿 (彻底消除 A-Pose 僵硬耸肩与张开)
 * 3. 固化至 mmd.animationPose (杜绝每帧渲染被底层还原回 A-Pose)
 * 4. 专属待机循环 (3.6s 呼吸起伏 + 双臂微晃) 与完整动作设计集
 * =========================================================================
 */

export const PMX_BONE_MAPPING = {
  'head': ['頭', '头', 'Head', 'Bip001 Head', 'head'],
  'neck': ['首', 'Neck', 'Bip001 Neck', 'neck'],
  'chest': ['上半身2', '上半身', 'Chest', 'Bip001 Spine1', 'chest'],
  'spine': ['上半身', 'Spine', 'Bip001 Spine', 'spine'],
  'hips': ['センター', '下半身', 'Hips', 'Center', 'Bip001 Pelvis', 'Bip001'],
  'leftShoulder': ['左肩', 'LeftShoulder', 'Bip001 L Clavicle', 'shoulderP_L', 'leftShoulder'],
  'rightShoulder': ['右肩', 'RightShoulder', 'Bip001 R Clavicle', 'shoulderP_R', 'rightShoulder'],
  'leftUpperArm': ['左腕', 'LeftUpperArm', 'Bip001 L UpperArm', 'BN_Sleeve_L'],
  'rightUpperArm': ['右腕', 'RightUpperArm', 'Bip001 R UpperArm', 'BN_Sleeve_R'],
  'leftLowerArm': ['左ひじ', '左前腕', 'LeftLowerArm', 'Bip001 L Forearm'],
  'rightLowerArm': ['右ひじ', '右前腕', 'RightLowerArm', 'Bip001 R Forearm'],
  'leftHand': ['左手首', '左手', 'LeftHand', 'Bip001 L Hand'],
  'rightHand': ['右手首', '右手', 'RightHand', 'Bip001 R Hand']
};

/**
 * 施加 Blender / PMX 角色的自然垂手站姿 (Natural Rest Pose)
 * 基于 MMD 动捕与解剖学微调数据：
 * - 沉肩：Z 轴微倾 ±0.05 rad，消除斜方肌耸肩紧张感；
 * - 垂臂：从 45° A-Pose 沿 Z 轴进一步下压 0.50~0.55 rad (约 30°~32°)，达到 75°~80° 自然立姿；
 * - 前倾防穿模：X 轴轻微前倾 0.12 rad，给大袖口和裙撑留出安全距离；
 * - 肘部与手腕微屈：呈现柔和放松的少女休止体态。
 */
/**
 * 修复 PMX / Blender 导出模型常见的面部脱臼异常 (Skinning Detachment Fix)
 * 根因排查：
 * 在 Blender / MMD 导出为 PMX 时，许多模型的面部/五官网格（如狂三的材质.002与材质.003）
 * 顶点的骨骼蒙皮权重被错误赋予了根骨骼 (Tokisaki_Skill01_Skip_Finish / Bone 0) 而非头部骨骼 (Head)。
 * 这导致一旦角色头颈旋转，身体与头发转动，但整张脸被死死锚定在世界原点，造成恐怖的面部撕裂分离。
 * 本函数在加载时毫秒级扫描并纠正该蒙皮索引，将面部顶点重新绑定回头部骨骼。
 */
export function repairPmxSkinning(adapter) {
  if (!adapter) return;
  const mesh = adapter.getRootNode() || adapter.mesh;
  if (!mesh || !mesh.skeleton || !mesh.geometry) return;

  const bones = mesh.skeleton.bones;
  const geom = mesh.geometry;
  if (!geom.attributes || !geom.attributes.skinIndex || !geom.attributes.skinWeight) return;

  const head = adapter.resolveBone('head');
  if (!head) return;
  const headIdx = bones.indexOf(head);
  if (headIdx < 0) return;

  const skinIndices = geom.attributes.skinIndex;
  const skinWeights = geom.attributes.skinWeight;
  const indexAttr = geom.index;
  const groups = geom.groups || [];

  let fixedCount = 0;

  // 根骨骼集合 (索引 0 或者是没有父级的根节点)
  const isRootBoneIdx = (idx) => {
    if (idx === 0) return true;
    const b = bones[idx];
    return b && (!b.parent || b.name.toLowerCase().includes('root') || b.name.toLowerCase().includes('finish'));
  };

  // 1. 扫描带有面部表情 MorphTarget (形态键) 的顶点
  const morphPositions = geom.morphAttributes?.position || [];
  const faceVertexIndices = new Set();
  for (const attr of morphPositions) {
    for (let i = 0; i < attr.count; i++) {
      if (Math.abs(attr.getX(i)) > 0.0001 || Math.abs(attr.getY(i)) > 0.0001 || Math.abs(attr.getZ(i)) > 0.0001) {
        faceVertexIndices.add(i);
      }
    }
  }

  for (const vIdx of faceVertexIndices) {
    for (let j = 0; j < 4; j++) {
      const bIdx = skinIndices.getComponent(vIdx, j);
      const w = skinWeights.getComponent(vIdx, j);
      if (w > 0.01 && isRootBoneIdx(bIdx)) {
        skinIndices.setComponent(vIdx, j, headIdx);
        fixedCount++;
      }
    }
  }

  // 2. 扫描材质分组：如果某个材质分组超 70% 顶点绑在根骨骼上，且属于头部零件
  for (const g of groups) {
    let rootBoundCount = 0;
    const count = g.count;
    for (let i = 0; i < count; i++) {
      const vIdx = indexAttr ? indexAttr.getX(g.start + i) : (g.start + i);
      for (let j = 0; j < 4; j++) {
        const bIdx = skinIndices.getComponent(vIdx, j);
        const w = skinWeights.getComponent(vIdx, j);
        if (w > 0.05 && isRootBoneIdx(bIdx)) {
          rootBoundCount++;
          break;
        }
      }
    }
    if (count > 0 && (rootBoundCount / count) > 0.7 && count < 30000) {
      for (let i = 0; i < count; i++) {
        const vIdx = indexAttr ? indexAttr.getX(g.start + i) : (g.start + i);
        for (let j = 0; j < 4; j++) {
          const bIdx = skinIndices.getComponent(vIdx, j);
          if (isRootBoneIdx(bIdx)) {
            skinIndices.setComponent(vIdx, j, headIdx);
            fixedCount++;
          }
        }
      }
    }
  }

  if (fixedCount > 0) {
    skinIndices.needsUpdate = true;
    console.log(`[PmxSkinning] 🔧 成功自动纠正 [${adapter.characterName || 'PMX'}] 的面部骨骼绑定异常 (共重定向 ${fixedCount} 处顶点权重至头部骨骼)`);
  }
}

export function applyNaturalPose(adapter) {
  if (!adapter) return;
  repairPmxSkinning(adapter);

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

  // 2. 上臂自然下垂 (根据模型服饰微调，防穿模)
  const charId = (adapter.characterId || '').toLowerCase();
  const name = (adapter.characterName || '').toLowerCase();
  const isTohru = charId === 'zh_tohru_01' || name.includes('托尔') || name.includes('トール') || name.includes('tohru');
  const isKurumi = charId === 'zh_tokisaki_kurumi_01' || name.includes('狂三') || name.includes('kurumi');

  // 托尔有较大蓬蓬袖与宽裙摆，取 0.50 rad；狂三为哥特灵装，取 0.55 rad
  const armAngleZ = isTohru ? 0.50 : (isKurumi ? 0.55 : 0.54);
  const armAngleX = 0.12;

  if (lArm) lArm.rotation.set(armAngleX, 0.05, -armAngleZ);
  if (rArm) rArm.rotation.set(armAngleX, -0.05, armAngleZ);

  // 3. 肘部自然微屈内敛 (少女休止体态，告别僵硬直立悬挂)
  if (lElbow) lElbow.rotation.set(0.20, 0.12, -0.22);
  if (rElbow) rElbow.rotation.set(0.20, -0.12, 0.22);

  // 4. 手腕顺势微敛放松，指尖自然指向地面偏内侧
  if (lHand) lHand.rotation.set(0.08, 0.0, -0.10);
  if (rHand) rHand.rotation.set(0.08, 0.0, 0.10);

  // 刷新变换并同步到四元数
  for (const b of [lShoulder, rShoulder, lArm, rArm, lElbow, rElbow, lHand, rHand]) {
    if (b) b.updateMatrix();
  }

  const rootMesh = adapter.getRootNode() || adapter.mesh;
  if (rootMesh) rootMesh.updateMatrixWorld(true);

  // 关键固化：同步更新 mmd.animationPose，防止 @moeru/three-mmd 每帧 beforeUpdate 还原回 A-Pose
  if (adapter.mmd && rootMesh && rootMesh.skeleton && rootMesh.skeleton.bones) {
    adapter.mmd.animationPose = rootMesh.skeleton.bones.map((bone) => ({
      position: bone.position.clone(),
      rotation: bone.quaternion.clone()
    }));
  }
}

/**
 * 为 PMX / Blend 角色生成全套专属程序化动作片段 (Clips)
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

  // 1. wave_hand & greeting (轻柔招手问候, 2.7s)
  if (rArm && rElbow && rHand) {
    const tracks = [];
    const tArm = makeQuatTrack(rArm, [0.0, 0.4, 2.3, 2.7], [
      [0, 0, 0], [0.35, -0.20, 0.95], [0.35, -0.20, 0.95], [0, 0, 0]
    ]);
    if (tArm) tracks.push(tArm);

    const tElbow = makeQuatTrack(rElbow, [0.0, 0.4, 2.3, 2.7], [
      [0, 0, 0], [0.55, -0.30, 0.65], [0.55, -0.30, 0.65], [0, 0, 0]
    ]);
    if (tElbow) tracks.push(tElbow);

    const tHand = makeQuatTrack(rHand, [0.0, 0.4, 0.7, 1.0, 1.3, 1.6, 1.9, 2.3, 2.7], [
      [0, 0, 0],
      [0.05, -0.25, 0.20],
      [0.05, 0.25, -0.15],
      [0.05, -0.25, 0.20],
      [0.05, 0.25, -0.15],
      [0.05, -0.25, 0.20],
      [0.05, 0.25, -0.15],
      [0.05, 0, 0],
      [0, 0, 0]
    ]);
    if (tHand) tracks.push(tHand);

    if (head) {
      const tHead = makeQuatTrack(head, [0.0, 0.45, 2.3, 2.7], [
        [0, 0, 0], [-0.04, -0.10, 0.08], [-0.04, -0.10, 0.08], [0, 0, 0]
      ]);
      if (tHead) tracks.push(tHead);
    }

    const waveClip = registerClip('wave_hand', 2.7, tracks);
    targetClipsMap['greeting'] = waveClip;
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

  // 4. cheerful_bounce (雀跃跳跃, 1.5s)
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

  // 5. surprise_jump (受惊后缩, 1.4s)
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
 * 独立的 Blend / PMX 动作管理器类 (BlendMotionSystem)
 */
export class BlendMotionSystem {
  constructor(adapter) {
    this.adapter = adapter;
    this.mesh = adapter.getRootNode() || adapter.mesh;
    this.mixer = null;
    this.activeMotionClips = {};
    this.currentIdleAction = null;
    this.currentMotionAction = null;
    this.currentMotionFinishedHandler = null;
  }

  init() {
    applyNaturalPose(this.adapter);
    this.setupMixer();
  }

  setupMixer() {
    if (this.mixer) {
      this.mixer.stopAllAction();
    }
    this.mixer = new THREE.AnimationMixer(this.mesh);
    this.adapter.mixer = this.mixer;
    window.currentAnimationMixer = this.mixer;

    this.activeMotionClips = {};
    ensureProceduralPmxMotionClips(this.adapter, this.activeMotionClips);
    this.adapter.activeMotionClips = this.activeMotionClips;
    if (window.activeMotionClips) {
      Object.assign(window.activeMotionClips, this.activeMotionClips);
    }

    this.playIdleMotion();
  }

  playIdleMotion() {
    if (!this.mixer) return;
    const clip = this.activeMotionClips['idle'];
    if (!clip) return;

    if (this.currentIdleAction) {
      this.currentIdleAction.stop();
    }
    this.currentIdleAction = this.mixer.clipAction(clip);
    this.currentIdleAction.setLoop(THREE.LoopRepeat);
    this.currentIdleAction.setEffectiveWeight(1.0);
    this.currentIdleAction.fadeIn(0.4).play();
  }

  playMotion(motionName) {
    if (!this.mixer) return false;
    const clip = this.activeMotionClips[motionName];
    if (!clip) {
      console.debug(`[BlendMotion] 动作 ${motionName} 未找到对应动画片段`);
      return false;
    }

    console.log(`[BlendMotion] ▶ 播放 Blend 肢体动作: ${motionName}`);

    if (this.currentMotionAction) {
      if (this.currentMotionFinishedHandler) {
        this.mixer.removeEventListener('finished', this.currentMotionFinishedHandler);
        this.currentMotionFinishedHandler = null;
      }
      this.currentMotionAction.stop();
      this.currentMotionAction = null;
    }

    const action = this.mixer.clipAction(clip);
    action.stop();
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.setEffectiveWeight(1.0);

    if (this.currentIdleAction) {
      action.crossFadeFrom(this.currentIdleAction, 0.25, false);
    } else {
      action.fadeIn(0.25);
    }

    action.play();
    this.currentMotionAction = action;

    const onFinished = (e) => {
      if (e.action !== action) return;
      this.mixer.removeEventListener('finished', onFinished);
      if (this.currentMotionFinishedHandler === onFinished) this.currentMotionFinishedHandler = null;
      if (this.currentMotionAction !== action) return;
      this.currentMotionAction = null;
      action.fadeOut(0.35);
      if (this.currentIdleAction) {
        this.currentIdleAction.reset().setEffectiveWeight(1.0).fadeIn(0.35).play();
      }
    };
    this.currentMotionFinishedHandler = onFinished;
    this.mixer.addEventListener('finished', onFinished);
    return true;
  }

  update(delta, elapsedTime) {
    if (this.adapter && this.adapter.mmd) {
      if (this.mixer) {
        this.adapter.mmd.updateWithMixer(delta, this.mixer);
      } else {
        this.adapter.mmd.update(delta);
      }
    }
  }

  destroy() {
    if (this.mixer) {
      this.mixer.stopAllAction();
      if (this.currentMotionFinishedHandler) {
        this.mixer.removeEventListener('finished', this.currentMotionFinishedHandler);
        this.currentMotionFinishedHandler = null;
      }
      this.mixer = null;
    }
    this.activeMotionClips = {};
    this.currentIdleAction = null;
    this.currentMotionAction = null;
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

  isBlendModel(adapter) {
    if (!adapter) return false;
    const url = (adapter.url || '').toLowerCase();
    const type = (adapter.type || '').toLowerCase();
    const charId = (adapter.characterId || '').toLowerCase();
    const name = (adapter.characterName || '').toLowerCase();

    return type === 'pmx' || type === 'blend' ||
           url.endsWith('.pmx') || url.endsWith('.pmd') || url.endsWith('.blend') ||
           charId === 'zh_tohru_01' || charId === 'zh_tokisaki_kurumi_01' ||
           name.includes('托尔') || name.includes('トール') || name.includes('tohru') ||
           name.includes('狂三') || name.includes('kurumi');
  }

  route(adapter) {
    if (!adapter) return;

    if (this.isBlendModel(adapter)) {
      this.currentModelType = 'blend';
      console.log(`[MotionRouter] 🔄 路由 -> Blend / PMX 独立动作系统 (角色: ${adapter.characterName || 'Unknown'})`);
      this.activeSystem = new BlendMotionSystem(adapter);
      this.activeSystem.init();
    } else {
      this.currentModelType = 'vrm';
      console.log(`[MotionRouter] 🔄 路由 -> VRM 原生动作系统 (角色: ${adapter.characterName || 'Unknown'})`);
      this.activeSystem = null; // 由原有 VRM 脚本自行调度
      if (typeof adapter.setupMotionMixer === 'function') {
        adapter.setupMotionMixer();
      }
    }
  }

  playMotion(name) {
    if (this.currentModelType === 'blend' && this.activeSystem) {
      return this.activeSystem.playMotion(name);
    }
    // VRM 回退至全局原有 playMotion
    if (typeof window.playMotion === 'function') {
      window.playMotion(name);
      return true;
    }
    return false;
  }

  update(delta, elapsedTime) {
    if (this.currentModelType === 'blend' && this.activeSystem) {
      this.activeSystem.update(delta, elapsedTime);
    }
  }

  destroy() {
    if (this.activeSystem) {
      this.activeSystem.destroy();
      this.activeSystem = null;
    }
  }
}

export const motionRouter = new MotionRouter();
