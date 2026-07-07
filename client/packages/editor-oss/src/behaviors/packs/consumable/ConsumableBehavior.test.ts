import * as THREE from "three";
import {describe, expect, it, vi} from "vitest";

import {CONSUMABLE_TYPES} from "@stem/editor-oss/types/editor";
import ConsumableBehavior from "./ConsumableBehavior";

const createBehavior = (getUseAction: () => boolean, pressE = false): ConsumableBehavior => {
    const target = new THREE.Object3D();
    const behavior = new ConsumableBehavior(target, "consumable", {
        gameObject: {target} as any,
        erth: {} as any,
        attributes: {
            consumableType: CONSUMABLE_TYPES.PRESS_E,
        },
    });

    behavior.init({
        inputManager: {
            getAction: vi.fn((action: string) => (action === "use" ? getUseAction() : false)),
        },
        scene: {userData: {pressE}},
        player: {userData: {pressE}},
    } as any);

    return behavior;
};

describe("ConsumableBehavior", () => {
    it("collects PRESS_E consumables from the input action system", () => {
        const behavior = createBehavior(() => true, false);
        const collectObject = vi.spyOn(behavior, "collectObject").mockImplementation(() => undefined as any);

        behavior.onCollision();

        expect(collectObject).toHaveBeenCalledOnce();
    });

    it("keeps the legacy pressE state as a fallback", () => {
        const behavior = createBehavior(() => false, true);
        const collectObject = vi.spyOn(behavior, "collectObject").mockImplementation(() => undefined as any);

        behavior.onCollision();

        expect(collectObject).toHaveBeenCalledOnce();
    });

    it("does not collect PRESS_E consumables until the use action is active", () => {
        const behavior = createBehavior(() => false, false);
        const collectObject = vi.spyOn(behavior, "collectObject").mockImplementation(() => undefined as any);

        behavior.onCollision();

        expect(collectObject).not.toHaveBeenCalled();
    });
});
