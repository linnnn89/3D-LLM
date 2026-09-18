import { a as MMDMaterialEvaluatedState, f as MMDTextureAlphaMode, i as MMDMaterialDescriptor, l as MMDAlphaMode, n as MMDMaterialCapabilities } from "../types-D5v-DvIz.js";
import { Color, MeshPhysicalMaterial } from "three";
//#region src/materials/physical/mapping.d.ts
/** Precision boundary of the WebGL Physical baseline. */
declare const MMD_PHYSICAL_MATERIAL_MAPPING: {
  readonly ambient: "unsupported";
  readonly diffuse: "exact";
  readonly diffuseTexture: "exact";
  readonly doubleSided: "exact";
  readonly metalness: "unsupported";
  readonly opacity: "approximate";
  readonly outline: "unsupported";
  readonly shininess: "approximate";
  readonly specular: "approximate";
  readonly sphereTexture: "unsupported";
  readonly textureMorphColor: "unsupported";
  readonly toonTexture: "unsupported";
};
type MMDPhysicalSpecularMode = 'ignore' | 'physical-color';
/** Maps PMX specular into the optional Physical non-metal F0 approximation. */
declare const resolveMMDPhysicalSpecularColor: (specular: Color, mode: MMDPhysicalSpecularMode) => Color | undefined;
/**
 * Engineering approximation from a Blinn-Phong exponent to Three's GGX
 * roughness input. This is intentionally replaceable rather than a PMX rule.
 */
declare const mmdShininessToRoughness: (shininess: number) => number;
type MMDShininessToRoughness = (shininess: number) => number;
declare const resolveMMDPhysicalRoughness: (shininess: number, mapping?: MMDShininessToRoughness) => number;
//#endregion
//#region src/materials/physical/mmd-physical-material.d.ts
interface MMDPhysicalMaterialOptions {
  alphaMode?: MMDAlphaMode;
  shininessToRoughness?: MMDShininessToRoughness;
  specularMode?: MMDPhysicalSpecularMode;
}
/**
 * @experimental
 * Opt-in physically based MMD material backend for WebGLRenderer.
 */
declare class MMDPhysicalMaterial extends MeshPhysicalMaterial {
  static readonly isMMDMaterial: true;
  static readonly mmdCapabilities: MMDMaterialCapabilities;
  alphaMode: MMDAlphaMode;
  descriptor: MMDMaterialDescriptor;
  readonly isMMDMaterial: true;
  readonly mmdCapabilities: MMDMaterialCapabilities;
  shininessToRoughness: MMDShininessToRoughness;
  specularMode: MMDPhysicalSpecularMode;
  private alphaMorphEnabled;
  private textureAlphaMode?;
  constructor(descriptor: MMDMaterialDescriptor, options?: MMDPhysicalMaterialOptions);
  applyMMDMaterialState(state: MMDMaterialEvaluatedState): void;
  clone(): this;
  copy(source: this): this;
  customProgramCacheKey(): string;
  setMMDAlphaMorphEnabled(enabled: boolean): void;
  setMMDTextureAlphaMode(mode: MMDTextureAlphaMode | undefined): void;
  setSdefEnabled(enabled: boolean): void;
  private updateAlphaPolicy;
}
//#endregion
export { MMDPhysicalMaterial, type MMDPhysicalMaterialOptions, type MMDPhysicalSpecularMode, type MMDShininessToRoughness, MMD_PHYSICAL_MATERIAL_MAPPING, mmdShininessToRoughness, resolveMMDPhysicalRoughness, resolveMMDPhysicalSpecularColor };