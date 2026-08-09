import {Euler, MeshBasicMaterial, MeshStandardMaterial, Plane, Vector2, Vector3} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import MaterialSerializer from "./MaterialSerializer";
import MaterialsSerializer from "./MaterialsSerializer";
import MeshBasicMaterialSerializer from "./MeshBasicMaterialSerializer";
import MeshBasicNodeMaterialSerializer from "./MeshBasicNodeMaterialSerializer";
import MeshStandardMaterialSerializer from "./MeshStandardMaterialSerializer";

describe("MaterialSerializer", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("omits default material properties without stringifying every field", () => {
        const material = new MeshBasicMaterial();
        const stringify = vi.spyOn(JSON, "stringify");

        const json = new MeshBasicMaterialSerializer().toJSON(material) as any;
        const stringifyCalls = stringify.mock.calls.length;

        expect(stringifyCalls).toBe(0);
        expect(json.color).toBe(material.color.getHex());
        expect(json.uuid).toBe(material.uuid);
        expect(json.type).toBe("MeshBasicMaterial");
        expect(json.transparent).toBeUndefined();
        expect(json.userData).toBeUndefined();
    });

    it("serializes non-default material values compatibly", () => {
        const material = new MeshStandardMaterial({
            metalness: 0.75,
            roughness: 0.25,
            transparent: true,
            opacity: 0.5,
        });
        material.name = "Serializable Material";
        material.envMapRotation = new Euler(0.1, 0.2, 0.3, "ZYX");
        material.normalScale = new Vector2(2, 3);
        material.clippingPlanes = [new Plane(new Vector3(1, 0, 0), 2)];
        material.userData = {custom: {enabled: true}};

        const json = new MaterialSerializer().toJSON(material, new MeshStandardMaterial()) as any;

        expect(json.name).toBe("Serializable Material");
        expect(json.metalness).toBe(0.75);
        expect(json.roughness).toBe(0.25);
        expect(json.transparent).toBe(true);
        expect(json.opacity).toBe(0.5);
        expect(json.envMapRotation).toEqual({x: 0.1, y: 0.2, z: 0.3, order: "ZYX"});
        expect(json.normalScale).toBe(material.normalScale);
        expect(json.clippingPlanes).toBe(material.clippingPlanes);
        expect(json.userData).toEqual({custom: {enabled: true}});
    });

    it("restores serialized Euler, Vector2, and clipping plane fields", () => {
        const material = new MeshStandardMaterial();
        material.envMapRotation = new Euler(0.25, 0.5, 0.75, "YZX");
        material.normalScale = new Vector2(4, 5);
        material.clippingPlanes = [new Plane(new Vector3(0, 1, 0), 3)];

        const json = new MaterialSerializer().toJSON(material, new MeshStandardMaterial()) as any;
        const restored = new MaterialSerializer().fromJSON(json, new MeshStandardMaterial(), {});

        expect(restored.envMapRotation.equals(material.envMapRotation)).toBe(true);
        expect(restored.normalScale.equals(material.normalScale)).toBe(true);
        expect(restored.clippingPlanes).toHaveLength(1);
        expect(restored.clippingPlanes![0].normal.equals(material.clippingPlanes[0]!.normal)).toBe(true);
        expect(restored.clippingPlanes![0].constant).toBe(3);
    });

    it("creates distinct material instances when deserializing without a parent", () => {
        const serializer = new MeshBasicMaterialSerializer();
        const json = serializer.toJSON(new MeshBasicMaterial({
            opacity: 0.4,
            transparent: true,
        })) as any;

        const first = serializer.fromJSON(json, undefined, {});
        const second = serializer.fromJSON(json, undefined, {});

        expect(first).toBeInstanceOf(MeshBasicMaterial);
        expect(second).toBeInstanceOf(MeshBasicMaterial);
        expect(first).not.toBe(second);
        first.opacity = 0.1;
        expect(second.opacity).toBe(0.4);
    });

    it("creates distinct node material instances through node serializers", () => {
        const serializer = new MeshBasicNodeMaterialSerializer();
        const json = {
            metadata: {generator: "MeshBasicNodeMaterialSerializer"},
            opacity: 0.35,
            transparent: true,
        };

        const first = serializer.fromJSON(json, undefined, {});
        const second = serializer.fromJSON(json, undefined, {});

        expect(first.type).toBe("MeshBasicNodeMaterial");
        expect(second.type).toBe("MeshBasicNodeMaterial");
        expect(first).not.toBe(second);
        first.opacity = 0.9;
        expect(second.opacity).toBe(0.35);
    });

    it("creates distinct materials through the central material registry", () => {
        const serializer = new (MaterialsSerializer as any)();
        const json = serializer.toJSON(new MeshBasicMaterial({
            name: "Registry Material",
            opacity: 0.6,
            transparent: true,
        }));

        const first = serializer.fromJSON(json, undefined, {});
        const second = serializer.fromJSON(json, undefined, {});

        expect(first).toBeInstanceOf(MeshBasicMaterial);
        expect(second).toBeInstanceOf(MeshBasicMaterial);
        expect(first).not.toBe(second);
        first.name = "Changed";
        expect(second.name).toBe("Registry Material");
    });

    it("keeps malformed material arrays renderable during reload", () => {
        const serializer = new (MaterialsSerializer as any)();
        const valid = new MeshStandardMaterialSerializer().toJSON(new MeshStandardMaterial({color: 0x3366ff}));

        const restored = serializer.fromJSON([{}, null, valid] as any, undefined, {}) as any[];

        expect(restored).toHaveLength(3);
        expect(restored.every(material => material?.isMaterial === true)).toBe(true);
        expect(restored[2].color.getHex()).toBe(0x3366ff);
    });

    it("replaces an empty material array with a visible fallback", () => {
        const serializer = new (MaterialsSerializer as any)();
        const restored = serializer.fromJSON([], undefined, {}) as any[];

        expect(restored).toHaveLength(1);
        expect(restored[0].isMaterial).toBe(true);
    });

    it("does not write null material slots back as an empty array", () => {
        const serializer = new (MaterialsSerializer as any)();
        const json = serializer.toJSON([null, undefined] as any);

        expect(json).toBeTruthy();
        expect(Array.isArray(json) ? json.length : 1).toBeGreaterThan(0);
    });

    it("keeps metadata-only default entries inspectable", () => {
        const serializer = new (MaterialsSerializer as any)();
        const json = serializer.toJSON(new MeshStandardMaterial()) as any;

        expect(json.metadata.generator).toBe("MeshStandardMaterialSerializer");
        expect(json.type).toBe("MeshStandardMaterial");
        expect(json.color).toBe(0xffffff);
        expect(json.roughness).toBe(1);
        expect(json.metalness).toBe(0);

        const restored = serializer.fromJSON(json, undefined, {});
        expect(restored).toBeInstanceOf(MeshStandardMaterial);
    });
});
