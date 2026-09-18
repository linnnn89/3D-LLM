import { Color, Material, Texture, Vector4 } from "three";
//#region src/materials/core/alpha-policy.d.ts
type MMDAlphaMode = 'blend' | 'cutout' | 'evaluate' | 'mmd-depth-blend';
interface MMDAlphaPolicyInput {
  alphaTest?: number;
  mode: MMDAlphaMode;
  opacity: number;
  textureAlphaMode?: MMDTextureAlphaMode;
  textureHasTransparency: boolean;
}
type MMDResolvedAlphaMode = 'opaque' | Exclude<MMDAlphaMode, 'evaluate'>;
type MMDTextureAlphaMode = 'blend' | 'cutout';
/** Resolves renderer-neutral MMD alpha intent into one concrete render mode. */
declare const resolveMMDAlphaPolicy: (input: MMDAlphaPolicyInput) => MMDResolvedAlphaMode;
/**
 * Classifies sampled texture alpha using Babylon-MMD's alpha evaluation rule.
 * The input values use the usual texture-alpha range (0 = transparent,
 * 255 = opaque); Babylon's checker evaluates the inverted value in its pass.
 */
declare const resolveMMDTextureAlphaMode: (alphaValues: readonly number[], alphaThreshold?: number, alphaBlendThreshold?: number) => MMDTextureAlphaMode | undefined;
/** Applies one resolved policy to Three's alpha/depth material controls. */
declare const applyMMDAlphaPolicy: (material: Material, mode: MMDResolvedAlphaMode, alphaTest?: number) => void;
//#endregion
//#region src/materials/types.d.ts
interface MMDMaterial extends Material {
  applyMMDMaterialState: (state: MMDMaterialEvaluatedState) => void;
  readonly descriptor: MMDMaterialDescriptor;
  readonly isMMDMaterial: true;
  readonly mmdCapabilities: MMDMaterialCapabilities;
  setMMDAlphaMorphEnabled: (enabled: boolean) => void;
  setMMDTextureAlphaMode: (mode: MMDTextureAlphaMode | undefined) => void;
  setSdefEnabled: (enabled: boolean) => void;
}
declare const isMMDMaterial: (material: Material) => material is MMDMaterial;
interface MMDMaterialCapabilities {
  readonly alpha: readonly MMDResolvedAlphaMode[];
  readonly materialMorph: 'binding';
  readonly outline: boolean;
  readonly renderer: readonly ('webgl-renderer')[];
  readonly sdef: 'full';
  readonly sphereTexture: readonly MMDSphereBlendMode[];
  readonly toon: boolean;
}
interface MMDMaterialConstructor {
  readonly isMMDMaterial: true;
  /** Optional constructor-level capabilities used before an instance exists. */
  readonly mmdCapabilities?: MMDMaterialCapabilities;
  new (descriptor: MMDMaterialDescriptor): MMDMaterial;
}
/**
 * Normalized PMX material data plus the textures resolved by the loader.
 *
 * This deliberately describes MMD semantics instead of renderer-specific
 * aliases such as `gradientMap` and `matcap`.
 */
interface MMDMaterialDescriptor {
  /** Optional PMX alpha-test override used by both renderer adapters. */
  alphaTest?: number;
  ambient: Color;
  diffuse: Color;
  /** PMX's raster-sidedness flag, kept independent from Three's Side value. */
  doubleSided: boolean;
  fog: boolean;
  isDefaultToonTexture: boolean;
  map?: Texture;
  mapFileName?: string;
  name: string;
  opacity: number;
  outline: MMDOutlineDescriptor;
  shininess: number;
  specular: Color;
  sphereBlendMode?: MMDSphereBlendMode;
  sphereMap?: Texture;
  sphereMapFileName?: string;
  textureAlphaMode?: MMDTextureAlphaMode;
  /** Resolved only when the selected material backend consumes toon shading. */
  toonMap?: Texture;
  toonMapFileName: string;
}
interface MMDMaterialEvaluatedState {
  ambient: Color;
  diffuse: Color;
  edgeAlpha: number;
  edgeColor: Color;
  edgeWidth: number;
  opacity: number;
  shininess: number;
  specular: Color;
  sphereTextureAdditiveColor: Vector4;
  sphereTextureMultiplicativeColor: Vector4;
  textureAdditiveColor: Vector4;
  textureMultiplicativeColor: Vector4;
  toonTextureAdditiveColor: Vector4;
  toonTextureMultiplicativeColor: Vector4;
}
interface MMDOutlineDescriptor {
  alpha: number;
  color: Color;
  visible: boolean;
  width: number;
}
/** PMX sphere modes implemented by the classic MMD material backend. */
type MMDSphereBlendMode = 'add' | 'multiply';
//#endregion
export { MMDMaterialEvaluatedState as a, isMMDMaterial as c, MMDResolvedAlphaMode as d, MMDTextureAlphaMode as f, resolveMMDTextureAlphaMode as h, MMDMaterialDescriptor as i, MMDAlphaMode as l, resolveMMDAlphaPolicy as m, MMDMaterialCapabilities as n, MMDOutlineDescriptor as o, applyMMDAlphaPolicy as p, MMDMaterialConstructor as r, MMDSphereBlendMode as s, MMDMaterial as t, MMDAlphaPolicyInput as u };