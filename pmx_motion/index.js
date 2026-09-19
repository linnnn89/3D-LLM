/**
 * =========================================================================
 * Open-LLM-VTuber: PMX & MMD Dedicated Motion System (统一对外 Barrel 门面)
 * 路径: pmx_motion/index.js
 * 
 * 模块架构拓扑 (100% 严格无环)：
 * - registry.js: 纯元数据与查表纯函数 (零 import)
 * - impl.js: 角色专属实现系统与通用姿态绑定
 * - router.js: 纯净两级查表动作路由器
 * - adapters.js: 双格式角色适配器层 (零 DOM，纯净 DI)
 * - base_motion.js: 动作与面部融合底层基类 (规则引擎驱动)
 * =========================================================================
 */

// 1. 注册表与纯元数据导出
export {
  PMX_BONE_MAPPING,
  PMX_MORPH_CANDIDATES,
  DEFAULT_MORPH_CONFLICT_RULES,
  DEFAULT_MOTION_LABELS,
  PMX_CHARACTER_REGISTRY,
  findCharacterDescriptor,
  normalizeChip
} from './registry.js';

// 2. 角色系统与实现导出
export {
  PMX_CHARACTER_IMPLS,
  applyNaturalPose,
  characterBasis,
  basisToWorld,
  createQuatTrack,
  createVectorTrack,
  ensureProceduralPmxMotionClips,
  DEFAULT_EXPRESSION_PROFILES,
  BlendMotionSystem,
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
} from './impl.js';

// 3. 路由器导出
export {
  MotionRouter,
  clampFrameDelta,
  motionRouter
} from './router.js';

// 4. 适配器导出
export {
  CharacterAdapter,
  VrmCharacterAdapter,
  PmxCharacterAdapter
} from './adapters.js';

// 5. 底层动作基类导出
export {
  BasePmxMotionSystem
} from './base_motion.js';
