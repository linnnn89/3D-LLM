import { t as PmxObject } from "../pmxObject-CVRQYFiE.js";
import { a as MMDMaterialEvaluatedState, c as isMMDMaterial, d as MMDResolvedAlphaMode, f as MMDTextureAlphaMode, h as resolveMMDTextureAlphaMode, i as MMDMaterialDescriptor, l as MMDAlphaMode, m as resolveMMDAlphaPolicy, n as MMDMaterialCapabilities, o as MMDOutlineDescriptor, p as applyMMDAlphaPolicy, r as MMDMaterialConstructor, s as MMDSphereBlendMode, t as MMDMaterial, u as MMDAlphaPolicyInput } from "../types-D5v-DvIz.js";
//#region src/materials/morph.d.ts
declare const createMMDMaterialEvaluatedState: (descriptor: MMDMaterialDescriptor) => MMDMaterialEvaluatedState;
/** Applies one PMX material morph element to an evaluated, mutable state. */
declare const applyMMDMaterialMorph: (state: MMDMaterialEvaluatedState, element: PmxObject.Morph.MaterialMorph["elements"][number], weight: number) => void;
//#endregion
export { type MMDAlphaMode, type MMDAlphaPolicyInput, type MMDMaterial, type MMDMaterialCapabilities, type MMDMaterialConstructor, type MMDMaterialDescriptor, type MMDMaterialEvaluatedState, type MMDOutlineDescriptor, type MMDResolvedAlphaMode, type MMDSphereBlendMode, type MMDTextureAlphaMode, applyMMDAlphaPolicy, applyMMDMaterialMorph, createMMDMaterialEvaluatedState, isMMDMaterial, resolveMMDAlphaPolicy, resolveMMDTextureAlphaMode };