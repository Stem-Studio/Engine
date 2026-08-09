import {Object3D} from "three";
import {describe, expect, it} from "vitest";

import HideObjectLambda from "../packs/hideObject/HideObjectLambda";
import ShowObjectLambda from "../packs/showObject/ShowObjectLambda";

const WAS_ENABLED_KEY = "__hideObjectPhysicsWasEnabled";
const REMOVED_KEY = "__hideObjectPhysicsRemoved";

describe("hide/show object lambdas", () => {
    it("keeps hide physics bookkeeping out of serialized userData", () => {
        const object = new Object3D();
        object.userData.physics = {enabled: true};
        const lambda = new HideObjectLambda("hideObject", {});
        lambda._registerObject(object, {includeChildren: false});

        lambda.update(0.016);

        expect(object.visible).toBe(false);
        expect(object.userData.physics.enabled).toBe(false);
        expect(object.userData[WAS_ENABLED_KEY]).toBe(true);
        expect(object.userData[REMOVED_KEY]).toBe(true);
        expect(Object.prototype.propertyIsEnumerable.call(object.userData, WAS_ENABLED_KEY)).toBe(false);
        expect(Object.prototype.propertyIsEnumerable.call(object.userData, REMOVED_KEY)).toBe(false);
        expect(JSON.stringify(object.userData)).not.toContain(WAS_ENABLED_KEY);
        expect(JSON.stringify(object.userData)).not.toContain(REMOVED_KEY);
    });

    it("restores physics and clears legacy enumerable hide bookkeeping", () => {
        const object = new Object3D();
        object.visible = false;
        object.userData.physics = {enabled: false};
        object.userData[WAS_ENABLED_KEY] = true;
        object.userData[REMOVED_KEY] = true;
        const lambda = new ShowObjectLambda("showObject", {});
        lambda._registerObject(object, {includeChildren: false});

        expect(Object.prototype.propertyIsEnumerable.call(object.userData, WAS_ENABLED_KEY)).toBe(true);
        expect(Object.prototype.propertyIsEnumerable.call(object.userData, REMOVED_KEY)).toBe(true);

        lambda.update(0.016);

        expect(object.visible).toBe(true);
        expect(object.userData.physics.enabled).toBe(true);
        expect(object.userData[WAS_ENABLED_KEY]).toBeUndefined();
        expect(object.userData[REMOVED_KEY]).toBeUndefined();
        expect(JSON.stringify(object.userData)).not.toContain(WAS_ENABLED_KEY);
        expect(JSON.stringify(object.userData)).not.toContain(REMOVED_KEY);
    });
});
