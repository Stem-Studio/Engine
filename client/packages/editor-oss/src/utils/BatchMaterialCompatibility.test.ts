import {
  AdditiveBlending,
  BackSide,
  CubeReflectionMapping,
  CustomBlending,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  ObjectSpaceNormalMap,
  Plane,
  Texture,
} from "three";
import { describe, expect, it } from "vitest";

import {
  hashBatchMaterial,
  hasPerInstanceBatchMaterialChange,
  hasSignificantBatchMaterialChange,
  isBatchMaterialSupported,
  snapshotBatchMaterial,
} from "./BatchMaterialCompatibility";
import { convertMeshStandardToNodeMaterial } from "./MaterialUtils";

type RetainedCase = [
  name: string,
  prepare: (material: MeshStandardMaterial) => void,
  mutate: (material: MeshStandardMaterial) => void,
];

type RetainedTextureSlot =
  | "map"
  | "normalMap"
  | "displacementMap"
  | "roughnessMap"
  | "metalnessMap"
  | "emissiveMap"
  | "alphaMap";

const retainedTextureSlots: RetainedTextureSlot[] = [
  "map",
  "normalMap",
  "displacementMap",
  "roughnessMap",
  "metalnessMap",
  "emissiveMap",
  "alphaMap",
];

const unsupportedTextureUvMutations: Array<
  [name: string, mutate: (texture: Texture) => void]
> = [
  ["channel", (texture) => (texture.channel = 1)],
  ["offset", (texture) => texture.offset.set(0.25, 0)],
  ["repeat", (texture) => texture.repeat.set(2, 1)],
  ["rotation", (texture) => (texture.rotation = 0.5)],
  ["center", (texture) => texture.center.set(0.5, 0.5)],
  ["matrixAutoUpdate", (texture) => (texture.matrixAutoUpdate = false)],
  [
    "custom matrix",
    (texture) => texture.matrix.setUvTransform(0.1, 0, 1, 1, 0, 0, 0),
  ],
  ["mapping", (texture) => (texture.mapping = CubeReflectionMapping)],
];

const unsupportedTextureUvCases = retainedTextureSlots.flatMap((slot) =>
  unsupportedTextureUvMutations.map(
    ([mutationName, mutate]) =>
      [`${slot}.${mutationName}`, slot, mutate] as const,
  ),
);

const retainedSignificantCases: RetainedCase[] = [
  ["fog", () => undefined, (material) => (material.fog = false)],
  ["transparent", () => undefined, (material) => (material.transparent = true)],
  ["side", () => undefined, (material) => (material.side = BackSide)],
  ["depthWrite", () => undefined, (material) => (material.depthWrite = false)],
  ["depthTest", () => undefined, (material) => (material.depthTest = false)],
  [
    "blending",
    () => undefined,
    (material) => (material.blending = AdditiveBlending),
  ],
  ["alphaTest", () => undefined, (material) => (material.alphaTest = 0.65)],
  ["flatShading", () => undefined, (material) => (material.flatShading = true)],
  ["toneMapped", () => undefined, (material) => (material.toneMapped = false)],
  [
    "premultipliedAlpha",
    () => undefined,
    (material) => (material.premultipliedAlpha = true),
  ],
  ["dithering", () => undefined, (material) => (material.dithering = true)],
  ["map", () => undefined, (material) => (material.map = new Texture())],
  [
    "normalMap",
    () => undefined,
    (material) => (material.normalMap = new Texture()),
  ],
  [
    "normalScale",
    (material) => (material.normalMap = new Texture()),
    (material) => material.normalScale.set(0.1234, 0.9876),
  ],
  [
    "displacementMap",
    () => undefined,
    (material) => (material.displacementMap = new Texture()),
  ],
  [
    "displacementScale",
    (material) => (material.displacementMap = new Texture()),
    (material) => (material.displacementScale = 0.1234),
  ],
  [
    "displacementBias",
    (material) => (material.displacementMap = new Texture()),
    (material) => (material.displacementBias = 0.01234),
  ],
  [
    "roughnessMap",
    () => undefined,
    (material) => (material.roughnessMap = new Texture()),
  ],
  [
    "metalnessMap",
    () => undefined,
    (material) => (material.metalnessMap = new Texture()),
  ],
  [
    "emissiveMap",
    () => undefined,
    (material) => (material.emissiveMap = new Texture()),
  ],
  [
    "alphaMap",
    () => undefined,
    (material) => (material.alphaMap = new Texture()),
  ],
  [
    "envMapIntensity",
    () => undefined,
    (material) => (material.envMapIntensity = 0.1234),
  ],
];

describe("BatchMaterialCompatibility", () => {
  it.each(retainedSignificantCases)(
    "keys and tracks retained generated/copy state: %s",
    (_name, prepare, mutate) => {
      const before = new MeshStandardMaterial();
      prepare(before);
      const after = before.clone();
      const snapshot = snapshotBatchMaterial(before);
      mutate(after);

      expect(hashBatchMaterial(after)).not.toBe(hashBatchMaterial(before));
      expect(hasSignificantBatchMaterialChange(snapshot, after)).toBe(true);
      expect(isBatchMaterialSupported(after)).toBe(true);
    },
  );

  it.each([
    ["color", (material: MeshStandardMaterial) => material.color.set(0x123456)],
    [
      "roughness",
      (material: MeshStandardMaterial) => (material.roughness = 0.1234),
    ],
    [
      "metalness",
      (material: MeshStandardMaterial) => (material.metalness = 0.4321),
    ],
    [
      "opacity",
      (material: MeshStandardMaterial) => (material.opacity = 0.4567),
    ],
    [
      "emissive",
      (material: MeshStandardMaterial) => material.emissive.set(0x654321),
    ],
    [
      "emissiveIntensity",
      (material: MeshStandardMaterial) => (material.emissiveIntensity = 2.345),
    ],
  ])("tracks retained per-instance state: %s", (_name, mutate) => {
    const before = new MeshStandardMaterial();
    const after = before.clone();
    const snapshot = snapshotBatchMaterial(before);
    mutate(after);

    expect(hasSignificantBatchMaterialChange(snapshot, after)).toBe(false);
    expect(hasPerInstanceBatchMaterialChange(snapshot, after)).toBe(true);
    expect(isBatchMaterialSupported(after)).toBe(true);
  });

  it("keeps every supported texture/node constant wired into the generated material", () => {
    const material = new MeshStandardMaterial();
    material.map = new Texture();
    material.normalMap = new Texture();
    material.displacementMap = new Texture();
    material.roughnessMap = new Texture();
    material.metalnessMap = new Texture();
    material.emissiveMap = new Texture();
    material.alphaMap = new Texture();
    const generated = convertMeshStandardToNodeMaterial(material);
    const nodes = generated.userData.tslNodes as Record<string, unknown>;

    expect(nodes.baseColorMap).toBe(material.map);
    expect(nodes.normalMapTex).toBe(material.normalMap);
    expect(nodes.displacementMap).toBe(material.displacementMap);
    expect(nodes.roughnessMap).toBe(material.roughnessMap);
    expect(nodes.metalnessMap).toBe(material.metalnessMap);
    expect(nodes.emissiveMap).toBe(material.emissiveMap);
    expect(nodes.alphaMap).toBe(material.alphaMap);
  });

  it.each(unsupportedTextureUvCases)(
    "rejects unsupported retained texture UV state: %s",
    (_name, slot, mutate) => {
      const material = new MeshStandardMaterial();
      const texture = new Texture();
      (material as unknown as Record<RetainedTextureSlot, Texture | null>)[
        slot
      ] = texture;
      mutate(texture);

      expect(isBatchMaterialSupported(material)).toBe(false);
    },
  );

  it.each([
    [
      "alphaHash",
      (material: MeshStandardMaterial) => (material.alphaHash = true),
    ],
    [
      "vertexColors",
      (material: MeshStandardMaterial) => (material.vertexColors = true),
    ],
    [
      "wireframe",
      (material: MeshStandardMaterial) => (material.wireframe = true),
    ],
    [
      "bumpMap",
      (material: MeshStandardMaterial) => (material.bumpMap = new Texture()),
    ],
    [
      "aoMap",
      (material: MeshStandardMaterial) => (material.aoMap = new Texture()),
    ],
    [
      "envMap",
      (material: MeshStandardMaterial) => (material.envMap = new Texture()),
    ],
    [
      "lightMap",
      (material: MeshStandardMaterial) => (material.lightMap = new Texture()),
    ],
    [
      "normalMapType",
      (material: MeshStandardMaterial) =>
        (material.normalMapType = ObjectSpaceNormalMap),
    ],
    [
      "colorWrite",
      (material: MeshStandardMaterial) => (material.colorWrite = false),
    ],
    [
      "polygonOffset",
      (material: MeshStandardMaterial) => (material.polygonOffset = true),
    ],
    [
      "polygonOffsetFactor",
      (material: MeshStandardMaterial) => (material.polygonOffsetFactor = 1),
    ],
    [
      "polygonOffsetUnits",
      (material: MeshStandardMaterial) => (material.polygonOffsetUnits = 1),
    ],
    [
      "stencilWrite",
      (material: MeshStandardMaterial) => (material.stencilWrite = true),
    ],
    [
      "stencilRef",
      (material: MeshStandardMaterial) => (material.stencilRef = 2),
    ],
    [
      "clippingPlanes",
      (material: MeshStandardMaterial) =>
        (material.clippingPlanes = [new Plane()]),
    ],
    [
      "custom blending",
      (material: MeshStandardMaterial) => (material.blending = CustomBlending),
    ],
    [
      "onBeforeCompile",
      (material: MeshStandardMaterial) => {
        material.onBeforeCompile = () => undefined;
      },
    ],
    [
      "customProgramCacheKey",
      (material: MeshStandardMaterial) => {
        material.customProgramCacheKey = () => "custom";
      },
    ],
  ])("rejects unsupported draw/program state: %s", (_name, mutate) => {
    const material = new MeshStandardMaterial();
    mutate(material);

    expect(isBatchMaterialSupported(material)).toBe(false);
  });

  it("rejects physical materials until their full pipeline state is batch-compatible", () => {
    expect(isBatchMaterialSupported(new MeshPhysicalMaterial())).toBe(false);
  });
});
