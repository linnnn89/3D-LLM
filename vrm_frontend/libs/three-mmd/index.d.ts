import { n as Vec3, r as Vec4, t as PmxObject } from "./pmxObject-CVRQYFiE.js";
import { r as MMDMaterialConstructor } from "./types-D5v-DvIz.js";
import { AnimationClip, AnimationMixer, Audio, Camera, LineBasicMaterial, Loader, LoadingManager, MeshBasicMaterial, Object3D, Quaternion, SkinnedMesh, SphereGeometry, Vector3 } from "three";
//#region src/physics/grant-solver.d.ts
/** @internal */
declare class GrantSolver {
  readonly mesh: SkinnedMesh;
  private readonly appendQuaternion;
  private readonly appliedPoses;
  private readonly entries;
  private readonly entriesByIndex;
  private readonly identityQuaternion;
  private readonly ikRotations;
  private readonly restPositions;
  private readonly skinMatrix;
  private readonly sourceRotation;
  private readonly worldPosition;
  private readonly worldQuaternion;
  private readonly worldScale;
  constructor(mesh: SkinnedMesh, pmx: PmxObject, ikRotations?: Quaternion[]);
  /** Restores unchanged output and captures the input for both physics stages. */
  beginFrame(): void;
  /** Records the final output after all bone transforms and physics have run. */
  endFrame(): void;
  /** Discards frame state when an explicit animation pose replaces the output. */
  reset(): void;
  /** Applies all append transforms once to the current animated/IK pose. */
  update(): this;
  /** Applies one append transform before the IK attached to that bone. */
  updateBone(boneIndex: number): void;
  private getSourcePosition;
  private getSourceRotation;
}
//#endregion
//#region src/physics/mmd-ik-helper.d.ts
/** Visualizes the target, effector, links, and chain of every PMX IK solver. */
declare class MMDIKHelper extends Object3D {
  readonly effectorSphereMaterial: MeshBasicMaterial;
  readonly lineMaterial: LineBasicMaterial;
  readonly linkSphereMaterial: MeshBasicMaterial;
  readonly root: SkinnedMesh;
  readonly sphereGeometry: SphereGeometry;
  readonly targetSphereMaterial: MeshBasicMaterial;
  private readonly bonePosition;
  private readonly matrixWorldInverse;
  private readonly visuals;
  constructor(mesh: SkinnedMesh, pmx: PmxObject, sphereSize?: number);
  /** Frees the GPU resources allocated by this helper. */
  dispose(): void;
  updateMatrixWorld(force?: boolean): void;
  private initialize;
  private setObjectPosition;
  private validateBoneIndex;
  private writeBonePosition;
}
//#endregion
//#region src/physics/mmd-ik-solver.d.ts
/** @internal */
declare class MMDIKSolver {
  readonly mesh: SkinnedMesh;
  private readonly appliedPoses;
  private readonly axis;
  private readonly chainIkVector;
  private readonly chainPosition;
  private readonly chainRotationAxis;
  private readonly chainTargetVector;
  private readonly entries;
  private readonly entriesByBoneIndex;
  private readonly ikPosition;
  private readonly ikRotations;
  private readonly inverseParentRotation;
  private readonly invertedLocalRotation;
  private readonly parentRotation;
  private readonly pmx;
  private readonly rotation;
  private readonly rotation2;
  private readonly rotationMatrix;
  private readonly targetPosition;
  private readonly xAxis;
  private readonly yAxis;
  private readonly zAxis;
  constructor(mesh: SkinnedMesh, pmx: PmxObject, ikRotations?: Quaternion[]);
  /** Restores unchanged output and captures chain input for both physics stages. */
  beginFrame(): void;
  /** Creates a helper that visualizes every PMX IK chain. */
  createHelper(sphereSize?: number): MMDIKHelper;
  /** Records the final output after all bone transforms and physics have run. */
  endFrame(): void;
  /** Returns whether the IK definition attached to a PMX bone is enabled. */
  isEnabled(ikBoneIndex: number): boolean;
  /** Discards frame state when an explicit animation pose replaces the output. */
  reset(): void;
  /** Enables or disables the IK definition attached to a PMX bone. */
  setEnabled(ikBoneIndex: number, enabled: boolean): this;
  /**
   * Solves every enabled PMX IK definition against the current bone pose.
   *
   * `delta` is reserved for parity with the model update lifecycle. The
   * current CCD calculation is frame-rate independent.
   *
   * @param delta Elapsed time in seconds.
   * @param physicsAffectsIK Whether PMX rigid-body-controlled chains may be skipped.
   */
  update(delta?: number, physicsAffectsIK?: boolean): this;
  /** Solves one definition within MMD's ordered pose evaluation. */
  updateBone(boneIndex: number, physicsAffectsIK?: boolean): void;
  private buildPhysicsBoneIndices;
  private getEntry;
  private limitAngle;
  private solve;
  private solveChain;
  private validateBoneIndex;
  private warnAboutUnexpectedTopology;
}
//#endregion
//#region src/utils/mmd.d.ts
interface MMDUpdateOptions {
  grant?: boolean;
  ik?: boolean;
  physics?: boolean;
}
/**
 * MMD model shell: holds parsed PMX, skinned mesh, IK/grants, and pluggable physics strategy.
 * Lifecycle methods update scale/physics, helpers expose collider/joint visualization when available.
 */
declare class MMD {
  grantSolver: GrantSolver;
  ikSolver: MMDIKSolver;
  mesh: SkinnedMesh;
  physics?: PhysicsService;
  pmx: PmxObject;
  scale: number;
  private readonly animationControlledIKBones;
  private animationPose?;
  private readonly boneOrder;
  private readonly currentAnimationIKStates;
  private readonly currentAnimationIKWeights;
  private readonly ikBoneIndicesByName;
  private ikRotations;
  private readonly normalizedIkBoneIndicesByName;
  constructor(pmx: PmxObject, mesh: SkinnedMesh);
  /** Evaluates post-physics bones after the physics service writes back its pose. */
  afterPhysics(options?: MMDUpdateOptions): void;
  /** Restores unchanged solver output, captures the input, and evaluates pre-physics bones. */
  beforePhysics(options?: MMDUpdateOptions): void;
  /**
   * Restores the skeletal pose sampled by the previous animation frame.
   *
   * Call this immediately before the animation mixer updates the mesh.
   */
  beforeUpdate(): void;
  dispose(): void;
  setPhysics(createPhysics: PhysicsFactory): void;
  setScalar(scale: number): void;
  /**
   * Applies MMD-specific pose processing after an animation mixer updates the mesh.
   *
   * The ordering is significant: the mixer pose is cached before IK and append
   * transforms mutate the bones, so the next frame can start from an unmodified
   * animation pose. Call beforeUpdate() before advancing an external mixer.
   */
  update(delta: number, options?: MMDUpdateOptions): void;
  updateAnimation(mixer?: AnimationMixer): void;
  updateWithMixer(delta: number, mixer: AnimationMixer, options?: MMDUpdateOptions): void;
  private updateBones;
}
//#endregion
//#region src/physics/physics-service.d.ts
type PhysicsFactory = (mmd: MMD) => PhysicsService;
interface PhysicsService {
  /** Whether this service drives PMX bones and activates physics-aware IK. */
  affectsIK?: boolean;
  createHelper: <T>() => T;
  dispose?: () => void;
  reset?: () => void;
  setGravity?: (gravity: Vector3) => void;
  setScalar?: (scale: number) => void;
  update: (delta: number) => void;
}
//#endregion
//#region src/loaders/loader-plugin.d.ts
interface MMDLoaderParser {
  readonly manager: LoadingManager;
  readonly resourcePath: string;
}
interface MMDLoaderPlugin {
  afterBuild?: (mmd: MMD) => Promise<void> | void;
  afterParse?: (pmx: PmxObject) => PmxObject | Promise<PmxObject | void> | void;
  materialType?: MMDMaterialConstructor;
  name: string;
}
type MMDLoaderPluginFactory = (parser: MMDLoaderParser) => MMDLoaderPlugin;
interface MMDMaterialPluginOptions {
  materialType: MMDMaterialConstructor;
}
/** Selects the first-party MMD material backend before mesh assembly begins. */
declare class MMDMaterialPlugin implements MMDLoaderPlugin {
  readonly materialType: MMDMaterialConstructor;
  readonly name = "MMDMaterialPlugin";
  constructor(_parser: MMDLoaderParser, options: MMDMaterialPluginOptions);
}
declare const createPhysicsPlugin: (name: string, createPhysics: PhysicsFactory) => MMDLoaderPluginFactory;
//#endregion
//#region src/loaders/mmd-loader.d.ts
declare class MMDLoader extends Loader<MMD> {
  private pluginCallbacks;
  constructor(manager?: LoadingManager);
  load(url: string, onLoad: (mesh: MMD) => void, onProgress?: (event: ProgressEvent) => void, onError?: (event: unknown) => void): void;
  loadAsync(url: string, onProgress?: (event: ProgressEvent) => void): Promise<MMD>;
  register(callback: MMDLoaderPluginFactory): this;
  unregister(callback: MMDLoaderPluginFactory): this;
  private assembleMMD;
}
//#endregion
//#region ../../node_modules/.pnpm/babylon-mmd@1.3.0_@babylonjs+core@9.18.0/node_modules/babylon-mmd/esm/Loader/Parser/ILogger.d.ts
interface ILogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}
//#endregion
//#region ../../node_modules/.pnpm/babylon-mmd@1.3.0_@babylonjs+core@9.18.0/node_modules/babylon-mmd/esm/Loader/Parser/endianness.d.ts
/**
 * Endianness utility class for serlization/deserialization
 */
declare class Endianness {
  /**
   * Whether the device is little endian
   */
  readonly isDeviceLittleEndian: boolean;
  constructor();
  private _getIsDeviceLittleEndian;
  /**
   * Changes the byte order of the array
   * @param array Array to swap
   */
  swap16Array(array: Int16Array | Uint16Array, offset?: number, length?: number): void;
  /**
   * Changes the byte order of the array
   * @param array Array to swap
   */
  swap32Array(array: Int32Array | Uint32Array | Float32Array, offset?: number, length?: number): void;
}
//#endregion
//#region ../../node_modules/.pnpm/babylon-mmd@1.3.0_@babylonjs+core@9.18.0/node_modules/babylon-mmd/esm/Loader/Parser/mmdDataDeserializer.d.ts
type TupleOf<T, N extends number, R extends unknown[]> = R["length"] extends N ? R : TupleOf<T, N, [T, ...R]>;
type Tuple<T, N extends number> = N extends N ? number extends N ? T[] : TupleOf<T, N, []> : never;
/**
 * DataView wrapper for deserializing MMD data
 */
declare class MmdDataDeserializer extends Endianness {
  private readonly _dataView;
  private _decoder;
  private _offset;
  /**
   * Creates MMD data deserializer
   * @param arrayBuffer ArrayBuffer to deserialize
   */
  constructor(arrayBuffer: ArrayBufferLike);
  /**
   * Current offset in the buffer
   */
  get offset(): number;
  set offset(value: number);
  /**
   * Read a uint8 value
   * @returns Uint8 value
   */
  getUint8(): number;
  /**
   * Read a int8 value
   * @returns Int8 value
   */
  getInt8(): number;
  /**
   * Read a uint16 value
   * @returns Uint16 value
   */
  getUint16(): number;
  /**
   * Read a uint16 array
   * @param dest Destination array
   */
  getUint16Array(dest: Uint16Array): void;
  /**
   * Read a int16 value
   * @returns Int16 value
   */
  getInt16(): number;
  /**
   * Read a uint32 value
   * @returns Uint32 value
   */
  getUint32(): number;
  /**
   * Read a int32 value
   * @returns Int32 value
   */
  getInt32(): number;
  /**
   * Read a float32 value
   * @returns Float32 value
   */
  getFloat32(): number;
  /**
   * Read a float32 tuple
   * @param length Tuple length
   * @returns Float32 tuple
   */
  getFloat32Tuple<N extends number>(length: N): Tuple<number, N>;
  /**
   * Initializes TextDecoder with the specified encoding
   * @param encoding Encoding
   */
  initializeTextDecoder(encoding: string): void;
  /**
   * Decode the string in the encoding determined by the initializeTextDecoder method
   * @param length Length of the string in bytes
   * @param trim Whether to trim the string, usally used in Shift-JIS encoding
   * @returns Decoded string
   */
  getDecoderString(length: number, trim: boolean): string;
  /**
   * Read a utf-8 string
   * @param length Length of the string in bytes
   * @returns Utf-8 string
   */
  getSignatureString(length: number): string;
  /**
   * The number of bytes available
   */
  get bytesAvailable(): number;
}
//#endregion
//#region ../../node_modules/.pnpm/babylon-mmd@1.3.0_@babylonjs+core@9.18.0/node_modules/babylon-mmd/esm/Loader/Parser/vmdObject.d.ts
/**
 * VMD data
 *
 * The creation of this object means that the validation and indexing of the Vmd data are finished
 *
 * Therefore, there is no parsing error when reading data from VmdData
 */
declare class VmdData {
  private static readonly _Signature;
  /**
   * Signature bytes
   *
   * The first 30 bytes of the VMD file must be "Vocaloid Motion Data 0002"
   * @internal
   */
  static readonly SignatureBytes = 30;
  /**
   * Model name bytes
   *
   * The next 20 bytes of the VMD file must be the model name
   *
   * MMD assuming that motion is usually valid for one model
   *
   * so when binding target model name is different from the model name in VMD file, MMD warns the user
   * @internal
   */
  static readonly ModelNameBytes = 20;
  /**
   * Bone key frame bytes
   * @internal
   */
  static readonly BoneKeyFrameBytes: number;
  /**
   * Morph key frame bytes
   * @internal
   */
  static readonly MorphKeyFrameBytes: number;
  /**
   * Camera key frame bytes
   * @internal
   */
  static readonly CameraKeyFrameBytes: number;
  /**
   * Light key frame bytes
   * @internal
   */
  static readonly LightKeyFrameBytes: number;
  /**
   * Self shadow key frame bytes
   * @internal
   */
  static readonly SelfShadowKeyFrameBytes: number;
  /**
   * Property key frame bytes
   * @internal
   */
  static readonly PropertyKeyFrameBytes: number;
  /**
   * Property key frame IK state bytes
   * @internal
   */
  static readonly PropertyKeyFrameIkStateBytes: number;
  /**
   * Data deserializer for reading VMD data
   * @internal
   */
  readonly dataDeserializer: MmdDataDeserializer;
  /**
   * Bone key frame count
   */
  readonly boneKeyFrameCount: number;
  /**
   * Morph key frame count
   */
  readonly morphKeyFrameCount: number;
  /**
   * Camera key frame count
   */
  readonly cameraKeyFrameCount: number;
  /**
   * Light key frame count
   */
  readonly lightKeyFrameCount: number;
  /**
   * Self shadow key frame count
   */
  readonly selfShadowKeyFrameCount: number;
  /**
   * Property key frame count
   */
  readonly propertyKeyFrameCount: number;
  private constructor();
  /**
   * Create a new `VmdData` instance from the given buffer
   * @param buffer ArrayBuffer
   * @param logger Logger
   * @returns `VmdData` instance if the given buffer is a valid VMD data, otherwise `null`
   */
  static CheckedCreate(buffer: ArrayBufferLike, logger?: ILogger): VmdData | null;
}
/**
 * VMD object
 *
 * Lazy parsed VMD data object
 *
 * The total amount of memory used is more than parsing at once
 *
 * but you can adjust the instantaneous memory usage to a smaller extent
 */
declare class VmdObject {
  /**
   * Property key frames
   *
   * Property key frames are only preparsed because they size is not fixed
   */
  readonly propertyKeyFrames: readonly VmdObject.PropertyKeyFrame[];
  private readonly _vmdData;
  private constructor();
  /**
   * Parse VMD data
   * @param vmdData VMD data
   * @returns `VmdObject` instance
   */
  static Parse(vmdData: VmdData): VmdObject;
  /**
   * Parse VMD data from the given buffer
   * @param buffer ArrayBuffer
   * @returns `VmdObject` instance
   * @throws {Error} if the given buffer is not a valid VMD data
   */
  static ParseFromBuffer(buffer: ArrayBufferLike): VmdObject;
  /**
   * Get bone key frame reader
   */
  get boneKeyFrames(): VmdObject.BoneKeyFrames;
  /**
   * Get morph key frame reader
   */
  get morphKeyFrames(): VmdObject.MorphKeyFrames;
  /**
   * Get camera key frame reader
   */
  get cameraKeyFrames(): VmdObject.CameraKeyFrames;
  /**
   * Get light key frame reader
   */
  get lightKeyFrames(): VmdObject.LightKeyFrames;
  /**
   * Get self shadow key frame reader
   */
  get selfShadowKeyFrames(): VmdObject.SelfShadowKeyFrames;
}
declare namespace VmdObject {
  /**
   * key frame reader base class
   */
  abstract class BufferArrayReader<T> {
    protected readonly _dataDeserializer: MmdDataDeserializer;
    protected readonly _startOffset: number;
    private readonly _length;
    /**
     * Create a new `BufferArrayReader` instance
     * @param dataDeserializer Data deserializer
     * @param startOffset Data start offset
     * @param length Data length
     */
    constructor(dataDeserializer: MmdDataDeserializer, startOffset: number, length: number);
    /**
     * Length of the data
     */
    get length(): number;
    /**
     * Get the data at the given index
     * @param index Index
     */
    abstract get(index: number): T;
  }
  /**
   * Bone key frame reader
   */
  class BoneKeyFrames extends BufferArrayReader<BoneKeyFrame> {
    /**
     * Create a new `BoneKeyFrames` instance
     * @param dataDeserializer Data deserializer
     * @param startOffset Data start offset
     * @param length Data length
     */
    constructor(dataDeserializer: MmdDataDeserializer, startOffset: number, length: number);
    /**
     * Get the data at the given index
     * @param index Index
     * @returns `BoneKeyFrame` instance
     */
    get(index: number): BoneKeyFrame;
  }
  /**
   * Bone key frame
   */
  class BoneKeyFrame {
    /**
     * Bone name
     */
    readonly boneName: string;
    /**
     * Frame number
     */
    readonly frameNumber: number;
    /**
     * Position
     */
    readonly position: Vec3;
    /**
     * Rotation quaternion
     */
    readonly rotation: Vec4;
    /**
     * Interpolation
     *
     * https://hariganep.seesaa.net/article/201103article_1.html
     * https://x.com/KuroNekoMeguMMD/status/1864306974856499520/
     *
     * The interpolation parameters are four Bezier curves (0,0), (x1,y1), (x2,y2), and (127,127)
     *
     * It represents the parameters of each axis
     *
     * - X-axis interpolation parameters (X_x1, X_y1), (X_x2, X_y2)
     * - Y-axis interpolation parameters (Y_x1, Y_y1), (Y_x2, Y_y2)
     * - Z-axis interpolation parameters (Z_x1, Z_y1), (Z_x2, Z_y2)
     * - Rotation interpolation parameters (R_x1, R_y1), (R_x2, R_y2)
     *
     * And interpolation parameters also include physics toggle parameters
     * - Physics toggle parameters (phy1, phy2)
     *
     * Physics toggle parameters has two varients
     * - phy1: 0x00, phy2: 0x00 (physics off)
     * - phy1: 0x63, phy2: 0x0f (physics on)
     *
     * Then, the interpolation parameters are as follows
     *
     * X_x1,Y_x1,phy1,phy2,
     * X_y1,Y_y1,Z_y1,R_y1,
     * X_x2,Y_x2,Z_x2,R_x2,
     * X_y2,Y_y2,Z_y2,R_y2,
     *
     * Y_x1,Z_x1,R_x1,X_y1,
     * Y_y1,Z_y1,R_y1,X_x2,
     * Y_x2,Z_x2,R_x2,X_y2,
     * Y_y2,Z_y2,R_y2, 00,
     *
     * Z_x1,R_x1,X_y1,Y_y1,
     * Z_y1,R_y1,X_x2,Y_x2,
     * Z_x2,R_x2,X_y2,Y_y2,
     * Z_y2,R_y2, 00, 00,
     *
     * R_x1,X_y1,Y_y1,Z_y1,
     * R_y1,X_x2,Y_x2,Z_x2,
     * R_x2,X_y2,Y_y2,Z_y2,
     * R_y2, 00, 00, 00
     *
     * [4][4][4] = [64]
     */
    readonly interpolation: Uint8Array;
    /**
     * Create a new `BoneKeyFrame` instance
     * @param dataDeserializer Data deserializer
     * @param offset Data offset
     */
    constructor(dataDeserializer: MmdDataDeserializer, offset: number);
  }
  enum BoneKeyFramePhysicsInfoKind {
    /**
     * Physics off
     *
     * Rigid body position is driven by animation
     */
    Off = 25359,
    /**
     * Physics on
     *
     * Rigid body position is driven by physics, only affected when the bone has a rigid body
     */
    On = 0
  }
  /**
   * Morph key frame reader
   */
  class MorphKeyFrames extends BufferArrayReader<MorphKeyFrame> {
    /**
     * Create a new `MorphKeyFrames` instance
     * @param dataDeserializer Data deserializer
     * @param startOffset Data start offset
     * @param length Data length
     */
    constructor(dataDeserializer: MmdDataDeserializer, startOffset: number, length: number);
    /**
     * Get the data at the given index
     * @param index Index
     * @returns `MorphKeyFrame` instance
     */
    get(index: number): MorphKeyFrame;
  }
  /**
   * Morph key frame
   */
  class MorphKeyFrame {
    /**
     * Morph name
     */
    readonly morphName: string;
    /**
     * Frame number
     */
    readonly frameNumber: number;
    /**
     * Weight
     */
    readonly weight: number;
    /**
     * Create a new `MorphKeyFrame` instance
     * @param dataDeserializer Data deserializer
     * @param offset Data offset
     */
    constructor(dataDeserializer: MmdDataDeserializer, offset: number);
  }
  /**
   * Camera key frame reader
   */
  class CameraKeyFrames extends BufferArrayReader<CameraKeyFrame> {
    /**
     * Create a new `CameraKeyFrames` instance
     * @param dataDeserializer Data deserializer
     * @param startOffset Data start offset
     * @param length Data length
     */
    constructor(dataDeserializer: MmdDataDeserializer, startOffset: number, length: number);
    /**
     * Get the data at the given index
     * @param index Index
     * @returns `CameraKeyFrame` instance
     */
    get(index: number): CameraKeyFrame;
  }
  /**
   * Camera key frame
   */
  class CameraKeyFrame {
    /**
     * Frame number
     */
    readonly frameNumber: number;
    /**
     * Distance from the camera center
     */
    readonly distance: number;
    /**
     * Camera center position
     */
    readonly position: Vec3;
    /**
     * Camera rotation in yaw, pitch, roll order
     */
    readonly rotation: Vec3;
    /**
     * Interpolation
     *
     * range: 0..=127
     *
     * default linear interpolation is 20, 107, 20, 107
     *
     * Repr:
     *
     * x_ax, x_bx, x_ay, x_by,
     * y_ax, y_bx, y_ay, y_by,
     * z_ax, z_bx, z_ay, z_by,
     * rot_ax, rot_bx, rot_ay, rot_by,
     * distance_ax, distance_bx, distance_ay, distance_by,
     * angle_ax, angle_bx, angle_ay, angle_by
     */
    readonly interpolation: Uint8Array;
    /**
     * Angle of view (in degrees)
     */
    readonly fov: number;
    /**
     * Whether the camera is perspective or orthographic
     */
    readonly perspective: boolean;
    /**
     * Create a new `CameraKeyFrame` instance
     * @param dataDeserializer Data deserializer
     * @param offset Data offset
     */
    constructor(dataDeserializer: MmdDataDeserializer, offset: number);
  }
  /**
   * Light key frame reader
   */
  class LightKeyFrames extends BufferArrayReader<LightKeyFrame> {
    /**
     * Create a new `LightKeyFrames` instance
     * @param dataDeserializer Data deserializer
     * @param startOffset Data start offset
     * @param length Data length
     */
    constructor(dataDeserializer: MmdDataDeserializer, startOffset: number, length: number);
    /**
     * Get the data at the given index
     * @param index Index
     * @returns `LightKeyFrame` instance
     */
    get(index: number): LightKeyFrame;
  }
  /**
   * Light key frame
   */
  class LightKeyFrame {
    /**
     * Frame number
     */
    readonly frameNumber: number;
    /**
     * Light color
     */
    readonly color: Vec3;
    /**
     * Light direction
     */
    readonly direction: Vec3;
    /**
     * Create a new `LightKeyFrame` instance
     * @param dataDeserializer Data deserializer
     * @param offset Data offset
     */
    constructor(dataDeserializer: MmdDataDeserializer, offset: number);
  }
  /**
   * Self shadow key frame reader
   */
  class SelfShadowKeyFrames extends BufferArrayReader<SelfShadowKeyFrame> {
    /**
     * Create a new `SelfShadowKeyFrames` instance
     * @param dataDeserializer Data deserializer
     * @param startOffset Data start offset
     * @param length Data length
     */
    constructor(dataDeserializer: MmdDataDeserializer, startOffset: number, length: number);
    /**
     * Get the data at the given index
     * @param index Index
     * @returns `SelfShadowKeyFrame` instance
     */
    get(index: number): SelfShadowKeyFrame;
  }
  /**
   * Self shadow key frame
   */
  class SelfShadowKeyFrame {
    /**
     * Frame number
     */
    readonly frameNumber: number;
    /**
     * Shadow mode
     */
    readonly mode: number;
    /**
     * Distance
     */
    readonly distance: number;
    /**
     * Create a new `SelfShadowKeyFrame` instance
     * @param dataDeserializer Data deserializer
     * @param offset Data offset
     */
    constructor(dataDeserializer: MmdDataDeserializer, offset: number);
  }
  /**
   * Property key frame
   */
  type PropertyKeyFrame = Readonly<{
    /**
     * Frame number
     */
    frameNumber: number;
    /**
     * Visibility
     */
    visible: boolean;
    /**
     * IK states
     */
    ikStates: readonly PropertyKeyFrame.IKState[];
  }>;
  namespace PropertyKeyFrame {
    /**
     * IK state [bone name, ik enabled]
     */
    type IKState = Readonly<[string, boolean]>;
  }
}
//#endregion
//#region src/loaders/vmd-loader.d.ts
declare class VMDLoader extends Loader<VmdObject> {
  constructor(manager?: LoadingManager);
  load(url: string, onLoad: (object: VmdObject) => void, onProgress?: (event: ProgressEvent) => void, onError?: (event: ErrorEvent) => void): void;
  loadAsync(url: string, onProgress?: (event: ProgressEvent) => void): Promise<VmdObject>;
}
//#endregion
//#region ../../node_modules/.pnpm/babylon-mmd@1.3.0_@babylonjs+core@9.18.0/node_modules/babylon-mmd/esm/Loader/Parser/vpdObject.d.ts
/**
 * Vpd object is a type that represents a vpd file
 */
type VpdObject = {
  /**
   * bone transforms
   *
   * key: bone name
   *
   * value: bone transform
   */
  bones: {
    [boneName: string]: {
      /**
       * bone position
       *
       * when this is undefined, the bone position is (0, 0, 0)
       */
      position?: Vec3;
      /**
       * bone rotation in quaternion
       */
      rotation: Vec4;
    };
  };
  /**
   * morph weights
   *
   * key: morph name
   *
   * value: morph weight
   */
  morphs: {
    [morphName: string]: number;
  };
};
//#endregion
//#region src/loaders/vpd-loader.d.ts
declare class VPDLoader extends Loader<VpdObject> {
  constructor(manager?: LoadingManager);
  load(url: string, onLoad: (object: VpdObject) => void, onProgress?: (event: ProgressEvent) => void, onError?: (event: ErrorEvent) => void): void;
  loadAsync(url: string, onProgress?: (event: ProgressEvent) => void): Promise<VpdObject>;
}
//#endregion
//#region src/utils/apply-vpd.d.ts
interface ApplyVPDOptions {
  grant?: boolean;
  ik?: boolean;
  resetPhysics?: boolean;
  resetPose?: boolean;
}
/**
 * Applies a static VPD pose to an MMD model.
 *
 * VPD uses MMD's coordinate system, so the pose is converted to the same
 * Three.js coordinate system used by VMD animation tracks before applying it.
 */
declare const applyVPD: (mmd: MMD, vpd: VpdObject, options?: ApplyVPDOptions) => void;
//#endregion
//#region src/utils/build-animation.d.ts
interface MMDAnimationUserData {
  propertyTrack?: MMDPropertyTrackData;
}
interface MMDPropertyTrackData {
  frameNumbers: number[];
  ikBoneNames: string[];
  /** State arrays are indexed as [ikBoneIndex][frameIndex]. */
  ikStates: boolean[][];
}
/**
 * @param vmd - parsed VMD data
 * @param mesh - tracks will be fitting to mesh
 */
declare const buildAnimation: (vmd: VmdObject, mesh: SkinnedMesh) => AnimationClip;
/** @param vmd - parsed VMD data */
declare const buildCameraAnimation: (vmd: VmdObject) => AnimationClip;
//#endregion
//#region src/utils/mmd-animation-manager.d.ts
interface AudioAnimationOptions {
  delayTime?: number;
}
interface MMDAnimationOptions {
  animation?: AnimationClip | AnimationClip[];
}
/** Coordinates MMD, camera, and audio animation on a single render-loop update. */
declare class MMDAnimationManager {
  private audio?;
  private audioDelay;
  private audioDuration?;
  private audioElapsed;
  private audioStarted;
  private audioStartedByManager;
  private camera?;
  private cameraMixer?;
  private cameraTarget?;
  private readonly duration?;
  private readonly models;
  constructor(options?: {
    duration?: number;
  });
  add(mmd: MMD, options?: MMDAnimationOptions): this;
  add(camera: Camera, options?: MMDAnimationOptions): this;
  add(audio: Audio, options?: AudioAnimationOptions): this;
  dispose(): void;
  remove(object: Audio | Camera | MMD): this;
  update(delta: number, options?: MMDUpdateOptions): this;
  private updateAudio;
  private updateMMD;
}
//#endregion
export { type ApplyVPDOptions, type AudioAnimationOptions, GrantSolver, MMD, MMDAnimationManager, type MMDAnimationOptions, type MMDAnimationUserData, MMDIKHelper, MMDIKSolver, MMDLoader, type MMDLoaderParser, type MMDLoaderPlugin, type MMDLoaderPluginFactory, MMDMaterialPlugin, type MMDMaterialPluginOptions, type MMDPropertyTrackData, type MMDUpdateOptions, type PhysicsFactory, type PhysicsService, PmxObject, VMDLoader, VPDLoader, VmdObject, type VpdObject, applyVPD, buildAnimation, buildCameraAnimation, createPhysicsPlugin };