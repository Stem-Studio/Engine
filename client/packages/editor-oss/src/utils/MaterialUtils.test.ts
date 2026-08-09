import { MeshStandardMaterial, DataTexture, RGBAFormat, UnsignedByteType } from "three";
import { describe, it, expect, vi } from "vitest";

// Use vi.hoisted() to create mock variables that are hoisted along with vi.mock
const { mockTextureNode, mockBaseColorNode, mockNormalLocalMul, mockPositionGeometryAdd } = vi.hoisted(() => {
    const mockMul = vi.fn().mockReturnValue({
        add: vi.fn().mockReturnValue({ setName: vi.fn().mockReturnValue("displacementValue") }),
        setName: vi.fn().mockReturnValue("scalarMulNode"),
    });
    const mockBaseColorNode = {
        setName: vi.fn().mockReturnThis(),
        mul: vi.fn().mockReturnValue({ setName: vi.fn().mockReturnValue("colorNodeWithAO") }),
    };
    const mockR = { mul: mockMul };
    return {
        mockTextureNode: { r: mockR, setName: vi.fn().mockReturnThis() },
        mockBaseColorNode,
        mockNormalLocalMul: vi.fn().mockReturnValue({ setName: vi.fn().mockReturnValue("positionNodeResult") }),
        mockPositionGeometryAdd: vi.fn().mockReturnValue({ setName: vi.fn().mockReturnValue("positionNodeResult") }),
    };
});

vi.mock("three/tsl", () => ({
    uv: vi.fn().mockReturnValue({ setName: vi.fn().mockReturnValue("uvNode") }),
    texture: vi.fn().mockReturnValue(mockTextureNode),
    float: vi.fn().mockReturnValue({ setName: vi.fn().mockReturnValue("floatNode") }),
    color: vi.fn().mockReturnValue(mockBaseColorNode),
    normalMap: vi.fn().mockReturnValue({ setName: vi.fn().mockReturnValue("normalMapNode") }),
    clamp: vi.fn(),
    uniform: vi.fn(),
    instanceIndex: {},
    drawIndex: {},
    textureLoad: vi.fn(),
    ivec2: vi.fn(),
    int: vi.fn(),
    vec2: vi.fn(),
    vec3: vi.fn(),
    vec4: vi.fn(),
    varying: vi.fn(),
    mix: vi.fn(),
    normalLocal: { mul: mockNormalLocalMul },
    positionGeometry: { add: mockPositionGeometryAdd },
}));

// Mock three/webgpu
vi.mock("three/webgpu", () => ({
    MeshPhysicalNodeMaterial: class MockMeshPhysicalNodeMaterial {
        userData = { tslNodes: {} };
        type = "MeshPhysicalNodeMaterial";
        isMeshPhysicalNodeMaterial = true;
    },
    MeshStandardNodeMaterial: class MockMeshStandardNodeMaterial {
        userData = { tslNodes: {} };
        name = "";
        uuid = "mock-uuid";
        color = {};
        metalness = 0;
        roughness = 1;
        opacity = 1;
        transparent = false;
        side = 0;
        visible = true;
        depthTest = true;
        depthWrite = true;
        flatShading = false;
        alphaTest = 0;
        alphaHash = false;
        blending = 1;
        positionNode: unknown = undefined;
    },
}));

import { convertMeshStandardToNodeMaterial, hasCustomTSLNodes } from "./MaterialUtils";

describe("MaterialUtils", () => {
    describe("convertMeshStandardToNodeMaterial", () => {
        it("should handle displacement map using positionNode instead of displacementNode", () => {
            const src = new MeshStandardMaterial();
            // Create a minimal displacement map
            const dispMap = new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat, UnsignedByteType);
            src.displacementMap = dispMap;
            src.displacementScale = 2.0;
            src.displacementBias = 0.5;

            const result = convertMeshStandardToNodeMaterial(src);

            // The displacement should be applied via positionNode, not displacementNode
            expect(result.positionNode).toBeDefined();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
            expect((result as any).displacementNode).toBeUndefined();
        });

        it("should not set positionNode when no displacement map is provided", () => {
            const src = new MeshStandardMaterial();

            const result = convertMeshStandardToNodeMaterial(src);

            expect(result.positionNode ?? undefined).toBeUndefined();
        });

        it("should store displacement map in tslNodes userData", () => {
            const src = new MeshStandardMaterial();
            const dispMap = new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat, UnsignedByteType);
            src.displacementMap = dispMap;

            const result = convertMeshStandardToNodeMaterial(src);

            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            expect(result.userData.tslNodes.displacementMap).toBeDefined();
        });

        it("should fold AO maps into colorNode without assigning Three AO lighting slots", () => {
            const src = new MeshStandardMaterial();
            const aoMap = new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat, UnsignedByteType);
            src.aoMap = aoMap;
            src.aoMapIntensity = 0.5;

            const result = convertMeshStandardToNodeMaterial(src);

            expect(result.colorNode).toBe("colorNodeWithAO");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
            expect((result as any).aoNode ?? undefined).toBeUndefined();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
            expect((result as any).aoMap ?? undefined).toBeUndefined();
            expect(result.userData.tslNodes.aoMap).toBe(aoMap);
            expect(result.userData.tslNodes.aoMapIntensity).toBe(0.5);
        });

        it("should mark generated node materials as batch-manager generated", () => {
            const src = new MeshStandardMaterial();

            const result = convertMeshStandardToNodeMaterial(src);

             
            expect(result.userData.batchManagerGeneratedTSL).toBe(true);
        });
    });

    describe("hasCustomTSLNodes", () => {
        it("should detect authored node materials with custom TSL slots", () => {
            const material = {
                isNodeMaterial: true,
                roughnessNode: { type: "roughness" },
                userData: {},
            } as any;

            expect(hasCustomTSLNodes(material)).toBe(true);
        });

        it("should ignore batch-manager generated node materials", () => {
            const material = {
                isNodeMaterial: true,
                colorNode: { type: "color" },
                userData: { batchManagerGeneratedTSL: true },
            } as any;

            expect(hasCustomTSLNodes(material)).toBe(false);
        });

        it("should ignore plain MeshStandardMaterial instances", () => {
            expect(hasCustomTSLNodes(new MeshStandardMaterial())).toBe(false);
        });
    });
});
