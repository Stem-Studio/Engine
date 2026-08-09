import {MeshStandardMaterial, PerspectiveCamera, Scene, Texture} from "three";
import {texture as textureNode} from "three/tsl";
import {describe, expect, it} from "vitest";

function materialType(object: {material: unknown}): string | undefined {
    return Array.isArray(object.material) ? object.material[0]?.type : (object.material as {type?: string}).type;
}

function collectThreeSrcImportOffenders(): string[] {
    const editorSourceModules = import.meta.glob("../**/*.{js,jsx,ts,tsx}", {
        eager: true,
        import: "default",
        query: "?raw",
    }) as Record<string, string>;
    const sharedSourceModules = import.meta.glob("../../../shared/src/**/*.{js,jsx,ts,tsx}", {
        eager: true,
        import: "default",
        query: "?raw",
    }) as Record<string, string>;
    const forbiddenDeepThreeImport =
        /(?:from\s+["']three\/src(?:\/|["'])|import\s+["']three\/src(?:\/|["'])|import\s*\(\s*["']three\/src(?:\/|["']))/;

    return Object.entries({...editorSourceModules, ...sharedSourceModules})
        .filter(([file]) => !file.endsWith("ThreeWebGpuImportCleanup.test.ts"))
        .filter(([, source]) => forbiddenDeepThreeImport.test(source))
        .map(([file]) => file);
}

describe("Three.js WebGPU import cleanup", () => {
    it("loads render helpers and node-material primitives without renderer setup", async () => {
        const {default: ClippingContext} = await import("./ClippingContext");
        const {outline} = await import("./postprocessing/SharedDepthOutlineNode");
        const {createMirror} = await import("../object/component/Mirror");
        const {default: Smoke} = await import("../object/component/Smoke.js");
        const {default: Fire} = await import("../object/component/Fire.js");
        const {default: Water} = await import("../object/component/Water.js");
        const {default: ScalingImageMaterial} = await import("../behaviors/packs/shared/ScalingImageMaterial");
        const {GPUPicker} = await import("../assets/js/gpupicker/gpupicker");
        const {default: BatchManager} = await import("../utils/BatchManager");
        const {convertMeshStandardToNodeMaterial} = await import("../utils/MaterialUtils");
        const {ModelPreviewRenderer} = await import(
            "../editor/assets/v2/LeftPanel/MainTabs/AssetsTab/ModelUpload/utils/ModelPreviewRenderer"
        );

        expect(new ClippingContext().unionClippingCount).toBe(0);
        expect(outline).toBeTypeOf("function");
        expect(GPUPicker).toBeTypeOf("function");
        expect(BatchManager).toBeTypeOf("function");
        expect(ModelPreviewRenderer).toBeTypeOf("function");

        const mirror = createMirror();
        expect(materialType(mirror)).toBe("MeshBasicNodeMaterial");

        const smoke = new Smoke({particleCount: 1});
        expect(materialType(smoke)).toBe("PointsNodeMaterial");

        const fire = new Fire(new PerspectiveCamera(), {particleCount: 1});
        expect(fire.children[0]).toBeDefined();
        const firePoints = fire.children[0] as unknown as {material: unknown};
        expect(materialType(firePoints)).toBe("PointsNodeMaterial");

        const water = new Water({segments: 1});
        expect(materialType(water)).toBe("MeshPhysicalNodeMaterial");

        const imageMaterial = ScalingImageMaterial.createMaterial(new Texture(), 1);
        expect(imageMaterial.type).toBe("MeshBasicNodeMaterial");

        const nodeMaterial = convertMeshStandardToNodeMaterial(new MeshStandardMaterial());
        expect(nodeMaterial.type).toBe("MeshStandardNodeMaterial");
    });

    it("keeps TextureUtils patched against the active TSL texture nodes", async () => {
        await import("../utils/TextureUtils");

        const originalTexture = new Texture();
        const node = textureNode(originalTexture) as unknown as {value: Texture | null};

        node.value = null;
        expect(node.value).toBe(originalTexture);

        const nextTexture = new Texture();
        node.value = nextTexture;
        expect(node.value).toBe(nextTexture);
    });

    it("keeps outline depth isolated from the main scene prepass", async () => {
        const {outline} = await import("./postprocessing/SharedDepthOutlineNode");
        const externalDepthTexture = new Texture();
        const node = outline(new Scene(), new PerspectiveCamera(), {
            depthTexture: externalDepthTexture,
            depthNode: textureNode(externalDepthTexture),
        }) as unknown as {
            _externalDepthTexture?: Texture;
            _externalDepthNode?: unknown;
        };

        expect(node._externalDepthTexture).toBeUndefined();
        expect(node._externalDepthNode).toBeUndefined();
    });

    it("does not import node-material constructors from deep three/src modules", () => {
        const forbiddenPath = ["three", "src", "materials", "nodes"].join("/");
        const sourceModules = import.meta.glob("../**/*.{js,jsx,ts,tsx}", {
            eager: true,
            import: "default",
            query: "?raw",
        }) as Record<string, string>;
        const offenders = Object.entries(sourceModules)
            .filter(([file]) => !file.endsWith("ThreeWebGpuImportCleanup.test.ts"))
            .filter(([, source]) => source.includes(forbiddenPath))
            .map(([file]) => file);

        expect(offenders).toEqual([]);
    });

    it("does not import from deep three/src modules in app source", () => {
        expect(collectThreeSrcImportOffenders()).toEqual([]);
    });
});
