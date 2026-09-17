import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/GLTFLoader.js';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';

// --- Global Scene & VRM State ---
let scene, camera, renderer, controls;
let currentVrm = null;
let currentModelUrl = null;
let clock = new THREE.Clock();

const CHARACTER_META = {
  '由比滨结衣': {
    name: '由比ヶ浜結衣',
    short: '結',
    vrm: '/vrm-models/由比滨结衣/由比滨结衣.vrm',
    greeting: 'やっはろー！あたし由比ヶ浜結衣！今日も元気にいこ？',
    chips: ['奉仕部について教えて', 'ヒッキーってどんな人？', 'サブレの話を聞かせて', '今日の予定は何？']
  },
  '雷电将军': {
    name: '雷電将軍',
    short: '影',
    vrm: '/vrm-models/雷电将军/雷电将军.vrm',
    greeting: '浮世の諸行、すべては永遠への塵芥にすぎぬ。……我を呼んだのはそなたか？',
    chips: ['稲妻の永遠とは？', '団子牛乳はお好きですか？', '料理は得意ですか？', '一心浄土について']
  },
  '喜多郁代': {
    name: '喜多郁代',
    short: '喜',
    vrm: '/vrm-models/喜多郁代/喜多郁代.vrm',
    greeting: 'こんにちは！結束バンドのギターボーカル、喜多郁代です！今日も元気にいきましょーっ！',
    chips: ['結束バンドについて教えて', 'ひとりちゃんは元気？', 'キタオーラ発射〜！✨', '今日の予定は何？']
  },
  'Kira': {
    name: '喜多郁代',
    short: '喜',
    vrm: '/vrm-models/喜多郁代/喜多郁代.vrm',
    greeting: 'こんにちは！結束バンドのギターボーカル、喜多郁代です！今日も元気にいきましょーっ！',
    chips: ['結束バンドについて教えて', 'ひとりちゃんは元気？', 'キタオーラ発射〜！✨', '今日の予定は何？']
  },
  '依蕾娜': {
    name: 'イレイナ',
    short: '魔',
    vrm: '/vrm-models/依蕾娜/依蕾娜.vrm',
    greeting: 'そう、私です！旅の魔女イレイナと申します。ふふっ、この街にはどんな物語があるのかしら？',
    chips: ['その美しい魔女は誰？', '旅の思い出を聞かせて', '焼きたてのパンはある？', '魔法について教えて']
  },
  '伊蕾娜': {
    name: 'イレイナ',
    short: '魔',
    vrm: '/vrm-models/依蕾娜/依蕾娜.vrm',
    greeting: 'そう、私です！旅の魔女イレイナと申します。ふふっ、この街にはどんな物語があるのかしら？',
    chips: ['その美しい魔女は誰？', '旅の思い出を聞かせて', '焼きたてのパンはある？', '魔法について教えて']
  }
};

// Audio Context & Analyser
let audioContext = null;
let analyserNode = null;
let gainNode = null;
let currentAudioSource = null;
let audioQueue = [];
let isPlayingAudio = false;

// Expression & Natural Motion State
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
  controls.minDistance = 0.5;
  controls.maxDistance = 3.5;
  controls.maxPolarAngle = Math.PI / 2 + 0.1;

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
function applyNaturalPose(vrm) {
  if (!vrm || !vrm.humanoid) return;

  // Lower arms naturally to sides (~70 degrees down from T-pose)
  const leftUpperArm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
  if (leftUpperArm) {
    leftUpperArm.rotation.set(0.08, 0, -1.22);
  }
  const rightUpperArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
  if (rightUpperArm) {
    rightUpperArm.rotation.set(0.08, 0, 1.22);
  }

  // Slightly bend elbows for a relaxed cute anime girl stance
  const leftLowerArm = vrm.humanoid.getNormalizedBoneNode('leftLowerArm');
  if (leftLowerArm) {
    leftLowerArm.rotation.set(-0.25, 0.15, -0.18);
  }
  const rightLowerArm = vrm.humanoid.getNormalizedBoneNode('rightLowerArm');
  if (rightLowerArm) {
    rightLowerArm.rotation.set(-0.25, -0.15, 0.18);
  }
}

// --- 3. Load VRM Model ---
async function loadVRM(url, characterName = '') {
  if (loadingScreen) {
    loadingScreen.classList.remove('hidden');
    loadingStatus.textContent = `正在加载 ${characterName || '3D'} 模型...`;
  }

  // Pre-check if file exists
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) {
      console.warn(`VRM model not found at ${url} (status: ${res.status})`);
      if (loadingStatus) {
        loadingStatus.textContent = `${characterName || '该角色'}模型文件暂未就绪 (${url})`;
      }
      setTimeout(() => {
        if (loadingScreen) loadingScreen.classList.add('hidden');
      }, 2500);
      return;
    }
  } catch (err) {
    console.warn('Could not verify model URL head:', err);
  }

  currentModelUrl = url;

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

  loader.load(
    url,
    (gltf) => {
      const vrm = gltf.userData.vrm;
      if (!vrm) {
        console.error('No VRM instance found in GLTF:', gltf);
        if (loadingStatus) loadingStatus.textContent = 'VRM 解析失败';
        setTimeout(() => {
          if (loadingScreen) loadingScreen.classList.add('hidden');
        }, 2000);
        return;
      }

      if (currentVrm) {
        if (currentAnimationMixer) {
          currentAnimationMixer.stopAllAction();
          currentAnimationMixer = null;
        }
        scene.remove(currentVrm.scene);
        VRMUtils.deepDispose(currentVrm.scene);
      }

      currentVrm = vrm;
      scene.add(vrm.scene);

      // Rotate model if VRM 0.x
      VRMUtils.rotateVRM0(vrm);

      // Apply natural cute posture (prevent T-pose)
      applyNaturalPose(vrm);

      // Eye look-at camera tracking
      if (vrm.lookAt) {
        vrm.lookAt.target = camera;
      }

      // 初始化并绑定当前角色的 VRMA 动作系统与 Mixer
      setupMotionMixer(vrm);

      console.log('✅ VRM model loaded:', vrm);

      if (loadingScreen) {
        loadingStatus.textContent = '加载完成！';
        loadingScreen.classList.add('hidden');
      }

      // Initial welcoming greeting expression
      setEmotion('happy', 0.6);
      setTimeout(() => setEmotion('neutral', 0), 2500);
    },
    (progress) => {
      if (progress.total > 0 && loadingStatus) {
        const percent = Math.round((progress.loaded / progress.total) * 100);
        loadingStatus.textContent = `正在加载模型资源... (${percent}%)`;
      }
    },
    (error) => {
      console.error('Error loading VRM:', error);
      if (loadingStatus) loadingStatus.textContent = '模型加载失败: ' + error.message;
      setTimeout(() => {
        if (loadingScreen) loadingScreen.classList.add('hidden');
      }, 2500);
    }
  );
}

function applyCharacterUI(confNameOrFileName) {
  if (!confNameOrFileName) return;
  let matched = null;
  for (const key of Object.keys(CHARACTER_META)) {
    if (confNameOrFileName.includes(key)) {
      matched = CHARACTER_META[key];
      break;
    }
  }
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
      chip.addEventListener('click', () => sendTextMessage(text));
      chipsContainer.appendChild(chip);
    });
  }

  // Update input placeholder
  if (textInput) {
    textInput.placeholder = `和${matched.name}聊点什么吧... (按 Enter 发送)`;
  }

  // Switch VRM model if different
  if (matched.vrm && currentModelUrl !== matched.vrm) {
    loadVRM(matched.vrm, matched.name);
  }
}

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
  if (currentVrm && currentVrm.expressionManager) {
    currentVrm.expressionManager.setValue('aa', 0);
    currentVrm.expressionManager.setValue('oh', 0);
  }
  updateStatus('connected', '在线');
  btnInterrupt.classList.remove('active');
  setEmotion('neutral', 0);
}

function setEmotion(emotionName, weight = 0.85) {
  if (!currentVrm || !currentVrm.expressionManager) return;

  const numberMap = {
    0: 'neutral',
    1: 'sad',
    2: 'angry',
    3: 'happy'
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
    'smirk': 'happy',
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

  ['happy', 'sad', 'angry', 'surprised', 'relaxed'].forEach((name) => {
    currentVrm.expressionManager.setValue(name, 0);
  });

  if (targetPreset !== 'neutral') {
    currentVrm.expressionManager.setValue(targetPreset, weight);
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
  if (!currentVrm || !currentVrm.expressionManager) return;

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
    currentVrm.expressionManager.setValue('aa', mouthOpen * 0.82);
    currentVrm.expressionManager.setValue('oh', mouthOpen * 0.22);
  } else {
    mouthOpen = THREE.MathUtils.lerp(mouthOpen, 0.0, 0.25);
    currentVrm.expressionManager.setValue('aa', mouthOpen);
    currentVrm.expressionManager.setValue('oh', 0);
  }
}

// Auto-blink
function updateBlink(delta) {
  if (!currentVrm || !currentVrm.expressionManager) return;

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
      currentVrm.expressionManager.setValue('blink', 0.0);
      nextBlinkTime = 2.4 + Math.random() * 3.6;
    } else {
      const weight = Math.sin(blinkProgress * Math.PI);
      currentVrm.expressionManager.setValue('blink', weight);
    }
  }
}

// Idle breathing & micro-sway (fallback when no VRMA idle loop is playing)
function updateIdle(elapsedTime) {
  if (!currentVrm || !currentVrm.humanoid) return;
  // 当 VRMA 动作系统正在通过 AnimationMixer 播放动画时，骨骼由动画混合器全权驱动
  if (currentAnimationMixer && ((currentIdleAction && currentIdleAction.isRunning()) || currentMotionAction)) {
    return;
  }
  const t = elapsedTime;
  const breath = Math.sin(t * 1.8) * 0.016;

  const chest = currentVrm.humanoid.getNormalizedBoneNode('chest');
  if (chest) chest.rotation.x = breath;

  const spine = currentVrm.humanoid.getNormalizedBoneNode('spine');
  if (spine) spine.rotation.x = breath * 0.5;

  // Natural head motion (combining emotional pitch with subtle idle sway)
  const head = currentVrm.humanoid.getNormalizedBoneNode('head');
  if (head) {
    head.rotation.y = Math.sin(t * 0.75) * 0.028;
    head.rotation.z = Math.sin(t * 0.5) * 0.012;
    head.rotation.x = currentEmotionHeadPitch + Math.sin(t * 1.8) * 0.006;
  }

  // Arms subtle breathing reaction (arms resting down naturally)
  const leftUpperArm = currentVrm.humanoid.getNormalizedBoneNode('leftUpperArm');
  if (leftUpperArm) leftUpperArm.rotation.z = -1.22 - Math.sin(t * 1.8) * 0.012;

  const rightUpperArm = currentVrm.humanoid.getNormalizedBoneNode('rightUpperArm');
  if (rightUpperArm) rightUpperArm.rotation.z = 1.22 + Math.sin(t * 1.8) * 0.012;
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
  if (!currentAnimationMixer || !activeMotionClips['greeting']) return;
  autoGreetingDone = true;
  playMotion('greeting');
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

  // 以当前 rest 姿态 (applyNaturalPose 之后的自然站姿) 为基准生成旋转关键帧轨道
  const rotTrack = (node, times, eulers) => {
    const qRest = node.quaternion.clone();
    const values = [];
    for (const [x, y, z] of eulers) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)).multiply(qRest);
      values.push(...q.toArray());
    }
    return new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, values);
  };

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
  if (!activeMotionClips['wave_hand']) {
    const rUpperArm = h.getNormalizedBoneNode('rightUpperArm');
    const rLowerArm = h.getNormalizedBoneNode('rightLowerArm');
    if (rUpperArm && rLowerArm) {
      const tracks = [
        // 右臂抬起维持在身侧上方，收尾回落
        rotTrack(rUpperArm, [0.0, 0.35, 2.35, 2.7], [
          [0, 0, 0], [-0.12, 0, -0.95], [-0.12, 0, -0.95], [0, 0, 0]
        ]),
        // 前臂来回摆动，形成挥手节奏
        rotTrack(rLowerArm, [0.0, 0.5, 0.95, 1.4, 1.85, 2.3], [
          [0, 0, 0], [-0.35, 0, 0.32], [-0.35, 0, -0.34], [-0.35, 0, 0.32], [-0.35, 0, -0.28], [0, 0, 0]
        ])
      ];
      if (headNode) {
        tracks.push(rotTrack(headNode, [0.0, 0.45, 2.3, 2.7], [
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
  if (!currentAnimationMixer) return;
  const clip = activeMotionClips[motionName];
  if (!clip) {
    console.debug(`[Motion] 动作 ${motionName} 未找到对应动画片段`);
    return;
  }

  console.log(`[Motion] ▶ 播放肢体动作: ${motionName}`);

  // 打断尚未结束的上一个动作，避免监听器泄漏与权重叠加
  if (currentMotionAction) {
    if (currentMotionFinishedHandler) {
      currentAnimationMixer.removeEventListener('finished', currentMotionFinishedHandler);
      currentMotionFinishedHandler = null;
    }
    currentMotionAction.stop();
    currentMotionAction = null;
  }

  const action = currentAnimationMixer.clipAction(clip);
  action.stop();
  action.reset();
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.setEffectiveWeight(1.0);

  if (currentIdleAction) {
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
    if (currentIdleAction) {
      currentIdleAction.reset().setEffectiveWeight(1.0).fadeIn(0.35).play();
    }
  };
  currentMotionFinishedHandler = onFinished;
  currentAnimationMixer.addEventListener('finished', onFinished);
}

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
    '依蕾娜': {
      head: ['ふふっ、美しい魔女の髪に触れたい気持ちは分かります。', 'あまり撫でると、料金をいただきますよ？'],
      body: ['おや？旅の資金でも恵んでくださるのですか？', '急に触るのは感心しませんね。']
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
  if (!currentVrm || !currentVrm.scene || !camera) return;

  const now = Date.now();
  if (now - lastInteractionTime < CLICK_COOLDOWN_MS) return;

  const rect = renderer.domElement.getBoundingClientRect();
  clickMouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  clickMouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  clickRaycaster.setFromCamera(clickMouse, camera);
  const intersects = clickRaycaster.intersectObject(currentVrm.scene, true);

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

    if (!currentVrm || !currentVrm.scene || !camera) return;
    const rect = renderer.domElement.getBoundingClientRect();
    clickMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    clickMouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    clickRaycaster.setFromCamera(clickMouse, camera);
    const hits = clickRaycaster.intersectObject(currentVrm.scene, true);
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
      ws.send(JSON.stringify({ type: 'switch-config', file: 'zh_由比滨结衣.yaml' }));
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

        // Retain or match selection with current active character
        const currentTitle = document.getElementById('character-title')?.textContent || '';
        for (let opt of configSelect.options) {
          if (currentTitle && (opt.value.includes(currentTitle) || opt.textContent.includes(currentTitle))) {
            opt.selected = true;
            break;
          }
        }
      }
      break;

    case 'set-model-and-conf':
      console.log('Current character config:', data.conf_name);
      if (data.conf_name) {
        applyCharacterUI(data.conf_name);
        if (configSelect) {
          for (let opt of configSelect.options) {
            if (opt.value.includes(data.conf_name) || opt.textContent.includes(data.conf_name)) {
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

  // 动作演示下拉：选中即播放一次对应肢体动作，随后自动回落到待机
  const motionSelect = document.getElementById('motion-select');
  if (motionSelect) {
    motionSelect.addEventListener('change', (e) => {
      const motionName = e.target.value;
      if (!motionName) return;
      if (currentAnimationMixer) {
        playMotion(motionName);
      } else {
        console.warn('[Motion] 角色模型尚未就绪，暂时无法播放动作');
      }
      e.target.value = '';
    });
  }

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

  if (currentVrm) {
    // 1. 驱动 VRMA 骨骼动作与待机循环
    if (currentAnimationMixer) {
      currentAnimationMixer.update(delta);
    }
    // 2. 语音口型 Viseme 分析
    updateLipSync();
    // 3. 自然眨眼
    updateBlink(delta);
    // 4. 程序化待机补正 (当无 VRMA 动作时保底)
    updateIdle(elapsedTime);
    // 5. 更新物理飘带、LookAt 与表情管理器
    currentVrm.update(delta);
  }

  controls.update();
  renderer.render(scene, camera);
}

window.addEventListener('DOMContentLoaded', () => {
  initScene();
  bindEvents();
  preloadAllVrmaMotions();
  applyCharacterUI('由比滨结衣');
  initWebSocket();
  animate();

  // ?settings=xxx 直接拉起独立设置窗口（定位到对应 tab）
  const settingsParam = new URLSearchParams(window.location.search).get('settings');
  if (settingsParam) {
    openSettingsWindow('settings', settingsParam);
  }
});

