import {describe, expect, it, vi} from "vitest";

import {parseTransformVectorState, serializeTransformVectorState} from "./transformStateSerialization";

describe("transformStateSerialization", () => {
    it("serializes x/y/z transform state without JSON.stringify", () => {
        const stringifySpy = vi.spyOn(JSON, "stringify");

        expect(serializeTransformVectorState({x: 1, y: -2.5, z: Number.NaN})).toBe('{"x":1,"y":-2.5,"z":null}');
        expect(stringifySpy).not.toHaveBeenCalled();
    });

    it("parses current and legacy Euler transform state", () => {
        expect(parseTransformVectorState('{"x":1,"y":2,"z":3}')).toEqual({x: 1, y: 2, z: 3});
        expect(parseTransformVectorState('{"isEuler":true,"_x":4,"_y":5,"_z":6,"_order":"XYZ"}')).toEqual({
            x: 4,
            y: 5,
            z: 6,
        });
    });
});
