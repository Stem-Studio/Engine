import {
  Color,
  CustomBlending,
  Material,
  Matrix3,
  MeshStandardMaterial,
  TangentSpaceNormalMap,
  Texture,
  UVMapping,
  Vector2,
} from "three";

export interface MaterialProperties {
  color?: Color | null;
  roughness?: number | null;
  metalness?: number | null;
  opacity?: number | null;
  fog?: boolean | null;
  transparent?: boolean | null;
  visible?: boolean | null;
  emissive?: Color | null;
  emissiveIntensity?: number | null;
  side?: number | null;
  depthWrite?: boolean | null;
  depthTest?: boolean | null;
  blending?: number | null;
  alphaTest?: number | null;
  flatShading?: boolean | null;
  toneMapped?: boolean | null;
  premultipliedAlpha?: boolean | null;
  dithering?: boolean | null;
  map?: Texture | null;
  normalMap?: Texture | null;
  bumpMap?: Texture | null;
  displacementMap?: Texture | null;
  roughnessMap?: Texture | null;
  metalnessMap?: Texture | null;
  emissiveMap?: Texture | null;
  aoMap?: Texture | null;
  alphaMap?: Texture | null;
  envMap?: Texture | null;
  lightMap?: Texture | null;
  normalScale?: Vector2 | null;
  bumpScale?: number | null;
  displacementScale?: number | null;
  displacementBias?: number | null;
  envMapIntensity?: number | null;
  lightMapIntensity?: number | null;
  aoMapIntensity?: number | null;
}

const DEFAULT_BATCH_MATERIAL = new MeshStandardMaterial();
const IDENTITY_TEXTURE_MATRIX = new Matrix3();

function hasUnsupportedTextureUvState(texture: Texture): boolean {
  if (texture.channel !== 0) return true;
  if (texture.mapping !== UVMapping) return true;
  if (texture.offset.x !== 0 || texture.offset.y !== 0) return true;
  if (texture.repeat.x !== 1 || texture.repeat.y !== 1) return true;
  if (texture.rotation !== 0) return true;
  if (texture.center.x !== 0 || texture.center.y !== 0) return true;
  if (texture.matrixAutoUpdate === false) return true;
  if (!texture.matrix.equals(IDENTITY_TEXTURE_MATRIX)) return true;
  return false;
}

function hasUnsupportedRetainedTextureState(
  material: MeshStandardMaterial,
): boolean {
  const textures = [
    material.map,
    material.normalMap,
    material.displacementMap,
    material.roughnessMap,
    material.metalnessMap,
    material.emissiveMap,
    material.alphaMap,
  ];
  return textures.some(
    (texture) => texture !== null && hasUnsupportedTextureUvState(texture),
  );
}

function hasCustomMaterialDefines(material: MeshStandardMaterial): boolean {
  const candidate = material.defines ?? {};
  const defaults = DEFAULT_BATCH_MATERIAL.defines ?? {};
  const candidateKeys = Object.keys(candidate);
  const defaultKeys = Object.keys(defaults);
  if (candidateKeys.length !== defaultKeys.length) return true;
  for (const key of candidateKeys) {
    if (candidate[key] !== defaults[key]) return true;
  }
  return false;
}

/**
 * The generated batch node material only supports the standard, built-in
 * material pipeline. Reject custom or unsupported GPU state rather than
 * silently rendering it with different shader/depth/stencil semantics.
 */
export function isBatchMaterialSupported(
  material: MeshStandardMaterial,
): boolean {
  const candidate = material as MeshStandardMaterial & {
    alphaHash?: boolean;
    alphaToCoverage?: boolean;
    forceSinglePass?: boolean;
    isMeshPhysicalMaterial?: boolean;
  };

  if (candidate.isMeshPhysicalMaterial) return false;
  if (material.visible === false) return false;
  if (hasUnsupportedRetainedTextureState(material)) return false;
  if (candidate.alphaHash === true) return false;
  if (material.vertexColors === true) return false;
  if (material.wireframe === true) return false;
  if (material.normalMapType !== TangentSpaceNormalMap) return false;
  if (material.bumpMap !== null) return false;
  if (material.aoMap !== null) return false;
  if (material.envMap !== null) return false;
  if (material.lightMap !== null) return false;
  if (material.colorWrite !== DEFAULT_BATCH_MATERIAL.colorWrite) return false;
  if (material.depthFunc !== DEFAULT_BATCH_MATERIAL.depthFunc) return false;
  if (material.polygonOffset !== DEFAULT_BATCH_MATERIAL.polygonOffset)
    return false;
  if (
    material.polygonOffsetFactor !== DEFAULT_BATCH_MATERIAL.polygonOffsetFactor
  )
    return false;
  if (material.polygonOffsetUnits !== DEFAULT_BATCH_MATERIAL.polygonOffsetUnits)
    return false;
  if (material.stencilWrite !== DEFAULT_BATCH_MATERIAL.stencilWrite)
    return false;
  if (material.stencilWriteMask !== DEFAULT_BATCH_MATERIAL.stencilWriteMask)
    return false;
  if (material.stencilFunc !== DEFAULT_BATCH_MATERIAL.stencilFunc) return false;
  if (material.stencilRef !== DEFAULT_BATCH_MATERIAL.stencilRef) return false;
  if (material.stencilFuncMask !== DEFAULT_BATCH_MATERIAL.stencilFuncMask)
    return false;
  if (material.stencilFail !== DEFAULT_BATCH_MATERIAL.stencilFail) return false;
  if (material.stencilZFail !== DEFAULT_BATCH_MATERIAL.stencilZFail)
    return false;
  if (material.stencilZPass !== DEFAULT_BATCH_MATERIAL.stencilZPass)
    return false;
  if (material.clipIntersection !== DEFAULT_BATCH_MATERIAL.clipIntersection)
    return false;
  if (material.clipShadows !== DEFAULT_BATCH_MATERIAL.clipShadows) return false;
  if (
    Array.isArray(material.clippingPlanes) &&
    material.clippingPlanes.length > 0
  )
    return false;
  if (candidate.alphaToCoverage === true) return false;
  if (candidate.forceSinglePass === true) return false;
  if (material.blending === CustomBlending) return false;
  if (material.shadowSide !== DEFAULT_BATCH_MATERIAL.shadowSide) return false;
  if (material.precision !== DEFAULT_BATCH_MATERIAL.precision) return false;
  if (hasCustomMaterialDefines(material)) return false;
  if (material.onBeforeCompile !== Material.prototype.onBeforeCompile)
    return false;
  if (
    material.customProgramCacheKey !== Material.prototype.customProgramCacheKey
  )
    return false;

  return true;
}

function classifyMaterialType(material: MeshStandardMaterial): string {
  if (material.transparent) return "transparent";
  if (material.metalness > 0.5) return "metal";
  if (material.roughness < 0.3) return "glossy";
  return "matte";
}

export function hashBatchMaterial(material: MeshStandardMaterial): string {
  const hashParts: string[] = [];

  hashParts.push(`type:${classifyMaterialType(material)}`);
  hashParts.push(`side:${material.side}`);
  hashParts.push(`transparent:${material.transparent ? "1" : "0"}`);
  hashParts.push(`opacity:${Math.round(material.opacity * 100)}`);
  hashParts.push(`fog:${material.fog ? "1" : "0"}`);
  hashParts.push(`depthWrite:${material.depthWrite ? "1" : "0"}`);
  hashParts.push(`depthTest:${material.depthTest ? "1" : "0"}`);
  hashParts.push(`blending:${material.blending}`);
  hashParts.push(`alphaTest:${material.alphaTest}`);
  hashParts.push(`flatShading:${material.flatShading ? "1" : "0"}`);
  hashParts.push(`toneMapped:${material.toneMapped ? "1" : "0"}`);
  hashParts.push(
    `premultipliedAlpha:${material.premultipliedAlpha ? "1" : "0"}`,
  );
  hashParts.push(`dithering:${material.dithering ? "1" : "0"}`);
  hashParts.push(`aoMapIntensity:${material.aoMapIntensity}`);

  if (material.map) {
    hashParts.push(`map:${material.map.uuid}`);
    if (material.map.wrapS) hashParts.push(`wrapS:${material.map.wrapS}`);
    if (material.map.wrapT) hashParts.push(`wrapT:${material.map.wrapT}`);
    hashParts.push(`repeatX:${Math.round(material.map.repeat.x * 100)}`);
    hashParts.push(`repeatY:${Math.round(material.map.repeat.y * 100)}`);
    hashParts.push(`offsetX:${Math.round(material.map.offset.x * 100)}`);
    hashParts.push(`offsetY:${Math.round(material.map.offset.y * 100)}`);
  } else {
    hashParts.push("map:null");
  }

  if (material.normalMap) {
    hashParts.push(`normalMap:${material.normalMap.uuid}`);
    hashParts.push(
      `normalScale:${material.normalScale.x}_${material.normalScale.y}`,
    );
    if (material.normalMap.wrapS)
      hashParts.push(`normalWrapS:${material.normalMap.wrapS}`);
    if (material.normalMap.wrapT)
      hashParts.push(`normalWrapT:${material.normalMap.wrapT}`);
    hashParts.push(
      `normalRepeatX:${Math.round(material.normalMap.repeat.x * 100)}`,
    );
    hashParts.push(
      `normalRepeatY:${Math.round(material.normalMap.repeat.y * 100)}`,
    );
  } else {
    hashParts.push("normalMap:null");
  }

  if (material.bumpMap) {
    hashParts.push(`bumpMap:${material.bumpMap.uuid}`);
    hashParts.push(`bumpScale:${Math.round(material.bumpScale * 100)}`);
    if (material.bumpMap.wrapS)
      hashParts.push(`bumpWrapS:${material.bumpMap.wrapS}`);
    if (material.bumpMap.wrapT)
      hashParts.push(`bumpWrapT:${material.bumpMap.wrapT}`);
    hashParts.push(
      `bumpRepeatX:${Math.round(material.bumpMap.repeat.x * 100)}`,
    );
    hashParts.push(
      `bumpRepeatY:${Math.round(material.bumpMap.repeat.y * 100)}`,
    );
  } else {
    hashParts.push("bumpMap:null");
  }

  if (material.displacementMap) {
    hashParts.push(`displacementMap:${material.displacementMap.uuid}`);
    hashParts.push(`displacementScale:${material.displacementScale}`);
    hashParts.push(`displacementBias:${material.displacementBias}`);
    if (material.displacementMap.wrapS)
      hashParts.push(`displacementWrapS:${material.displacementMap.wrapS}`);
    if (material.displacementMap.wrapT)
      hashParts.push(`displacementWrapT:${material.displacementMap.wrapT}`);
    hashParts.push(
      `displacementRepeatX:${Math.round(material.displacementMap.repeat.x * 100)}`,
    );
    hashParts.push(
      `displacementRepeatY:${Math.round(material.displacementMap.repeat.y * 100)}`,
    );
  } else {
    hashParts.push("displacementMap:null");
  }

  if (material.roughnessMap)
    hashParts.push(`roughnessMap:${material.roughnessMap.uuid}`);
  if (material.metalnessMap)
    hashParts.push(`metalnessMap:${material.metalnessMap.uuid}`);
  if (material.emissiveMap)
    hashParts.push(`emissiveMap:${material.emissiveMap.uuid}`);
  if (material.aoMap) hashParts.push(`aoMap:${material.aoMap.uuid}`);
  if (material.alphaMap) hashParts.push(`alphaMap:${material.alphaMap.uuid}`);
  if (material.envMap) hashParts.push(`envMap:${material.envMap.uuid}`);
  hashParts.push(`envMapIntensity:${material.envMapIntensity}`);
  if (material.lightMap) hashParts.push(`lightMap:${material.lightMap.uuid}`);
  if (material.lightMapIntensity !== undefined) {
    hashParts.push(
      `lightMapIntensity:${Math.round(material.lightMapIntensity * 100)}`,
    );
  }

  return hashParts.join("|");
}

export function snapshotBatchMaterial(
  material: MeshStandardMaterial,
): MaterialProperties {
  return {
    color: material.color?.clone(),
    roughness: material.roughness,
    metalness: material.metalness,
    opacity: material.opacity,
    fog: material.fog,
    transparent: material.transparent,
    visible: material.visible,
    emissive: material.emissive?.clone(),
    emissiveIntensity: material.emissiveIntensity,
    side: material.side,
    depthWrite: material.depthWrite,
    depthTest: material.depthTest,
    blending: material.blending,
    alphaTest: material.alphaTest,
    flatShading: material.flatShading,
    toneMapped: material.toneMapped,
    premultipliedAlpha: material.premultipliedAlpha,
    dithering: material.dithering,
    map: material.map,
    normalMap: material.normalMap,
    bumpMap: material.bumpMap,
    displacementMap: material.displacementMap,
    roughnessMap: material.roughnessMap,
    metalnessMap: material.metalnessMap,
    emissiveMap: material.emissiveMap,
    aoMap: material.aoMap,
    alphaMap: material.alphaMap,
    envMap: material.envMap,
    lightMap: material.lightMap,
    normalScale: new Vector2().copy(material.normalScale),
    bumpScale: material.bumpScale,
    displacementScale: material.displacementScale,
    displacementBias: material.displacementBias,
    envMapIntensity: material.envMapIntensity,
    lightMapIntensity: material.lightMapIntensity,
    aoMapIntensity: material.aoMapIntensity,
  };
}

export function hasSignificantBatchMaterialChange(
  oldProps: MaterialProperties,
  newProps: MeshStandardMaterial,
): boolean {
  if (oldProps.transparent !== newProps.transparent) return true;
  if (oldProps.visible !== newProps.visible) return true;
  if (oldProps.fog !== newProps.fog) return true;
  if (oldProps.side !== newProps.side) return true;
  if (oldProps.depthWrite !== newProps.depthWrite) return true;
  if (oldProps.depthTest !== newProps.depthTest) return true;
  if (oldProps.blending !== newProps.blending) return true;
  if (oldProps.alphaTest !== newProps.alphaTest) return true;
  if (oldProps.flatShading !== newProps.flatShading) return true;
  if (oldProps.toneMapped !== newProps.toneMapped) return true;
  if (oldProps.premultipliedAlpha !== newProps.premultipliedAlpha) return true;
  if (oldProps.dithering !== newProps.dithering) return true;
  if (oldProps.map !== newProps.map) return true;
  if (oldProps.normalMap !== newProps.normalMap) return true;
  if (oldProps.bumpMap !== newProps.bumpMap) return true;
  if (oldProps.displacementMap !== newProps.displacementMap) return true;
  if (oldProps.roughnessMap !== newProps.roughnessMap) return true;
  if (oldProps.metalnessMap !== newProps.metalnessMap) return true;
  if (oldProps.emissiveMap !== newProps.emissiveMap) return true;
  if (oldProps.aoMap !== newProps.aoMap) return true;
  if (oldProps.alphaMap !== newProps.alphaMap) return true;
  if (oldProps.envMap !== newProps.envMap) return true;
  if (oldProps.lightMap !== newProps.lightMap) return true;

  const oldNormalScale = oldProps.normalScale;
  const newNormalScale = newProps.normalScale;
  if ((oldNormalScale == null) !== (newNormalScale == null)) return true;
  if (
    oldNormalScale &&
    newNormalScale &&
    !oldNormalScale.equals(newNormalScale)
  )
    return true;
  if (oldProps.bumpScale !== newProps.bumpScale) return true;
  if (oldProps.displacementScale !== newProps.displacementScale) return true;
  if (oldProps.displacementBias !== newProps.displacementBias) return true;
  if (oldProps.envMapIntensity !== newProps.envMapIntensity) return true;
  if (oldProps.lightMapIntensity !== newProps.lightMapIntensity) return true;
  if (oldProps.aoMapIntensity !== newProps.aoMapIntensity) return true;
  return false;
}

export function hasPerInstanceBatchMaterialChange(
  oldProps: MaterialProperties,
  newProps: MaterialProperties,
): boolean {
  const oldColor = oldProps.color ?? null;
  const newColor = newProps.color ?? null;
  const colorChanged =
    (oldColor === null && newColor !== null) ||
    (oldColor !== null && newColor === null) ||
    (oldColor !== null && newColor !== null && !oldColor.equals(newColor));
  const oldEmissive = oldProps.emissive ?? null;
  const newEmissive = newProps.emissive ?? null;
  const emissiveChanged =
    (oldEmissive === null && newEmissive !== null) ||
    (oldEmissive !== null && newEmissive === null) ||
    (oldEmissive !== null &&
      newEmissive !== null &&
      !oldEmissive.equals(newEmissive));

  return (
    colorChanged ||
    emissiveChanged ||
    oldProps.roughness !== newProps.roughness ||
    oldProps.metalness !== newProps.metalness ||
    oldProps.opacity !== newProps.opacity ||
    oldProps.emissiveIntensity !== newProps.emissiveIntensity
  );
}
