/**
 * =========================================================================
 * Open-LLM-VTuber: PMX & Character Registry (纯数据与查表中心)
 * 路径: pmx_motion/registry.js
 * 
 * 核心设计原则：
 * 1. 零依赖：不依赖 Three.js、@pixiv/three-vrm 或任何 DOM 元素，Node/浏览器 100% 绿色安全。
 * 2. 拓扑无环：零 import，作为架构图的最底层事实源，彻底杜绝 ESM TDZ 环。
 * 3. 单一事实源：集中管理角色元数据、快捷 Chips、动作名与规范化形态键映射。
 * =========================================================================
 */

/**
 * 标准日本 MMD 骨骼语义映射表
 * 仅保留纯正 MMD 规范命名，废弃陈旧的 3ds Max / Biped 兼容别名。
 */
export const PMX_BONE_MAPPING = {
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
 * 规范化形态键候选字典 (Canonical Morph Candidates)
 * 将通用语义通道映射到各模型可能存在的日文/英文实际形态键名
 */
export const PMX_MORPH_CANDIDATES = {
  'aa': ['あ', 'a', 'A', '口_あ', 'Mouth_ah', 'mouth_ah'],
  'oh': ['お', 'o', 'O', '口_お', 'Mouth_oh', 'mouth_oh'],
  'blink': ['まばたき', '眨眼', 'blink', 'Eye_close', 'Reye_close', 'Leye_close'],
  'blinkRight': ['ウィンク右', '眨眼右', 'Reye_close', 'Reye_close_smile'],
  'blinkLeft': ['ウィンク', '眨眼左', 'Leye_close', 'Leye_close_smile'],
  'smile': ['笑い', 'にっこり', '笑顔', 'happy', 'Mouth_smile', 'mouth_smile'],
  'mouthCornerUp': ['口角上げ'],
  'mouthCornerDown': ['口角下げ'],
  'browAngry': ['怒り', 'つり眉', 'Eye_angry', 'Eyebrow_SP06'],
  'browSorrow': ['困る', '悲しい', '下がり眉', 'Eye_sorrow', 'Eyebrow_SP04'],
  'eyeAngry': ['Eye_angry'],
  'eyeSorrow': ['Eye_sorrow'],
  'mouthSmile': ['Mouth_smile'],
  'mouthAngry': ['Mouth_angry']
};

/**
 * 默认形态键互斥规则 (规范化通道定义)
 * 模式说明：
 * - winner_takes_all: 竞争通道中大者获胜，小者归零，杜绝多边形反向撕裂
 * - subtract: 从目标通道中扣除主通道权重，防止过度形变
 */
export const DEFAULT_MORPH_CONFLICT_RULES = [
  { channels: ['mouthCornerUp', 'mouthCornerDown'], mode: 'winner_takes_all' },
  { channels: ['browAngry', 'browSorrow'], mode: 'winner_takes_all' },
  { channels: ['eyeAngry', 'eyeSorrow'], mode: 'winner_takes_all' },
  { channels: ['mouthSmile', 'mouthAngry'], mode: 'winner_takes_all' },
  { primary: 'smile', target: 'blink', mode: 'subtract' }
];

/**
 * 默认动作下拉选项展示信息 (兜底用)
 */
export const DEFAULT_MOTION_LABELS = {
  'greeting': { label: '🌟 官方全身打招呼 (Pixiv)', order: 1 },
  'pmx_greeting': { label: '✨ 全身礼貌致意 (PMX专属)', order: 1 },
  'wave_hand': { label: '👋 热情摆手招手 (元气日常)', order: 2 },
  'gentle_nod': { label: '🙇 赞同点头 (倾听)', order: 3 },
  'shake_head': { label: '🙅 轻轻摇头 (傲娇/否定)', order: 4 },
  'cheerful_bounce': { label: '✨ 喜多元气跳 (开心)', order: 5 },
  'surprise_jump': { label: '😲 受惊后缩 (惊讶)', order: 6 },
  'pout_turn': { label: '😤 傲娇侧头 (生气)', order: 7 },
  'shy_tilt': { label: '💕 歪头害羞 (萌态)', order: 8 }
};

/**
 * 将任意格式的 chip 归一化为 { label, message, action }
 */
export function normalizeChip(item) {
  if (!item) return { label: '', message: '', action: null };
  if (typeof item === 'string') {
    return { label: item, message: item, action: null };
  }
  return {
    label: item.label || item.text || '',
    message: item.message || item.text || item.label || '',
    action: item.action || null
  };
}

/**
 * 静态 PMX 角色注册表 (纯元数据)
 */
export const PMX_CHARACTER_REGISTRY = [
  {
    characterId: 'zh_cantarella_pmx_01',
    name: '坎特蕾拉',
    motionGroup: 'cantarella',
    aliases: ['坎特蕾拉', 'cantarella', 'カンタレラ'],
    chips: [
      { label: '💜 魅惑吐舌', message: '坎特蕾拉，展现你的声痕', action: 'cantarella_seduce_tongue' },
      { label: '🍷 优雅致意', message: '坎特蕾拉，向大家致意', action: 'cantarella_graceful_greeting' },
      { label: '🥀 毒药挑逗', message: '那杯毒药，究竟是什么滋味？', action: 'cantarella_poison_tease' },
      { label: '💋 亲密邀约', message: '我想听听居城的故事', action: 'cantarella_alluring_whisper' }
    ],
    motionLabels: {
      'cantarella_seduce_tongue': { label: '💜 魅惑吐舌·声痕显现 (王牌特写)', order: 1 },
      'cantarella_graceful_greeting': { label: '🍷 优雅曼妙致意 (贵妇礼仪)', order: 2 },
      'cantarella_alluring_whisper': { label: '💋 魅惑邀约·低语 (亲密挑逗)', order: 3 },
      'cantarella_poison_tease': { label: '🥀 危险毒药挑逗 (戏谑冷艳)', order: 4 },
      'cantarella_arrogant_turn': { label: '👑 冷艳傲然侧身 (回眸睥睨)', order: 5 },
      'gentle_nod': { label: '🙇 优雅轻颔首 (倾听)', order: 6 },
      'shake_head': { label: '🙅 冷艳微摇头 (否定)', order: 7 }
    }
  },
  {
    characterId: 'zh_tokisaki_kurumi_01',
    name: '时崎狂三',
    motionGroup: 'kurumi',
    aliases: ['时崎狂三', '狂三', 'kurumi'],
    chips: [
      { label: '👗 优雅提裙行礼', message: '狂三，向大家行个礼吧', action: 'kurumi_curtsy' },
      { label: '💋 掩唇低语', message: 'うふふ……能靠近点跟我说吗？', action: 'kurumi_tease_whisper' },
      { label: '🎯 招牌指枪', message: '狂三，来一记Bang吧！', action: 'kurumi_finger_gun' },
      { label: '🖤 撩发回眸', message: '狂三，你今天真迷人', action: 'kurumi_hair_stroke' }
    ],
    motionLabels: {
      'kurumi_curtsy': { label: '👗 优雅提裙行礼 (初见致意)', order: 1 },
      'kurumi_tease_whisper': { label: '💋 魅惑掩唇低语 (うふふ…)', order: 2 },
      'kurumi_finger_gun': { label: '🎯 招牌指枪放电 (Bang~)', order: 3 },
      'kurumi_hair_stroke': { label: '🖤 慵懒撩发回眸 (魔女风情)', order: 4 },
      'kurumi_giggle': { label: '✨ 狂三优雅轻笑 (轻颤露齿)', order: 5 },
      'gentle_nod': { label: '🙇 优雅轻颔首 (倾听)', order: 6 },
      'shake_head': { label: '🙅 戏谑轻摇头 (玩味否定)', order: 7 },
      'pout_turn': { label: '😤 傲慢侧身回眸 (冷艳)', order: 8 }
    }
  },
  {
    characterId: 'zh_tohru_01',
    name: '托尔',
    motionGroup: 'tohru',
    aliases: ['托尔', 'tohru', 'トール'],
    chips: [
      { label: '💖 小林狂爱·飞扑', message: '小林さーん！今日も大好きですよ！', action: 'tohru_love_hug' },
      { label: '🍖 特制尾肉招待', message: '托尔，特制尻尾肉还有吗？', action: 'tohru_tail_meat' },
      { label: '🐲 灭世龙威怒颜', message: '托尔，展现一下巨龙的威严吧！', action: 'tohru_dragon_roar' },
      { label: '👗 龙女仆提裙致意', message: '托尔女仆，请多指教！', action: 'tohru_maid_curtsy' }
    ],
    motionLabels: {
      'tohru_love_hug': { label: '💖 小林狂爱·飞扑拥抱 (小林さーん！)', order: 1 },
      'tohru_tail_meat': { label: '🍖 特制尻尾肉·料理邀尝 (爱意满满)', order: 2 },
      'tohru_dragon_roar': { label: '🐲 灭世龙威·冷峻怒颜 (威慑人类)', order: 3 },
      'tohru_maid_curtsy': { label: '👗 端庄龙女仆·提裙致意 (女仆礼仪)', order: 4 },
      'tohru_happy_bounce': { label: '✨ 元气欢呼·雀跃起跳 (开心跳跃)', order: 5 },
      'wave_hand': { label: '👋 热情摆手招手 (元气日常)', order: 6 },
      'gentle_nod': { label: '🙇 乖巧轻颔首 (倾听小林)', order: 7 },
      'shake_head': { label: '🙅 委屈扁嘴轻摇头 (不开心)', order: 8 },
      'pout_turn': { label: '😤 傲娇侧身别头 (气鼓鼓)', order: 9 }
    }
  }
];

/**
 * 根据适配器元数据精确匹配角色描述符
 * 优先级：1. 后端标准 characterId (最高优先级) -> 2. 角色名/URL别名匹配
 */
export function findCharacterDescriptor(adapter) {
  if (!adapter) return null;
  const charId = (adapter.characterId || '').toLowerCase();
  const name = (adapter.characterName || '').toLowerCase();
  const url = (adapter.url || '').toLowerCase();

  // 1. 优先使用后端下发的标准 characterId 进行精确查找
  if (charId) {
    const matched = PMX_CHARACTER_REGISTRY.find(d => d.characterId.toLowerCase() === charId);
    if (matched) return matched;
  }

  // 2. 备用别名容错匹配
  for (const desc of PMX_CHARACTER_REGISTRY) {
    if (desc.aliases.some(alias => name.includes(alias.toLowerCase()) || url.includes(alias.toLowerCase()))) {
      return desc;
    }
  }

  return null;
}
