/**
 * =========================================================================
 * Open-LLM-VTuber: MotionRouter (纯净查表两级动作路由器)
 * 路径: pmx_motion/router.js
 * 
 * 核心设计：
 * 1. 第一级格式分流：VRM 原生动作系统 vs PMX 独立动作系统
 * 2. 第二级角色查表：查 registry.js 元数据，取 impl.js 实现类实例化
 * 3. 契约自注入：route(adapter) 自动赋值 adapter.router = this
 * 4. 安全兜底：descriptor 存在但 impl 缺失时安全回退至通用 BlendMotionSystem
 * =========================================================================
 */

import { findCharacterDescriptor, PMX_CHARACTER_REGISTRY } from './registry.js';
import { PMX_CHARACTER_IMPLS, BlendMotionSystem } from './impl.js';

export class MotionRouter {
  constructor() {
    this.activeSystem = null;
    this.currentModelType = null;
    this.currentDescriptor = null;
  }

  route(adapter) {
    if (!adapter) return;

    // 契约：自注入 router 引用，供适配器内部解耦调用
    adapter.router = this;

    // 第一级：格式分流 (VRM 模型由 VRM 原生动作系统管理)
    if (adapter.type === 'vrm') {
      this.currentModelType = 'vrm';
      this.currentDescriptor = null;
      adapter.descriptor = null;
      console.log(`[MotionRouter] 🔄 路由 -> VRM 原生动作系统 (角色: ${adapter.characterName || 'Unknown'})`);
      this.activeSystem = null;
      adapter.motionSystem = null;
      return;
    }

    // 第二级：PMX 角色注册表查表分流 (Descriptor-based Routing)
    const descriptor = findCharacterDescriptor(adapter);
    if (descriptor) {
      this.currentModelType = descriptor.motionGroup;
      this.currentDescriptor = descriptor;
      adapter.descriptor = descriptor;

      const impl = PMX_CHARACTER_IMPLS[descriptor.motionGroup];
      if (impl && typeof impl.systemClass === 'function') {
        console.log(`[MotionRouter] 🎯 查表路由 -> ${descriptor.name}专属 PMX 动作系统 (${impl.systemClass.name})`);
        this.activeSystem = new impl.systemClass(adapter);
      } else {
        console.warn(`[MotionRouter] ⚠️ 未找到角色实现绑定 (${descriptor.motionGroup})，安全回退到 BlendMotionSystem`);
        this.activeSystem = new BlendMotionSystem(adapter);
      }

      adapter.motionSystem = this.activeSystem;
      // 向后兼容历史专用挂载字段
      adapter[`${descriptor.motionGroup}MotionSystem`] = this.activeSystem;
      adapter.blendMotionSystem = this.activeSystem;
      this.activeSystem.init();
      return;
    }

    // 通用 PMX 回退分流
    this.currentModelType = 'blend';
    this.currentDescriptor = null;
    adapter.descriptor = null;
    console.log(`[MotionRouter] 🔄 路由 -> 通用 PMX 独立动作系统 (角色: ${adapter.characterName || 'Unknown'})`);
    this.activeSystem = new BlendMotionSystem(adapter);
    adapter.motionSystem = this.activeSystem;
    adapter.blendMotionSystem = this.activeSystem;
    this.activeSystem.init();
  }

  playMotion(name) {
    if (this.activeSystem && typeof this.activeSystem.playMotion === 'function') {
      return this.activeSystem.playMotion(name);
    }
    // VRM 回退至全局原有 playMotion
    if (typeof window !== 'undefined' && typeof window.playMotion === 'function') {
      window.playMotion(name);
      return true;
    }
    return false;
  }

  playIdleMotion() {
    if (this.activeSystem && typeof this.activeSystem.playIdleMotion === 'function') {
      return this.activeSystem.playIdleMotion();
    }
    return false;
  }

  setEmotion(preset, weight) {
    if (this.activeSystem && typeof this.activeSystem.setEmotion === 'function') {
      this.activeSystem.setEmotion(preset, weight);
      return true;
    }
    return false;
  }

  setLipSync(vaa, voh) {
    if (this.activeSystem && typeof this.activeSystem.setLipSync === 'function') {
      this.activeSystem.setLipSync(vaa, voh);
      return true;
    }
    return false;
  }

  setBlink(weight) {
    if (this.activeSystem && typeof this.activeSystem.setBlink === 'function') {
      this.activeSystem.setBlink(weight);
      return true;
    }
    return false;
  }

  update(delta, elapsedTime) {
    if (this.activeSystem && typeof this.activeSystem.update === 'function') {
      this.activeSystem.update(delta, elapsedTime);
    }
  }

  destroy(adapter = null) {
    const targetAdapter = adapter || this.activeSystem?.adapter;
    if (this.activeSystem) {
      try {
        this.activeSystem.destroy();
      } catch (e) {
        console.warn('[MotionRouter] 销毁 activeSystem 异常:', e);
      }
      this.activeSystem = null;
    }
    this.currentModelType = null;
    this.currentDescriptor = null;
    if (targetAdapter) {
      targetAdapter.descriptor = null;
      targetAdapter.motionSystem = null;
    }
  }
}

export function clampFrameDelta(rawDelta, maxDelta = 0.1) {
  if (!Number.isFinite(rawDelta) || rawDelta < 0) return 0.016;
  return Math.min(rawDelta, maxDelta);
}

export const motionRouter = new MotionRouter();
