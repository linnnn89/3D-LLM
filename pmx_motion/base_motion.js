import * as THREE from 'three';
import { PMX_MORPH_CANDIDATES, DEFAULT_MORPH_CONFLICT_RULES } from './registry.js';

const warnedMissingChannels = new Set();

/**
 * =========================================================================
 * BasePmxMotionSystem: 所有 PMX 角色的全局动作与表情驱动基类
 * 
 * 核心设计目标 (第一性原理)：
 * 1. 【全局动作切换原点守卫】：任何角色在切换到新动作前，强制将上一动作的表情形态键与骨骼位移
 *    原子复位归零回原点，杜绝两次动作间表情向量非线性叠加（导致五官拉扯畸变）与 hips 漂移。
 * 2. 【统一生命周期管理】：无论未来新增 10 个还是 100 个动作，均自动继承完整的淡入淡出、
 *    打断复位、表情联动与退场恢复机制，无需为每个动作单独写复位代码。
 * 3. 【多通道阻尼面部融合】：支持基准情绪、动作伴随专属表情、实时眨眼与语音嘴型(LipSync)的
 *    优先级计算与平滑阻尼插值。
 * =========================================================================
 */
export class BasePmxMotionSystem {
  constructor(adapter, options = {}) {
    this.adapter = adapter;
    this.mesh = adapter.getRootNode ? adapter.getRootNode() : adapter.mesh;
    this.mixer = null;
    this.activeMotionClips = {};
    this.currentIdleAction = null;
    this.currentMotionAction = null;
    this.currentMotionName = null;
    this.currentMotionTime = 0.0;
    this.currentMotionFinishedHandler = null;
    this.disposed = false;
    this.channelToMorphKey = {};

    // 表情与形态键管理核心状态
    this.profile = options.profile || { emotions: {}, actionExpressions: {} };
    this.currentBaseEmotion = 'neutral';
    this.baseEmotionWeight = 1.0;
    this.savedBaseEmotion = null;
    this.savedBaseEmotionWeight = 1.0;
    this.activeActionExpression = null;
    this.currentMorphWeights = {};

    // 独立眨眼与口型驱动权重 (由 setLipSync / setBlink 统一驱动，Sole Writer)
    this.blinkWeight = 0.0;
    this.lipSyncAa = 0.0;
    this.lipSyncOh = 0.0;

    // 钩子函数
    this.ensureClipsFn = options.ensureClipsFn || null;
    this.applyPoseFn = options.applyPoseFn || null;

    // 收集本模型受控形态键字典与初始 hips 位移
    this.initialHipsPosition = null;
    this.controlledMorphNames = new Set();
    this.initControlledMorphNames(options.defaultMorphNames);
  }

  initControlledMorphNames(defaultNames = []) {
    if (Array.isArray(defaultNames)) {
      for (const n of defaultNames) this.controlledMorphNames.add(n);
    }
    if (this.profile?.emotions) {
      for (const obj of Object.values(this.profile.emotions)) {
        for (const k of Object.keys(obj)) this.controlledMorphNames.add(k);
      }
    }
    if (this.profile?.actionExpressions) {
      for (const obj of Object.values(this.profile.actionExpressions)) {
        for (const k of Object.keys(obj)) this.controlledMorphNames.add(k);
      }
    }
    if (this.mesh && this.mesh.morphTargetDictionary) {
      for (const name of Object.keys(this.mesh.morphTargetDictionary)) {
        this.controlledMorphNames.add(name);
      }
    }
  }

  buildMorphChannelMapping() {
    this.channelToMorphKey = {};
    if (!this.mesh || !this.mesh.morphTargetDictionary) return;
    const dict = this.mesh.morphTargetDictionary;
    for (const [channel, candidates] of Object.entries(PMX_MORPH_CANDIDATES)) {
      for (const name of candidates) {
        if (dict[name] !== undefined) {
          this.channelToMorphKey[channel] = name;
          break; // 规则契约：首个命中
        }
      }
    }

    // 校验规则中的通道，若有未命中的通道打一次 warning (使用 Set 去重，绝不进入每帧)
    const rules = this.adapter?.descriptor?.conflictRules || DEFAULT_MORPH_CONFLICT_RULES;
    for (const rule of rules) {
      const channelsToCheck = rule.channels || [rule.primary, rule.target];
      for (const ch of channelsToCheck) {
        if (ch && !this.channelToMorphKey[ch] && !warnedMissingChannels.has(ch)) {
          warnedMissingChannels.add(ch);
          console.warn(`[BasePmxMotionSystem] 通道 ${ch} 未在模型形态键字典中命中，跳过该规则约束`);
        }
      }
    }
  }

  init() {
    this.buildMorphChannelMapping();
    if (typeof this.applyPoseFn === 'function') {
      this.applyPoseFn(this.adapter);
    }
    const hips = typeof this.adapter?.resolveBone === 'function' ? this.adapter.resolveBone('hips') : null;
    if (hips) {
      this.initialHipsPosition = hips.position.clone();
    }
    this.setupMixer();
  }

  applyNaturalPose() {
    if (typeof this.applyPoseFn === 'function') {
      this.applyPoseFn(this.adapter);
    } else if (typeof this.adapter?.applyNaturalPose === 'function') {
      this.adapter.applyNaturalPose();
    }
  }

  setupMixer() {
    if (this.mixer) {
      this.mixer.stopAllAction();
    }
    this.mixer = new THREE.AnimationMixer(this.mesh);
    this.adapter.mixer = this.mixer;
    if (typeof window !== 'undefined') {
      window.currentAnimationMixer = this.mixer;
    }

    this.activeMotionClips = {};
    if (typeof this.ensureClipsFn === 'function') {
      this.ensureClipsFn(this.adapter, this.activeMotionClips);
    }
    this.adapter.activeMotionClips = this.activeMotionClips;
    if (typeof window !== 'undefined' && window.activeMotionClips) {
      for (const k in window.activeMotionClips) delete window.activeMotionClips[k];
      Object.assign(window.activeMotionClips, this.activeMotionClips);
    }

    this.playIdleMotion();
  }

  /**
   * ★ 全局核心机制 1：表情形态键彻底归零恢复原点
   * 杜绝上一动作形态键残留与新动作形态键累加
   * @param {boolean} immediate - 是否立即写入底层的 morphTargetInfluences
   */
  resetExpressions(immediate = true) {
    this.activeActionExpression = null;
    this.blinkWeight = 0.0;
    this.lipSyncAa = 0.0;
    this.lipSyncOh = 0.0;

    const dict = this.mesh?.morphTargetDictionary || {};
    const influences = this.mesh?.morphTargetInfluences;

    // 1. 清空内部受控形态键的当前缓存与权重
    this.currentMorphWeights = {};

    // 2. 将所有受控形态键彻底归零回原点
    for (const mName of this.controlledMorphNames) {
      this.currentMorphWeights[mName] = 0.0;
      const idx = dict[mName];
      if (immediate && influences && idx !== undefined) {
        influences[idx] = 0.0;
      }
    }
  }

  /**
   * ★ 全局核心机制 2：骨骼姿态与根节点位移彻底复位回自然站姿原点
   * 杜绝上一动作中途打断产生的 hips 漂移与骨骼旋转累加
   */
  resetPose() {
    if (!this.adapter) return;
    const hips = typeof this.adapter.resolveBone === 'function' ? this.adapter.resolveBone('hips') : null;
    const spine = typeof this.adapter.resolveBone === 'function' ? this.adapter.resolveBone('spine') : null;
    const chest = typeof this.adapter.resolveBone === 'function' ? this.adapter.resolveBone('chest') : null;
    const head = typeof this.adapter.resolveBone === 'function' ? this.adapter.resolveBone('head') : null;

    if (hips) {
      hips.rotation.set(0, 0, 0);
      if (this.initialHipsPosition) {
        hips.position.copy(this.initialHipsPosition);
      }
    }
    if (spine) spine.rotation.set(0, 0, 0);
    if (chest) chest.rotation.set(0, 0, 0);
    if (head) head.rotation.set(0, 0, 0);

    this.applyNaturalPose();

    const rootMesh = this.adapter.getRootNode() || this.adapter.mesh;
    if (rootMesh) {
      rootMesh.updateMatrixWorld(true);
      if (rootMesh.skeleton && rootMesh.skeleton.bones) {
        for (const bone of rootMesh.skeleton.bones) {
          bone.updateMatrix();
        }
      }
    }
  }

  resolveMotionAlias(motionName) {
    return motionName;
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

  /**
   * ★ 全局动作播放统一入口 (无论未来有 10 个还是 100 个动作，均由此通用管线驱动)
   * 核心逻辑：假设在第一个动作还未结束时触发了第二个动作，立刻强制归零，然后再开始第二个动作
   */
  playMotion(motionName) {
    if (!this.mixer) return false;
    const actualMotion = this.resolveMotionAlias(motionName);
    const clip = this.activeMotionClips[actualMotion];
    if (!clip) {
      console.debug(`[BasePmxMotion] 动作 ${actualMotion} 未找到对应动画片段`);
      return false;
    }

    console.log(`[BasePmxMotion] ▶ 播放动作: ${actualMotion}`);

    // 1. 若第一个动作尚未结束被中途打断，立即硬停并清除监听器
    const wasInterrupting = !!this.currentMotionAction;
    if (this.currentMotionAction) {
      if (this.currentMotionFinishedHandler) {
        this.mixer.removeEventListener('finished', this.currentMotionFinishedHandler);
        this.currentMotionFinishedHandler = null;
      }
      this.currentMotionAction.stop();
      this.currentMotionAction = null;
    }

    // 2. 保存当前基础情绪，供动作自然结束时自动回弹恢复
    if (this.currentBaseEmotion && this.currentBaseEmotion !== 'neutral' && !this.savedBaseEmotion) {
      this.savedBaseEmotion = this.currentBaseEmotion;
      this.savedBaseEmotionWeight = this.baseEmotionWeight;
    }

    // 3. ★ 立刻归零：立刻将表情形态键清零、骨骼姿态与 hips 位移复位回基准 Natural Pose
    this.resetExpressions(true);
    this.resetPose();

    // 4. 然后再开始第二个动作
    this.currentMotionName = actualMotion;
    this.currentMotionTime = 0.0;

    // 联动注入动作专属表情（若 profile 中配置）
    const actionExp = this.profile.actionExpressions?.[actualMotion];
    if (actionExp) {
      this.activeActionExpression = actionExp;
      console.log(`[BasePmxMotion] ✨ 联动注入 [${actualMotion}] 专属面部表情`);
    } else {
      this.activeActionExpression = null;
    }

    // 5. 动画轨道初始化与启动
    const action = this.mixer.clipAction(clip);
    action.stop();
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.setEffectiveWeight(1.0);

    if (wasInterrupting) {
      // 中途打断切换：从已归零的原点迅速淡入启动新动作，绝不混合旧动作残余
      action.fadeIn(0.15);
    } else if (this.currentIdleAction) {
      action.crossFadeFrom(this.currentIdleAction, 0.25, false);
    } else {
      action.fadeIn(0.25);
    }

    action.play();
    this.currentMotionAction = action;

    // 6. ★ 动作播放完毕自动退场守卫：淡出并恢复原点与待机
    const onFinished = (e) => {
      if (e && e.action && e.action !== action) return;
      this.mixer.removeEventListener('finished', onFinished);
      if (this.currentMotionFinishedHandler === onFinished) this.currentMotionFinishedHandler = null;
      if (this.currentMotionAction !== action) return;
      this.currentMotionAction = null;
      this.currentMotionName = null;
      this.currentMotionTime = 0.0;
      this.activeActionExpression = null;

      // 动作自然播放完，平滑恢复原点
      this.resetExpressions(false);
      this.resetPose();

      // ★ 自动恢复动作前保存的基础人设情绪 (happy / angry / etc.)
      if (this.savedBaseEmotion) {
        this.currentBaseEmotion = this.savedBaseEmotion;
        this.baseEmotionWeight = this.savedBaseEmotionWeight || 1.0;
        this.savedBaseEmotion = null;
      }

      action.fadeOut(0.35);
      if (this.currentIdleAction) {
        this.currentIdleAction.reset().setEffectiveWeight(1.0).fadeIn(0.35).play();
      }
    };
    this.currentMotionFinishedHandler = onFinished;
    this.mixer.addEventListener('finished', onFinished);
    return true;
  }

  setEmotion(preset, weight = 0.85) {
    const validPresets = ['happy', 'angry', 'sad', 'relaxed', 'surprised', 'neutral'];
    const p = validPresets.includes(preset) ? preset : 'neutral';
    this.currentBaseEmotion = p;
    this.baseEmotionWeight = weight;
    if (this.currentMotionAction) {
      this.savedBaseEmotion = p;
      this.savedBaseEmotionWeight = weight;
    }
    console.log(`[BasePmxMotion] 🎭 人设表情: ${p} (强度: ${weight})`);
  }

  setBlink(weight) {
    this.blinkWeight = weight;
  }

  setLipSync(vaa, voh) {
    this.lipSyncAa = vaa;
    this.lipSyncOh = voh;
  }

  update(delta, elapsedTime) {
    if (this.disposed) return;

    if (this.adapter && this.adapter.mmd) {
      if (this.mixer) {
        this.adapter.mmd.updateWithMixer(delta, this.mixer);
      } else {
        this.adapter.mmd.update(delta);
      }
    }
    if (this.currentMotionAction) {
      this.currentMotionTime += delta;
    }
    this.updateFacialExpressions(delta);
  }

  /**
   * =========================================================================
   * 形态键更新执行流水线 (严格顺序保证，严禁颠倒)：
   * 步骤 1: 人设基准情绪 / 动作专属表情独占计算并写入 targetWeights
   * 步骤 2: 形态键互斥裁决器 (resolveMorphConflicts) 消除相对立拉伸 (大者胜 / 相减)
   * 步骤 3: 实时自主眨眼通道合并 (Math.max 合并)
   * 步骤 4: 语音嘴型驱动 (LipSync) 计算
   * 步骤 5: 单级直通与平滑阻尼更新 (口型单级直通零衰减覆盖；情绪与眨眼平滑阻尼)
   * =========================================================================
   */
  updateFacialExpressions(delta) {
    if (this.disposed || !this.mesh || !this.mesh.morphTargetDictionary || !this.mesh.morphTargetInfluences) return;
    const dict = this.mesh.morphTargetDictionary;
    const influences = this.mesh.morphTargetInfluences;

    const targetWeights = {};

    // 步骤 1: 动作专属表情与基准情绪独占计算
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

    // 步骤 2: 形态键互斥裁决与防撕裂约束 (规则引擎驱动)
    this.resolveMorphConflicts(targetWeights);

    // 步骤 3: 眨眼叠加 (基于规范化通道映射，回落到字面量)
    const blinkKey = this.channelToMorphKey['blink'] || (dict['まばたき'] !== undefined ? 'まばたき' : (dict['Eye_close'] !== undefined ? 'Eye_close' : null));
    if (this.blinkWeight > 0.001 && blinkKey) {
      targetWeights[blinkKey] = Math.max(targetWeights[blinkKey] || 0.0, this.blinkWeight);
    }

    // 步骤 4: 语音嘴型驱动 (aa 与 oh 通道)
    const mouthKey = this.channelToMorphKey['aa'] || (dict['あ'] !== undefined ? 'あ' : (dict['口_あ'] !== undefined ? '口_あ' : (dict['Mouth_ah'] !== undefined ? 'Mouth_ah' : null)));
    if (mouthKey && this.lipSyncAa > 0.001) {
      targetWeights[mouthKey] = Math.max(targetWeights[mouthKey] || 0.0, this.lipSyncAa);
    }
    const mouthOhKey = this.channelToMorphKey['oh'] || (dict['お'] !== undefined ? 'お' : (dict['口_お'] !== undefined ? '口_お' : (dict['Mouth_oh'] !== undefined ? 'Mouth_oh' : null)));
    if (mouthOhKey && this.lipSyncOh > 0.001) {
      targetWeights[mouthOhKey] = Math.max(targetWeights[mouthOhKey] || 0.0, this.lipSyncOh);
    }

    // 步骤 5: 单级直通与平滑阻尼更新
    const aaCandidates = PMX_MORPH_CANDIDATES['aa'] || [];
    const ohCandidates = PMX_MORPH_CANDIDATES['oh'] || [];
    const blinkCandidates = PMX_MORPH_CANDIDATES['blink'] || [];

    for (const mName of this.controlledMorphNames) {
      const idx = dict[mName];
      if (idx === undefined) continue;

      const target = targetWeights[mName] || 0.0;

      const isMouth = (mName === mouthKey || mName === mouthOhKey || aaCandidates.includes(mName) || ohCandidates.includes(mName));
      if (isMouth) {
        // 单级滤波闭环：app.js 已执行频域平滑，底层直跟目标，消除级联衰减导致的不张嘴
        this.currentMorphWeights[mName] = target;
        influences[idx] = target;
        continue;
      }

      const isBlink = (mName === blinkKey || blinkCandidates.includes(mName));
      const speed = isBlink ? 24.0 : 12.0;

      const current = this.currentMorphWeights[mName] || 0.0;
      const next = THREE.MathUtils.damp(current, target, speed, delta);
      this.currentMorphWeights[mName] = next;
      influences[idx] = next;
    }
  }

  /**
   * ★ 形态键互斥裁决器：由规范化通道规则驱动，消除相对立拉伸，杜绝面部多边形反向撕裂畸变
   */
  resolveMorphConflicts(weights) {
    if (!weights) return;
    const rules = this.adapter?.descriptor?.conflictRules || DEFAULT_MORPH_CONFLICT_RULES;
    for (const rule of rules) {
      if (rule.mode === 'winner_takes_all' && Array.isArray(rule.channels)) {
        const [chA, chB] = rule.channels;
        const keyA = this.channelToMorphKey[chA] || chA;
        const keyB = this.channelToMorphKey[chB] || chB;
        if (weights[keyA] > 0 && weights[keyB] > 0) {
          if (weights[keyA] >= weights[keyB]) {
            weights[keyB] = 0.0;
          } else {
            weights[keyA] = 0.0;
          }
        }
      } else if (rule.mode === 'subtract' && rule.primary && rule.target) {
        const keyPrim = this.channelToMorphKey[rule.primary] || rule.primary;
        const keyTgt = this.channelToMorphKey[rule.target] || rule.target;
        if (weights[keyPrim] > 0 && weights[keyTgt] > 0) {
          weights[keyTgt] = Math.max(0.0, weights[keyTgt] - weights[keyPrim]);
        }
      }
    }
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;

    if (this.mixer) {
      this.mixer.stopAllAction();
      if (this.currentMotionFinishedHandler) {
        this.mixer.removeEventListener('finished', this.currentMotionFinishedHandler);
        this.currentMotionFinishedHandler = null;
      }
      if (this.mesh) {
        try {
          this.mixer.uncacheRoot(this.mesh);
        } catch (e) {
          console.warn('[BasePmxMotion] uncacheRoot failed:', e);
        }
      }
      if (this.activeMotionClips) {
        for (const clip of Object.values(this.activeMotionClips)) {
          if (clip) {
            try {
              this.mixer.uncacheClip(clip);
            } catch (e) {}
          }
        }
      }
      this.mixer = null;
    }
    const influences = this.mesh?.morphTargetInfluences;
    if (influences && typeof influences.fill === 'function') {
      influences.fill(0.0);
    }
    this.activeMotionClips = {};
    this.currentIdleAction = null;
    this.currentMotionAction = null;
    this.currentMotionName = null;
    this.activeActionExpression = null;
    this.mesh = null;
    this.adapter = null;
  }
}
