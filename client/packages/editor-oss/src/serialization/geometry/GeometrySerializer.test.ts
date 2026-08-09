import * as THREE from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import GeometrySerializer from "./GeometrySerializer";

describe("GeometrySerializer", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("compares defaults without stringifying every field", () => {
        const stringify = vi.spyOn(JSON, "stringify");
        const geometry = new THREE.BufferGeometry();
        geometry.name = "legacy-compatible";

        const json = new GeometrySerializer().toJSON(geometry) as any;

        expect(stringify).not.toHaveBeenCalled();
        expect(json.metadata?.generator).toBe("GeometrySerializer");
        expect(json.name).toBe("legacy-compatible");
        expect(json.parameters).toBeUndefined();
    });

    it("restores serialized geometry compatibility fields", () => {
        const geometry = new GeometrySerializer().fromJSON({
            name: "restored",
            parameters: {width: 2},
        }) as any;

        expect(geometry).toBeInstanceOf(THREE.BufferGeometry);
        expect(geometry.name).toBe("restored");
        expect(geometry.parameters).toEqual({width: 2});
    });
});
