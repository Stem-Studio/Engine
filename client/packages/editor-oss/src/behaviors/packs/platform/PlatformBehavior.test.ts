import * as THREE from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import MotionStateHelper from "../../../physics/MotionStateHelper";
import PlatformBehavior from "./PlatformBehavior";

const createHostMultiplayerState = () => ({
    isHost: vi.fn(() => true),
    setBehaviorData: vi.fn(),
});

const createPlatformBehavior = () => {
    const target = new THREE.Object3D();
    const player = new THREE.Object3D();
    const behavior = new PlatformBehavior(target, "platform", {
        gameObject: {target} as any,
        erth: {} as any,
        attributes: {},
    });
    const multiplayerState = createHostMultiplayerState();
    const physics = {setPlayerSpeedAdjustment: vi.fn()};
    behavior.init({multiplayerState, player, physics} as any);
    return {behavior, target, player, multiplayerState, physics};
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe("PlatformBehavior", () => {
    it("syncs transform state without JSON.stringify", () => {
        const stringifySpy = vi.spyOn(JSON, "stringify");
        const {behavior, target, multiplayerState} = createPlatformBehavior();
        target.position.set(1, 2, 3);
        target.rotation.set(0.1, 0.2, 0.3);
        target.scale.set(2, 3, 4);

        behavior.syncMultiplayerState();

        expect(stringifySpy).not.toHaveBeenCalled();
        expect(multiplayerState.setBehaviorData).toHaveBeenCalledWith(target, "platform", "position", '{"x":1,"y":2,"z":3}');
        expect(multiplayerState.setBehaviorData).toHaveBeenCalledWith(target, "platform", "rotation", '{"x":0.1,"y":0.2,"z":0.3}');
        expect(multiplayerState.setBehaviorData).toHaveBeenCalledWith(target, "platform", "scale", '{"x":2,"y":3,"z":4}');
    });

    it("reads player motion state once per update", () => {
        const {behavior, player} = createPlatformBehavior();
        (behavior as any).isStarted = true;
        player.userData.motionState = {onGround: true};
        const motionStateSpy = vi.spyOn(MotionStateHelper, "getMotionState");

        behavior.update(1);

        expect(motionStateSpy).toHaveBeenCalledTimes(1);
    });
});
