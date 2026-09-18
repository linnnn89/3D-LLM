import { a as MMDMaterialEvaluatedState, f as MMDTextureAlphaMode, i as MMDMaterialDescriptor, n as MMDMaterialCapabilities, s as MMDSphereBlendMode } from "../types-D5v-DvIz.js";
import { Color, MeshPhongMaterial, Texture, Vector4 } from "three";
//#region src/materials/toon/mmd-toon-material.d.ts
/**
 * Three's native Phong material with MMD toon/sphere semantics layered through
 * guarded WebGL shader seams. It intentionally has no ShaderMaterial aliases
 * such as `gradientMap` and `matcap`.
 */
declare class MMDToonMaterial extends MeshPhongMaterial {
  static readonly isMMDMaterial: true;
  static readonly mmdCapabilities: MMDMaterialCapabilities;
  ambient: Color;
  descriptor: MMDMaterialDescriptor;
  readonly isMMDMaterial: true;
  readonly isMMDToonMaterial = true;
  readonly mmdCapabilities: MMDMaterialCapabilities;
  sphereBlendMode?: MMDSphereBlendMode;
  sphereMap?: Texture;
  readonly sphereTextureAdditiveColor: Vector4;
  readonly sphereTextureMultiplicativeColor: Vector4;
  readonly textureAdditiveColor: Vector4;
  readonly textureMultiplicativeColor: Vector4;
  toonMap: Texture;
  readonly toonTextureAdditiveColor: Vector4;
  readonly toonTextureMultiplicativeColor: Vector4;
  private alphaMorphEnabled;
  private readonly mmdUniforms;
  private textureAlphaMode?;
  constructor(descriptor: MMDMaterialDescriptor);
  applyMMDMaterialState(state: MMDMaterialEvaluatedState): void;
  clone(): this;
  copy(source: this): this;
  customProgramCacheKey(): string;
  setMMDAlphaMorphEnabled(enabled: boolean): void;
  setMMDTextureAlphaMode(mode: MMDTextureAlphaMode | undefined): void;
  setSdefEnabled(enabled: boolean): void;
  private getSphereBlendModeValue;
  private updateAlphaPolicy;
}
//#endregion
export { MMDToonMaterial };