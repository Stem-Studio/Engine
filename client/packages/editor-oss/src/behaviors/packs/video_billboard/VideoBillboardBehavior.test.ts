import * as THREE from "three";
import {describe, expect, it, vi} from "vitest";

import VideoBillboardBehavior from "./VideoBillboardBehavior";

function createBehavior() {
    const target = new THREE.Object3D();
    const player = new THREE.Object3D();
    const behavior = new VideoBillboardBehavior(target, "video_billboard", {
        gameObject: {target} as any,
        erth: {} as any,
        attributes: {},
    });
    behavior.init({player} as any);

    const videoSource = {
        isReady: vi.fn(() => true),
        getTexture: vi.fn(() => ({needsUpdate: false})),
        isPlaying: vi.fn(() => false),
        setVolume: vi.fn(),
    };

    (behavior as any).videoSource = videoSource;
    (behavior as any).proximityDistance = 5;
    behavior.initialVolume = 0.5;

    return {behavior, target, player, videoSource};
}

describe("VideoBillboardBehavior", () => {
    it("uses squared distance to skip outside proximity without a Vector3 distance sqrt", () => {
        const {behavior, target, player, videoSource} = createBehavior();
        player.position.set(10, 0, 0);
        target.position.set(0, 0, 0);
        const distanceTo = vi.spyOn(player.position, "distanceTo");
        const distanceToSquared = vi.spyOn(player.position, "distanceToSquared");
        const pause = vi.spyOn(behavior as any, "pause").mockImplementation(() => undefined);
        const play = vi.spyOn(behavior as any, "play").mockImplementation(() => undefined);

        behavior.update();

        expect(distanceTo).not.toHaveBeenCalled();
        expect(distanceToSquared).toHaveBeenCalledOnce();
        expect(videoSource.setVolume).toHaveBeenCalledWith(0);
        expect(pause).toHaveBeenCalledOnce();
        expect(play).not.toHaveBeenCalled();
    });

    it("keeps linear volume falloff while inside proximity", () => {
        const {behavior, target, player, videoSource} = createBehavior();
        player.position.set(3, 0, 0);
        target.position.set(0, 0, 0);
        const play = vi.spyOn(behavior as any, "play").mockImplementation(() => undefined);

        behavior.update();

        expect(videoSource.setVolume).toHaveBeenCalledWith(0.2);
        expect(play).toHaveBeenCalledOnce();
    });
});
