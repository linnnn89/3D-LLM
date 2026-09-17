import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/GLTFLoader.js';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

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
  '爱蜜莉雅': {
    name: 'エミリア',
    short: '莉',
    vrm: '/vrm-models/爱蜜莉雅/爱蜜莉雅.vrm',
    greeting: 'こんにちは！私はエミリア、ただの半エルフよ。今日もすごーくいい日になるといいわね！',
    chips: ['パックはどこにいるの？', 'スバルとの関係は？', '王選の目標を教えて', 'すごーく嬉しいことある？']
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
const clickRaycaster = new THREE.Raycaster();
const clickMouse = new THREE.Vector2();

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
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
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
  // Directional lights must cast light onto character front to keep face brightly lit
  const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
  scene.add(ambientLight);

  const mainLight = new THREE.DirectionalLight(0xfff7ed, 1.6);
  mainLight.position.set(0.8, 2.2, 2.0).normalize();
  scene.add(mainLight);

  const fillLight = new THREE.DirectionalLight(0xebe4ff, 0.9);
  fillLight.position.set(-1.2, 1.8, 1.5).normalize();
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xffd6e0, 0.7);
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

// Idle breathing & micro-sway
function updateIdle(elapsedTime) {
  if (!currentVrm || !currentVrm.humanoid) return;
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
// 随机触碰反馈池 (表情 + 预留动作)
const CLICK_REACTIONS = [
  { emotion: 'happy', weight: 0.95, motion: 'cheerful_bounce', duration: 2400 },
  { emotion: 'surprised', weight: 0.90, motion: 'surprise_jump', duration: 2000 },
  { emotion: 'relaxed', weight: 0.85, motion: 'gentle_nod', duration: 2500 },
  { emotion: 'angry', weight: 0.80, motion: 'pout_turn', duration: 1800 }
];

/**
 * 预留动作播放接口 (Motion Integration Interface)
 * 当前前端尚未搭载完整肢体动作播放器，待动作模块升级后接入 Three.js AnimationMixer 播放 FBX/BVH 动作。
 * 架构参考升级路线规划: doc/motion_upgrade_roadmap.md
 * 
 * @param {string} motionName - 动作标识 (如 'cheerful_bounce', 'surprise_jump')
 */
function playMotion(motionName) {
  console.log(`[Interaction] 触发动作: ${motionName} (当前肢体动作系统待接入，已触发预留接口)`);
  // TODO: 后续接入动作骨骼动画控制器时启用:
  // if (currentAnimationMixer && motionClips[motionName]) {
  //   const action = currentAnimationMixer.clipAction(motionClips[motionName]);
  //   action.reset().fadeIn(0.2).play();
  // }
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
    '爱蜜莉雅': {
      head: ['ふふ、ありがとう！', 'すごーく嬉しいかも！', 'えへへ、ちょっと照れるわね。'],
      body: ['きゃっ！急にどうしたの？', 'もう、びっくりさせないでよ。', 'パック、見てるかしら……？']
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
        updateStatus('thinking', '思考中...');
      } else if (data.text) {
        const currentName = (bubbleSender && bubbleSender.textContent) || 'AI';
        showDialogue(currentName, data.text);
      }
      break;

    case 'audio':
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
    updateStatus('thinking', '思考中...');

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

  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const text = chip.getAttribute('data-text');
      if (text) sendTextMessage(text);
    });
  });

  // Settings button
  const btnSettings = document.getElementById('btn-settings');
  if (btnSettings) {
    btnSettings.addEventListener('click', openSettingsModal);
  }

  // Settings modal close triggers
  const btnCloseSettings = document.getElementById('btn-close-settings');
  if (btnCloseSettings) btnCloseSettings.addEventListener('click', closeSettingsModal);
  const btnCancelSettings = document.getElementById('btn-cancel-settings');
  if (btnCancelSettings) btnCancelSettings.addEventListener('click', closeSettingsModal);
  const settingsBackdrop = document.getElementById('settings-backdrop');
  if (settingsBackdrop) settingsBackdrop.addEventListener('click', closeSettingsModal);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSettingsModal();
  });

  // Settings Save button
  const btnSaveSettings = document.getElementById('btn-save-settings');
  if (btnSaveSettings) btnSaveSettings.addEventListener('click', saveAllSettings);

  // Settings Tab Switching
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      const pane = document.getElementById(targetTab);
      if (pane) pane.classList.add('active');
    });
  });

  // Target Character select change in settings
  const settingCharSelect = document.getElementById('setting-char-select');
  if (settingCharSelect) {
    settingCharSelect.addEventListener('change', async (e) => {
      const f = e.target.value;
      if (f) {
        const confRes = await fetch(`/api/settings/config?character=${encodeURIComponent(f)}`);
        if (confRes.ok) {
          settingsData.config = await confRes.json();
          renderSettingsUI(false);
        }
      }
    });
  }

  // LLM Provider Presets change
  const providerPreset = document.getElementById('llm-provider-preset');
  if (providerPreset) {
    providerPreset.addEventListener('change', (e) => {
      onProviderPresetChange(e.target.value);
    });
  }

  // Base URL Real-time Validation (/v1 enforcement)
  const baseUrlInput = document.getElementById('llm-base-url');
  if (baseUrlInput) {
    baseUrlInput.addEventListener('input', () => {
      checkBaseUrlWarning(baseUrlInput.value);
    });
    baseUrlInput.addEventListener('blur', () => {
      baseUrlInput.value = validateAndCleanBaseUrl(baseUrlInput.value);
      checkBaseUrlWarning(baseUrlInput.value);
    });
  }

  // Temperature Slider Sync
  const tempInput = document.getElementById('llm-temperature');
  const tempVal = document.getElementById('temp-val');
  if (tempInput && tempVal) {
    tempInput.addEventListener('input', () => {
      tempVal.textContent = tempInput.value;
    });
  }

  // Breath Scale Sync
  const breathInput = document.getElementById('vrm-breath-scale');
  const breathVal = document.getElementById('breath-val');
  if (breathInput && breathVal) {
    breathInput.addEventListener('input', () => {
      breathVal.textContent = `${breathInput.value}x`;
    });
  }

  // TTS Engine Select Toggle
  const ttsEngineSelect = document.getElementById('tts-engine-select');
  if (ttsEngineSelect) {
    ttsEngineSelect.addEventListener('change', (e) => {
      toggleTtsPanel(e.target.value);
    });
  }

  // Password View Toggles
  bindPasswordToggle('btn-toggle-llm-key', 'llm-api-key');
  bindPasswordToggle('btn-toggle-fish-key', 'fish-api-key');

  // Background Select
  const bgSelect = document.getElementById('vrm-bg-select');
  if (bgSelect) {
    bgSelect.addEventListener('change', (e) => {
      applyBackgroundTheme(e.target.value);
    });
  }

  // Storage Migration actions
  bindStorageActions();
  bindFieldResetHandlers();

  // Global user gesture unlock for Web Audio
  document.body.addEventListener('click', () => ensureAudioContext(), { once: true });
}

// --- 9. Settings Management & DPAPI Vault Logic ---
let settingsData = {
  providers: null,
  config: null,
  keysStatus: {},
  storagePath: null,
};

async function openSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  await loadSettingsFromServer();
}

function closeSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (modal) modal.classList.add('hidden');
  const statusMsg = document.getElementById('save-status-msg');
  if (statusMsg) statusMsg.textContent = '';
  const storageOp = document.getElementById('storage-op-status');
  if (storageOp) storageOp.className = 'storage-status-banner hidden';
}

async function loadSettingsFromServer() {
  try {
    const provRes = await fetch('/api/settings/providers');
    if (provRes.ok) settingsData.providers = await provRes.json();

    const keysRes = await fetch('/api/settings/keys');
    if (keysRes.ok) {
      const kd = await keysRes.json();
      settingsData.keysStatus = kd.status || {};
    }

    const storageRes = await fetch('/api/settings/storage-path');
    if (storageRes.ok) {
      settingsData.storagePath = await storageRes.json();
    }

    const currentCharFile = configSelect ? configSelect.value : 'zh_由比滨结衣.yaml';
    const confRes = await fetch(`/api/settings/config?character=${encodeURIComponent(currentCharFile)}`);
    if (confRes.ok) settingsData.config = await confRes.json();

    renderSettingsUI(true);
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

function renderSettingsUI(updateCharDropdown = true) {
  if (!settingsData.config) return;
  const cfg = settingsData.config;
  const defaults = cfg.defaults || {};
  const userOverrides = cfg.user_overrides || {};
  const memoryOverrides = cfg.memory_overrides || {};

  // Populate Character dropdown
  const charSelect = document.getElementById('setting-char-select');
  if (updateCharDropdown && charSelect && cfg.character_files) {
    charSelect.innerHTML = '';
    cfg.character_files.forEach((f) => {
      const opt = document.createElement('option');
      opt.value = f;
      opt.textContent = f.replace('.yaml', '').replace('zh_', '');
      if (f === cfg.target_character) opt.selected = true;
      charSelect.appendChild(opt);
    });
  }

  const charConfig = (cfg.character_conf && cfg.character_conf.character_config) || {};
  const agentConfig = charConfig.agent_config || {};
  const basicAgent = (agentConfig.agent_settings && agentConfig.agent_settings.basic_memory_agent) || {};
  const llmSettings = (basicAgent.llm_settings && basicAgent.llm_settings.openai_compatible_llm) || {};

  // 1. LLM Settings
  const baseUrlInput = document.getElementById('llm-base-url');
  const modelInput = document.getElementById('llm-model');
  const tempInput = document.getElementById('llm-temperature');
  const tempVal = document.getElementById('temp-val');
  const personaInput = document.getElementById('llm-persona-prompt');

  const defaultBaseUrl = (defaults.llm && defaults.llm.base_url) || 'https://api.deepseek.com/v1';
  const defaultModel = (defaults.llm && defaults.llm.model) || 'deepseek-chat';
  const defaultTemp = (defaults.llm && defaults.llm.temperature !== undefined) ? defaults.llm.temperature : 0.7;

  if (baseUrlInput) {
    const activeUrl = (userOverrides.llm && userOverrides.llm.base_url) || (llmSettings.base_url !== defaultBaseUrl ? llmSettings.base_url : '');
    baseUrlInput.value = activeUrl || '';
    baseUrlInput.placeholder = `系统默认: ${defaultBaseUrl}`;
  }
  if (modelInput) {
    const activeModel = (userOverrides.llm && userOverrides.llm.model) || (llmSettings.model !== defaultModel ? llmSettings.model : '');
    modelInput.value = activeModel || '';
    modelInput.placeholder = `系统默认: ${defaultModel}`;
  }
  if (tempInput) {
    const activeTemp = (userOverrides.llm && userOverrides.llm.temperature !== undefined)
      ? userOverrides.llm.temperature
      : (llmSettings.temperature !== undefined ? llmSettings.temperature : defaultTemp);
    tempInput.value = activeTemp;
    if (tempVal) tempVal.textContent = activeTemp;
  }
  if (personaInput) {
    personaInput.value = userOverrides.persona_prompt || charConfig.persona_prompt || '';
  }

  // Update LLM Provider Preset dropdown
  const providerPreset = document.getElementById('llm-provider-preset');
  if (providerPreset) {
    const currentUrl = (baseUrlInput && baseUrlInput.value) || defaultBaseUrl;
    if (currentUrl.includes('deepseek.com')) providerPreset.value = 'deepseek';
    else if (currentUrl.includes('openrouter.ai')) providerPreset.value = 'openrouter';
    else if (currentUrl.includes('commandcode.ai')) providerPreset.value = 'commandcode';
    else if (currentUrl.includes('opencode.ai')) providerPreset.value = 'opencode';
    else providerPreset.value = 'custom';
  }

  // Update LLM Key Status indicator
  const llmKeyStatus = document.getElementById('llm-key-status');
  if (llmKeyStatus) {
    const isConfigured =
      settingsData.keysStatus['deepseek'] ||
      settingsData.keysStatus['openrouter'] ||
      settingsData.keysStatus['commandcode'] ||
      settingsData.keysStatus['opencode'] ||
      settingsData.keysStatus['custom'];
    if (isConfigured) {
      llmKeyStatus.innerHTML = `🛡️ <span style="color:#4ade80">已在 Windows DPAPI 保险库中安全配置 (掩码: ${isConfigured.masked})</span>`;
    } else {
      llmKeyStatus.innerHTML = `⚠️ <span style="color:#f87171">尚未配置 API Key，请在下方输入并保存</span>`;
    }
  }

  // 2. TTS Settings
  const ttsCfg = charConfig.tts_config || {};
  const ttsEngineSelect = document.getElementById('tts-engine-select');
  const activeTtsEngine = (userOverrides.tts && userOverrides.tts.provider) || ttsCfg.tts_model || (defaults.tts && defaults.tts.provider) || 'fish_api_tts';
  if (ttsEngineSelect) {
    ttsEngineSelect.value = activeTtsEngine;
    toggleTtsPanel(activeTtsEngine);
  }

  const fishCfg = ttsCfg.fish_api_tts || {};
  const fishModel = document.getElementById('fish-model');
  const fishRefId = document.getElementById('fish-reference-id');
  const fishLatency = document.getElementById('fish-latency');
  const fishBaseUrl = document.getElementById('fish-base-url');

  const defFishModel = (defaults.tts && defaults.tts.model) || 's2-pro-free';
  const defFishRef = (defaults.tts && defaults.tts.reference_id) || '7f92f8afb8ec43bf81429cc1c9199cb1';
  const defFishLat = (defaults.tts && defaults.tts.latency) || 'balanced';
  const defFishBase = (defaults.tts && defaults.tts.base_url) || 'https://api.fish.audio';

  if (fishModel) fishModel.value = (userOverrides.tts && userOverrides.tts.model) || fishCfg.model || defFishModel;
  if (fishRefId) {
    const activeRef = (userOverrides.tts && userOverrides.tts.reference_id) || (fishCfg.reference_id !== defFishRef ? fishCfg.reference_id : '');
    fishRefId.value = activeRef || '';
    fishRefId.placeholder = `系统默认: ${defFishRef}`;
  }
  if (fishLatency) fishLatency.value = (userOverrides.tts && userOverrides.tts.latency) || fishCfg.latency || defFishLat;
  if (fishBaseUrl) {
    const activeBase = (userOverrides.tts && userOverrides.tts.base_url) || (fishCfg.base_url !== defFishBase ? fishCfg.base_url : '');
    fishBaseUrl.value = activeBase || '';
    fishBaseUrl.placeholder = `系统默认: ${defFishBase}`;
  }

  const edgeVoice = document.getElementById('edge-voice');
  if (edgeVoice && userOverrides.tts && userOverrides.tts.voice) {
    edgeVoice.value = userOverrides.tts.voice;
  }

  const fishKeyStatus = document.getElementById('fish-key-status');
  if (fishKeyStatus) {
    const isFishKey = settingsData.keysStatus['fish_audio'] || settingsData.keysStatus['fish.audio'];
    if (isFishKey) {
      fishKeyStatus.innerHTML = `🛡️ <span style="color:#4ade80">已在 DPAPI 保险库中安全加密 (${isFishKey.masked})</span>`;
    } else {
      fishKeyStatus.innerHTML = `⚠️ <span style="color:#f87171">尚未配置 Fish Audio 密钥</span>`;
    }
  }

  // 3. Memory Subsystem Settings
  const defMem = defaults.memory || {};
  const memAuto = document.getElementById('mem-auto-generate');
  const memInterval = document.getElementById('mem-update-interval');
  const memMaxUserTurns = document.getElementById('mem-max-user-turns');
  const memTargetTokens = document.getElementById('mem-target-tokens');
  const memRetrievalEnabled = document.getElementById('mem-retrieval-enabled');
  const memRetrievalScope = document.getElementById('mem-retrieval-scope');
  const memRecentCount = document.getElementById('mem-recent-count');
  const memMaxResults = document.getElementById('mem-max-results');
  const memTokenBudget = document.getElementById('mem-token-budget');

  if (memAuto) {
    memAuto.checked = memoryOverrides.auto_generate_enabled !== undefined
      ? memoryOverrides.auto_generate_enabled
      : (defMem.auto_generate_enabled !== undefined ? defMem.auto_generate_enabled : true);
  }
  if (memInterval) {
    memInterval.value = memoryOverrides.update_interval_turns !== undefined ? memoryOverrides.update_interval_turns : '';
    memInterval.placeholder = `系统默认: ${defMem.update_interval_turns ?? 10}`;
  }
  if (memMaxUserTurns) {
    memMaxUserTurns.value = memoryOverrides.maximum_source_user_turns !== undefined ? memoryOverrides.maximum_source_user_turns : '';
    memMaxUserTurns.placeholder = `系统默认: ${defMem.maximum_source_user_turns ?? 10}`;
  }
  if (memTargetTokens) {
    memTargetTokens.value = memoryOverrides.target_tokens !== undefined ? memoryOverrides.target_tokens : '';
    memTargetTokens.placeholder = `系统默认: ${defMem.target_tokens ?? 0} (无上限/自适应压缩)`;
  }
  if (memRetrievalEnabled) {
    memRetrievalEnabled.checked = memoryOverrides.retrieval_enabled !== undefined
      ? memoryOverrides.retrieval_enabled
      : (defMem.retrieval_enabled !== undefined ? defMem.retrieval_enabled : true);
  }
  if (memRetrievalScope) {
    memRetrievalScope.value = memoryOverrides.retrieval_scope || defMem.retrieval_scope || 'current_conversation';
  }
  if (memRecentCount) {
    memRecentCount.value = memoryOverrides.retrieval_recent_count !== undefined ? memoryOverrides.retrieval_recent_count : '';
    memRecentCount.placeholder = `系统默认: ${defMem.retrieval_recent_count ?? 20}`;
  }
  if (memMaxResults) {
    memMaxResults.value = memoryOverrides.retrieval_max_results !== undefined ? memoryOverrides.retrieval_max_results : '';
    memMaxResults.placeholder = `系统默认: ${defMem.retrieval_max_results ?? 6}`;
  }
  if (memTokenBudget) {
    memTokenBudget.value = memoryOverrides.retrieval_token_budget !== undefined ? memoryOverrides.retrieval_token_budget : '';
    memTokenBudget.placeholder = `系统默认: ${defMem.retrieval_token_budget ?? 1200}`;
  }

  // 4. Storage Subsystem Settings
  const storagePathInput = document.getElementById('storage-path-input');
  const storageDefaultHint = document.getElementById('storage-default-hint');
  const currentPath = (settingsData.storagePath && settingsData.storagePath.current_path) || cfg.user_data_dir || '';
  const defaultPath = (settingsData.storagePath && settingsData.storagePath.default_path) || cfg.default_user_data_dir || 'E:\\我的文档\\LLM-3D-CHAT';
  if (storagePathInput) {
    storagePathInput.value = currentPath;
    storagePathInput.placeholder = `当前目录: ${currentPath}`;
  }
  if (storageDefaultHint) {
    storageDefaultHint.innerHTML = `系统默认路径: <code>${defaultPath}</code> (通过 Windows Shell 动态获取)`;
  }

  renderVaultCards();
  bindFieldResetHandlers();
}

function bindFieldResetHandlers() {
  document.querySelectorAll('.btn-field-reset').forEach((btn) => {
    if (btn.dataset.bound === 'true') return;
    btn.dataset.bound = 'true';

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = btn.getAttribute('data-reset');
      if (!targetId) return;

      const cfg = settingsData.config || {};
      const defaults = cfg.defaults || {};
      const charConfig = (cfg.character_conf && cfg.character_conf.character_config) || {};

      const input = document.getElementById(targetId);
      if (!input) return;

      switch (targetId) {
        case 'llm-provider-preset':
          input.value = 'deepseek';
          onProviderPresetChange('deepseek');
          break;
        case 'llm-base-url':
        case 'llm-model':
          input.value = '';
          break;
        case 'llm-temperature':
          input.value = (defaults.llm && defaults.llm.temperature !== undefined) ? defaults.llm.temperature : 0.7;
          const tempVal = document.getElementById('temp-val');
          if (tempVal) tempVal.textContent = input.value;
          break;
        case 'llm-persona-prompt':
          input.value = charConfig.persona_prompt || '';
          break;
        case 'tts-engine-select':
          input.value = (defaults.tts && defaults.tts.provider) || 'fish_api_tts';
          toggleTtsPanel(input.value);
          break;
        case 'fish-model':
          input.value = (defaults.tts && defaults.tts.model) || 's2-pro-free';
          break;
        case 'fish-latency':
          input.value = (defaults.tts && defaults.tts.latency) || 'balanced';
          break;
        case 'fish-reference-id':
        case 'fish-base-url':
          input.value = '';
          break;
        case 'edge-voice':
          input.value = 'ja-JP-NanamiNeural';
          break;
        case 'mem-auto-generate':
          input.checked = true;
          break;
        case 'mem-update-interval':
        case 'mem-max-user-turns':
        case 'mem-target-tokens':
        case 'mem-recent-count':
        case 'mem-max-results':
        case 'mem-token-budget':
          input.value = '';
          break;
        case 'mem-retrieval-enabled':
          input.checked = true;
          break;
        case 'mem-retrieval-scope':
          input.value = 'current_conversation';
          break;
        case 'asr-mode':
          input.value = 'web_speech';
          break;
        case 'chk-auto-interrupt':
          input.checked = true;
          break;
        case 'vrm-lookat-mode':
          input.value = 'camera';
          break;
        case 'vrm-breath-scale':
          input.value = 1.0;
          const breathVal = document.getElementById('breath-val');
          if (breathVal) breathVal.textContent = '1.0x';
          break;
        case 'vrm-bg-select':
          input.value = 'default';
          applyBackgroundTheme('default');
          break;
        default:
          input.value = '';
          break;
      }

      // Flash feedback
      const origText = btn.innerHTML;
      btn.classList.add('reset-flash');
      btn.innerHTML = '✔ 已恢复';
      setTimeout(() => {
        btn.classList.remove('reset-flash');
        btn.innerHTML = origText;
      }, 900);
    });
  });
}

function bindStorageActions() {
  const btnMigrate = document.getElementById('btn-save-migrate-storage');
  if (btnMigrate && !btnMigrate.dataset.bound) {
    btnMigrate.dataset.bound = 'true';
    btnMigrate.addEventListener('click', async () => {
      const pathInput = document.getElementById('storage-path-input');
      const statusBox = document.getElementById('storage-op-status');
      const newPath = pathInput ? pathInput.value.trim() : '';
      if (!newPath) return;

      btnMigrate.disabled = true;
      btnMigrate.textContent = '正在迁移数据...';
      if (statusBox) {
        statusBox.className = 'storage-status-banner';
        statusBox.classList.remove('hidden', 'success', 'error');
        statusBox.textContent = `⏳ 正在迁移数据文件至 ${newPath}...`;
      }

      try {
        const res = await fetch('/api/settings/storage-path', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ new_path: newPath, migrate: true }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          if (statusBox) {
            statusBox.classList.add('success');
            statusBox.innerHTML = `✅ ${data.message}`;
          }
          await loadSettingsFromServer();
        } else {
          if (statusBox) {
            statusBox.classList.add('error');
            statusBox.textContent = `❌ 迁移失败: ${data.detail || data.message || '未知错误'}`;
          }
        }
      } catch (e) {
        if (statusBox) {
          statusBox.classList.add('error');
          statusBox.textContent = `❌ 请求错误: ${e.message}`;
        }
      } finally {
        btnMigrate.disabled = false;
        btnMigrate.textContent = '💾 保存并迁移数据';
      }
    });
  }

  const btnResetStorage = document.getElementById('btn-reset-storage-path');
  if (btnResetStorage && !btnResetStorage.dataset.bound) {
    btnResetStorage.dataset.bound = 'true';
    btnResetStorage.addEventListener('click', async () => {
      const statusBox = document.getElementById('storage-op-status');
      if (statusBox) {
        statusBox.className = 'storage-status-banner';
        statusBox.classList.remove('hidden', 'success', 'error');
        statusBox.textContent = '⏳ 正在重置并迁移数据回系统默认目录...';
      }

      try {
        const res = await fetch('/api/settings/storage-path/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        const data = await res.json();
        if (res.ok && data.success) {
          if (statusBox) {
            statusBox.classList.add('success');
            statusBox.innerHTML = `✅ ${data.message}`;
          }
          await loadSettingsFromServer();
        } else {
          if (statusBox) {
            statusBox.classList.add('error');
            statusBox.textContent = `❌ 重置失败: ${data.detail || data.message || '未知错误'}`;
          }
        }
      } catch (e) {
        if (statusBox) {
          statusBox.classList.add('error');
          statusBox.textContent = `❌ 请求错误: ${e.message}`;
        }
      }
    });
  }
}

function onProviderPresetChange(providerId) {
  const baseUrlInput = document.getElementById('llm-base-url');
  const modelInput = document.getElementById('llm-model');

  const presets = {
    deepseek: { url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    openrouter: { url: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-chat' },
    commandcode: { url: 'https://api.commandcode.ai/provider/v1', model: 'claude-3-5-sonnet-20241022' },
    opencode: { url: 'https://api.opencode.ai/v1', model: 'default' },
    custom: { url: 'https://api.your-service.com/v1', model: 'default' },
  };

  const p = presets[providerId];
  if (p) {
    if (baseUrlInput) {
      baseUrlInput.value = p.url;
      baseUrlInput.placeholder = p.url;
    }
    if (modelInput) {
      modelInput.value = p.model;
      modelInput.placeholder = p.model;
    }
    checkBaseUrlWarning(p.url);
  }
}

function checkBaseUrlWarning(url) {
  const hintEl = document.getElementById('base-url-hint');
  if (!hintEl) return;
  if (url && (url.includes('/chat') || url.includes('/completions'))) {
    hintEl.style.color = '#f87171';
    hintEl.innerHTML = '⚠️ <strong>检测到路径包含 /chat</strong>：系统保存时将自动截断至 <code>/v1</code>，以统一当前 chat 模式并兼容未来 Agent response 扩展。';
  } else {
    hintEl.style.color = '#fbd38d';
    hintEl.innerHTML = '⚠️ 规范约束：端点请严格填至 <code>/v1</code> 结尾，请勿填写后面的 <code>/chat</code> 或 <code>/chat/completions</code>。当下默认 openai 兼容 chat 模式，同时预留未来 Agent response 扩展。';
  }
}

function validateAndCleanBaseUrl(url) {
  if (!url) return '';
  let clean = url.trim();
  if (clean.endsWith('/chat/completions')) {
    clean = clean.substring(0, clean.length - '/chat/completions'.length);
  } else if (clean.endsWith('/chat')) {
    clean = clean.substring(0, clean.length - '/chat'.length);
  }
  return clean.replace(/\/+$/, '');
}

function toggleTtsPanel(engine) {
  const fishPanel = document.getElementById('fish-audio-panel');
  const edgePanel = document.getElementById('edge-tts-panel');
  if (engine === 'fish_api_tts') {
    if (fishPanel) fishPanel.classList.remove('hidden');
    if (edgePanel) edgePanel.classList.add('hidden');
  } else {
    if (fishPanel) fishPanel.classList.add('hidden');
    if (edgePanel) edgePanel.classList.remove('hidden');
  }
}

function bindPasswordToggle(btnId, inputId) {
  const btn = document.getElementById(btnId);
  const input = document.getElementById(inputId);
  if (btn && input) {
    btn.addEventListener('click', () => {
      input.type = input.type === 'password' ? 'text' : 'password';
      btn.textContent = input.type === 'password' ? '👁️' : '🙈';
    });
  }
}

function renderVaultCards() {
  const container = document.getElementById('vault-cards-container');
  if (!container) return;
  container.innerHTML = '';

  const providers = [
    { id: 'deepseek', name: '官方 DeepSeek', defaultUrl: 'https://api.deepseek.com/v1' },
    { id: 'openrouter', name: 'OpenRouter', defaultUrl: 'https://openrouter.ai/api/v1' },
    { id: 'commandcode', name: 'Command Code', defaultUrl: 'https://api.commandcode.ai/provider/v1' },
    { id: 'opencode', name: 'OpenCode', defaultUrl: 'https://api.opencode.ai/v1' },
    { id: 'fish_audio', name: 'Fish Audio (TTS)', defaultUrl: 'https://api.fish.audio' },
    { id: 'custom', name: '自定义 Provider', defaultUrl: 'OpenAI-compatible' },
  ];

  providers.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'vault-card';
    const status =
      settingsData.keysStatus[p.id] || (p.id === 'fish_audio' ? settingsData.keysStatus['fish.audio'] : null);
    const isOk = status && status.configured;

    card.innerHTML = `
      <div class="vault-card-header">
        <span class="vault-card-title">${p.name}</span>
        <span class="vault-card-status ${isOk ? 'status-ok' : 'status-missing'}">
          ${isOk ? '● 已安全加密' : '○ 未配置'}
        </span>
      </div>
      <div class="vault-card-masked">
        ${isOk ? `密钥掩码: ${status.masked}` : 'DPAPI 保险库暂无此项密钥'}
      </div>
      <div style="display:flex;gap:6px;margin-top:4px;">
        <input type="password" id="vault-input-${p.id}" class="form-control" placeholder="输入新 Key..." style="padding:5px 8px;font-size:12px;">
        <button class="btn-secondary" style="padding:4px 10px;font-size:12px;" id="btn-save-key-${p.id}">保存</button>
      </div>
    `;
    container.appendChild(card);

    // Bind save button
    setTimeout(() => {
      const btn = document.getElementById(`btn-save-key-${p.id}`);
      const inp = document.getElementById(`vault-input-${p.id}`);
      if (btn && inp) {
        btn.addEventListener('click', async () => {
          const val = inp.value.trim();
          if (!val) return;
          btn.textContent = '...';
          try {
            await fetch('/api/settings/keys', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ [p.id]: val }),
            });
            inp.value = '';
            btn.textContent = '✔';
            await loadSettingsFromServer();
          } catch (err) {
            btn.textContent = '✕';
          }
        });
      }
    }, 0);
  });
}

async function saveAllSettings() {
  const statusEl = document.getElementById('save-status-msg');
  if (statusEl) statusEl.textContent = '正在保存配置并加密密钥...';

  const charSelect = document.getElementById('setting-char-select');
  const targetChar = charSelect ? charSelect.value : configSelect ? configSelect.value : 'zh_由比滨结衣.yaml';

  const baseUrlInput = document.getElementById('llm-base-url');
  const modelInput = document.getElementById('llm-model');
  const tempInput = document.getElementById('llm-temperature');
  const personaInput = document.getElementById('llm-persona-prompt');
  const ttsEngineSelect = document.getElementById('tts-engine-select');

  const cleanUrl = validateAndCleanBaseUrl(baseUrlInput ? baseUrlInput.value : '');
  if (baseUrlInput) baseUrlInput.value = cleanUrl;

  const payload = {
    character_file: targetChar,
    persona_prompt: personaInput ? personaInput.value : undefined,
    llm: {
      provider: 'openai_compatible_llm',
      base_url: cleanUrl || undefined,
      model: (modelInput && modelInput.value.trim()) || undefined,
      temperature: tempInput ? parseFloat(tempInput.value) : undefined,
    },
    tts: {
      provider: ttsEngineSelect ? ttsEngineSelect.value : 'fish_api_tts',
    },
  };

  if (payload.tts.provider === 'fish_api_tts') {
    const fishModel = document.getElementById('fish-model');
    const fishRefId = document.getElementById('fish-reference-id');
    const fishLatency = document.getElementById('fish-latency');
    const fishBaseUrl = document.getElementById('fish-base-url');
    payload.tts.model = (fishModel && fishModel.value) || 's2-pro-free';
    payload.tts.reference_id = (fishRefId && fishRefId.value.trim()) || undefined;
    payload.tts.latency = (fishLatency && fishLatency.value) || 'balanced';
    payload.tts.base_url = (fishBaseUrl && fishBaseUrl.value.trim()) || 'https://api.fish.audio';
  } else if (payload.tts.provider === 'edge_tts') {
    const edgeVoice = document.getElementById('edge-voice');
    payload.tts.voice = edgeVoice ? edgeVoice.value : undefined;
  }

  // Memory settings payload
  const memAuto = document.getElementById('mem-auto-generate');
  const memInterval = document.getElementById('mem-update-interval');
  const memMaxUserTurns = document.getElementById('mem-max-user-turns');
  const memTargetTokens = document.getElementById('mem-target-tokens');
  const memRetrievalEnabled = document.getElementById('mem-retrieval-enabled');
  const memRetrievalScope = document.getElementById('mem-retrieval-scope');
  const memRecentCount = document.getElementById('mem-recent-count');
  const memMaxResults = document.getElementById('mem-max-results');
  const memTokenBudget = document.getElementById('mem-token-budget');

  payload.memory = {
    auto_generate_enabled: memAuto ? memAuto.checked : true,
    update_interval_turns: memInterval && memInterval.value.trim() ? parseInt(memInterval.value.trim(), 10) : '',
    maximum_source_user_turns: memMaxUserTurns && memMaxUserTurns.value.trim() ? parseInt(memMaxUserTurns.value.trim(), 10) : '',
    target_tokens: memTargetTokens && memTargetTokens.value.trim() ? parseInt(memTargetTokens.value.trim(), 10) : '',
    retrieval_enabled: memRetrievalEnabled ? memRetrievalEnabled.checked : true,
    retrieval_scope: memRetrievalScope ? memRetrievalScope.value : 'current_conversation',
    retrieval_recent_count: memRecentCount && memRecentCount.value.trim() ? parseInt(memRecentCount.value.trim(), 10) : '',
    retrieval_max_results: memMaxResults && memMaxResults.value.trim() ? parseInt(memMaxResults.value.trim(), 10) : '',
    retrieval_token_budget: memTokenBudget && memTokenBudget.value.trim() ? parseInt(memTokenBudget.value.trim(), 10) : '',
  };

  // 1. Save Keys if filled
  const keysToSave = {};
  const llmKeyInput = document.getElementById('llm-api-key');
  const providerPreset = document.getElementById('llm-provider-preset');
  const selectedProviderId = (providerPreset && providerPreset.value) || 'deepseek';
  if (llmKeyInput && llmKeyInput.value.trim()) {
    keysToSave[selectedProviderId] = llmKeyInput.value.trim();
  }
  const fishKeyInput = document.getElementById('fish-api-key');
  if (fishKeyInput && fishKeyInput.value.trim()) {
    keysToSave['fish_audio'] = fishKeyInput.value.trim();
  }

  if (Object.keys(keysToSave).length > 0) {
    try {
      await fetch('/api/settings/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(keysToSave),
      });
      if (llmKeyInput) llmKeyInput.value = '';
      if (fishKeyInput) fishKeyInput.value = '';
    } catch (e) {
      console.warn('Failed to save keys:', e);
    }
  }

  // 2. Save Config Overrides
  try {
    const res = await fetch('/api/settings/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      if (statusEl) {
        statusEl.innerHTML = '✅ 设置已增量保存至资料库，密钥由 Windows DPAPI 加密！';
      }
      setTimeout(() => {
        closeSettingsModal();
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'switch-config', file: targetChar }));
        }
      }, 1200);
    } else {
      const err = await res.json();
      if (statusEl) statusEl.textContent = `❌ 保存失败: ${err.detail || '未知错误'}`;
    }
  } catch (e) {
    if (statusEl) statusEl.textContent = `❌ 保存失败: ${e.message}`;
  }
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
    updateLipSync();
    updateBlink(delta);
    updateIdle(elapsedTime);
    currentVrm.update(delta);
  }

  controls.update();
  renderer.render(scene, camera);
}

window.addEventListener('DOMContentLoaded', () => {
  initScene();
  bindEvents();
  applyCharacterUI('由比滨结衣');
  initWebSocket();
  animate();

  const settingsParam = new URLSearchParams(window.location.search).get('settings');
  if (settingsParam) {
    openSettingsModal().then(() => {
      const tab = document.querySelector(`[data-tab="tab-${settingsParam}"]`);
      if (tab) tab.click();
    });
  }
});

