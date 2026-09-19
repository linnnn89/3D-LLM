import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/GLTFLoader.js';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';
import { MMDLoader } from '@moeru/three-mmd';
import {
  PMX_BONE_MAPPING,
  applyNaturalPose as applyPmxNaturalPose,
  ensureProceduralPmxMotionClips,
  applyCantarellaNaturalPose,
  ensureCantarellaMotionClips,
  applyKurumiNaturalPose,
  ensureKurumiMotionClips,
  applyTohruNaturalPose,
  ensureTohruMotionClips,
  motionRouter
} from '/pmx_motion/index.js';

window.THREE = THREE;

// --- Global Scene & Character State ---
let scene, camera, renderer, controls;
let currentAdapter = null;
let currentVrm = null;
let currentModelUrl = null;
let clock = new THREE.Clock();

const CHARACTER_ID_ALIASES = {
  '由比滨结衣': 'zh_yuigahama_yui_01',
  '由比ヶ浜結衣': 'zh_yuigahama_yui_01',
  '雷电将军': 'zh_raiden_shogun_01',
  '雷電将軍': 'zh_raiden_shogun_01',
  '喜多郁代': 'zh_kita_ikuyo_01',
  'Kira': 'zh_kita_ikuyo_01',
  '托尔': 'zh_tohru_01',
  'トール': 'zh_tohru_01',
  'Tohru': 'zh_tohru_01',
  '时崎狂三': 'zh_tokisaki_kurumi_01',
  '時崎狂三': 'zh_tokisaki_kurumi_01',
  '坎特蕾拉（PMX）': 'zh_cantarella_pmx_01',
  '坎特蕾拉(PMX)': 'zh_cantarella_pmx_01',
  'カンタレラ (PMX)': 'zh_cantarella_pmx_01',
  'Cantarella (PMX)': 'zh_cantarella_pmx_01',
  '坎特蕾拉': 'zh_cantarella_01',
  'カンタレラ': 'zh_cantarella_01',
  'Cantarella': 'zh_cantarella_01',
  '弗洛洛': 'zh_phrolova_01',
  'フローヴァ': 'zh_phrolova_01',
  'Phrolova': 'zh_phrolova_01',
};

const CHARACTER_META = {
  'zh_yuigahama_yui_01': {
    id: 'zh_yuigahama_yui_01',
    name: '由比ヶ浜結衣',
    short: '結',
    vrm: '/vrm-models/由比滨结衣/由比滨结衣.vrm',
    greeting: 'やっはろー！あたし由比ヶ浜結衣！今日も元気にいこ？',
    chips: ['奉仕部について教えて', 'ヒッキーってどんな人？', 'サブレの話を聞かせて', '今日の予定は何？']
  },
  'zh_raiden_shogun_01': {
    id: 'zh_raiden_shogun_01',
    name: '雷電将軍',
    short: '影',
    vrm: '/vrm-models/雷电将军/雷电将军.vrm',
    greeting: '浮世の諸行、すべては永遠への塵芥にすぎぬ。……我を呼んだのはそなたか？',
    chips: ['稲妻の永遠とは？', '団子牛乳はお好きですか？', '料理は得意ですか？', '一心浄土について']
  },
  'zh_kita_ikuyo_01': {
    id: 'zh_kita_ikuyo_01',
    name: '喜多郁代',
    short: '喜',
    vrm: '/vrm-models/喜多郁代/喜多郁代.vrm',
    greeting: 'こんにちは！結束バンドのギターボーカル、喜多郁代です！今日も元気にいきましょーっ！',
    chips: ['結束バンドについて教えて', 'ひとりちゃんは元気？', 'キタオーラ発射〜！✨', '今日の予定は何？']
  },
  'zh_tohru_01': {
    id: 'zh_tohru_01',
    name: 'トール',
    short: '竜',
    pmx: '/pmx-models/托尔/Tohru_v1.0.pmx',
    greeting: '小林さーん！お帰りなさいませ！今日も世界で一番愛してますよっ！',
    chips: ['小林さんについて教えて！', '特製尻尾肉はいかがですか？', 'ドラゴンの世界のお话', '今日の家事は何にする？']
  },
  'zh_tokisaki_kurumi_01': {
    id: 'zh_tokisaki_kurumi_01',
    name: '時崎狂三',
    short: '狂',
    pmx: '/pmx-models/时崎狂三/时崎狂三.pmx',
    greeting: 'うふふ……ごきげんよう、可愛いお方。そんなに熱い目で見つめて……わたくしに何を求めていらっしゃいますの？',
    chips: ['👗 优雅提裙行礼', '💋 掩唇低语 (うふふ…)', '🎯 招牌指枪 (Bang~)', '🖤 撩发回眸']
  },
  'zh_cantarella_01': {
    id: 'zh_cantarella_01',
    name: 'カンタレラ',
    short: '蕾',
    vrm: '/vrm-models/坎特蕾拉/坎特蕾拉.vrm',
    greeting: 'ごきげんよう、私の可愛い漂泊者。貴方が来てくれるのを待っていましたわ。',
    chips: ['フィサリアについて教えて', 'その毒はどんな味？', '居城のお話を聞かせて', '一緒に散歩しましょう']
  },
  'zh_cantarella_pmx_01': {
    id: 'zh_cantarella_pmx_01',
    name: 'カンタレラ (PMX)',
    short: '蕾',
    pmx: '/pmx-models/坎特蕾拉/坎特蕾拉.pmx',
    greeting: 'ごきげんよう、私の可愛い漂泊者。貴方が来てくれるのを待っていましたわ。',
    chips: ['💜 魅惑吐舌 (声痕显现)', '🍷 优雅致意', '🥀 毒药的滋味', '💋 亲密邀约']
  },
  'zh_phrolova_01': {
    id: 'zh_phrolova_01',
    name: 'フローヴァ',
    short: '洛',
    vrm: '/vrm-models/弗洛洛/弗洛洛.vrm',
    greeting: '私が残星組織の監察だからといって、過剰に警戒する必要はないわ。さあ一緒に、この誰もが望む完璧なコンサートを仕上げましょう。',
    chips: ['残星組織について教えて', 'リコリスの花言葉は？', 'ヘカテーを呼んで', '調律を始めましょう']
  }
};

// Audio Context & Analyser
let audioContext = null;
let analyserNode = null;
let gainNode = null;
let currentAudioSource = null;
let audioQueue = [];
let isPlayingAudio = false;
try {
  Object.defineProperty(window, 'isPlayingAudio', {
    get() { return isPlayingAudio; },
    set(val) { isPlayingAudio = val; },
    configurable: true
  });
} catch (e) {
  window.isPlayingAudio = false;
}
let mouthOpen = 0.0;
let blinkTimer = 0.0;
let nextBlinkTime = 3.0;
let isBlinking = false;
let blinkProgress = 0.0;
const BLINK_DURATION = 0.16;
let currentEmotionHeadPitch = 0.0;
let interactionResetTimeout = null;
let lastInteractionTime = 0;
const CLICK_COOLDOWN_MS = 500;
const AUTO_GREETING_ON_LOAD = true; // 模型与官方动作就绪后自动播放一次打招呼动作
const clickRaycaster = new THREE.Raycaster();
const clickMouse = new THREE.Vector2();

// --- VRMA Motion System State ---
let currentAnimationMixer = null;
let currentIdleAction = null;
let currentMotionAction = null;
let currentMotionFinishedHandler = null;
const loadedVrmAnimations = {}; // 缓存解析后的原始 VRMAnimation 数据
const activeMotionClips = {};   // 绑定到当前角色骨骼上的 THREE.AnimationClip

// 外部 .vrma 动作清单：文件存在则优先使用官方动捕，缺失时由程序化骨骼曲线保底。
// 资源目录挂在 /vrm 下，故使用相对路径。
const MOTION_URLS = {
  'idle': './motions/idle_loop.vrma',           // Pixiv/ChatVRM 官方待机循环
  'greeting': './motions/greeting.vrma',        // Pixiv VRoid Project 官方动捕 (BOOTH 免费包)
  'VRMA_01': './motions/VRMA_01.vrma',          // 官方包原始文件 (与 greeting 同源)
  'wave_hand': './motions/wave_hand.vrma',      // 缺省时走程序化
  'shake_head': './motions/shake_head.vrma',
  'gentle_nod': './motions/gentle_nod.vrma',
  'cheerful_bounce': './motions/cheerful_bounce.vrma',
  'shy_tilt': './motions/shy_tilt.vrma',
  'surprise_jump': './motions/surprise_jump.vrma',
  'pout_turn': './motions/pout_turn.vrma'
};


// WebSocket
let ws = null;
let heartbeatInterval = null;
let isRecording = false;
let mediaStream = null;
let micAudioContext = null;

// UI Elements
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const dialogueBubble = document.getElementById('dialogue-bubble');
const bubbleSender = document.getElementById('bubble-sender');
const bubbleText = document.getElementById('bubble-text');
const userTranscript = document.getElementById('user-transcript');
const textInput = document.getElementById('text-input');
const btnSend = document.getElementById('btn-send');
const btnMic = document.getElementById('btn-mic');
const btnInterrupt = document.getElementById('btn-interrupt');
const btnResetCam = document.getElementById('btn-reset-cam');
const configSelect = document.getElementById('config-select');
const loadingScreen = document.getElementById('loading-screen');
const loadingStatus = document.getElementById('loading-status');

// --- 1. Three.js Scene Initialization ---
function initScene() {
  const container = document.getElementById('canvas-container');
  const width = container.clientWidth;
  const height = container.clientHeight;

  scene = new THREE.Scene();
  window.scene = scene;

  // Camera: FOV 30 provides an appealing anime portrait focal length without wide-angle distortion
  camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 20);
  camera.position.set(0, 1.36, 1.25);

  // Renderer
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance'
  });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // MToon 是卡通着色，贴图颜色本身即最终风格化结果。电影级色调映射会压缩浅色贴图的对比度，
  // 把脸部与五官细节一并洗成白色（three-vrm 官方示例同样不使用 tone mapping）。
  renderer.toneMapping = THREE.NoToneMapping;
  container.appendChild(renderer.domElement);

  // OrbitControls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.30, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxPolarAngle = Math.PI / 2 + 0.1;
  window.camera = camera;
  window.controls = controls;
  window.renderer = renderer;

  // Lighting tailored for MToon cel-shading:
  // MToon 的明暗是二阶跃函数，光照过强会让模型处处落在亮部、失去层次而显得发白，
  // 因此总量控制在 ~2.4（原先 4.4 会明显过曝，尤其是浅色贴图模型）。
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambientLight);

  const mainLight = new THREE.DirectionalLight(0xfff7ed, 1.2);
  mainLight.position.set(0.8, 2.2, 2.0).normalize();
  scene.add(mainLight);

  const fillLight = new THREE.DirectionalLight(0xebe4ff, 0.45);
  fillLight.position.set(-1.2, 1.8, 1.5).normalize();
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xffd6e0, 0.35);
  rimLight.position.set(0, 2.0, -2.0).normalize();
  scene.add(rimLight);

  window.addEventListener('resize', onWindowResize);
}

function onWindowResize() {
  const container = document.getElementById('canvas-container');
  const width = container.clientWidth;
  const height = container.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

// --- 2. Natural Resting Pose for VRM (No Awkward T-Pose) ---
//
// 本节同时放「按世界系语义操作归一化骨骼」的工具，applyNaturalPose 与程序化动作共用。
//
// 为什么需要它们：three-vrm 的归一化骨架里，所有骨骼静止时的局部旋转都是单位阵，但
// **rig 根的世界朝向两个 VRM 版本并不一致** ——
//   VRM 1.0 → 单位阵 I
//   VRM 0.x → Ry(π)（VRMUtils.rotateVRM0 把整个 scene 绕 Y 转了 180°）
// 所以「在父级局部系里左乘同一组欧拉角」这件事，在 0.x 上得到的**世界**旋转是被 Ry(π)
// 共轭过的（x、z 分量取反）：上臂本该下放却上举、前臂本该竖起却下垂、点头变成后仰。
// 写死欧拉角只对一个版本有效，根因就在这里；下面统一按世界系语义收发。

/** 归一化骨架的基准世界四元数（骨骼静止时，任意骨骼的父级朝向都等于 rig 根朝向）。 */
function rigBaseQuaternion(vrm) {
  vrm.scene.updateMatrixWorld(true);
  return vrm.humanoid.normalizedHumanBonesRoot.getWorldQuaternion(new THREE.Quaternion());
}

/**
 * 把「按 VRM 1.0 手调的局部欧拉角」换算成当前模型的局部旋转（P⁻¹ · E · P）。
 * 对 VRM 1.0 是恒等变换（P = I），既有数值逐位不变；对 VRM 0.x 把 180° 的基差抵掉。
 */
function authoredEulerToLocal(baseQuat, euler) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(euler[0], euler[1], euler[2]));
  return baseQuat.clone().invert().multiply(q).multiply(baseQuat);
}

/**
 * 反解「让 node 指向 targetWorldDir」所需的局部旋转增量。
 *
 * 关键帧写进轨道的是局部增量 Δ（播放时骨骼旋转 = Δ · restQuat），其世界效果是 Δ 被父级
 * 世界四元数共轭：世界增量 = P · Δ · P⁻¹。取 Δ = P⁻¹ · R · P（R = setFromUnitVectors(当前指向, 目标)）
 * 即可让世界增量恒为 R，与模型版本无关。
 *
 * 调用前必须 updateMatrixWorld(true)：P 与「当前指向」都是实时读的，而子骨骼的解依赖父骨骼
 * 已摆好的姿态，所以求解顺序必须是 上臂 → 刷新矩阵 → 前臂 → 手腕。
 */
function solveBoneAim(node, child, targetWorldDir) {
  const parentWorld = node.parent.getWorldQuaternion(new THREE.Quaternion());
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
 * 角色自身基：右 = 右肩−左肩，上 = +Y，前 = 上×右（指向观众）。
 * 用基系数表达目标指向，就不必去猜某个版本的骨骼局部系朝哪边。
 */
function characterBasis(vrm) {
  const left = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
  const right = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
  if (!left || !right) return null;
  vrm.scene.updateMatrixWorld(true);
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

/**
 * 掌心朝向 = cross(拇指方向, 手指方向)。
 * 已用 T-pose 核对符号约定：VRM 约定 T-pose 掌心朝下，本式给出 ≈(0,-1,0)，即该法线是
 * 「掌心朝向」而不是手背朝向。
 */
function palmNormal(vrm, side = 'right') {
  const h = vrm.humanoid;
  const hand = h.getNormalizedBoneNode(`${side}Hand`);
  const finger = h.getNormalizedBoneNode(`${side}MiddleProximal`);
  const thumb = h.getNormalizedBoneNode(`${side}ThumbProximal`);
  if (!hand || !finger || !thumb) return null;
  const origin = hand.getWorldPosition(new THREE.Vector3());
  const fingerDir = finger.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
  const thumbDir = thumb.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
  return new THREE.Vector3().crossVectors(thumbDir, fingerDir).normalize();
}

function applyNaturalPose(vrm) {
  if (!vrm || !vrm.humanoid) return;

  // Lower arms naturally to sides (~70 degrees down from T-pose)
  // Slightly bend elbows for a relaxed cute anime girl stance
  // 数值沿用此前在由比滨结衣（VRM 1.0）上调好的那组，只改成按世界系语义施加，
  // 这样 VRM 0.x（喜多郁代 / 雷电将军）不会再镜像成「双手上举」。
  const base = rigBaseQuaternion(vrm);
  const NATURAL_ARM_ROTATIONS = [
    ['leftUpperArm', [0.08, 0, -1.22]],
    ['rightUpperArm', [0.08, 0, 1.22]],
    ['leftLowerArm', [-0.25, 0.15, -0.18]],
    ['rightLowerArm', [-0.25, -0.15, 0.18]]
  ];
  for (const [name, euler] of NATURAL_ARM_ROTATIONS) {
    const node = vrm.humanoid.getNormalizedBoneNode(name);
    if (node) node.quaternion.copy(authoredEulerToLocal(base, euler));
  }
  vrm.scene.updateMatrixWorld(true);
}

/**
 * 摘掉「已被作者禁用」的法线贴图（normalScale 为 0 时）。
 */
function dropDisabledNormalMaps(vrm) {
  let dropped = 0;
  vrm.scene.traverse((obj) => {
    if (!obj.isMesh) return;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of materials) {
      if (
        material.normalMap &&
        material.normalScale &&
        material.normalScale.x === 0 &&
        material.normalScale.y === 0
      ) {
        material.normalMap = null;
        material.needsUpdate = true;
        dropped++;
      }
    }
  });
  if (dropped) {
    console.warn(
      `[VRM] 已停用 ${dropped} 处被禁用的法线贴图（normalScale 为 0，其蓝通道会翻转法线导致面部过曝）`
    );
  }
}

/**
 * 模型整体尺寸归一化的参考头骨高度
 * 由比滨结衣 head 骨世界高度 = 1.4111 —— 取景以她为基准
 */
const REFERENCE_HEAD_HEIGHT = 1.4111;

// --- 3. Dual-Format Character Adapter Architecture (VRM & PMX) ---

/**
 * 角色适配器抽象基类 (CharacterAdapter)
 * 统一 VRM 与 PMX (MMD) 底层实例，向外暴露一致的生命周期、表情、骨骼反解与视口接口。
 */
class CharacterAdapter {
  constructor(url, characterName = '') {
    this.url = url;
    this.characterName = characterName;
    this.type = 'base';
    this.restPoseType = 'tpose'; // 'tpose' (VRM) | 'astance' (PMX)
    this.model = null;
    this.mixer = null;
    this.activeMotionClips = {};
    this.currentIdleAction = null;
    this.currentMotionAction = null;
    this.currentMotionFinishedHandler = null;
    this.scaleFactor = 1.0;
  }

  getRootNode() { return null; }
  getHitMesh() { return this.getRootNode(); }
  resolveBone(semanticName) { return null; }
  setLipSync(vaa, voh) {}
  setBlink(weight) {}
  setEmotion(preset, weight) {}
  setHeadPitch(rad) {}
  update(delta, elapsedTime) {}

  destroy() {
    if (this.mixer) {
      this.mixer.stopAllAction();
      if (this.currentMotionFinishedHandler) {
        this.mixer.removeEventListener('finished', this.currentMotionFinishedHandler);
        this.currentMotionFinishedHandler = null;
      }
      this.mixer = null;
    }
    const root = this.getRootNode();
    if (root && scene) {
      scene.remove(root);
    }
    this.activeMotionClips = {};
    this.currentIdleAction = null;
    this.currentMotionAction = null;
  }
}

/**
 * VRM 角色适配器 (VrmCharacterAdapter)
 * 封装 three-vrm 的 Humanoid、ExpressionManager、LookAt 与 SpringBone
 */
class VrmCharacterAdapter extends CharacterAdapter {
  constructor(vrm, url, characterName = '', characterId = '') {
    super(url, characterName);
    this.characterId = characterId;
    this.type = 'vrm';
    this.restPoseType = 'tpose';
    this.vrm = vrm;
    this.model = vrm;
    currentVrm = vrm; // 保持向后兼容

    this.initModel();
  }

  getRootNode() {
    return this.vrm ? this.vrm.scene : null;
  }

  getHitMesh() {
    return this.vrm ? this.vrm.scene : null;
  }

  resolveBone(semanticName) {
    if (!this.vrm || !this.vrm.humanoid) return null;
    return this.vrm.humanoid.getNormalizedBoneNode(semanticName) ||
           this.vrm.humanoid.getRawBoneNode(semanticName);
  }

  initModel() {
    const vrm = this.vrm;
    scene.add(vrm.scene);

    // Rotate model if VRM 0.x
    VRMUtils.rotateVRM0(vrm);

    // 尺寸归一化到统一头骨高度
    this.normalizeScale(REFERENCE_HEAD_HEIGHT);

    // 修正禁用贴图导致的面部过曝
    dropDisabledNormalMaps(vrm);

    // 自然休止站姿
    applyNaturalPose(vrm);

    // 视线追踪目标
    if (vrm.lookAt) {
      vrm.lookAt.target = camera;
    }

    // 初始化 Mixer 与动作
    this.setupMotionMixer();
  }

  normalizeScale(referenceHeadHeight) {
    const headNode = this.vrm.humanoid?.getRawBoneNode('head');
    if (!headNode) {
      console.warn('[VRM] 没有 head 骨，跳过尺寸归一化');
      return;
    }
    this.vrm.scene.updateMatrixWorld(true);
    const headY = headNode.getWorldPosition(new THREE.Vector3()).y;
    if (!Number.isFinite(headY) || headY <= 0.01) {
      console.warn(`[VRM] head 骨高度异常 (${headY})，跳过尺寸归一化`);
      return;
    }
    const scale = referenceHeadHeight / headY;
    this.scaleFactor = scale;
    this.vrm.scene.scale.multiplyScalar(scale);
    this.vrm.scene.updateMatrixWorld(true);
    console.log(`[VRM] 尺寸归一化：head 骨 ${headY.toFixed(4)} → ×${scale.toFixed(4)}（目标 ${referenceHeadHeight}）`);
  }

  setupMotionMixer() {
    if (currentAnimationMixer) {
      currentAnimationMixer.stopAllAction();
    }
    this.mixer = new THREE.AnimationMixer(this.vrm.scene);
    currentAnimationMixer = this.mixer;
    currentIdleAction = null;
    currentMotionAction = null;
    autoGreetingDone = false;

    for (const k in activeMotionClips) delete activeMotionClips[k];

    for (const [name, vrmAnim] of Object.entries(loadedVrmAnimations)) {
      try {
        const clip = createVRMAnimationClip(vrmAnim, this.vrm);
        activeMotionClips[name] = clip;
        this.activeMotionClips[name] = clip;
      } catch (e) {
        console.warn(`[Motion] 为新角色生成动作 clip 失败 (${name}):`, e);
      }
    }

    ensureProceduralMotionClips(this.vrm);
    Object.assign(this.activeMotionClips, activeMotionClips);

    playIdleMotion();
    maybeAutoGreeting();
  }

  setLipSync(vaa, voh) {
    if (!this.vrm || !this.vrm.expressionManager) return;
    this.vrm.expressionManager.setValue('aa', vaa);
    this.vrm.expressionManager.setValue('oh', voh);
  }

  setBlink(weight) {
    if (!this.vrm || !this.vrm.expressionManager) return;
    this.vrm.expressionManager.setValue('blink', weight);
  }

  setEmotion(preset, weight) {
    if (!this.vrm || !this.vrm.expressionManager) return;
    ['happy', 'sad', 'angry', 'surprised', 'relaxed'].forEach((name) => {
      this.vrm.expressionManager.setValue(name, 0);
    });
    if (preset && preset !== 'neutral') {
      this.vrm.expressionManager.setValue(preset, weight);
    }
  }

  setHeadPitch(rad) {
    const head = this.resolveBone('head');
    if (head) {
      head.rotation.x = rad;
    }
  }

  update(delta, elapsedTime) {
    if (this.vrm) {
      this.vrm.update(delta);
    }
  }

  destroy() {
    super.destroy();
    if (this.vrm) {
      VRMUtils.deepDispose(this.vrm.scene);
      this.vrm = null;
      currentVrm = null;
    }
  }
}

/**
 * PMX 角色适配器 (PmxCharacterAdapter)
 * 采用社区成熟的高性能运行时 @moeru/three-mmd
 */
const PMX_MORPH_CANDIDATES = {
  'aa': ['あ', 'a', 'A', '口_あ', 'Mouth_ah', 'mouth_ah'],
  'oh': ['お', 'o', 'O', '口_お', 'Mouth_oh', 'mouth_oh'],
  'blink': ['まばたき', '眨眼', 'blink', 'Reye_close', 'Leye_close'],
  'blinkRight': ['ウィンク右', '眨眼右', 'Reye_close', 'Reye_close_smile'],
  'blinkLeft': ['ウィンク', '眨眼左', 'Leye_close', 'Leye_close_smile'],
  'happy': ['笑い', 'にっこり', '笑顔', 'happy', 'Mouth_smile', 'mouth_smile'],
  'sad': ['困る', '悲しい', '下がり眉', 'sad', 'Eye_sorrow', 'eye_sorrow', 'Eyebrow_SP04'],
  'angry': ['怒り', 'つり眉', 'angry', 'Eye_angry', 'Mouth_angry', 'Eyebrow_SP06'],
  'surprised': ['びっくり', '驚き', 'surprised', 'Eyebrow_SP05', 'Mouth_SP04'],
  'relaxed': ['Mouth_smile', 'smile', 'Reye_close_smile', 'Mouth_SP03']
};


class PmxCharacterAdapter extends CharacterAdapter {
  constructor(mmd, url, characterName = '', characterId = '') {
    super(url, characterName);
    this.characterId = characterId;
    this.type = 'pmx';
    this.restPoseType = 'astance';
    this.mmd = mmd;
    this.mesh = mmd.mesh;
    this.model = mmd;
    this.morphIndices = {};
    this.boneCache = {};
    this.activeMotionClips = {};

    this.initModel();
  }

  getRootNode() {
    return this.mesh;
  }

  getHitMesh() {
    return this.mesh;
  }

  resolveBone(semanticName) {
    if (this.boneCache[semanticName] !== undefined) {
      return this.boneCache[semanticName];
    }
    const candidates = PMX_BONE_MAPPING[semanticName] || [semanticName];
    let found = null;
    if (this.mesh && this.mesh.skeleton && this.mesh.skeleton.bones) {
      for (const name of candidates) {
        found = this.mesh.skeleton.bones.find((b) => b.name === name);
        if (found) break;
      }
    }
    this.boneCache[semanticName] = found;
    return found;
  }

  isCantarella() {
    const url = (this.url || '').toLowerCase();
    const type = (this.type || '').toLowerCase();
    const charId = (this.characterId || '').toLowerCase();
    const name = (this.characterName || '').toLowerCase();

    const isPmx = type === 'pmx' || url.endsWith('.pmx') || url.endsWith('.pmd') || charId === 'zh_cantarella_pmx_01';
    if (!isPmx) return false;

    return charId === 'zh_cantarella_pmx_01' ||
           url.includes('坎特蕾拉') || url.includes('cantarella') ||
           name.includes('坎特蕾拉') || name.includes('cantarella') || name.includes('カンタレラ');
  }

  isKurumi() {
    const url = (this.url || '').toLowerCase();
    const type = (this.type || '').toLowerCase();
    const charId = (this.characterId || '').toLowerCase();
    const name = (this.characterName || '').toLowerCase();

    const isPmx = type === 'pmx' || url.endsWith('.pmx') || url.endsWith('.pmd') || charId === 'zh_tokisaki_kurumi_01';
    if (!isPmx) return false;

    return charId === 'zh_tokisaki_kurumi_01' ||
           url.includes('时崎狂三') || url.includes('kurumi') ||
           name.includes('时崎狂三') || name.includes('狂三') || name.includes('kurumi');
  }

  isTohru() {
    const url = (this.url || '').toLowerCase();
    const type = (this.type || '').toLowerCase();
    const charId = (this.characterId || '').toLowerCase();
    const name = (this.characterName || '').toLowerCase();

    const isPmx = type === 'pmx' || url.endsWith('.pmx') || url.endsWith('.pmd') || charId === 'zh_tohru_01';
    if (!isPmx) return false;

    return charId === 'zh_tohru_01' ||
           url.includes('托尔') || url.includes('tohru') ||
           name.includes('托尔') || name.includes('トール') || name.includes('tohru');
  }

  applyNaturalPose() {
    if (this.isCantarella()) {
      applyCantarellaNaturalPose(this);
    } else if (this.isKurumi()) {
      applyKurumiNaturalPose(this);
    } else if (this.isTohru()) {
      applyTohruNaturalPose(this);
    } else {
      applyPmxNaturalPose(this);
    }
  }

  initModel() {
    scene.add(this.mesh);

    // 缓存 Morph 字典映射
    this.buildMorphCache();

    // 材质去油去反光：二次元模型 specular 归零，消除金属高光白斑
    this.mesh.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of materials) {
        if (mat.specular && typeof mat.specular.setRGB === 'function') {
          mat.specular.setRGB(0, 0, 0);
        }
        if (mat.shininess !== undefined) {
          mat.shininess = 0;
        }
        mat.needsUpdate = true;
      }
    });

    // 尺寸归一化
    this.normalizeScale(REFERENCE_HEAD_HEIGHT);

    // 施加自然女仆站姿 (Natural Rest Pose) 并固化到 MMD animationPose 基底
    this.applyNaturalPose();
    if (this.mmd) {
      const bones = this.mesh.skeleton.bones;
      this.mmd.animationPose = bones.map((bone) => ({
        position: bone.position.clone(),
        rotation: bone.quaternion.clone()
      }));
    }

    // 初始化动画 Mixer 与动作 clips
    this.setupMixer();
  }

  buildMorphCache() {
    const dict = this.mesh.morphTargetDictionary || {};
    for (const [semantic, candidates] of Object.entries(PMX_MORPH_CANDIDATES)) {
      this.morphIndices[semantic] = [];
      for (const cand of candidates) {
        if (dict[cand] !== undefined) {
          this.morphIndices[semantic].push(dict[cand]);
        }
      }
    }
  }

  normalizeScale(referenceHeadHeight) {
    this.mesh.updateMatrixWorld(true);
    const headNode = this.resolveBone('head');
    let headY = 20.0; // MMD 常见默认标高估算
    if (headNode) {
      headY = headNode.getWorldPosition(new THREE.Vector3()).y;
    }
    if (!Number.isFinite(headY) || headY <= 0.01) {
      console.warn(`[PMX] head 骨高度异常 (${headY})，采用默认缩放系数 0.07`);
      headY = 20.0;
    }
    const scale = referenceHeadHeight / headY;
    this.scaleFactor = scale;
    if (this.mmd && typeof this.mmd.setScalar === 'function') {
      this.mmd.setScalar(scale);
    } else {
      this.mesh.scale.multiplyScalar(scale);
    }
    this.mesh.updateMatrixWorld(true);
    console.log(`[PMX] 尺寸归一化：head 骨 ${headY.toFixed(4)} → ×${scale.toFixed(4)}（目标 ${referenceHeadHeight}）`);
  }

  setupMixer() {
    if (currentAnimationMixer) {
      currentAnimationMixer.stopAllAction();
    }
    this.mixer = new THREE.AnimationMixer(this.mesh);
    currentAnimationMixer = this.mixer;
    currentIdleAction = null;
    currentMotionAction = null;
    autoGreetingDone = false;

    // 清空全局动作 clips 映射，以本角色为准
    for (const k in activeMotionClips) delete activeMotionClips[k];

    // 生成并注入 PMX 专用动作 Clips 集（优先坎特蕾拉/狂三专属动作套件）
    if (this.isCantarella()) {
      ensureCantarellaMotionClips(this, activeMotionClips);
    } else if (this.isKurumi()) {
      ensureKurumiMotionClips(this, activeMotionClips);
    } else {
      ensureProceduralPmxMotionClips(this, activeMotionClips);
    }
    this.activeMotionClips = {};
    Object.assign(this.activeMotionClips, activeMotionClips);

    playIdleMotion();
    maybeAutoGreeting();
  }

  setLipSync(vaa, voh) {
    if (this.kurumiMotionSystem && typeof this.kurumiMotionSystem.setLipSync === 'function') {
      this.kurumiMotionSystem.setLipSync(vaa, voh);
    }
    if (!this.mesh || !this.mesh.morphTargetInfluences) return;
    const aaIndices = this.morphIndices['aa'] || [];
    const ohIndices = this.morphIndices['oh'] || [];
    for (const idx of aaIndices) this.mesh.morphTargetInfluences[idx] = vaa;
    for (const idx of ohIndices) this.mesh.morphTargetInfluences[idx] = voh;
  }

  setBlink(weight) {
    if (this.kurumiMotionSystem && typeof this.kurumiMotionSystem.setBlink === 'function') {
      this.kurumiMotionSystem.setBlink(weight);
    }
    if (!this.mesh || !this.mesh.morphTargetInfluences) return;
    const blinkIndices = this.morphIndices['blink'] || [];
    for (const idx of blinkIndices) {
      this.mesh.morphTargetInfluences[idx] = weight;
    }
  }

  setEmotion(preset, weight = 0.85) {
    if (this.kurumiMotionSystem && typeof this.kurumiMotionSystem.setEmotion === 'function') {
      this.kurumiMotionSystem.setEmotion(preset, weight);
      return;
    }
    if (this.blendMotionSystem && typeof this.blendMotionSystem.setEmotion === 'function') {
      this.blendMotionSystem.setEmotion(preset, weight);
      return;
    }
    if (!this.mesh || !this.mesh.morphTargetInfluences) return;
    // 情绪先互斥清零
    for (const key of ['happy', 'sad', 'angry', 'surprised', 'relaxed']) {
      const list = this.morphIndices[key] || [];
      for (const idx of list) {
        this.mesh.morphTargetInfluences[idx] = 0;
      }
    }
    if (preset && preset !== 'neutral') {
      const list = this.morphIndices[preset] || [];
      for (const idx of list) {
        this.mesh.morphTargetInfluences[idx] = weight;
      }
    }
  }

  setHeadPitch(rad) {
    const head = this.resolveBone('head');
    if (head) {
      head.rotation.x = rad;
    }
  }

  update(delta, elapsedTime) {
    if (motionRouter && motionRouter.activeSystem && motionRouter.activeSystem.adapter === this) {
      motionRouter.update(delta, elapsedTime);
      return;
    }
    if (this.blendMotionSystem) {
      this.blendMotionSystem.update(delta, elapsedTime);
      return;
    }
    if (this.cantarellaMotionSystem) {
      this.cantarellaMotionSystem.update(delta, elapsedTime);
      return;
    }
    if (this.kurumiMotionSystem) {
      this.kurumiMotionSystem.update(delta, elapsedTime);
      return;
    }
    if (this.mmd) {
      if (this.mixer) {
        this.mmd.updateWithMixer(delta, this.mixer);
      } else {
        this.mmd.update(delta);
      }
    }
  }

  destroy() {
    super.destroy();
    if (motionRouter && motionRouter.activeSystem && motionRouter.activeSystem.adapter === this) {
      motionRouter.destroy();
    }
    if (this.blendMotionSystem) {
      try {
        this.blendMotionSystem.destroy();
      } catch (e) {
        console.warn('[PmxCharacterAdapter] 销毁 blendMotionSystem 异常:', e);
      }
      this.blendMotionSystem = null;
    }
    if (this.cantarellaMotionSystem) {
      try {
        this.cantarellaMotionSystem.destroy();
      } catch (e) {
        console.warn('[PmxCharacterAdapter] 销毁 cantarellaMotionSystem 异常:', e);
      }
      this.cantarellaMotionSystem = null;
    }
    if (this.kurumiMotionSystem) {
      try {
        this.kurumiMotionSystem.destroy();
      } catch (e) {
        console.warn('[PmxCharacterAdapter] 销毁 kurumiMotionSystem 异常:', e);
      }
      this.kurumiMotionSystem = null;
    }
    if (this.mesh) {
      if (scene) {
        scene.remove(this.mesh);
      }
      if (this.mesh.geometry) {
        this.mesh.geometry.dispose();
      }
      const materials = Array.isArray(this.mesh.material) ? this.mesh.material : [this.mesh.material];
      for (const mat of materials) {
        if (mat.map) mat.map.dispose();
        if (mat.matcap) mat.matcap.dispose();
        if (mat.gradientMap) mat.gradientMap.dispose();
        mat.dispose();
      }
      this.mesh = null;
      this.mmd = null;
    }
  }
}

// --- 3.1 Lifecycle & Scene Cleanup Management ---
let currentLoadingToken = 0;

/**
 * 彻底清除场景中已存在的全部角色对象（保持单实例绝对安全）
 */
function cleanupSceneAvatarObjects() {
  if (motionRouter) {
    try {
      motionRouter.destroy();
    } catch (e) {
      console.warn('[Cleanup] 销毁 motionRouter 异常:', e);
    }
  }
  if (currentAdapter) {
    try {
      currentAdapter.destroy();
    } catch (e) {
      console.warn('[Cleanup] 销毁 currentAdapter 异常:', e);
    }
    currentAdapter = null;
  }
  if (currentVrm) {
    try {
      if (scene && currentVrm.scene) {
        scene.remove(currentVrm.scene);
        VRMUtils.deepDispose(currentVrm.scene);
      }
    } catch (e) {
      console.warn('[Cleanup] 销毁 currentVrm 异常:', e);
    }
    currentVrm = null;
  }

  // 防御性彻底清除 scene 中遗留的任何角色 Mesh/Group（只保留 Camera 与 Light）
  if (scene) {
    const toRemove = [];
    for (let i = scene.children.length - 1; i >= 0; i--) {
      const child = scene.children[i];
      if (child.isLight || child.isCamera) continue;
      toRemove.push(child);
    }
    for (const obj of toRemove) {
      console.warn('[Cleanup] 防御性移出场景残留网格:', obj.name || obj.type);
      scene.remove(obj);
      if (typeof VRMUtils !== 'undefined' && VRMUtils.deepDispose) {
        try { VRMUtils.deepDispose(obj); } catch (e) {}
      }
    }
  }

  currentModelUrl = null;
  window.currentAdapter = null;
  window.currentVrm = null;
  window.currentModelUrl = null;
}

function unloadCurrentCharacter() {
  cleanupSceneAvatarObjects();
}

/**
 * 统一的角色加载调度器 (loadCharacter)
 * 采用 Token 序号锁与原子切换机制，杜绝网络并发导致的孤儿多重渲染
 */
async function loadCharacter(modelMeta, characterName = '') {
  const url = modelMeta.vrm || modelMeta.pmx;
  const name = characterName || modelMeta.name || '3D';
  if (!url) return;

  // 防重复：若当前适配器已就绪且 URL 一致，不重复触发
  if (currentModelUrl === url && currentAdapter) {
    console.debug(`[Load] 模型 ${url} 已就绪，跳过重复加载`);
    return;
  }

  const thisToken = ++currentLoadingToken;

  if (loadingScreen) {
    loadingScreen.classList.remove('hidden');
    loadingStatus.textContent = `正在加载 ${name} 模型...`;
  }

  // Pre-check if file exists
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) {
      console.warn(`Model file not found at ${url} (status: ${res.status})`);
      if (thisToken !== currentLoadingToken) return;
      if (loadingStatus) {
        loadingStatus.textContent = `${name} 模型文件暂未就绪 (${url})`;
      }
      setTimeout(() => {
        if (loadingScreen) loadingScreen.classList.add('hidden');
      }, 2500);
      return;
    }
  } catch (err) {
    console.warn('Could not verify model URL head:', err);
  }

  if (thisToken !== currentLoadingToken) return;

  const isPmx = url.toLowerCase().endsWith('.pmx') || url.toLowerCase().endsWith('.pmd');

  if (isPmx) {
    // --- MMD (.pmx) 加载分支 ---
    const mmdLoader = new MMDLoader();
    mmdLoader.load(
      url,
      (mmd) => {
        if (thisToken !== currentLoadingToken) {
          console.warn(`[PMX] 加载 #${thisToken} 已过时（最新 #${currentLoadingToken}），丢弃`);
          if (mmd && typeof mmd.dispose === 'function') mmd.dispose();
          return;
        }

        // 新模型真正就绪后，在加入前原子清理场景
        cleanupSceneAvatarObjects();

        try {
          currentAdapter = new PmxCharacterAdapter(mmd, url, name, modelMeta.id || characterName || '');
          currentModelUrl = url;
          window.currentAdapter = currentAdapter;
          window.currentModelUrl = currentModelUrl;
          console.log('✅ PMX model loaded successfully:', mmd);
          if (motionRouter) {
            motionRouter.route(currentAdapter);
          }
          if (currentAdapter.mixer) {
            currentAnimationMixer = currentAdapter.mixer;
          }
          if (currentAdapter.isCantarella && currentAdapter.isCantarella()) {
            updateMotionSelectForCharacter('cantarella');
          } else if (currentAdapter.isKurumi && currentAdapter.isKurumi()) {
            updateMotionSelectForCharacter('kurumi');
          } else if (currentAdapter.isTohru && currentAdapter.isTohru()) {
            updateMotionSelectForCharacter('tohru');
          } else {
            updateMotionSelectForCharacter('pmx');
          }

          if (loadingScreen) {
            loadingStatus.textContent = '加载完成！';
            loadingScreen.classList.add('hidden');
          }
          setEmotion('happy', 0.6);
          setTimeout(() => setEmotion('neutral', 0), 2500);
        } catch (e) {
          console.error('Error initializing PmxCharacterAdapter:', e);
          if (loadingStatus) loadingStatus.textContent = 'PMX 初始化失败: ' + e.message;
          setTimeout(() => {
            if (loadingScreen) loadingScreen.classList.add('hidden');
          }, 2500);
        }
      },
      (progress) => {
        if (progress.total > 0 && loadingStatus && thisToken === currentLoadingToken) {
          const percent = Math.round((progress.loaded / progress.total) * 100);
          loadingStatus.textContent = `正在加载 PMX 模型资源... (${percent}%)`;
        }
      },
      (error) => {
        if (thisToken !== currentLoadingToken) return;
        console.error('Error loading PMX:', error);
        if (loadingStatus) loadingStatus.textContent = '模型加载失败: ' + (error?.message || error);
        setTimeout(() => {
          if (loadingScreen) loadingScreen.classList.add('hidden');
        }, 2500);
      }
    );
  } else {
    // --- VRM (.vrm) 加载分支 ---
    const gltfLoader = new GLTFLoader();
    gltfLoader.register((parser) => new VRMLoaderPlugin(parser));
    gltfLoader.register((parser) => new VRMAnimationLoaderPlugin(parser));

    gltfLoader.load(
      url,
      (gltf) => {
        if (thisToken !== currentLoadingToken) {
          console.warn(`[VRM] 加载 #${thisToken} 已过时（最新 #${currentLoadingToken}），丢弃`);
          if (gltf.userData.vrm) {
            VRMUtils.deepDispose(gltf.userData.vrm.scene);
          }
          return;
        }

        const vrm = gltf.userData.vrm;
        if (!vrm) {
          console.error('No VRM instance found in GLTF:', gltf);
          if (loadingStatus) loadingStatus.textContent = 'VRM 解析失败';
          setTimeout(() => {
            if (loadingScreen) loadingScreen.classList.add('hidden');
          }, 2000);
          return;
        }

        // 新模型真正就绪后，在加入前原子清理场景
        cleanupSceneAvatarObjects();

        try {
          currentAdapter = new VrmCharacterAdapter(vrm, url, name, modelMeta.id || characterName || '');
          currentModelUrl = url;
          currentVrm = vrm;
          window.currentAdapter = currentAdapter;
          window.currentVrm = currentVrm;
          window.currentModelUrl = currentModelUrl;
          console.log('✅ VRM model loaded successfully:', vrm);
          if (motionRouter) {
            motionRouter.route(currentAdapter);
          }
          if (currentAdapter.mixer) {
            currentAnimationMixer = currentAdapter.mixer;
          }
          updateMotionSelectForCharacter('vrm');

          if (loadingScreen) {
            loadingStatus.textContent = '加载完成！';
            loadingScreen.classList.add('hidden');
          }
          setEmotion('happy', 0.6);
          setTimeout(() => setEmotion('neutral', 0), 2500);
        } catch (e) {
          console.error('Error initializing VrmCharacterAdapter:', e);
          if (loadingStatus) loadingStatus.textContent = 'VRM 初始化失败: ' + e.message;
          setTimeout(() => {
            if (loadingScreen) loadingScreen.classList.add('hidden');
          }, 2500);
        }
      },
      (progress) => {
        if (progress.total > 0 && loadingStatus && thisToken === currentLoadingToken) {
          const percent = Math.round((progress.loaded / progress.total) * 100);
          loadingStatus.textContent = `正在加载模型资源... (${percent}%)`;
        }
      },
      (error) => {
        if (thisToken !== currentLoadingToken) return;
        console.error('Error loading VRM:', error);
        if (loadingStatus) loadingStatus.textContent = '模型加载失败: ' + (error?.message || error);
        setTimeout(() => {
          if (loadingScreen) loadingScreen.classList.add('hidden');
        }, 2500);
      }
    );
  }
}

// 兼容别名
async function loadVRM(url, characterName = '') {
  return loadCharacter({ vrm: url, name: characterName }, characterName);
}

function resolveCharacterId(idOrNameOrFile) {
  if (!idOrNameOrFile) return null;
  const str = String(idOrNameOrFile).trim();
  const stem = str.replace(/\.ya?ml$/i, '');
  if (CHARACTER_META[stem]) return stem;
  if (CHARACTER_META[str]) return str;
  if (CHARACTER_ID_ALIASES[stem]) return CHARACTER_ID_ALIASES[stem];
  if (CHARACTER_ID_ALIASES[str]) return CHARACTER_ID_ALIASES[str];
  // 长度降序优先匹配，避免 "坎特蕾拉" 拦截 "坎特蕾拉（PMX）"
  const sortedAliases = Object.keys(CHARACTER_ID_ALIASES).sort((a, b) => b.length - a.length);
  for (const alias of sortedAliases) {
    if (str.includes(alias)) return CHARACTER_ID_ALIASES[alias];
  }
  return null;
}

function updateMotionSelectForCharacter(characterType = 'vrm') {
  const motionSelect = document.getElementById('motion-select');
  if (!motionSelect) return;

  if (characterType === 'cantarella') {
    motionSelect.innerHTML = `
      <option value="">🎭 坎特蕾拉专属动作演示...</option>
      <option value="cantarella_seduce_tongue">💜 魅惑吐舌·声痕显现 (王牌特写)</option>
      <option value="cantarella_graceful_greeting">🍷 优雅曼妙致意 (贵妇礼仪)</option>
      <option value="cantarella_alluring_whisper">💋 魅惑邀约·低语 (亲密挑逗)</option>
      <option value="cantarella_poison_tease">🥀 危险毒药挑逗 (戏谑冷艳)</option>
      <option value="cantarella_arrogant_turn">👑 冷艳傲然侧身 (回眸睥睨)</option>
      <option value="gentle_nod">🙇 优雅轻颔首 (倾听)</option>
      <option value="shake_head">🙅 冷艳微摇头 (否定)</option>
    `;
    return;
  }

  if (characterType === 'kurumi') {
    motionSelect.innerHTML = `
      <option value="">🎭 时崎狂三专属动作演示...</option>
      <option value="kurumi_curtsy">👗 优雅提裙行礼 (初见致意)</option>
      <option value="kurumi_tease_whisper">💋 魅惑掩唇低语 (うふふ…)</option>
      <option value="kurumi_finger_gun">🎯 招牌指枪放电 (Bang~)</option>
      <option value="kurumi_hair_stroke">🖤 慵懒撩发回眸 (魔女风情)</option>
      <option value="kurumi_giggle">✨ 狂三优雅轻笑 (轻颤露齿)</option>
      <option value="gentle_nod">🙇 优雅轻颔首 (倾听)</option>
      <option value="shake_head">🙅 戏谑轻摇头 (玩味否定)</option>
      <option value="pout_turn">😤 傲慢侧身回眸 (冷艳)</option>
    `;
    return;
  }

  if (characterType === 'tohru') {
    motionSelect.innerHTML = `
      <option value="">🎭 托尔专属动作演示...</option>
      <option value="tohru_love_hug">💖 小林狂爱·飞扑拥抱 (小林さーん！)</option>
      <option value="tohru_tail_meat">🍖 特制尻尾肉·料理邀尝 (爱意满满)</option>
      <option value="tohru_dragon_roar">🐲 灭世龙威·冷峻怒颜 (威慑人类)</option>
      <option value="tohru_maid_curtsy">👗 端庄龙女仆·提裙致意 (女仆礼仪)</option>
      <option value="tohru_happy_bounce">✨ 元气欢呼·雀跃起跳 (开心跳跃)</option>
      <option value="wave_hand">👋 热情摆手招手 (元气日常)</option>
      <option value="gentle_nod">🙇 乖巧轻颔首 (倾听小林)</option>
      <option value="shake_head">🙅 委屈扁嘴轻摇头 (不开心)</option>
      <option value="pout_turn">😤 傲娇侧身别头 (气鼓鼓)</option>
    `;
    return;
  }

  // 其他角色恢复通用动作菜单
  motionSelect.innerHTML = `
    <option value="">🎭 动作演示打样...</option>
    <option value="${characterType === 'pmx' ? 'pmx_greeting' : 'greeting'}">
      ${characterType === 'pmx' ? '✨ 全身礼貌致意 (PMX专属)' : '🌟 官方全身打招呼 (Pixiv)'}
    </option>
    <option value="wave_hand">👋 轻柔摆手招手 (日常)</option>
    <option value="shake_head">🙅 轻轻摇头 (傲娇/否定)</option>
    <option value="gentle_nod">🙇 赞同点头 (倾听)</option>
    <option value="cheerful_bounce">✨ 喜多元气跳 (开心)</option>
    <option value="surprise_jump">😲 受惊后缩 (惊讶)</option>
    <option value="pout_turn">😤 傲娇侧头 (生气)</option>
    <option value="shy_tilt">💕 歪头害羞 (萌态)</option>
  `;
}

function applyCharacterUI(characterIdOrConfig) {
  if (!characterIdOrConfig) return;
  const charId = resolveCharacterId(characterIdOrConfig);
  const matched = charId ? CHARACTER_META[charId] : null;
  if (!matched) return;

  const titleEl = document.getElementById('character-title');
  const avatarEl = document.getElementById('character-avatar');
  if (titleEl) titleEl.textContent = matched.name;
  if (avatarEl) avatarEl.textContent = matched.short;
  if (bubbleSender) bubbleSender.textContent = matched.name;
  if (bubbleText) bubbleText.textContent = matched.greeting;
  document.title = `${matched.name} - Open-LLM-VTuber 3D`;

  // Update quick chips
  const chipsContainer = document.querySelector('.suggestion-chips') || document.querySelector('.dock-chips');
  if (chipsContainer && matched.chips) {
    chipsContainer.innerHTML = '';
    matched.chips.forEach((text) => {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.setAttribute('data-text', text);
      chip.textContent = text;
      chip.addEventListener('click', () => {
        if (text.includes('吐舌')) {
          playMotion('cantarella_seduce_tongue');
        } else if (text.includes('致意') || text.includes('行礼') || text.includes('提裙')) {
          playMotion(charId === 'zh_tokisaki_kurumi_01' ? 'kurumi_curtsy' : (charId === 'zh_tohru_01' ? 'tohru_maid_curtsy' : 'cantarella_graceful_greeting'));
        } else if (text.includes('掩唇') || text.includes('低语') || text.includes('うふふ')) {
          playMotion(charId === 'zh_tokisaki_kurumi_01' ? 'kurumi_tease_whisper' : 'cantarella_alluring_whisper');
        } else if (text.includes('指枪') || text.includes('Bang')) {
          playMotion('kurumi_finger_gun');
        } else if (text.includes('撩发') || text.includes('回眸')) {
          playMotion('kurumi_hair_stroke');
        } else if (text.includes('邀约')) {
          playMotion('cantarella_alluring_whisper');
        } else if (text.includes('尻尾') || text.includes('尾巴') || text.includes('肉')) {
          playMotion('tohru_tail_meat');
        } else if (text.includes('小林') || text.includes('爱') || text.includes('抱')) {
          playMotion('tohru_love_hug');
        } else if (text.includes('ドラゴン') || text.includes('世界') || text.includes('龙')) {
          playMotion('tohru_dragon_roar');
        } else if (text.includes('家事') || text.includes('メイド') || text.includes('女仆')) {
          playMotion('tohru_maid_curtsy');
        }
        sendTextMessage(text);
      });
      chipsContainer.appendChild(chip);
    });
  }

  // Update input placeholder
  if (textInput) {
    textInput.placeholder = `和${matched.name}聊点什么吧... (按 Enter 发送)`;
  }

  // 同步更新动作打样下拉列表：坎特蕾拉专属动作 / 狂三专属动作 / 托尔专属动作 / PMX专属全身致意 / VRM官方打招呼
  if (charId === 'zh_cantarella_pmx_01') {
    updateMotionSelectForCharacter('cantarella');
  } else if (charId === 'zh_tokisaki_kurumi_01') {
    updateMotionSelectForCharacter('kurumi');
  } else if (charId === 'zh_tohru_01') {
    updateMotionSelectForCharacter('tohru');
  } else {
    updateMotionSelectForCharacter(matched.pmx ? 'pmx' : 'vrm');
  }

  // Switch character model (VRM or PMX) if different
  const targetModelUrl = matched.vrm || matched.pmx;
  if (targetModelUrl && currentModelUrl !== targetModelUrl) {
    loadCharacter(matched, charId);
  }
}

// 暴露全局接口与 Getter/Setter 给外部环境（如 Electron 桌宠主进程、自动化测试）
window.applyCharacterUI = applyCharacterUI;
window.updateMotionSelectForCharacter = updateMotionSelectForCharacter;
window.resolveCharacterId = resolveCharacterId;
window.loadCharacter = loadCharacter;
window.loadVRM = loadVRM;
window.CHARACTER_META = CHARACTER_META;
window.CHARACTER_ID_ALIASES = CHARACTER_ID_ALIASES;
Object.defineProperty(window, 'currentAdapter', {
  get: () => currentAdapter,
  set: (v) => { currentAdapter = v; },
  configurable: true
});
Object.defineProperty(window, 'currentVrm', {
  get: () => currentVrm,
  set: (v) => { currentVrm = v; },
  configurable: true
});
Object.defineProperty(window, 'currentModelUrl', {
  get: () => currentModelUrl,
  set: (v) => { currentModelUrl = v; },
  configurable: true
});

// --- 4. Web Audio & Lip-Sync ---
function ensureAudioContext() {
  if (!audioContext) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioCtx();
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 256;
    analyserNode.smoothingTimeConstant = 0.35;

    gainNode = audioContext.createGain();
    gainNode.gain.value = 1.0;

    analyserNode.connect(gainNode);
    gainNode.connect(audioContext.destination);
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
}

function base64ToArrayBuffer(base64) {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

async function handleAudioMessage(payload) {
  ensureAudioContext();

  const activeSpeaker = (bubbleSender && bubbleSender.textContent) || 'AI';
  const base64Audio = payload.audio;
  if (!base64Audio) {
    if (payload.display_text && payload.display_text.text) {
      showDialogue(payload.display_text.name || activeSpeaker, payload.display_text.text);
    }
    return;
  }

  try {
    const arrayBuffer = base64ToArrayBuffer(base64Audio);
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    audioQueue.push({
      audioBuffer: audioBuffer,
      displayText: payload.display_text,
      expressions: payload.actions ? payload.actions.expressions : []
    });

    if (!isPlayingAudio) {
      playNextAudio();
    }
  } catch (err) {
    console.error('Error decoding audio:', err);
  }
}

function playNextAudio() {
  if (audioQueue.length === 0) {
    isPlayingAudio = false;
    updateStatus('connected', '在线');
    btnInterrupt.classList.remove('active');
    setEmotion('neutral', 0);
    return;
  }

  isPlayingAudio = true;
  updateStatus('speaking', '说话中...');
  btnInterrupt.classList.add('active');

  const item = audioQueue.shift();
  const activeSpeaker = (bubbleSender && bubbleSender.textContent) || 'AI';

  if (item.displayText && item.displayText.text) {
    showDialogue(item.displayText.name || activeSpeaker, item.displayText.text);
  }

  if (item.expressions && item.expressions.length > 0) {
    const exp = item.expressions[0];
    setEmotion(exp, 0.85);

    // 对话情绪与全身肢体动作联动
    const motionMap = {
      'happy': 'cheerful_bounce',
      'joy': 'cheerful_bounce',
      'surprised': 'surprise_jump',
      'surprise': 'surprise_jump',
      'relaxed': 'gentle_nod',
      'angry': 'pout_turn'
    };
    const cleanKey = String(exp).toLowerCase().replace(/[\[\]]/g, '');
    const targetMotion = motionMap[cleanKey] || motionMap[exp];
    if (targetMotion) {
      playMotion(targetMotion);
    }
  }

  const source = audioContext.createBufferSource();
  source.buffer = item.audioBuffer;
  source.connect(analyserNode);

  currentAudioSource = source;

  source.onended = () => {
    currentAudioSource = null;
    playNextAudio();
  };

  source.start(0);
}

function stopAudioPlayback() {
  if (currentAudioSource) {
    try {
      currentAudioSource.stop();
    } catch (e) {}
    currentAudioSource = null;
  }
  audioQueue = [];
  isPlayingAudio = false;
  mouthOpen = 0;
  if (currentAdapter) {
    currentAdapter.setLipSync(0, 0);
  } else if (currentVrm && currentVrm.expressionManager) {
    currentVrm.expressionManager.setValue('aa', 0);
    currentVrm.expressionManager.setValue('oh', 0);
  }
  updateStatus('connected', '在线');
  btnInterrupt.classList.remove('active');
  setEmotion('neutral', 0);
}

function setEmotion(emotionName, weight = 0.85) {
  if (!currentAdapter && (!currentVrm || !currentVrm.expressionManager)) return;

  const numberMap = {
    0: 'neutral',
    1: 'happy',
    2: 'angry',
    3: 'sad',
    4: 'relaxed'
  };

  let strKey = '';
  if (typeof emotionName === 'number') {
    strKey = numberMap[emotionName] || 'neutral';
  } else if (typeof emotionName === 'string') {
    strKey = emotionName.toLowerCase().trim().replace(/[\[\]]/g, '');
  } else {
    strKey = 'neutral';
  }

  const emotionMap = {
    'happy': 'happy',
    'joy': 'happy',
    'fun': 'happy',
    'smirk': 'relaxed',
    'wink': 'relaxed',
    'playful': 'relaxed',
    'sadness': 'sad',
    'sad': 'sad',
    'sorrow': 'sad',
    'fear': 'sad',
    'disgust': 'angry',
    'anger': 'angry',
    'angry': 'angry',
    'surprise': 'surprised',
    'surprised': 'surprised',
    'relaxed': 'relaxed',
    'neutral': 'neutral'
  };

  const targetPreset = emotionMap[strKey] || (numberMap[strKey] || 'neutral');

  const emotionSelect = document.getElementById('emotion-select');
  if (emotionSelect && emotionSelect.value !== targetPreset) {
    emotionSelect.value = targetPreset;
  }

  if (currentAdapter) {
    currentAdapter.setEmotion(targetPreset, weight);
  } else if (currentVrm && currentVrm.expressionManager) {
    ['happy', 'sad', 'angry', 'surprised', 'relaxed'].forEach((name) => {
      currentVrm.expressionManager.setValue(name, 0);
    });
    if (targetPreset !== 'neutral') {
      currentVrm.expressionManager.setValue(targetPreset, weight);
    }
  }

  // Subtle emotional posture/action reaction
  if (targetPreset === 'happy') {
    currentEmotionHeadPitch = -0.04; // slight cheerful chin lift
  } else if (targetPreset === 'sad') {
    currentEmotionHeadPitch = 0.08; // slightly downcast
  } else if (targetPreset === 'angry') {
    currentEmotionHeadPitch = 0.05; // firm forward tilt
  } else if (targetPreset === 'surprised') {
    currentEmotionHeadPitch = -0.08; // slight surprise pop
  } else {
    currentEmotionHeadPitch = 0;
  }
}

// Lip-sync with speech frequency analysis and dual viseme blending
const freqData = new Uint8Array(128);
function updateLipSync() {
  if (!currentAdapter && (!currentVrm || !currentVrm.expressionManager)) return;

  if (isPlayingAudio && analyserNode) {
    analyserNode.getByteFrequencyData(freqData);
    let sum = 0;
    const startBin = 2;
    const endBin = 24;
    for (let i = startBin; i < endBin; i++) {
      sum += freqData[i];
    }
    const avg = sum / (endBin - startBin) / 255;
    const target = Math.min(1.0, Math.max(0, (avg - 0.035) * 3.4));
    mouthOpen = THREE.MathUtils.lerp(mouthOpen, target, 0.48);

    // Blend 'aa' with subtle 'oh' for lively mouth kinematics
    const vaa = mouthOpen * 0.82;
    const voh = mouthOpen * 0.22;
    if (currentAdapter) {
      currentAdapter.setLipSync(vaa, voh);
    } else {
      currentVrm.expressionManager.setValue('aa', vaa);
      currentVrm.expressionManager.setValue('oh', voh);
    }
  } else {
    mouthOpen = THREE.MathUtils.lerp(mouthOpen, 0.0, 0.25);
    if (currentAdapter) {
      currentAdapter.setLipSync(mouthOpen, 0);
    } else {
      currentVrm.expressionManager.setValue('aa', mouthOpen);
      currentVrm.expressionManager.setValue('oh', 0);
    }
  }
}

// Auto-blink
function updateBlink(delta) {
  if (!currentAdapter && (!currentVrm || !currentVrm.expressionManager)) return;

  blinkTimer += delta;
  if (!isBlinking && blinkTimer >= nextBlinkTime) {
    isBlinking = true;
    blinkTimer = 0;
    blinkProgress = 0;
  }

  if (isBlinking) {
    blinkProgress += delta / BLINK_DURATION;
    if (blinkProgress >= 1.0) {
      isBlinking = false;
      blinkProgress = 0;
      if (currentAdapter) {
        currentAdapter.setBlink(0.0);
      } else {
        currentVrm.expressionManager.setValue('blink', 0.0);
      }
      nextBlinkTime = 2.4 + Math.random() * 3.6;
    } else {
      const weight = Math.sin(blinkProgress * Math.PI);
      if (currentAdapter) {
        currentAdapter.setBlink(weight);
      } else {
        currentVrm.expressionManager.setValue('blink', weight);
      }
    }
  }
}

// Idle breathing & micro-sway (fallback when no VRMA idle loop is playing)
function updateIdle(elapsedTime) {
  // 当独立动作系统已接管（Cantarella / Kurumi / Blend）或动画混合器正在播放动作时，骨骼由动画系统全权驱动，防止程序化待机覆盖姿态
  if (motionRouter && motionRouter.activeSystem) {
    return;
  }
  if (currentAnimationMixer && ((currentIdleAction && currentIdleAction.isRunning()) || currentMotionAction)) {
    return;
  }

  const head = currentAdapter ? currentAdapter.resolveBone('head') : currentVrm?.humanoid?.getNormalizedBoneNode('head');
  if (!head) return;
  const t = elapsedTime;
  const breath = Math.sin(t * 1.8) * 0.016;

  const chest = currentAdapter ? currentAdapter.resolveBone('chest') : currentVrm?.humanoid?.getNormalizedBoneNode('chest');
  if (chest) chest.rotation.x = breath;

  const spine = currentAdapter ? currentAdapter.resolveBone('spine') : currentVrm?.humanoid?.getNormalizedBoneNode('spine');
  if (spine) spine.rotation.x = breath * 0.5;

  // Natural head motion (combining emotional pitch with subtle idle sway)
  head.rotation.y = Math.sin(t * 0.75) * 0.028;
  head.rotation.z = Math.sin(t * 0.5) * 0.012;
  head.rotation.x = currentEmotionHeadPitch + Math.sin(t * 1.8) * 0.006;

  // VRM T-pose 需要手臂下垂，PMX 自身有自然休止姿态微动
  if (currentAdapter && currentAdapter.type === 'pmx') {
    const lShoulder = currentAdapter.resolveBone('leftShoulder');
    const rShoulder = currentAdapter.resolveBone('rightShoulder');
    if (lShoulder) lShoulder.rotation.z = -0.05;
    if (rShoulder) rShoulder.rotation.z = 0.05;

    const name = (currentAdapter.characterName || '').toLowerCase();
    const isTohru = name.includes('托尔') || name.includes('トール') || name.includes('tohru');
    const isKurumi = name.includes('狂三') || name.includes('kurumi');
    const baseZ = isTohru ? 0.50 : (isKurumi ? 0.55 : 0.54);

    const leftUpperArm = currentAdapter.resolveBone('leftUpperArm');
    if (leftUpperArm) {
      leftUpperArm.rotation.z = -baseZ - Math.sin(t * 1.8) * 0.008;
      leftUpperArm.rotation.x = 0.12 + Math.sin(t * 1.8) * 0.005;
    }
    const rightUpperArm = currentAdapter.resolveBone('rightUpperArm');
    if (rightUpperArm) {
      rightUpperArm.rotation.z = baseZ + Math.sin(t * 1.8) * 0.008;
      rightUpperArm.rotation.x = 0.12 + Math.sin(t * 1.8) * 0.005;
    }
    const leftLowerArm = currentAdapter.resolveBone('leftLowerArm');
    if (leftLowerArm) {
      leftLowerArm.rotation.set(0.20, 0.12, -0.22 - Math.sin(t * 1.8) * 0.006);
    }
    const rightLowerArm = currentAdapter.resolveBone('rightLowerArm');
    if (rightLowerArm) {
      rightLowerArm.rotation.set(0.20, -0.12, 0.22 + Math.sin(t * 1.8) * 0.006);
    }
  } else if (!currentAdapter || currentAdapter.restPoseType === 'tpose') {
    const leftUpperArm = currentAdapter ? currentAdapter.resolveBone('leftUpperArm') : currentVrm?.humanoid?.getNormalizedBoneNode('leftUpperArm');
    if (leftUpperArm) leftUpperArm.rotation.z = -1.22 - Math.sin(t * 1.8) * 0.012;

    const rightUpperArm = currentAdapter ? currentAdapter.resolveBone('rightUpperArm') : currentVrm?.humanoid?.getNormalizedBoneNode('rightUpperArm');
    if (rightUpperArm) rightUpperArm.rotation.z = 1.22 + Math.sin(t * 1.8) * 0.012;
  }
}

// --- 4.1 Interactive Touch & Motion System ---
// 随机触碰反馈池 (表情 + 动作联动)
const CLICK_REACTIONS = [
  { emotion: 'happy', weight: 0.95, motion: 'cheerful_bounce', duration: 2400 },
  { emotion: 'surprised', weight: 0.90, motion: 'surprise_jump', duration: 2000 },
  { emotion: 'relaxed', weight: 0.85, motion: 'gentle_nod', duration: 2500 },
  { emotion: 'angry', weight: 0.80, motion: 'pout_turn', duration: 1800 }
];

/**
 * 按 URL 解析并缓存 VRMA 文件 (同一文件被多个动作名引用时只下载/解析一次)
 */
const vrmAnimationCache = {};   // url -> VRMAnimation | null
const vrmAnimationPending = {}; // url -> Promise

async function fetchVrmAnimation(url) {
  if (!vrmAnimationPending[url]) {
    vrmAnimationPending[url] = (async () => {
      try {
        const res = await fetch(url, { method: 'HEAD' });
        if (!res.ok) {
          console.debug(`[Motion] 动作文件 ${url} 暂未就绪 (HTTP ${res.status})`);
          return null;
        }
        const loader = new GLTFLoader();
        loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
        const gltf = await loader.loadAsync(url);
        const vrmAnim = gltf.userData.vrmAnimations?.[0] || gltf.userData.vrmAnimation;
        if (vrmAnim) {
          console.log(`✅ [Motion] 成功载入 VRMA 动作文件: ${url}`);
          return vrmAnim;
        }
      } catch (err) {
        console.debug(`[Motion] 加载动作 ${url} 跳过:`, err.message);
      }
      return null;
    })();
  }

  if (vrmAnimationCache[url] === undefined) {
    vrmAnimationCache[url] = await vrmAnimationPending[url];
  }
  return vrmAnimationCache[url];
}

/**
 * 加载单个动作名对应的 .vrma 文件，并绑定到当前角色骨骼
 */
async function loadVrmaFile(name, url) {
  const vrmAnim = await fetchVrmAnimation(url);
  if (!vrmAnim) return null;

  loadedVrmAnimations[name] = vrmAnim;
  console.debug(`[Motion] 注册动作: ${name}`);

  if (currentVrm) {
    try {
      activeMotionClips[name] = createVRMAnimationClip(vrmAnim, currentVrm);
    } catch (e) {
      console.warn(`[Motion] 为当前角色生成 Clip 失败 (${name}):`, e);
    }
  }
  return vrmAnim;
}

/**
 * 预加载所有已配置的 VRMA 动作
 */
async function preloadAllVrmaMotions() {
  const promises = Object.entries(MOTION_URLS).map(([name, url]) => loadVrmaFile(name, url));
  await Promise.allSettled(promises);
  if (currentVrm && !currentIdleAction) {
    playIdleMotion();
  }
  maybeAutoGreeting();
}

/**
 * 模型与官方动作都就绪后，自动播放一次打招呼动作 (每次加载模型仅一次)
 */
let autoGreetingDone = false;
function maybeAutoGreeting() {
  if (!AUTO_GREETING_ON_LOAD || autoGreetingDone) return;
  if (!currentAnimationMixer) return;
  if (activeMotionClips['pmx_greeting']) {
    autoGreetingDone = true;
    playMotion('pmx_greeting');
  } else if (activeMotionClips['greeting']) {
    autoGreetingDone = true;
    playMotion('greeting');
  }
}

/**
 * 为新载入的 VRM 模型初始化动作混合器 AnimationMixer 并重定向动作 Clip
 */
function setupMotionMixer(vrm) {
  if (!vrm) return;
  if (currentAnimationMixer) {
    currentAnimationMixer.stopAllAction();
  }
  currentAnimationMixer = new THREE.AnimationMixer(vrm.scene);
  currentIdleAction = null;
  currentMotionAction = null;
  autoGreetingDone = false;

  // 清空之前角色的 clip 映射
  for (const k in activeMotionClips) delete activeMotionClips[k];

  // 绑定所有已载入的 VRMA 动作
  for (const [name, vrmAnim] of Object.entries(loadedVrmAnimations)) {
    try {
      activeMotionClips[name] = createVRMAnimationClip(vrmAnim, vrm);
    } catch (e) {
      console.warn(`[Motion] 为新角色生成动作 clip 失败 (${name}):`, e);
    }
  }

  // 生成程序化备用动画 (防止个别 .vrma 文件缺失时无动作)
  ensureProceduralMotionClips(vrm);

  // 启动常驻待机动作
  playIdleMotion();

  // 切换角色后重新打一次招呼 (仅当官方动作已就绪)
  maybeAutoGreeting();
}

/**
 * 当部分动作文件缺失时，生成高品质程序化 VRM 人形骨骼关键帧动画作为保底
 */
function ensureProceduralMotionClips(vrm) {
  if (!vrm || !vrm.humanoid) return;
  const h = vrm.humanoid;
  const headNode = h.getNormalizedBoneNode('head');
  const chestNode = h.getNormalizedBoneNode('chest');
  const hipsNode = h.getNormalizedBoneNode('hips');

  const base = rigBaseQuaternion(vrm);
  const IDENTITY_QUAT = new THREE.Quaternion();

  // 底层：把一组**局部增量**四元数写成以 restQuat 为基准的旋转关键帧轨道
  const quatTrack = (node, restQuat, times, quats) => {
    const values = [];
    for (const q of quats) {
      values.push(...q.clone().multiply(restQuat).toArray());
    }
    return new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, values);
  };

  // 以当前 rest 姿态 (applyNaturalPose 之后的自然站姿) 为基准生成旋转关键帧轨道。
  // 传入的欧拉角按**世界系**语义解释：先用本节开头的基准把 VRM 0.x/1.0 的基差抵掉，
  // 于是同一组手调数值在两个版本上得到相同的世界旋转（对 VRM 1.0 是恒等变换）。
  const rotTrack = (node, times, worldEulers) =>
    quatTrack(
      node,
      node.quaternion.clone(),
      times,
      worldEulers.map((euler) => authoredEulerToLocal(base, euler))
    );

  // 1. cheerful_bounce (欢快跳跃/雀跃)
  if (!activeMotionClips['cheerful_bounce'] && hipsNode) {
    const tracks = [];
    const restHipsY = hipsNode.position.y;
    tracks.push(new THREE.VectorKeyframeTrack(
      `${hipsNode.name}.position`,
      [0.0, 0.25, 0.55, 0.85, 1.2, 1.5],
      [
        hipsNode.position.x, restHipsY, hipsNode.position.z,
        hipsNode.position.x, restHipsY + 0.04, hipsNode.position.z,
        hipsNode.position.x, restHipsY - 0.005, hipsNode.position.z,
        hipsNode.position.x, restHipsY + 0.025, hipsNode.position.z,
        hipsNode.position.x, restHipsY, hipsNode.position.z,
        hipsNode.position.x, restHipsY, hipsNode.position.z
      ]
    ));
    if (headNode) {
      const qRest = headNode.quaternion.clone();
      const qTilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.06, 0, 0.03)).multiply(qRest);
      tracks.push(new THREE.QuaternionKeyframeTrack(
        `${headNode.name}.quaternion`,
        [0.0, 0.3, 0.6, 1.0, 1.5],
        [...qRest.toArray(), ...qTilt.toArray(), ...qRest.toArray(), ...qTilt.toArray(), ...qRest.toArray()]
      ));
    }
    activeMotionClips['cheerful_bounce'] = new THREE.AnimationClip('cheerful_bounce', 1.5, tracks);
  }

  // 2. surprise_jump (受惊后缩)
  if (!activeMotionClips['surprise_jump'] && hipsNode) {
    const tracks = [];
    const restHipsY = hipsNode.position.y;
    const restHipsZ = hipsNode.position.z;
    tracks.push(new THREE.VectorKeyframeTrack(
      `${hipsNode.name}.position`,
      [0.0, 0.15, 0.5, 0.9, 1.4],
      [
        hipsNode.position.x, restHipsY, restHipsZ,
        hipsNode.position.x, restHipsY + 0.02, restHipsZ - 0.035,
        hipsNode.position.x, restHipsY, restHipsZ - 0.02,
        hipsNode.position.x, restHipsY, restHipsZ,
        hipsNode.position.x, restHipsY, restHipsZ
      ]
    ));
    if (headNode) {
      const qRest = headNode.quaternion.clone();
      const qBack = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.08, 0, 0)).multiply(qRest);
      tracks.push(new THREE.QuaternionKeyframeTrack(
        `${headNode.name}.quaternion`,
        [0.0, 0.15, 0.5, 1.0, 1.4],
        [...qRest.toArray(), ...qBack.toArray(), ...qBack.toArray(), ...qRest.toArray(), ...qRest.toArray()]
      ));
    }
    activeMotionClips['surprise_jump'] = new THREE.AnimationClip('surprise_jump', 1.4, tracks);
  }

  // 3. gentle_nod (温柔点头)
  if (!activeMotionClips['gentle_nod'] && headNode) {
    const tracks = [];
    const qRest = headNode.quaternion.clone();
    const qNod1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.09, 0, 0)).multiply(qRest);
    const qNod2 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.06, 0, 0)).multiply(qRest);
    tracks.push(new THREE.QuaternionKeyframeTrack(
      `${headNode.name}.quaternion`,
      [0.0, 0.35, 0.7, 1.05, 1.4, 1.7],
      [...qRest.toArray(), ...qNod1.toArray(), ...qRest.toArray(), ...qNod2.toArray(), ...qRest.toArray(), ...qRest.toArray()]
    ));
    activeMotionClips['gentle_nod'] = new THREE.AnimationClip('gentle_nod', 1.7, tracks);
  }

  // 4. pout_turn (傲娇侧身)
  if (!activeMotionClips['pout_turn'] && headNode) {
    const tracks = [];
    const qRest = headNode.quaternion.clone();
    const qTurn = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05, 0.22, 0.03)).multiply(qRest);
    tracks.push(new THREE.QuaternionKeyframeTrack(
      `${headNode.name}.quaternion`,
      [0.0, 0.25, 0.8, 1.2, 1.5],
      [...qRest.toArray(), ...qTurn.toArray(), ...qTurn.toArray(), ...qRest.toArray(), ...qRest.toArray()]
    ));
    activeMotionClips['pout_turn'] = new THREE.AnimationClip('pout_turn', 1.5, tracks);
  }

  // 5. wave_hand (轻柔摆手 / 招手问候)
  //
  // 这里不用写死的欧拉角，而是按「期望的骨骼世界指向」运行时反解（原因见 §2 开头）。
  // 目标指向用**角色自身基**表达，于是三份模型共用同一组「意图」：
  //   上臂 下放到肩下 + 略前收；前臂竖直竖起并使肘部保持约 133° 的弯；
  //   前臂绕 forward 轴左右摆 ±16°，把手举到脸侧（指尖约额头高度）；
  //   手腕单独反解，让掌心正对观众。
  // 三处踩过的坑：
  //   ① 只抬上臂而不给前臂足够的肘弯，整条手臂会退化成一根水平外伸的直杆；
  //   ② 肘部抬到肩高并向外伸，看起来是「停下」而不是「打招呼」，要下放+前收；
  //   ③ 不驱动 rightHand 的话掌心朝向会继承 T-pose（朝下），手背/侧面对人。
  // 反解顺序必须是 上臂 → 刷新矩阵 → 前臂 → 手腕：子骨骼的解依赖父骨骼已摆好的姿态；
  // 且每解一个键前先把该骨骼复位，否则上一次的姿态会污染这一次的「当前指向」。
  if (!activeMotionClips['wave_hand']) {
    const rUpperArm = h.getNormalizedBoneNode('rightUpperArm');
    const rLowerArm = h.getNormalizedBoneNode('rightLowerArm');
    const rHand = h.getNormalizedBoneNode('rightHand');
    const basis = characterBasis(vrm);
    if (rUpperArm && rLowerArm && rHand && basis) {
      const UPPER_TARGET = basisToWorld(basis, 0.76, -0.48, 0.44); // 下放 + 前收
      const FORE_TARGET = basisToWorld(basis, -0.22, 0.96, -0.13); // 竖起 + 略朝脸侧收
      const SWING_DEG = 16; // 前臂摆幅（绕 forward 轴）
      const VIEWER_DIR = new THREE.Vector3(0, 0, 1);

      // 反解基准是自然站姿，解出的增量要配这组 rest 使用
      applyNaturalPose(vrm);
      const qUpRest = rUpperArm.quaternion.clone();
      const qLowRest = rLowerArm.quaternion.clone();
      const qHandRest = rHand.quaternion.clone();

      // 上臂：解出来就真的施加，前臂的解依赖已经抬起的父骨骼
      const dUp = solveBoneAim(rUpperArm, rLowerArm, UPPER_TARGET);
      rUpperArm.quaternion.copy(qUpRest).premultiply(dUp);
      vrm.scene.updateMatrixWorld(true);

      // 前臂：中位 + 绕 forward 轴 ±SWING_DEG 的两个端点
      const foreDelta = (swingDeg) => {
        rLowerArm.quaternion.copy(qLowRest);
        vrm.scene.updateMatrixWorld(true);
        const target = FORE_TARGET.clone().applyQuaternion(
          new THREE.Quaternion().setFromAxisAngle(basis.forward, THREE.MathUtils.degToRad(swingDeg))
        );
        return solveBoneAim(rLowerArm, rHand, target);
      };
      const dSwingIn = foreDelta(-SWING_DEG);
      const dSwingMid = foreDelta(0);
      const dSwingOut = foreDelta(SWING_DEG);

      // 手腕：先把前臂摆到中位，再把掌心法线转到观众方向
      rLowerArm.quaternion.copy(qLowRest).premultiply(dSwingMid);
      vrm.scene.updateMatrixWorld(true);
      const palm = palmNormal(vrm, 'right');
      const handParentWorld = rHand.parent.getWorldQuaternion(new THREE.Quaternion());
      const dHand = handParentWorld
        .clone()
        .invert()
        .multiply(
          palm ? new THREE.Quaternion().setFromUnitVectors(palm, VIEWER_DIR) : new THREE.Quaternion()
        )
        .multiply(handParentWorld);

      // 复位，别把反解过程中的姿态带进后面几个 clip 的 qRest
      rUpperArm.quaternion.copy(qUpRest);
      rLowerArm.quaternion.copy(qLowRest);
      rHand.quaternion.copy(qHandRest);
      vrm.scene.updateMatrixWorld(true);

      const tracks = [
        // 抬臂 → 保持 → 回落
        quatTrack(rUpperArm, qUpRest, [0.0, 0.35, 2.45, 2.7], [
          IDENTITY_QUAT, dUp, dUp, IDENTITY_QUAT
        ]),
        // 前臂来回摆动 3 次 (0.6s 一个来回)
        quatTrack(
          rLowerArm,
          qLowRest,
          [0.0, 0.35, 0.65, 0.95, 1.25, 1.55, 1.85, 2.15, 2.45, 2.7],
          [
            IDENTITY_QUAT, dSwingMid, dSwingOut, dSwingIn, dSwingOut,
            dSwingIn, dSwingOut, dSwingIn, dSwingMid, IDENTITY_QUAT
          ]
        ),
        // 手腕滚转：掌心朝向观众
        quatTrack(rHand, qHandRest, [0.0, 0.35, 2.45, 2.7], [
          IDENTITY_QUAT, dHand, dHand, IDENTITY_QUAT
        ])
      ];
      if (headNode) {
        tracks.push(rotTrack(headNode, [0.0, 0.45, 2.45, 2.7], [
          [0, 0, 0], [0.02, -0.14, 0.08], [0.02, -0.14, 0.08], [0, 0, 0]
        ]));
      }
      activeMotionClips['wave_hand'] = new THREE.AnimationClip('wave_hand', 2.7, tracks);
    }
  }

  // 6. shake_head (轻轻摇头 / 否定)
  if (!activeMotionClips['shake_head'] && headNode) {
    const tracks = [rotTrack(headNode, [0.0, 0.25, 0.6, 0.95, 1.3, 1.65], [
      [0, 0, 0], [0.03, -0.20, 0.02], [0.03, 0.20, -0.02], [0.03, -0.16, 0.02], [0.03, 0.14, -0.02], [0, 0, 0]
    ])];
    if (chestNode) {
      tracks.push(rotTrack(chestNode, [0.0, 0.6, 1.3, 1.65], [
        [0, 0, 0], [0, -0.05, 0], [0, 0.05, 0], [0, 0, 0]
      ]));
    }
    activeMotionClips['shake_head'] = new THREE.AnimationClip('shake_head', 1.65, tracks);
  }

  // 7. shy_tilt (歪头害羞)
  if (!activeMotionClips['shy_tilt'] && headNode) {
    const tracks = [rotTrack(headNode, [0.0, 0.6, 1.6, 2.2], [
      [0, 0, 0], [0.12, 0.06, 0.26], [0.12, 0.06, 0.26], [0, 0, 0]
    ])];
    if (chestNode) {
      tracks.push(rotTrack(chestNode, [0.0, 0.6, 1.6, 2.2], [
        [0, 0, 0], [0.03, 0, 0.06], [0.03, 0, 0.06], [0, 0, 0]
      ]));
    }
    activeMotionClips['shy_tilt'] = new THREE.AnimationClip('shy_tilt', 2.2, tracks);
  }
}



/**
 * 播放常驻待机动作 (Idle Loop)
 */
function playIdleMotion() {
  if (motionRouter && motionRouter.activeSystem && typeof motionRouter.activeSystem.playIdleMotion === 'function') {
    motionRouter.activeSystem.playIdleMotion();
    return;
  }
  if (!currentAnimationMixer) return;
  const clip = activeMotionClips['idle'];
  if (!clip) return;

  if (currentIdleAction) {
    currentIdleAction.stop();
  }
  currentIdleAction = currentAnimationMixer.clipAction(clip);
  currentIdleAction.setLoop(THREE.LoopRepeat);
  currentIdleAction.setEffectiveWeight(1.0);
  currentIdleAction.fadeIn(0.4).play();
}

/**
 * 播放指定动作并平滑过渡回待机 (One-shot Action with Crossfade)
 * @param {string} motionName - 动作标识 (如 'cheerful_bounce', 'surprise_jump')
 */
function playMotion(motionName) {
  if (motionRouter && motionRouter.activeSystem) {
    const handled = motionRouter.playMotion(motionName);
    if (handled) return;
  }
  if (!currentAnimationMixer) return;
  const clip = activeMotionClips[motionName];
  if (!clip) {
    console.debug(`[Motion] 动作 ${motionName} 未找到对应动画片段`);
    return;
  }

  console.log(`[Motion] ▶ 播放肢体动作: ${motionName}`);

  // 打断尚未结束的上一个动作，避免监听器泄漏与权重叠加
  const wasInterrupting = !!currentMotionAction;
  if (currentMotionAction) {
    if (currentMotionFinishedHandler) {
      currentAnimationMixer.removeEventListener('finished', currentMotionFinishedHandler);
      currentMotionFinishedHandler = null;
    }
    currentMotionAction.stop();
    currentMotionAction = null;
  }

  // ★ 全局原点复位：若上一个动作被打断，立刻将当前模型表情归零并复位骨骼到原点
  if (currentAdapter) {
    if (typeof currentAdapter.resetExpressions === 'function') {
      currentAdapter.resetExpressions(true);
    } else if (typeof currentAdapter.setEmotion === 'function') {
      currentAdapter.setEmotion('neutral', 1.0);
    }
    if (typeof currentAdapter.resetPose === 'function') {
      currentAdapter.resetPose();
    } else if (typeof currentAdapter.applyNaturalPose === 'function') {
      currentAdapter.applyNaturalPose();
    }
  }

  const action = currentAnimationMixer.clipAction(clip);
  action.stop();
  action.reset();
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.setEffectiveWeight(1.0);

  if (wasInterrupting) {
    action.fadeIn(0.15);
  } else if (currentIdleAction) {
    action.crossFadeFrom(currentIdleAction, 0.25, false);
  } else {
    action.fadeIn(0.25);
  }

  action.play();
  currentMotionAction = action;

  const onFinished = (e) => {
    if (e.action !== action) return;
    currentAnimationMixer.removeEventListener('finished', onFinished);
    if (currentMotionFinishedHandler === onFinished) currentMotionFinishedHandler = null;
    if (currentMotionAction !== action) return; // 已被新动作接管，不再干预 idle
    currentMotionAction = null;

    if (currentAdapter) {
      if (typeof currentAdapter.resetExpressions === 'function') {
        currentAdapter.resetExpressions(false);
      }
      if (typeof currentAdapter.resetPose === 'function') {
        currentAdapter.resetPose();
      }
    }

    // clampWhenFinished 会让动作停在最后一帧，但权重仍保持 1。不淡出的话它会一直
    // 和 idle 混合下去，把角色姿势永久拖偏（自动打招呼尤其明显：VRMA_01 的收尾
    // 帧并非站姿）。淡出结束时 three.js 会自动把该动作置为 disabled。
    action.fadeOut(0.35);
    if (currentIdleAction) {
      currentIdleAction.reset().setEffectiveWeight(1.0).fadeIn(0.35).play();
    }
  };
  currentMotionFinishedHandler = onFinished;
  currentAnimationMixer.addEventListener('finished', onFinished);
}

window.activeMotionClips = activeMotionClips;
window.playMotion = playMotion;
window.playIdleMotion = playIdleMotion;

/**
 * 预留语音/台词反馈接口 (Voice & Speech Reaction Interface)
 * 用户要求：目前点击模型身体范围内不配合出现发言和语音，以备注注释形式预留扩展空间。
 * 
 * @param {string} hitPart - 触碰部位 ('head' 头部 / 'body' 身体)
 * @param {string} characterName - 当前角色名称
 */
function playVoiceReaction(hitPart, characterName) {
  /*
  // ==========================================
  // 预留触碰台词与语音合成扩展 (未来可随时开启)
  // ==========================================
  // 示例 1: 角色触碰随机台词表
  const VOICE_LINES = {
    '喜多郁代': {
      head: ['欸嘿嘿～不要摸头啦，头发会乱的！', '哇！好舒服～✨', '最喜欢你了！'],
      body: ['哇呀！戳到我了啦！', '怎么突然戳我？要准备演出了吗？', 'キタオーラ発射〜！']
    },
    '由比滨结衣': {
      head: ['呀哈啰！摸摸头好舒服哦～', '哇，头上有东西吗？', '嘻嘻～'],
      body: ['呜哇！有点痒啦～', '碰我有什么事吗？今天也元气满满哦！', '呀！吓了我一跳！']
    },
    '雷电将军': {
      head: ['……休得无礼。', '这便是……触碰的感觉么。', '……'],
      body: ['何事？', '此身即是永恒，莫要随意动手动脚。', '雷霆之威，不可轻亵。']
    },
    '弗洛洛': {
      head: ['……頭の中の雑音を取り除きなさい。', '不躾な調律はおやめなさい。', '……ふふ、面白い周波数ね。'],
      body: ['私に触れるなど、どんな旋律をお望みかしら？', 'リコリスの海に溺れたいのかしら。', '過剰に警戒する必要はないけれど、礼節は弁えて。']
    },
    '时崎狂三': {
      head: ['うふふ、髪に触れたいのですか？乱暴になさっては駄目ですわよ。', 'あら……そんなに優しく撫でられては、熱を帯びてしまいますわ。', 'ふふっ、可愛いお方。もっと近くにいらっしゃいな。'],
      body: ['まあ、いきなりお身体に触れるだなんて……大胆な方ですこと。', '食べてしまいたいほど愛らしいお方……それとも、わたくしに美味しく召し上がられたいのかしら？', 'はぁ……ん、そんな悪戯な指先……後でどうなっても知りませんわよ？うふふ。']
    }
  };

  // 示例 2: 本地气泡展示台词
  // const charLines = VOICE_LINES[characterName] || { head: ['……？'], body: ['……！'] };
  // const partLines = charLines[hitPart] || charLines.body;
  // const randomLine = partLines[Math.floor(Math.random() * partLines.length)];
  // showDialogue(characterName, randomLine);

  // 示例 3: 通过 WebSocket 请求服务端合成语音
  // if (ws && ws.readyState === WebSocket.OPEN) {
  //   ws.send(JSON.stringify({
  //     type: 'touch-reaction',
  //     part: hitPart,
  //     character: characterName,
  //     text: randomLine
  //   }));
  // }
  */
}

/**
 * 响应点击 3D 模型的事件处理器
 */
function handleModelClick(event) {
  const hitMesh = currentAdapter ? currentAdapter.getHitMesh() : (currentVrm ? currentVrm.scene : null);
  if (!hitMesh || !camera) return;

  const now = Date.now();
  if (now - lastInteractionTime < CLICK_COOLDOWN_MS) return;

  const rect = renderer.domElement.getBoundingClientRect();
  clickMouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  clickMouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  clickRaycaster.setFromCamera(clickMouse, camera);
  const intersects = clickRaycaster.intersectObject(hitMesh, true);

  if (intersects.length === 0) return; // 点击位置未在 3D 模型身体网格上

  lastInteractionTime = now;

  // 根据击中位置的三维坐标判定触碰部位 (头部 y > 1.28)
  const hitPoint = intersects[0].point;
  const hitPart = hitPoint.y > 1.28 ? 'head' : 'body';
  const activeSpeaker = (bubbleSender && bubbleSender.textContent) || (document.getElementById('character-title')?.textContent) || 'AI';

  // 随机挑选反馈表情与动作
  const reaction = CLICK_REACTIONS[Math.floor(Math.random() * CLICK_REACTIONS.length)];
  console.log(`[Interaction] 点击模型 (${hitPart}) -> 触发表情: ${reaction.emotion}, 预留动作: ${reaction.motion}`);

  // 1. 触发表情变化
  setEmotion(reaction.emotion, reaction.weight);

  // 2. 触发预留动作接口
  playMotion(reaction.motion);

  // 3. 触发预留语音/台词接口 (当前为纯注释预留)
  playVoiceReaction(hitPart, activeSpeaker);

  // 4. 定时复原表情为 neutral (若此时正在播报 AI 对话语音则不打断)
  if (interactionResetTimeout) clearTimeout(interactionResetTimeout);
  interactionResetTimeout = setTimeout(() => {
    if (!isPlayingAudio) {
      setEmotion('neutral', 0);
    }
  }, reaction.duration);
}

/**
 * 初始化 3D 角色身体点击与光标交互系统
 */
function initClickInteraction() {
  let pointerDownPos = { x: 0, y: 0, time: 0 };

  renderer.domElement.addEventListener('pointerdown', (e) => {
    pointerDownPos = { x: e.clientX, y: e.clientY, time: Date.now() };
  });

  renderer.domElement.addEventListener('pointerup', (e) => {
    const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
    const dur = Date.now() - pointerDownPos.time;
    // 判定为纯粹点击 (位移 < 8px 且耗时 < 500ms)，避免 OrbitControls 旋转缩放误触
    if (dist < 8 && dur < 500) {
      handleModelClick(e);
    }
  });

  // 鼠标悬停在模型上时动态切换手型光标 (pointer / default)
  let hoverThrottle = 0;
  renderer.domElement.addEventListener('pointermove', (e) => {
    const now = Date.now();
    if (now - hoverThrottle < 60) return; // 约 16fps 节流
    hoverThrottle = now;

    const hitMesh = currentAdapter ? currentAdapter.getHitMesh() : (currentVrm ? currentVrm.scene : null);
    if (!hitMesh || !camera) return;
    const rect = renderer.domElement.getBoundingClientRect();
    clickMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    clickMouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    clickRaycaster.setFromCamera(clickMouse, camera);
    const hits = clickRaycaster.intersectObject(hitMesh, true);
    renderer.domElement.style.cursor = hits.length > 0 ? 'pointer' : 'default';
  });
}

// --- 5. WebSocket Integration ---
function initWebSocket() {
  const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${location.host}/client-ws`;

  updateStatus('connecting', '连接中...');

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('✅ Connected to Open-LLM-VTuber WebSocket');
      updateStatus('connected', '在线就绪');

      if (heartbeatInterval) clearInterval(heartbeatInterval);
      heartbeatInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'heartbeat' }));
        }
      }, 20000);

      ws.send(JSON.stringify({ type: 'fetch-configs' }));
      ws.send(JSON.stringify({ type: 'switch-config', file: 'zh_yuigahama_yui_01.yaml' }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleServerMessage(data);
      } catch (err) {
        console.error('Error parsing WS message:', err);
      }
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
      updateStatus('disconnected', '连接异常');
    };

    ws.onclose = () => {
      console.warn('WebSocket closed. Reconnecting in 3s...');
      updateStatus('disconnected', '连接断开 (重连中)');
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      setTimeout(initWebSocket, 3000);
    };
  } catch (e) {
    console.error('Failed to create WebSocket:', e);
    setTimeout(initWebSocket, 4000);
  }
}

function handleServerMessage(data) {
  const type = data.type;

  switch (type) {
    case 'full-text':
      if (data.text === 'Thinking...') {
        markThinking();
      } else if (data.text) {
        // 有实际内容回来，说明这一轮在推进，刷新空闲计时
        touchStatusActivity();
        const currentName = (bubbleSender && bubbleSender.textContent) || 'AI';
        showDialogue(currentName, data.text);
      }
      break;

    case 'audio':
      // 音频到达即视为本轮仍在进行，刷新空闲计时
      touchStatusActivity();
      handleAudioMessage(data);
      break;

    case 'user-input-transcription':
      if (data.text) {
        userTranscript.textContent = `“${data.text}”`;
        userTranscript.style.display = 'block';
      }
      break;

    case 'config-files':
      if (data.configs && configSelect) {
        configSelect.innerHTML = '';
        data.configs.forEach((item) => {
          const opt = document.createElement('option');
          const fileName = typeof item === 'string' ? item : item.filename;
          const displayName = typeof item === 'string' ? item : (item.name || item.filename);
          opt.value = fileName;
          opt.textContent = displayName;
          configSelect.appendChild(opt);
        });

        // 同步服务端配置列表，优先以角色身份证 ID 进行精准匹配
        const activeCharId = currentAdapter?.characterId;
        for (let opt of configSelect.options) {
          const optId = opt.getAttribute('data-id') || resolveCharacterId(opt.value);
          if (activeCharId && optId === activeCharId) {
            opt.selected = true;
            break;
          }
        }
      }
      break;

    case 'set-model-and-conf':
      console.log('Current character config:', data.conf_uid || data.conf_name);
      const activeCharId = data.conf_uid || data.character_id || resolveCharacterId(data.conf_name);
      if (activeCharId) {
        applyCharacterUI(activeCharId);
        if (configSelect) {
          for (let opt of configSelect.options) {
            const optId = opt.getAttribute('data-id') || resolveCharacterId(opt.value);
            if (optId === activeCharId || opt.value.includes(activeCharId)) {
              opt.selected = true;
              break;
            }
          }
        }
      }
      break;

    case 'control':
      if (data.text === 'interrupt') {
        stopAudioPlayback();
      }
      break;

    default:
      break;
  }
}

function sendTextMessage(text) {
  if (!text || !text.trim()) return;
  ensureAudioContext();

  if (ws && ws.readyState === WebSocket.OPEN) {
    userTranscript.textContent = `“${text}”`;
    userTranscript.style.display = 'block';
    markThinking();

    ws.send(JSON.stringify({
      type: 'text-input',
      text: text.trim()
    }));
  } else {
    alert('未连接到服务端，请确认后端已启动！');
  }
}

function interruptSpeech() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'interrupt-signal',
      text: 'interrupt'
    }));
  }
  stopAudioPlayback();
}

// --- 6. UI Helpers ---

// ===== 状态灯：「思考中」的自动复位 =====
// 服务端只发 conversation-chain-start，没有明确的「对话结束」信号。
// 所以改用「空闲计时」：收到任何进展（文本/音频）就刷新，静默一段时间后
// 自动回到「在线就绪」。否则思考灯会一直亮着（TTS 失败时尤其明显）。
const STATUS_IDLE_MS = 12000;
let statusIdleTimer = null;

function touchStatusActivity() {
  if (statusIdleTimer !== null) clearTimeout(statusIdleTimer);
  statusIdleTimer = setTimeout(() => {
    statusIdleTimer = null;
    updateStatus('connected', '在线就绪');
  }, STATUS_IDLE_MS);
}

function markThinking() {
  updateStatus('thinking', '思考中...');
  touchStatusActivity();
}

function updateStatus(stateClass, text) {
  statusDot.className = 'status-dot ' + stateClass;
  statusText.textContent = text;
}

let dialogueTimeout = null;
function showDialogue(sender, text) {
  bubbleSender.textContent = sender;
  bubbleText.textContent = text;
  dialogueBubble.classList.add('visible');

  if (dialogueTimeout) clearTimeout(dialogueTimeout);
  dialogueTimeout = setTimeout(() => {
    if (!isPlayingAudio) {
      dialogueBubble.classList.remove('visible');
    }
  }, 12000);
}

function resetCamera() {
  controls.target.set(0, 1.30, 0);
  camera.position.set(0, 1.36, 1.25);
  controls.update();
}

// --- 7. Microphone Input ---
async function toggleMicrophone() {
  ensureAudioContext();

  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
}

async function startRecording() {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000
      }
    });

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    micAudioContext = new AudioCtx({ sampleRate: 16000 });
    const source = micAudioContext.createMediaStreamSource(mediaStream);

    const processor = micAudioContext.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => {
      if (!isRecording) return;
      const inputData = e.inputBuffer.getChannelData(0);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'mic-audio-data',
          audio: Array.from(inputData)
        }));
      }
    };

    source.connect(processor);
    processor.connect(micAudioContext.destination);

    isRecording = true;
    btnMic.classList.add('recording');
    btnMic.title = '点击停止录音并发送';
    updateStatus('speaking', '正在倾听...');
  } catch (err) {
    console.error('Microphone access denied:', err);
    alert('无法访问麦克风，请检查浏览器麦克风权限！');
  }
}

function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  btnMic.classList.remove('recording');
  btnMic.title = '点击开启语音输入';

  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
  if (micAudioContext) {
    micAudioContext.close();
    micAudioContext = null;
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'mic-audio-end' }));
    updateStatus('thinking', '正在识别与思考...');
  }
}

// --- 8. Event Binding ---
function bindEvents() {
  // 初始化 3D 角色触碰与动作交互监听
  initClickInteraction();

  btnSend.addEventListener('click', () => {
    sendTextMessage(textInput.value);
    textInput.value = '';
  });

  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      sendTextMessage(textInput.value);
      textInput.value = '';
    }
  });

  btnMic.addEventListener('click', toggleMicrophone);
  btnInterrupt.addEventListener('click', interruptSpeech);
  btnResetCam.addEventListener('click', resetCamera);

  if (configSelect) {
    configSelect.addEventListener('change', (e) => {
      const selected = e.target.value;
      if (selected && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'switch-config', file: selected }));
      }
      applyCharacterUI(selected);
    });
  }

  // 情绪选择下拉：选中即触发对应人设表情联动
  const emotionSelect = document.getElementById('emotion-select');
  let emotionAutoResetTimer = null;
  if (emotionSelect) {
    emotionSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      if (!val) return;
      if (emotionAutoResetTimer) {
        clearTimeout(emotionAutoResetTimer);
        emotionAutoResetTimer = null;
      }
      setEmotion(val, 0.95);
      if (val !== 'neutral') {
        emotionAutoResetTimer = setTimeout(() => {
          setEmotion('neutral', 0);
        }, 4000);
      }
    });
  }

  // 动作演示下拉：选中即播放一次对应肢体动作，随后自动回落到待机
  const motionSelect = document.getElementById('motion-select');
  if (motionSelect) {
    motionSelect.addEventListener('change', (e) => {
      const motionName = e.target.value;
      if (!motionName) return;
      if (currentAnimationMixer || (motionRouter && motionRouter.activeSystem)) {
        playMotion(motionName);
      } else {
        console.warn('[Motion] 角色模型尚未就绪，暂时无法播放动作');
      }
      setTimeout(() => {
        if (motionSelect) motionSelect.value = '';
      }, 120);
    });
  }

  // 键盘快捷键监听：1喜 2怒 3哀 4乐 0平，触发人设面部表情与专属动作联动
  window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable)) {
      return;
    }

    if (e.key === '1') {
      console.log('[Hotkey 1] 触发: 喜 (Happy) + 元气跳跃');
      if (emotionAutoResetTimer) clearTimeout(emotionAutoResetTimer);
      setEmotion('happy', 0.95);
      playMotion('cheerful_bounce');
      emotionAutoResetTimer = setTimeout(() => setEmotion('neutral', 0), 4500);
    } else if (e.key === '2') {
      console.log('[Hotkey 2] 触发: 怒 (Angry) + 傲娇侧身');
      if (emotionAutoResetTimer) clearTimeout(emotionAutoResetTimer);
      setEmotion('angry', 0.95);
      playMotion('pout_turn');
      emotionAutoResetTimer = setTimeout(() => setEmotion('neutral', 0), 4500);
    } else if (e.key === '3') {
      console.log('[Hotkey 3] 触发: 哀 (Sad) + 委屈摇头');
      if (emotionAutoResetTimer) clearTimeout(emotionAutoResetTimer);
      setEmotion('sad', 0.95);
      playMotion('shake_head');
      emotionAutoResetTimer = setTimeout(() => setEmotion('neutral', 0), 4500);
    } else if (e.key === '4') {
      console.log('[Hotkey 4] 触发: 乐 / 调皮 (Playful/Relaxed) + 招手');
      if (emotionAutoResetTimer) clearTimeout(emotionAutoResetTimer);
      setEmotion('relaxed', 0.95);
      playMotion('wave_hand');
      emotionAutoResetTimer = setTimeout(() => setEmotion('neutral', 0), 4500);
    } else if (e.key === '0') {
      console.log('[Hotkey 0] 触发: 平静 (Neutral)');
      if (emotionAutoResetTimer) clearTimeout(emotionAutoResetTimer);
      setEmotion('neutral', 0);
    }
  });

  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const text = chip.getAttribute('data-text');
      if (text) sendTextMessage(text);
    });
  });

  // 全局设置按钮 —— 拉起**独立全局设置窗口**
  const btnSettings = document.getElementById('btn-settings');
  if (btnSettings) {
    btnSettings.addEventListener('click', () => openSettingsWindow('settings'));
  }

  // 角色设置按钮 —— 拉起**独立角色设置窗口**
  const btnCharacter = document.getElementById('btn-character');
  if (btnCharacter) {
    btnCharacter.addEventListener('click', () => openSettingsWindow('character'));
  }

  // Global user gesture unlock for Web Audio
  document.body.addEventListener('click', () => ensureAudioContext(), { once: true });

  // 监听独立设置窗口的保存通知。
  // storage 事件只在**其他窗口**改动同一 key 时触发，正好符合"设置窗口保存 -> 主视口刷新"的场景。
  window.addEventListener('storage', (e) => {
    if (e.key !== 'vtuber:settings-updated' || !e.newValue) return;
    console.info('[Settings] 检测到设置窗口已保存，正在重载当前角色配置…');
    const file = configSelect ? configSelect.value : null;
    if (file && ws && ws.readyState === WebSocket.OPEN) {
      // 复用 switch-config：后端会按最新 conf.yaml / 角色 yaml 重建 agent 与 TTS
      ws.send(JSON.stringify({ type: 'switch-config', file }));
    }
  });
}

// --- 9. Settings Window Launchers ---
/**
 * 拉起独立设置窗口。
 * @param {'settings'|'character'} page 要打开的设置页（全局 / 角色）
 * @param {string} [tab] 可选：直接定位到某个 tab
 * 优先让后端以 Edge/Chrome 的 --app 模式弹出（无地址栏，形似原生弹窗）；
 * 若后端不可用（如远程访问场景），退化为普通浏览器弹出窗口。
 */
async function openSettingsWindow(page = 'settings', tab) {
  const character = configSelect ? configSelect.value : '';
  const qs = new URLSearchParams();
  qs.set('page', page);
  if (character) qs.set('character', character);
  if (tab) qs.set('tab', tab);

  try {
    const res = await fetch(`/api/settings/open-window?${qs.toString()}`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return;
  } catch (e) {
    console.warn('后端拉起设置窗口失败，退化为浏览器弹窗:', e.message);
  }
  const file = page === 'character' ? './character.html' : './settings.html';
  window.open(`${file}?${qs.toString()}`, 'vtuber-settings', 'width=1020,height=780');
}

function applyBackgroundTheme(themeKey) {
  const container = document.getElementById('canvas-container');
  if (!container) return;
  const bgMap = {
    default: '#17152b',
    'ceiling-window': '/bg/ceiling-window-room-night.jpeg',
    cityscape: '/bg/cityscape.jpeg',
    'computer-room': '/bg/computer-room-illustration.jpeg',
    'moon-mountain': '/bg/moon-over-mountain.jpeg',
  };

  const val = bgMap[themeKey] || bgMap.default;
  if (val.startsWith('/')) {
    container.style.backgroundImage = `url('${val}')`;
    container.style.backgroundSize = 'cover';
    container.style.backgroundPosition = 'center';
  } else {
    container.style.backgroundImage = 'none';
    container.style.backgroundColor = val;
  }
}

// --- 10. Animation Render Loop ---
function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  const elapsedTime = clock.getElapsedTime();

  if (currentAdapter) {
    // 1. 驱动骨骼动作与待机循环 (仅当非 PMX 或 PMX 自驱动时由各自内部或全局处理)
    if (currentAdapter.type === 'vrm' && currentAnimationMixer) {
      currentAnimationMixer.update(delta);
    }
    // 2. 语音口型 Viseme 分析
    updateLipSync();
    // 3. 自然眨眼
    updateBlink(delta);
    // 4. 程序化待机补正 (当无动作播放时保底)
    updateIdle(elapsedTime);
    // 5. 调用适配器 update 驱动底层物理、LookAt 或 MMD Runtime
    currentAdapter.update(delta, elapsedTime);
  } else if (currentVrm) {
    if (currentAnimationMixer) {
      currentAnimationMixer.update(delta);
    }
    updateLipSync();
    updateBlink(delta);
    updateIdle(elapsedTime);
    currentVrm.update(delta);
  }

  controls.update();
  renderer.render(scene, camera);
}

window.addEventListener('DOMContentLoaded', () => {
  try {
    initScene();
    bindEvents();
    preloadAllVrmaMotions();
    const urlParams = new URLSearchParams(window.location.search);
    const initialChar = urlParams.get('character') || '由比滨结衣';
    applyCharacterUI(initialChar);
    initWebSocket();
    animate();

    // ?settings=xxx 直接拉起独立设置窗口（定位到对应 tab）
    const settingsParam = new URLSearchParams(window.location.search).get('settings');
    if (settingsParam) {
      openSettingsWindow('settings', settingsParam);
    }
  } catch (err) {
    console.error('初始化 3D 引擎失败:', err);
    if (loadingStatus) {
      loadingStatus.textContent = '初始化 3D 引擎失败: ' + err.message;
    }
  }
});

