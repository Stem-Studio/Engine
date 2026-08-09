import {
  DataTexture,
  FloatType,
  MeshStandardMaterial,
  RGBAFormat,
  Texture,
} from "three";
import { describe, expect, it } from "vitest";

import {
  convertMeshStandardToNodeMaterial,
  patchNodeMaterialSetup,
} from "./MaterialUtils";

type TraversableNode = {
  constructor: { name: string };
  components?: string;
  op?: string;
  aNode?: TraversableNode;
  bNode?: TraversableNode;
  traverse(callback: (node: TraversableNode) => void): void;
};

function createUniformTexture(
  entries: Array<[string, { offset: number; size: number }]>,
): DataTexture & {
  uniformMap: Map<string, { offset: number; size: number }>;
  pixelsPerInstance: number;
  channels: number;
} {
  const texture = new DataTexture(
    new Float32Array(4),
    1,
    1,
    RGBAFormat,
    FloatType,
  ) as ReturnType<typeof createUniformTexture>;
  texture.uniformMap = new Map(entries);
  texture.pixelsPerInstance = 1;
  texture.channels = 4;
  return texture;
}

function collectSplitComponents(node: TraversableNode): string[] {
  const components: string[] = [];
  node.traverse((child) => {
    if (child.constructor.name === "SplitNode" && child.components) {
      components.push(child.components);
    }
  });
  return components;
}

describe("MaterialUtils batch graph parity", () => {
  it("samples initial alpha maps from Three's green channel", () => {
    const source = new MeshStandardMaterial({ alphaMap: new Texture() });
    const generated = convertMeshStandardToNodeMaterial(source);
    const components = collectSplitComponents(
      generated.opacityNode as unknown as TraversableNode,
    );

    expect(components).toContain("y");
    expect(components).not.toContain("w");
  });

  it("samples patched batched alpha maps from the green channel", () => {
    const material = {
      setupPosition: (_builder?: unknown) => undefined,
      userData: { tslNodes: { alphaMap: new Texture() } },
      opacityNode: null,
    };
    const uniformsTexture = createUniformTexture([
      ["opacity", { offset: 0, size: 1 }],
    ]);
    patchNodeMaterialSetup(material, { uniformsTexture });
    material.setupPosition({ getDrawIndex: () => null });
    const components = collectSplitComponents(
      material.opacityNode as unknown as TraversableNode,
    );

    expect(components).toContain("y");
    expect(components).not.toContain("w");
  });

  it("composes per-instance emissive intensity into the consumed emissive node", () => {
    const material = {
      setupPosition: (_builder?: unknown) => undefined,
      userData: { tslNodes: {} },
      emissiveNode: null,
      emissiveIntensityNode: undefined,
    };
    const uniformsTexture = createUniformTexture([
      ["emissive", { offset: 0, size: 3 }],
      ["emissiveIntensity", { offset: 3, size: 1 }],
    ]);
    patchNodeMaterialSetup(material, { uniformsTexture });
    material.setupPosition({ getDrawIndex: () => null });
    const multiplyNodes: TraversableNode[] = [];
    (material.emissiveNode as unknown as TraversableNode).traverse((node) => {
      if (node.constructor.name === "OperatorNode" && node.op === "*") {
        multiplyNodes.push(node);
      }
    });

    expect(
      multiplyNodes.some(
        (node) =>
          node.aNode?.constructor.name === "VaryingNode" &&
          node.bNode?.constructor.name === "VaryingNode",
      ),
    ).toBe(true);
    expect(material.emissiveIntensityNode).toBeUndefined();
  });
});
