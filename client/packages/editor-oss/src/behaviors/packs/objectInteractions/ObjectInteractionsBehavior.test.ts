import {Object3D, PerspectiveCamera, Scene} from "three";
import {describe, expect, it, vi} from "vitest";

import ObjectInteractionsBehavior from "./ObjectInteractionsBehavior";

function createBehavior() {
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    camera.position.set(0, 0, 10);
    const player = new Object3D();
    const target = new Object3D();
    target.userData.physics = {
        enabled: true,
        ctype: "Dynamic",
        mass: 1,
    };
    scene.add(player, target);
    const physics = {
        remove: vi.fn(),
        applyCentralImpulse: vi.fn(),
    };
    const game = {
        scene,
        camera,
        player,
        physics,
    };
    const behavior = new ObjectInteractionsBehavior(target, "objectInteractions", {
        gameObject: {target} as never,
        erth: {} as never,
        attributes: {
            interactionDistance: 3.5,
            pickUp: true,
        },
    });
    behavior.init(game as never);
    behavior.onStart();
    return {behavior, scene, player, target, physics};
}

describe("ObjectInteractionsBehavior", () => {
    it("reuses the range detector result for the input interaction gate", () => {
        const {behavior, scene, player, target, physics} = createBehavior();
        player.position.set(0, 0, 0);
        target.position.set(1, 0, 0);
        scene.updateMatrixWorld(true);
        scene.userData.pressE = true;
        const targetGetWorldPosition = vi.spyOn(target, "getWorldPosition");
        const isTargetInRange = vi.spyOn(
            behavior as unknown as {isTargetInRange(): boolean},
            "isTargetInRange",
        );

        behavior.update(1 / 60);

        expect(isTargetInRange).not.toHaveBeenCalled();
        expect(targetGetWorldPosition).toHaveBeenCalledTimes(2);
        expect(physics.remove).toHaveBeenCalledWith(target.uuid);
    });
});
