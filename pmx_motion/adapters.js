/**
 * =========================================================================
 * Open-LLM-VTuber: Character Adapters (双格式角色适配器层)
 * 路径: pmx_motion/adapters.js
 * 
 * 核心设计原则：
 * 1. 纯逻辑无 DOM：严禁 import @pixiv/three-vrm，环境依赖 (scene, camera, vrmUtils) 全部通过 DI 注入。
 * 2. 构造与挂载分离：构造函数只存引用与元数据；mount() 执行场景挂载。Node 测试中可安全实例化并测试真实生命周期。
 * 3. 规范化生命周期：destroy() 全面收束 Mixer 解绑、缓存清除、几何体/材质释放与 Router 销毁。
 * =========================================================================
 */

import * as THREE from 'three';
import { PMX_BONE_MAPPING, PMX_MORPH_CANDIDATES, findCharacterDescriptor } from './registry.js';
import { PMX_CHARACTER_IMPLS } from './impl.js';

/**
 * 角色适配器抽象基类 (CharacterAdapter)
 */
export class CharacterAdapter {
  constructor(url, characterName = '', options = {}) {
    this.url = url;
    this.characterName = characterName;
    this.type = 'base';
    this.restPoseType = 'tpose'; // 'tpose' (VRM) | 'astance' (PMX)
    this.model = null;
    this.mixer = options.mixer || null;
    this.activeMotionClips = options.activeMotionClips ? Object.assign({}, options.activeMotionClips) : {};
    this.currentIdleAction = null;
    this.currentMotionAction = null;
    this.currentMotionFinishedHandler = null;
    this.scaleFactor = 1.0;
    this.scene = options.scene || null;
    this.router = options.router || null;
  }

  getRootNode() { return null; }
  getHitMesh() { return this.getRootNode(); }
  resolveBone(semanticName) { return null; }
  setLipSync(vaa, voh) {}
  setBlink(weight) {}
  setEmotion(preset, weight) {}
  setHeadPitch(rad) {}
  update(delta, elapsedTime) {}

  /**
   * 挂载动画混合器与动作剪辑字典 (契约要求：同时写入 activeMotionClips)
   */
  attachMixer(mixer, clips = {}) {
    this.mixer = mixer;
    this.activeMotionClips = Object.assign({}, clips);
  }

  destroy() {
    if (this.mixer) {
      if (typeof this.mixer.stopAllAction === 'function') {
        this.mixer.stopAllAction();
      }
      if (this.currentMotionFinishedHandler && typeof this.mixer.removeEventListener === 'function') {
        this.mixer.removeEventListener('finished', this.currentMotionFinishedHandler);
        this.currentMotionFinishedHandler = null;
      }
      this.mixer = null;
    }
    const root = this.getRootNode();
    if (root && this.scene && typeof this.scene.remove === 'function') {
      this.scene.remove(root);
    }
    this.activeMotionClips = {};
    this.currentIdleAction = null;
    this.currentMotionAction = null;
  }
}

/**
 * VRM 角色适配器 (VrmCharacterAdapter)
 */
export class VrmCharacterAdapter extends CharacterAdapter {
  constructor(vrm, url, characterName = '', characterId = '', options = {}) {
    super(url, characterName, options);
    this.characterId = characterId;
    this.type = 'vrm';
    this.restPoseType = 'tpose';
    this.vrm = vrm;
    this.model = vrm;
    this.vrmUtils = options.vrmUtils || null;
  }

  getRootNode() {
    return this.vrm ? this.vrm.scene : null;
  }

  getHitMesh() {
    return this.vrm ? this.vrm.scene : null;
  }

  resolveBone(semanticName) {
    if (!this.vrm || !this.vrm.humanoid) return null;
    return (typeof this.vrm.humanoid.getNormalizedBoneNode === 'function' ? this.vrm.humanoid.getNormalizedBoneNode(semanticName) : null) ||
           (typeof this.vrm.humanoid.getRawBoneNode === 'function' ? this.vrm.humanoid.getRawBoneNode(semanticName) : null);
  }

  mount({ scene, camera, referenceHeadHeight = 1.40, vrmUtils, applyPoseFn } = {}) {
    if (scene) this.scene = scene;
    if (vrmUtils) this.vrmUtils = vrmUtils;

    if (this.vrm && this.vrm.scene && this.scene && typeof this.scene.add === 'function') {
      this.scene.add(this.vrm.scene);
    }

    if (this.vrmUtils && typeof this.vrmUtils.rotateVRM0 === 'function') {
      this.vrmUtils.rotateVRM0(this.vrm);
    }

    if (camera && this.vrm && this.vrm.lookAt) {
      this.vrm.lookAt.target = camera;
    }

    this.normalizeScale(referenceHeadHeight);

    if (typeof applyPoseFn === 'function') {
      applyPoseFn(this.vrm);
    }
  }

  normalizeScale(referenceHeadHeight = 1.40) {
    const headNode = this.vrm?.humanoid?.getRawBoneNode?.('head');
    if (!headNode) return;
    const head = headNode;

    if (this.vrm && this.vrm.scene) {
      this.vrm.scene.updateMatrixWorld(true);
    }

    if (typeof head.getWorldPosition !== 'function') return;

    const headY = head.getWorldPosition(new THREE.Vector3()).y;
    if (!Number.isFinite(headY) || headY <= 0.01) return;

    const scale = referenceHeadHeight / headY;
    this.scaleFactor = scale;
    this.vrm.scene.scale.set(scale, scale, scale);
    this.vrm.scene.updateMatrixWorld(true);
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
    if (head) head.rotation.x = rad;
  }

  update(delta, elapsedTime) {
    if (this.vrm && typeof this.vrm.update === 'function') {
      this.vrm.update(delta);
    }
  }

  destroy() {
    if (this.mixer) {
      if (typeof this.mixer.stopAllAction === 'function') {
        this.mixer.stopAllAction();
      }
      if (this.vrm && this.vrm.scene && typeof this.mixer.uncacheRoot === 'function') {
        try {
          this.mixer.uncacheRoot(this.vrm.scene);
        } catch (e) {}
      }
      if (this.activeMotionClips && typeof this.mixer.uncacheClip === 'function') {
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
    this.activeMotionClips = {};

    super.destroy();

    if (this.vrm) {
      if (this.vrmUtils && typeof this.vrmUtils.deepDispose === 'function') {
        try {
          this.vrmUtils.deepDispose(this.vrm.scene);
        } catch (e) {}
      }
      this.vrm = null;
    }
  }
}

/**
 * PMX 角色适配器 (PmxCharacterAdapter)
 */
export class PmxCharacterAdapter extends CharacterAdapter {
  constructor(mmd, url, characterName = '', characterId = '', options = {}) {
    super(url, characterName, options);
    this.characterId = characterId;
    this.type = 'pmx';
    this.restPoseType = 'astance';
    this.mmd = mmd;
    this.mesh = mmd ? mmd.mesh : null;
    this.model = mmd;
    this.morphIndices = {};
    this.boneCache = {};
  }

  getRootNode() {
    return this.mesh;
  }

  getHitMesh() {
    return this.mesh;
  }

  getDescriptor() {
    return this.descriptor || findCharacterDescriptor(this);
  }

  isCantarella() {
    return this.getDescriptor()?.motionGroup === 'cantarella';
  }

  isKurumi() {
    return this.getDescriptor()?.motionGroup === 'kurumi';
  }

  isTohru() {
    return this.getDescriptor()?.motionGroup === 'tohru';
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

  buildMorphCache() {
    this.morphIndices = {};
    if (!this.mesh || !this.mesh.morphTargetDictionary) return;
    const dict = this.mesh.morphTargetDictionary;
    for (const [key, candidates] of Object.entries(PMX_MORPH_CANDIDATES)) {
      this.morphIndices[key] = [];
      for (const name of candidates) {
        if (dict[name] !== undefined) {
          this.morphIndices[key].push(dict[name]);
        }
      }
    }
  }

  mount({ scene, referenceHeadHeight = 1.40 } = {}) {
    if (scene) this.scene = scene;
    if (this.mesh && this.scene && typeof this.scene.add === 'function') {
      this.scene.add(this.mesh);
    }
    this.buildMorphCache();

    // 材质去油去反光
    if (this.mesh && typeof this.mesh.traverse === 'function') {
      this.mesh.traverse((obj) => {
        if (!obj.isMesh || !obj.material) return;
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of materials) {
          if (mat.specular && typeof mat.specular.setRGB === 'function') {
            mat.specular.setRGB(0, 0, 0);
          }
        }
      });
    }

    this.normalizeScale(referenceHeadHeight);
    this.applyNaturalPose();
  }

  normalizeScale(referenceHeadHeight = 1.40) {
    const head = this.resolveBone('head');
    if (!head) return;

    if (this.mesh) {
      this.mesh.updateMatrixWorld(true);
    }

    if (typeof head.getWorldPosition !== 'function') return;

    const headY = head.getWorldPosition(new THREE.Vector3()).y;
    if (!Number.isFinite(headY) || headY <= 0.01) return;

    const scale = referenceHeadHeight / headY;
    this.scaleFactor = scale;

    if (this.mmd && typeof this.mmd.setScalar === 'function') {
      this.mmd.setScalar(scale);
    } else if (this.mesh && this.mesh.scale && typeof this.mesh.scale.multiplyScalar === 'function') {
      this.mesh.scale.multiplyScalar(scale);
    }

    if (this.mesh) {
      this.mesh.updateMatrixWorld(true);
    }
  }

  applyNaturalPose() {
    const desc = this.getDescriptor();
    const impl = desc ? PMX_CHARACTER_IMPLS[desc.motionGroup] : PMX_CHARACTER_IMPLS.generic;
    if (impl && typeof impl.applyPoseFn === 'function') {
      impl.applyPoseFn(this);
    }
  }

  setLipSync(vaa, voh) {
    const system = this.motionSystem || this.blendMotionSystem || this.kurumiMotionSystem || this.cantarellaMotionSystem || this.tohruMotionSystem;
    if (system && typeof system.setLipSync === 'function') {
      system.setLipSync(vaa, voh);
      return;
    }
    if (!this.mesh || !this.mesh.morphTargetInfluences) return;
    const aaIndices = this.morphIndices['aa'] || [];
    const ohIndices = this.morphIndices['oh'] || [];
    for (const idx of aaIndices) this.mesh.morphTargetInfluences[idx] = vaa;
    for (const idx of ohIndices) this.mesh.morphTargetInfluences[idx] = voh;
  }

  setBlink(weight) {
    const system = this.motionSystem || this.blendMotionSystem || this.kurumiMotionSystem || this.cantarellaMotionSystem || this.tohruMotionSystem;
    if (system && typeof system.setBlink === 'function') {
      system.setBlink(weight);
      return;
    }
    if (!this.mesh || !this.mesh.morphTargetInfluences) return;
    const blinkIndices = this.morphIndices['blink'] || [];
    for (const idx of blinkIndices) {
      this.mesh.morphTargetInfluences[idx] = weight;
    }
  }

  setEmotion(preset, weight = 0.85) {
    const system = this.motionSystem || this.blendMotionSystem || this.kurumiMotionSystem || this.cantarellaMotionSystem || this.tohruMotionSystem;
    if (system && typeof system.setEmotion === 'function') {
      system.setEmotion(preset, weight);
      return;
    }
    if (!this.mesh || !this.mesh.morphTargetInfluences) return;
    for (const key of ['happy', 'sad', 'angry', 'surprised', 'relaxed']) {
      const list = this.morphIndices[key] || [];
      for (const idx of list) this.mesh.morphTargetInfluences[idx] = 0;
    }
    if (preset && preset !== 'neutral') {
      const list = this.morphIndices[preset] || [];
      for (const idx of list) this.mesh.morphTargetInfluences[idx] = weight;
    }
  }

  setHeadPitch(rad) {
    const head = this.resolveBone('head');
    if (head) head.rotation.x = rad;
  }

  update(delta, elapsedTime) {
    if (this.router && this.router.activeSystem && this.router.activeSystem.adapter === this) {
      this.router.update(delta, elapsedTime);
      return;
    }
    if (this.motionSystem && typeof this.motionSystem.update === 'function') {
      this.motionSystem.update(delta, elapsedTime);
      return;
    }
    if (this.mmd) {
      if (this.mixer && typeof this.mmd.updateWithMixer === 'function') {
        this.mmd.updateWithMixer(delta, this.mixer);
      } else if (typeof this.mmd.update === 'function') {
        this.mmd.update(delta);
      }
    }
  }

  destroy() {
    super.destroy();

    if (this.router && this.router.activeSystem && this.router.activeSystem.adapter === this) {
      this.router.destroy();
    }
    if (this.motionSystem && this.motionSystem !== this.router?.activeSystem) {
      try {
        this.motionSystem.destroy();
      } catch (e) {
        console.warn('[PmxCharacterAdapter] 销毁 motionSystem 异常:', e);
      }
    }
    this.motionSystem = null;
    this.blendMotionSystem = null;
    this.cantarellaMotionSystem = null;
    this.kurumiMotionSystem = null;
    this.tohruMotionSystem = null;

    if (this.mesh) {
      if (this.scene && typeof this.scene.remove === 'function') {
        this.scene.remove(this.mesh);
      }
      if (this.mesh.geometry && typeof this.mesh.geometry.dispose === 'function') {
        this.mesh.geometry.dispose();
      }
      const materials = Array.isArray(this.mesh.material) ? this.mesh.material : [this.mesh.material];
      for (const mat of materials) {
        if (mat) {
          if (mat.map && typeof mat.map.dispose === 'function') mat.map.dispose();
          if (mat.matcap && typeof mat.matcap.dispose === 'function') mat.matcap.dispose();
          if (mat.gradientMap && typeof mat.gradientMap.dispose === 'function') mat.gradientMap.dispose();
          if (typeof mat.dispose === 'function') mat.dispose();
        }
      }
      this.mesh = null;
    }
  }
}
