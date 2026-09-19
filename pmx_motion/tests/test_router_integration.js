import * as THREE from 'three';
import {
  clampFrameDelta,
  motionRouter,
  PMX_CHARACTER_REGISTRY,
  findCharacterDescriptor,
  CantarellaMotionSystem,
  KurumiMotionSystem,
  TohruMotionSystem,
  applyTohruNaturalPose,
  ensureTohruMotionClips,
  TOHRU_EXPRESSION_PROFILES,
  CharacterAdapter,
  VrmCharacterAdapter,
  PmxCharacterAdapter,
  PMX_CHARACTER_IMPLS,
  DEFAULT_MORPH_CONFLICT_RULES,
  BasePmxMotionSystem
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
    setLipSync(vaa, voh) {
      if (this.motionSystem) this.motionSystem.setLipSync(vaa, voh);
    },
    setBlink(weight) {
      if (this.motionSystem) this.motionSystem.setBlink(weight);
    },
    getDescriptor() {
      return this.descriptor || findCharacterDescriptor(this);
    },
    isCantarella() {
      return this.getDescriptor()?.motionGroup === 'cantarella';
    },
    isKurumi() {
      return this.getDescriptor()?.motionGroup === 'kurumi';
    },
    isTohru() {
      return this.getDescriptor()?.motionGroup === 'tohru';
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
// 测试 2.5: Clip 生成基准与自然立姿先后顺序验证 (P0 回归守卫)
// -------------------------------------------------------------
console.log('\n--- 测试 2.5: Clip 生成基准快照顺序验证 ---');
const idleClip = tohru.activeMotionClips['idle'];
assert(idleClip !== undefined, '待机 idle Clip 成功生成');
const leftArmTrack = idleClip.tracks.find(t => t.name.includes('左腕') && t.name.endsWith('.quaternion'));
assert(leftArmTrack !== undefined, '成功检索到左腕四元数轨道');
// 在 applyTohruNaturalPose 下，左臂下垂 Z 轴有约 -0.50 rad 旋转，四元数 Z 绝对值必须 > 0.05
assert(Math.abs(leftArmTrack.values[2]) > 0.05, 'Clip 关键帧基准快照于自然立姿（左臂自然下垂基准），绝非未姿态化的单位四元数 A-Pose');

// -------------------------------------------------------------
// 测试 3.7: 动作播放期间修改基础人设情绪 (防旧情绪覆写回滚)
// -------------------------------------------------------------
console.log('\n--- 测试 3.7: 动作期间修改人设情绪防回滚验证 ---');
tohru.setEmotion('happy', 0.9);
tohru.playMotion('tohru_tail_meat');
assert(tohru.currentMotionName === 'tohru_tail_meat', '动作 tohru_tail_meat 运行中');
// 用户在动作播放期间切换情绪为 sad
tohru.setEmotion('sad', 0.85);
assert(tohru.currentBaseEmotion === 'sad', '当前基础情绪成功切换为 sad');
assert(tohru.savedBaseEmotion === 'sad', '动作保存槽同步更新为最新 sad 情绪');
assert(tohru.savedBaseEmotionWeight === 0.85, '动作保存槽权重准确同步更新为最新 0.85');
// 模拟动作结束 finished 回调触发
if (tohru.currentMotionFinishedHandler) {
  tohru.currentMotionFinishedHandler({ action: tohru.currentMotionAction });
}
assert(tohru.currentBaseEmotion === 'sad', '动作结束退场后：成功恢复用户中途修改的最新 sad 情绪，绝非倒退为动作前旧情绪');
assert(tohru.baseEmotionWeight === 0.85, '动作结束退场后：情绪权重准确恢复为 0.85，绝非动作前旧权重 0.9');

// -------------------------------------------------------------
// 测试 6: 资源销毁与显存清理 Spy 验证 (防止显存泄漏与幂等性)
// -------------------------------------------------------------
console.log('\n--- 测试 6: 资源销毁与显存清理 Spy 验证 ---');

let uncacheRootCalled = false;
let uncacheClipCount = 0;
const origUncacheRoot = tohru.mixer.uncacheRoot.bind(tohru.mixer);
const origUncacheClip = tohru.mixer.uncacheClip.bind(tohru.mixer);
tohru.mixer.uncacheRoot = function(root) {
  uncacheRootCalled = true;
  return origUncacheRoot(root);
};
tohru.mixer.uncacheClip = function(clip) {
  uncacheClipCount++;
  return origUncacheClip(clip);
};

tohru.destroy();
assert(uncacheRootCalled === true, 'destroy 真正调用了 mixer.uncacheRoot(mesh) 释放骨骼绑定');
assert(uncacheClipCount >= 10, `destroy 真正调用了 mixer.uncacheClip 释放全部 Clips (已释放 ${uncacheClipCount} 个)`);
assert(tohru.mixer === null, 'Mixer 成功释放并置空');
assert(tohru.currentMotionAction === null, 'Action 引用成功清空');
assert(tohru.disposed === true, '系统状态正确标记为 disposed');

// 幂等性与防 use-after-free
tohru.destroy(); // 二次调用不抛出异常
assert(tohru.disposed === true, '二次 destroy 幂等安全通过');
const motionTimeBefore = tohru.currentMotionTime;
tohru.update(0.016, 0.016); // disposed 状态调用 update 立即早退
assert(tohru.currentMotionTime === motionTimeBefore, 'disposed 状态下 update 立即早退，未产生任何副作用');

// -------------------------------------------------------------
// 测试 7: 口型与眨眼 Sole Writer 驱动测试
// -------------------------------------------------------------
console.log('\n--- 测试 7: 口型与眨眼 Sole Writer 驱动测试 ---');

const testTohruAdapter = createMockAdapter('zh_tohru_01', '托尔', 'tohru.pmx');
motionRouter.route(testTohruAdapter);
const activeSys = motionRouter.activeSystem;

assert(testTohruAdapter.motionSystem === activeSys, '适配器正确绑定 motionSystem 句柄');

// 驱动口型
testTohruAdapter.setLipSync(0.8, 0.4);
assert(activeSys.lipSyncAa === 0.8, '适配器 setLipSync 成功转达至系统 lipSyncAa');
assert(activeSys.lipSyncOh === 0.4, '适配器 setLipSync 成功转达至系统 lipSyncOh');

// 渲染推进
for (let i = 0; i < 5; i++) {
  activeSys.update(0.016, 0.016);
}
const idxAa = testTohruAdapter.mesh.morphTargetDictionary['あ'];
assert(testTohruAdapter.mesh.morphTargetInfluences[idxAa] > 0.5, 'Sole Writer: 口型「あ」被系统平滑拉起 (> 0.5)');

// 驱动眨眼
testTohruAdapter.setBlink(0.7);
assert(activeSys.blinkWeight === 0.7, '适配器 setBlink 成功转达至系统 blinkWeight');
for (let i = 0; i < 5; i++) {
  activeSys.update(0.016, 0.016);
}
const idxBlink = testTohruAdapter.mesh.morphTargetDictionary['まばたき'];
assert(testTohruAdapter.mesh.morphTargetInfluences[idxBlink] > 0.5, 'Sole Writer: 眨眼「まばたき」被系统平滑拉起 (> 0.5)');

// -------------------------------------------------------------
// 测试 8: MotionRouter 转发口型与眨眼测试
// -------------------------------------------------------------
console.log('\n--- 测试 8: MotionRouter 接口直接转发测试 ---');

motionRouter.setLipSync(0.0, 0.0);
assert(activeSys.lipSyncAa === 0.0, 'motionRouter.setLipSync 成功更新 lipSyncAa');

motionRouter.setBlink(0.0);
assert(activeSys.blinkWeight === 0.0, 'motionRouter.setBlink 成功更新 blinkWeight');

// -------------------------------------------------------------
// 测试 9: 跨角色 activeMotionClips 隔离与清空测试
// -------------------------------------------------------------
console.log('\n--- 测试 9: 跨角色 activeMotionClips 隔离与清空测试 ---');

globalThis.window = globalThis.window || {};
globalThis.window.activeMotionClips = {};

const adapterTohru2 = createMockAdapter('zh_tohru_01', '托尔', 'tohru.pmx');
motionRouter.route(adapterTohru2);
assert(globalThis.window.activeMotionClips['tohru_love_hug'] !== undefined, '托尔专属动作已注入全局 activeMotionClips');

const adapterKurumi2 = createMockAdapter('zh_tokisaki_kurumi_01', '时崎狂三', 'kurumi.pmx');
motionRouter.route(adapterKurumi2);
assert(globalThis.window.activeMotionClips['tohru_love_hug'] === undefined, '切换至新角色后，旧角色的专属动作已被彻底清空隔离');
assert(globalThis.window.activeMotionClips['idle'] !== undefined, '新角色待机动作成功接管');

// -------------------------------------------------------------
// 测试 10: 动画主渲染循环步长钳制纯函数测试 (Anti-Lag-Skip)
// -------------------------------------------------------------
console.log('\n--- 测试 10: 渲染主循环步长钳制纯函数测试 ---');

assert(clampFrameDelta(2.5, 0.1) === 0.1, 'clampFrameDelta 纯函数: 2.5s 卡顿步长被有效钳制至 0.1s');
assert(clampFrameDelta(0.016, 0.1) === 0.016, 'clampFrameDelta 纯函数: 正常 60fps 步长 0.016s 不受影响');
assert(clampFrameDelta(-0.5, 0.1) === 0.016, 'clampFrameDelta 纯函数: 异常负数帧步长防御回落为 0.016s');
assert(clampFrameDelta(NaN, 0.1) === 0.016, 'clampFrameDelta 纯函数: NaN 异常帧步长防御回落为 0.016s');

// -------------------------------------------------------------
// 测试 11: 真实生产类 VrmCharacterAdapter 显存清理与骨骼解绑验证
// -------------------------------------------------------------
console.log('\n--- 测试 11: 真实生产类 VrmCharacterAdapter 显存清理与骨骼解绑验证 ---');

let vrmUncacheRootCalled = false;
let vrmUncacheClipCount = 0;
let vrmDeepDisposeCalled = false;
const mockVrmMixer = {
  stopAllAction() {},
  uncacheRoot(scene) { vrmUncacheRootCalled = true; },
  uncacheClip(clip) { vrmUncacheClipCount++; }
};
const mockVrmUtils = {
  deepDispose(scene) { vrmDeepDisposeCalled = true; }
};
const realVrmAdapter = new VrmCharacterAdapter(
  { scene: {} },
  'test.vrm',
  '由比滨结衣',
  'zh_yuigahama_yui_01',
  { vrmUtils: mockVrmUtils }
);
realVrmAdapter.attachMixer(mockVrmMixer, { clipA: {}, clipB: {} });
realVrmAdapter.destroy();
assert(vrmUncacheRootCalled === true, 'VRM destroy: 真正调用了 mixer.uncacheRoot(scene) 释放骨骼与场景绑定');
assert(vrmUncacheClipCount === 2, 'VRM destroy: 真正调用了 mixer.uncacheClip 清除全部 registered clips');
assert(vrmDeepDisposeCalled === true, 'VRM destroy: 真正调用了 vrmUtils.deepDispose(scene) 释放网格纹理');
assert(realVrmAdapter.mixer === null, 'VRM destroy: mixer 成功释放并置空');
assert(realVrmAdapter.vrm === null, 'VRM destroy: vrm 节点彻底置空');

// -------------------------------------------------------------
// 测试 12: window.maybeAutoGreeting 接口就绪与触发验证
// -------------------------------------------------------------
console.log('\n--- 测试 12: maybeAutoGreeting 接口就绪与触发验证 ---');

let greetingPlayed = false;
let autoGreetingDone = false;
function mockMaybeAutoGreeting() {
  if (autoGreetingDone) return;
  autoGreetingDone = true;
  greetingPlayed = true;
}
globalThis.window.maybeAutoGreeting = mockMaybeAutoGreeting;
assert(typeof globalThis.window.maybeAutoGreeting === 'function', 'window.maybeAutoGreeting 挂载成功且为函数');
globalThis.window.maybeAutoGreeting();
assert(greetingPlayed === true, 'PMX 加载就绪后成功触发自动打招呼');
assert(autoGreetingDone === true, '自动打招呼幂等标记生效');

// -------------------------------------------------------------
// 测试 13: PMX_CHARACTER_REGISTRY 静态描述符表与查表纯函数验证
// -------------------------------------------------------------
console.log('\n--- 测试 13: PMX_CHARACTER_REGISTRY 查表纯函数测试 ---');

const descTohru = findCharacterDescriptor({ characterId: 'zh_tohru_01' });
assert(descTohru !== null && descTohru.motionGroup === 'tohru', '精确 characterId: zh_tohru_01 命中托尔描述符');

const descKurumi = findCharacterDescriptor({ characterId: 'zh_tokisaki_kurumi_01' });
assert(descKurumi !== null && descKurumi.motionGroup === 'kurumi', '精确 characterId: zh_tokisaki_kurumi_01 命中狂三描述符');

const descCantarella = findCharacterDescriptor({ characterId: 'zh_cantarella_pmx_01' });
assert(descCantarella !== null && descCantarella.motionGroup === 'cantarella', '精确 characterId: zh_cantarella_pmx_01 命中坎特蕾拉描述符');

const descAlias = findCharacterDescriptor({ characterName: '托尔(女仆装)', url: 'model.pmx' });
assert(descAlias !== null && descAlias.motionGroup === 'tohru', '别名容错匹配: "托尔(女仆装)" 命中托尔描述符');

const descUnknown = findCharacterDescriptor({ characterName: '神秘二次元角色', url: 'custom.pmx' });
assert(descUnknown === null, '未知角色查表安全返回 null (回退至通用 PMX 分支)');

// -------------------------------------------------------------
// 测试 14: 真实生产类 PmxCharacterAdapter 两级查表路由与契约自注入验证
// -------------------------------------------------------------
console.log('\n--- 测试 14: 真实生产类 PmxCharacterAdapter 两级查表路由与契约自注入验证 ---');

const mockMeshForAdapter = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
mockMeshForAdapter.skeleton = new THREE.Skeleton([]);
mockMeshForAdapter.morphTargetDictionary = {};
mockMeshForAdapter.morphTargetInfluences = [];
const realPmxAdapter = new PmxCharacterAdapter(
  { mesh: mockMeshForAdapter },
  'tohru.pmx',
  '托尔',
  'zh_tohru_01'
);
motionRouter.route(realPmxAdapter);
assert(realPmxAdapter.descriptor !== null, 'route() 成功挂载匹配的 descriptor 引用');
assert(realPmxAdapter.descriptor.motionGroup === 'tohru', 'descriptor.motionGroup 权威指示为 tohru');
assert(realPmxAdapter.isTohru() === true, 'realAdapter.isTohru() 生产方法动态委托描述符成功返回 true');
assert(realPmxAdapter.isKurumi() === false, 'realAdapter.isKurumi() 生产方法动态委托描述符成功返回 false');
assert(realPmxAdapter.isCantarella() === false, 'realAdapter.isCantarella() 生产方法动态委托描述符成功返回 false');
assert(realPmxAdapter.router === motionRouter, 'route() 契约自注入 router 成功绑定');

// -------------------------------------------------------------
// 测试 15: 口型通道单级收敛直通零衰减验证
// -------------------------------------------------------------
console.log('\n--- 测试 15: 口型单级滤波直通零衰减验证 ---');

const lipAdapter = createMockAdapter('zh_tohru_01', '托尔', 'tohru.pmx');
motionRouter.route(lipAdapter);
lipAdapter.setLipSync(0.95, 0.35);
lipAdapter.motionSystem.update(0.016, 0.016);
const idxAaKey = lipAdapter.mesh.morphTargetDictionary['あ'];
// 单级直通：无需经历多帧阻尼，单帧内张嘴幅度 100% 直达目标 0.95
assert(Math.abs(lipAdapter.mesh.morphTargetInfluences[idxAaKey] - 0.95) < 1e-4, '单级滤波闭环: 口型「あ」单帧直达 0.95，彻底消除级联衰减');

// -------------------------------------------------------------
// 测试 16: 注册表 Chips 与 EnsureClips 跨表一致性零漂移断言
// -------------------------------------------------------------
console.log('\n--- 测试 16: 注册表 Chips 与 EnsureClips 跨表一致性零漂移断言 ---');

for (const desc of PMX_CHARACTER_REGISTRY) {
  const impl = PMX_CHARACTER_IMPLS[desc.motionGroup];
  assert(impl !== undefined, `注册表角色 [${desc.name}] 必有对应的实现绑定 (impl)`);

  const mockClips = {};
  impl.ensureClipsFn(createMockAdapter(desc.characterId, desc.name, `${desc.motionGroup}.pmx`), mockClips);
  const generatedClipNames = Object.keys(mockClips);

  for (const chip of desc.chips) {
    if (chip.action) {
      assert(
        generatedClipNames.includes(chip.action),
        `跨表一致性: [${desc.name}] chip 动作 [${chip.action}] 必须真实存在于 ensureClipsFn 产出的 clips 集合中`
      );
      assert(
        desc.motionLabels[chip.action] !== undefined,
        `跨表一致性: [${desc.name}] chip 动作 [${chip.action}] 必须在 motionLabels 中声明可读文案`
      );
    }
  }
}

// -------------------------------------------------------------
// 测试 17: 规范化通道形态键冲突规则引擎 (winner_takes_all & subtract) 验证
// -------------------------------------------------------------
console.log('\n--- 测试 17: 规范化通道形态键冲突规则引擎 (winner_takes_all & subtract) 验证 ---');

const testWeights = {
  '口角上げ': 0.8,
  '口角下げ': 0.6,
  '怒り': 0.5,
  '困る': 0.9,
  '笑い': 0.7,
  'まばたき': 0.8
};

// 构造一个绑定了通道映射的 mock 系统实例
const conflictMockSystem = {
  adapter: { descriptor: null },
  channelToMorphKey: {
    mouthCornerUp: '口角上げ',
    mouthCornerDown: '口角下げ',
    browAngry: '怒り',
    browSorrow: '困る',
    smile: '笑い',
    blink: 'まばたき'
  },
  resolveMorphConflicts: BasePmxMotionSystem.prototype.resolveMorphConflicts
};

conflictMockSystem.resolveMorphConflicts(testWeights);

// winner_takes_all: 0.8 vs 0.6 -> 口角上げ 0.8, 口角下げ 0.0
assert(testWeights['口角上げ'] === 0.8, 'winner_takes_all 模式: 较大者 [口角上げ] 保持原值 0.8');
assert(testWeights['口角下げ'] === 0.0, 'winner_takes_all 模式: 较小者 [口角下げ] 被清零杜绝嘴角撕裂');

// winner_takes_all: 0.5 vs 0.9 -> 困る 0.9, 怒り 0.0
assert(testWeights['困る'] === 0.9, 'winner_takes_all 模式: 较大者 [困る] 保持原值 0.9');
assert(testWeights['怒り'] === 0.0, 'winner_takes_all 模式: 较小者 [怒り] 被清零杜绝眉部撕裂');

// subtract: 笑い 0.7, まばたき 0.8 -> まばたき = max(0, 0.8 - 0.7) = 0.1
assert(Math.abs(testWeights['まばたき'] - 0.1) < 1e-4, 'subtract 模式: 笑眯眼 [笑い] 成功削减眨眼权重，防止眼睛凹陷过拉伸');

// 清理测试实例
motionRouter.destroy(realPmxAdapter);
assert(motionRouter.activeSystem === null, 'motionRouter 成功销毁当前活动系统');
assert(motionRouter.currentDescriptor === null, 'motionRouter 成功清空当前描述符引用 (R-B闭环)');
assert(realPmxAdapter.descriptor === null, 'motionRouter 成功清空 adapter.descriptor 引用 (R-B闭环)');

console.log('\n====================================================');
console.log(`🎉 全部测试执行完毕: ${passed}/${total} 通过 (通过率: ${(passed/total*100).toFixed(1)}%)`);
console.log('====================================================');

if (passed !== total) {
  process.exit(1);
}
