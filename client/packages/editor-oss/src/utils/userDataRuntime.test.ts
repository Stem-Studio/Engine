import {describe, expect, it, vi} from "vitest";
import {Object3D} from "three";

import {deleteRuntimeUserDataValue, setRuntimeUserDataValue} from "./userDataRuntime";

describe("userDataRuntime", () => {
    it("stores runtime values as hidden userData", () => {
        const object = new Object3D();

        setRuntimeUserDataValue(object, "_runtimeValue", 42);

        expect(object.userData._runtimeValue).toBe(42);
        expect(Object.prototype.propertyIsEnumerable.call(object.userData, "_runtimeValue")).toBe(false);
        expect(JSON.stringify(object.userData)).not.toContain("_runtimeValue");
    });

    it("hides legacy enumerable runtime values", () => {
        const object = new Object3D();
        object.userData._runtimeValue = 7;

        expect(Object.prototype.propertyIsEnumerable.call(object.userData, "_runtimeValue")).toBe(true);

        setRuntimeUserDataValue(object, "_runtimeValue", 7);

        expect(object.userData._runtimeValue).toBe(7);
        expect(Object.prototype.propertyIsEnumerable.call(object.userData, "_runtimeValue")).toBe(false);
    });

    it("does not redefine an already hidden value when the value is unchanged", () => {
        const object = new Object3D();
        setRuntimeUserDataValue(object, "_runtimeValue", 7);

        const definePropertySpy = vi.spyOn(Object, "defineProperty");

        setRuntimeUserDataValue(object, "_runtimeValue", 7);

        expect(definePropertySpy).not.toHaveBeenCalled();
        definePropertySpy.mockRestore();
    });

    it("updates an existing hidden value without redefining the descriptor", () => {
        const object = new Object3D();
        setRuntimeUserDataValue(object, "_runtimeValue", 7);

        const definePropertySpy = vi.spyOn(Object, "defineProperty");

        setRuntimeUserDataValue(object, "_runtimeValue", 9);

        expect(object.userData._runtimeValue).toBe(9);
        expect(Object.prototype.propertyIsEnumerable.call(object.userData, "_runtimeValue")).toBe(false);
        expect(definePropertySpy).not.toHaveBeenCalled();
        definePropertySpy.mockRestore();
    });

    it("deletes runtime values when possible", () => {
        const object = new Object3D();
        setRuntimeUserDataValue(object, "_runtimeValue", true);

        deleteRuntimeUserDataValue(object, "_runtimeValue");

        expect(object.userData._runtimeValue).toBeUndefined();
        expect("_runtimeValue" in object.userData).toBe(false);
    });
});
