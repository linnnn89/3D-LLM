import * as THREE from 'three';

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
    this.mesh = adapter.getRootNode() || adapter.mesh;
    this.mixer = null;
    this.activeMotionClips = {};
    this.currentIdleAction = null;
    this.currentMotionAction = null;
    this.currentMotionName = null;
    this.currentMotionTime = 0.0;
    this.currentMotionFinishedHandler = null;

    // 表情与形态键管理核心状态
    this.profile = options.profile || { emotions: {}, actionExpressions: {} };
    this.currentBaseEmotion = 'neutral';
    this.baseEmotionWeight = 1.0;
    this.activeActionExpression = null;
    this.currentMorphWeights = {};

    // 独立眨眼与口型驱动权重
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

  init() {
    const hips = typeof this.adapter?.resolveBone === 'function' ? this.adapter.resolveBone('hips') : null;
    if (hips) {
      this.initialHipsPosition = hips.position.clone();
      this.adapter._initialHipsPosition = this.initialHipsPosition;
    }
    this.applyNaturalPose();
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
    this.currentBaseEmotion = 'neutral';
    this.baseEmotionWeight = 1.0;
    this.blinkWeight = 0.0;
    this.lipSyncAa = 0.0;
    this.lipSyncOh = 0.0;

    const dict = this.mesh?.morphTargetDictionary || {};
    const influences = this.mesh?.morphTargetInfluences;

    // 1. 若为立即模式（动作打断切换），强制将底层网格的所有形态键全部彻底归零 (0.0)
    if (immediate && influences) {
      if (typeof influences.fill === 'function') {
        influences.fill(0.0);
      } else {
        for (let i = 0; i < influences.length; i++) influences[i] = 0.0;
      }
    }

    // 2. 清空内部形态键权重缓存
    this.currentMorphWeights = {};

    // 3. 将所有受控形态键权重直接置为 0.0
    const allMorphs = new Set([...Object.keys(dict), ...this.controlledMorphNames]);
    for (const mName of allMorphs) {
      const idx = dict[mName];
      this.currentMorphWeights[mName] = 0.0;
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

    // 2. ★ 立刻归零：立刻将表情形态键清零、骨骼姿态与 hips 位移复位回基准 Natural Pose
    this.resetExpressions(true);
    this.resetPose();

    // 3. 然后再开始第二个动作
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

    // 4. 动画轨道初始化与启动
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

    // 5. ★ 动作播放完毕自动退场守卫：淡出并恢复原点与待机
    const onFinished = (e) => {
      if (e.action !== action) return;
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

  updateFacialExpressions(delta) {
    if (!this.mesh || !this.mesh.morphTargetDictionary || !this.mesh.morphTargetInfluences) return;
    const dict = this.mesh.morphTargetDictionary;
    const influences = this.mesh.morphTargetInfluences;

    const targetWeights = {};

    // ★ 关键防护：动作专属表情与基准情绪绝对互斥！
    // 当动作专属表情激活时，动作表情拥有 100% 独占权，严禁基础情绪 (happy/sad/angry等) 的形态键混入叠加产生畸变！
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

    // 2. 形态键互斥裁决与防撕裂约束
    this.resolveMorphConflicts(targetWeights);

    // 3. 眨眼叠加 (まばたき 或 Eye_close)
    if (this.blinkWeight > 0.001) {
      const blinkKey = dict['まばたき'] !== undefined ? 'まばたき' : (dict['Eye_close'] !== undefined ? 'Eye_close' : null);
      if (blinkKey) {
        targetWeights[blinkKey] = Math.max(targetWeights[blinkKey] || 0.0, this.blinkWeight);
      }
    }

    // 4. 语音嘴型驱动 (あ / Mouth_ah)
    if (typeof window !== 'undefined' && window.isPlayingAudio) {
      const mouthKey = dict['あ'] !== undefined ? 'あ' : (dict['口_あ'] !== undefined ? '口_あ' : (dict['Mouth_ah'] !== undefined ? 'Mouth_ah' : null));
      if (mouthKey && this.lipSyncAa > 0.01) {
        targetWeights[mouthKey] = this.lipSyncAa;
      }
    }

    // 5. 毫秒级阻尼插值更新形态键
    const speed = 12.0;
    const isPlaying = typeof window !== 'undefined' && !!window.isPlayingAudio;

    for (const mName of this.controlledMorphNames) {
      const idx = dict[mName];
      if (idx === undefined) continue;

      if (isPlaying && (mName === 'あ' || mName === '口_あ' || mName === 'Mouth_ah')) {
        influences[idx] = targetWeights[mName] || 0.0;
        continue;
      }

      const target = targetWeights[mName] || 0.0;
      const current = this.currentMorphWeights[mName] || 0.0;
      const next = THREE.MathUtils.damp(current, target, speed, delta);
      this.currentMorphWeights[mName] = next;
      influences[idx] = next;
    }
  }

  /**
   * ★ 形态键互斥裁决器：消除相对立拉伸的形态键同时为正值，杜绝面部多边形反向撕裂畸变
   */
  resolveMorphConflicts(weights) {
    if (!weights) return;
    // 1. 嘴角反向互斥 (口角上げ vs 口角下げ)
    if (weights['口角上げ'] > 0 && weights['口角下げ'] > 0) {
      if (weights['口角上げ'] >= weights['口角下げ']) {
        weights['口角下げ'] = 0.0;
      } else {
        weights['口角上げ'] = 0.0;
      }
    }
    // 2. 眉毛情绪互斥 (怒り vs 困る)
    if (weights['怒り'] > 0 && weights['困る'] > 0) {
      if (weights['怒り'] >= weights['困る']) {
        weights['困る'] = 0.0;
      } else {
        weights['怒り'] = 0.0;
      }
    }
    // 3. 狂三眼部互斥 (Eye_angry vs Eye_sorrow)
    if (weights['Eye_angry'] > 0 && weights['Eye_sorrow'] > 0) {
      if (weights['Eye_angry'] >= weights['Eye_sorrow']) {
        weights['Eye_sorrow'] = 0.0;
      } else {
        weights['Eye_angry'] = 0.0;
      }
    }
    // 4. 狂三嘴角互斥 (Mouth_smile vs Mouth_angry)
    if (weights['Mouth_smile'] > 0 && weights['Mouth_angry'] > 0) {
      if (weights['Mouth_smile'] >= weights['Mouth_angry']) {
        weights['Mouth_angry'] = 0.0;
      } else {
        weights['Mouth_smile'] = 0.0;
      }
    }
    // 5. 闭眼与眨眼防过度拉伸 (笑い + まばたき)
    if (weights['笑い'] > 0 && weights['まばたき'] > 0) {
      weights['まばたき'] = Math.max(0.0, weights['まばたき'] - weights['笑い']);
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
    this.currentMotionName = null;
    this.activeActionExpression = null;
  }
}
