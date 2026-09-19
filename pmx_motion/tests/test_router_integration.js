import * as THREE from 'three';
import {
  motionRouter,
  CantarellaMotionSystem,
  KurumiMotionSystem,
  TohruMotionSystem,
  applyTohruNaturalPose,
  ensureTohruMotionClips,
  TOHRU_EXPRESSION_PROFILES
} from '../index.js';

console.log('====================================================');
console.log('🧪 开始执行 PMX 动作路由器与托尔专属系统架构集成测试');
console.log('====================================================\n');

// 构造简易 Mock 骨骼与网格适配器
function createMockAdapter(charId, name, url, type = 'pmx') {
  const bones = [];
  const boneMap = {};

  const boneNames = [
    '全ての親', 'センター', 'グルーブ', '下半身', '上半身', '上半身2', '首', '頭',
    '左肩', '左腕', '左ひじ', '左手首',
    '右肩', '右腕', '右ひじ', '右手首',
    '左足', '左ひざ', '左足首', '左つま先', '左足ＩＫ',
    '右足', '右ひざ', '右足首', '右つま先', '右足ＩＫ'
  ];

  for (const bName of boneNames) {
    const b = new THREE.Bone();
    b.name = bName;
    b.position.set(0, 0, 0);
    b.quaternion.set(0, 0, 0, 1);
    b.scale.set(1, 1, 1);
    bones.push(b);
    boneMap[bName] = b;
  }

  const skeleton = new THREE.Skeleton(bones);
  const geom = new THREE.BufferGeometry();
  const morphDict = {
    '困る': 0, '怒り': 1, '口角上げ': 2, '口角下げ': 3, 'あ': 4, 'ω': 5,
    'まばたき': 6, 'ウィンク': 7, 'ウィンク右': 8, 'ウィンク２': 9, 'ｳｨﾝｸ２右': 10,
    '真面目': 11, '笑い': 12
  };
  const morphInfluences = new Array(13).fill(0.0);

  const mesh = new THREE.SkinnedMesh(geom, new THREE.MeshBasicMaterial());
  mesh.skeleton = skeleton;
  mesh.morphTargetDictionary = morphDict;
  mesh.morphTargetInfluences = morphInfluences;

  const adapter = {
    characterId: charId,
    characterName: name,
    url: url,
    type: type,
    mesh: mesh,
    boneCache: {},
    getRootNode() { return mesh; },
    resolveBone(semanticName) {
      const map = {
        'head': '頭', 'neck': '首', 'chest': '上半身2', 'spine': '上半身',
        'hips': 'センター',
        'leftShoulder': '左肩', 'rightShoulder': '右肩',
        'leftUpperArm': '左腕', 'rightUpperArm': '右腕',
        'leftLowerArm': '左ひじ', 'rightLowerArm': '右ひじ',
        'leftHand': '左手首', 'rightHand': '右手首'
      };
      const bName = map[semanticName];
      return boneMap[bName] || null;
    },
    mmd: {
      animationPose: null,
      update(delta) {},
      updateWithMixer(delta, mixer) {
        if (mixer) mixer.update(delta);
      }
    }
  };

  return adapter;
}

let passed = 0;
let total = 0;

function assert(condition, testName) {
  total++;
  if (condition) {
    passed++;
    console.log(`✅ [PASS] ${testName}`);
  } else {
    console.error(`❌ [FAIL] ${testName}`);
  }
}

// -------------------------------------------------------------
// 测试 1: 路由判定与分流测试 (强约束隔离)
// -------------------------------------------------------------
console.log('--- 测试 1: MotionRouter 路由精准分流测试 ---');

// 1.1 坎特蕾拉 PMX 路由
const cantarellaAdapter = createMockAdapter('zh_cantarella_pmx_01', '坎特蕾拉', '/pmx-models/坎特蕾拉/坎特蕾拉.pmx', 'pmx');
motionRouter.route(cantarellaAdapter);
assert(motionRouter.currentModelType === 'cantarella', '坎特蕾拉 PMX 精确路由至 cantarella');
assert(cantarellaAdapter.cantarellaMotionSystem instanceof CantarellaMotionSystem, '挂载 CantarellaMotionSystem 实例');

// 1.2 时崎狂三 PMX 路由
const kurumiAdapter = createMockAdapter('zh_tokisaki_kurumi_01', '时崎狂三', '/pmx-models/时崎狂三/时崎狂三.pmx', 'pmx');
motionRouter.route(kurumiAdapter);
assert(motionRouter.currentModelType === 'kurumi', '时崎狂三 PMX 精确路由至 kurumi');
assert(kurumiAdapter.kurumiMotionSystem instanceof KurumiMotionSystem, '挂载 KurumiMotionSystem 实例');

// 1.3 托尔 PMX 路由 (新升级独立系统)
const tohruAdapter = createMockAdapter('zh_tohru_01', '托尔', '/pmx-models/托尔/Tohru_v1.0.pmx', 'pmx');
motionRouter.route(tohruAdapter);
assert(motionRouter.currentModelType === 'tohru', '托尔 PMX 精确路由至 tohru 专属系统');
assert(tohruAdapter.tohruMotionSystem instanceof TohruMotionSystem, '挂载 TohruMotionSystem 实例');
assert(tohruAdapter.blendMotionSystem instanceof TohruMotionSystem, '向后兼容绑定 blendMotionSystem');

// 1.4 通用 PMX/Blend 模型路由
const genericAdapter = createMockAdapter('custom_pmx_01', '自定义角色', '/pmx-models/other/test.pmx', 'pmx');
motionRouter.route(genericAdapter);
assert(motionRouter.currentModelType === 'blend', '通用 PMX 路由至通用 blend 分支');

// 1.5 VRM 模型路由
const vrmAdapter = createMockAdapter('zh_kita_ikuyo_01', '喜多郁代', '/vrm-models/喜多郁代/喜多郁代.vrm', 'vrm');
motionRouter.route(vrmAdapter);
assert(motionRouter.currentModelType === 'vrm', 'VRM 角色路由至原生 vrm 分支');

// -------------------------------------------------------------
// 测试 2: TohruMotionSystem 核心功能与生命周期测试
// -------------------------------------------------------------
console.log('\n--- 测试 2: TohruMotionSystem 功能与生命周期测试 ---');

const tohru = new TohruMotionSystem(tohruAdapter);
tohru.init();

assert(tohru.mixer instanceof THREE.AnimationMixer, 'AnimationMixer 正确初始化并挂载');
assert(Object.keys(tohru.activeMotionClips).length >= 10, '已注册全部 10 个专属动作 Clips');

const requiredClips = [
  'idle', 'tohru_love_hug', 'tohru_tail_meat', 'tohru_dragon_roar',
  'tohru_maid_curtsy', 'tohru_happy_bounce', 'wave_hand', 'gentle_nod',
  'shake_head', 'pout_turn'
];
for (const cName of requiredClips) {
  assert(!!tohru.activeMotionClips[cName], `动作 Clip [${cName}] 成功生成且存在于 activeMotionClips`);
}

// -------------------------------------------------------------
// 测试 3: 动作播放与微表情联动测试
// -------------------------------------------------------------
console.log('\n--- 测试 3: 动作播放与面部微表情联动测试 ---');

// 3.1 播放 tohru_love_hug
const playHugOk = tohru.playMotion('tohru_love_hug');
assert(playHugOk === true, 'playMotion("tohru_love_hug") 返回成功');
assert(tohru.currentMotionName === 'tohru_love_hug', '当前正在播放动作记为 tohru_love_hug');
assert(tohru.activeActionExpression && tohru.activeActionExpression['笑い'] === 0.90, 'tohru_love_hug 联动注入专属大笑表情');

// 3.2 阻尼插值更新
tohru.update(0.016, 0.016);
const idxSmile = tohruAdapter.mesh.morphTargetDictionary['口角下げ'];
assert(tohruAdapter.mesh.morphTargetInfluences[idxSmile] > 0.0, '阻尼插值成功推动形态键权重 (> 0.0)');

// 3.3 播放 tohru_tail_meat (料理邀尝)
tohru.playMotion('tohru_tail_meat');
assert(tohru.currentMotionName === 'tohru_tail_meat', '当前动作切换至 tohru_tail_meat');
assert(tohru.activeActionExpression && tohru.activeActionExpression['ウィンク２'] === 0.85, '联动注入俏皮单眼 Wink (0.85)');

// 3.4 播放 tohru_dragon_roar (龙威威慑)
tohru.playMotion('tohru_dragon_roar');
assert(tohru.currentMotionName === 'tohru_dragon_roar', '当前动作切换至 tohru_dragon_roar');
assert(tohru.activeActionExpression && tohru.activeActionExpression['怒り'] === 1.0, '联动注入倒八字怒眉 (1.0)');

// -------------------------------------------------------------
// 测试 3.5: 核心逻辑专项测试：第一动作未结束时中途触发第二动作，立刻归零验证
// -------------------------------------------------------------
console.log('\n--- 测试 3.5: 动作中途打断切换立刻归零验证 ---');
// 步骤 1: 播放动作 1 (tohru_love_hug)，经过若干帧阻尼推至高权重，模拟 hips 位移偏移
tohru.playMotion('tohru_love_hug');
for (let i = 0; i < 10; i++) {
  tohru.update(0.016, 0.016);
}
const hipsBone = tohruAdapter.resolveBone('hips');
if (hipsBone) {
  hipsBone.position.set(0, 0.5, -0.3); // 模拟动作 1 运行产生的位移偏移
}
const idxSmileKey = tohruAdapter.mesh.morphTargetDictionary['笑い'];
assert(tohruAdapter.mesh.morphTargetInfluences[idxSmileKey] > 0.05, '动作 1 运行中，笑脸形态键处于激活状态');

// 步骤 2: 在动作 1 未结束时，中途强制触发动作 2 (tohru_dragon_roar)
tohru.playMotion('tohru_dragon_roar');

// 步骤 3: 严格断言：动作 1 的笑脸与嘴角形态键已在 playMotion 瞬间被立刻归零
assert(tohruAdapter.mesh.morphTargetInfluences[idxSmileKey] === 0.0, '中途触发动作 2 瞬间：上一动作的笑脸形态键立刻归零 (=== 0.0)');
assert(tohruAdapter.mesh.morphTargetInfluences[idxSmile] === 0.0, '中途触发动作 2 瞬间：上一动作的嘴角形态键立刻归零 (=== 0.0)');

// 步骤 4: 严格断言：hips 骨骼位移已在 playMotion 瞬间被立刻复位回初始原点
if (hipsBone) {
  assert(Math.abs(hipsBone.position.y - tohru.initialHipsPosition.y) < 1e-4, '中途触发动作 2 瞬间：hips 骨骼 Y 位移立刻复位回原点');
  assert(Math.abs(hipsBone.position.z - tohru.initialHipsPosition.z) < 1e-4, '中途触发动作 2 瞬间：hips 骨骼 Z 位移立刻复位回原点');
}

// 步骤 5: 严格断言：当前动作已干净切换为动作 2，专属怒眉表情成功注入且不含任何上一动作残留
assert(tohru.currentMotionName === 'tohru_dragon_roar', '动作干净切换为 tohru_dragon_roar');
assert(tohru.activeActionExpression && tohru.activeActionExpression['怒り'] === 1.0, '动作 2 专属怒颜表情成功注入');
assert(tohru.activeActionExpression['笑い'] === undefined, '动作 2 专属表情中绝无动作 1 笑脸残留');

// -------------------------------------------------------------
// 测试 3.6: 动作与基础情绪叠加防范验证 (Motion + Emotion Superposition Prevention)
// -------------------------------------------------------------
console.log('\n--- 测试 3.6: 动作与基础情绪叠加防范验证 ---');
// 先让上一动作结束并回归待机基态
if (tohru.currentMotionAction) {
  tohru.currentMotionAction.stop();
  tohru.currentMotionAction = null;
}
tohru.activeActionExpression = null;
tohru.resetExpressions(true);

// 步骤 1: 设置基础情绪为 happy，并模拟渲染推进
tohru.setEmotion('happy', 1.0);
for (let i = 0; i < 10; i++) {
  tohru.update(0.016, 0.016);
}
assert(tohruAdapter.mesh.morphTargetInfluences[idxSmileKey] > 0.05, '基础情绪 happy 运行中，笑脸形态键生效');

// 步骤 2: 此时触发与 happy 产生严重形态键冲突的动作 tohru_dragon_roar (怒颜)
tohru.playMotion('tohru_dragon_roar');

// 步骤 3: 断言触发瞬间：笑脸形态键被彻底归零
assert(tohruAdapter.mesh.morphTargetInfluences[idxSmileKey] === 0.0, '动作播放瞬间：基础情绪笑脸形态键立刻归零 (=== 0.0)');

// 步骤 4: 更新若干帧，断言动作专属表情独占面部，基础情绪 happy 绝对没有叠加进来
tohru.update(0.016, 0.016);
tohru.update(0.016, 0.016);
const idxAngry = tohruAdapter.mesh.morphTargetDictionary['怒り'];
assert(tohruAdapter.mesh.morphTargetInfluences[idxAngry] > 0.0, '动作专属怒颜形态键正常升起 (> 0.0)');
assert(tohruAdapter.mesh.morphTargetInfluences[idxSmileKey] === 0.0, '动作专属表情独占期间：基础情绪笑脸始终为 0.0，杜绝动作+表情叠加畸变');

// -------------------------------------------------------------
// 测试 4: 基础人设情绪设置 (setEmotion)
// -------------------------------------------------------------
console.log('\n--- 测试 4: 基础人设情绪设置测试 ---');

tohru.setEmotion('happy', 0.9);
assert(tohru.currentBaseEmotion === 'happy', '基础情绪切换为 happy');
assert(tohru.baseEmotionWeight === 0.9, '情绪权重正确记录为 0.9');

tohru.setEmotion('angry', 1.0);
assert(tohru.currentBaseEmotion === 'angry', '基础情绪切换为 angry');

tohru.setEmotion('neutral', 1.0);
assert(tohru.currentBaseEmotion === 'neutral', '基础情绪切换为 neutral');

// -------------------------------------------------------------
// 测试 5: 自然休止姿态固化测试 (避免 A-Pose 还原)
// -------------------------------------------------------------
console.log('\n--- 测试 5: 自然休止姿态与 mmd.animationPose 固化测试 ---');

applyTohruNaturalPose(tohruAdapter);
assert(Array.isArray(tohruAdapter.mmd.animationPose), 'mmd.animationPose 正确固化为数组');
assert(tohruAdapter.mmd.animationPose.length === tohruAdapter.mesh.skeleton.bones.length, '固化骨骼数与模型完全一致');

// -------------------------------------------------------------
// 测试 6: 资源销毁与清理测试 (防止内存泄漏)
// -------------------------------------------------------------
console.log('\n--- 测试 6: 资源销毁与清理测试 ---');

tohru.destroy();
assert(tohru.mixer === null, 'Mixer 成功释放并置空');
assert(tohru.currentMotionAction === null, 'Action 引用成功清空');

console.log('\n====================================================');
console.log(`🎉 全部测试执行完毕: ${passed}/${total} 通过 (通过率: ${(passed/total*100).toFixed(1)}%)`);
console.log('====================================================');

if (passed !== total) {
  process.exit(1);
}
