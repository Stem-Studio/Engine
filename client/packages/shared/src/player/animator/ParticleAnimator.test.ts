import {describe, expect, it, vi} from "vitest";
import {Object3D, Scene} from "three";

import ParticleAnimator from "./ParticleAnimator.js";

function createParticle(type: string) {
    const object = new Object3D() as Object3D & {
        update: ReturnType<typeof vi.fn>;
        userData: Record<string, any>;
    };
    object.userData.type = type;
    object.update = vi.fn();

    if (type === "Fire") {
        object.userData.fire = {
            update: vi.fn(),
        };
    }

    if (type === "ParticleEmitter") {
        object.userData.group = {
            tick: vi.fn(),
        };
    }

    return object;
}

describe("ParticleAnimator", () => {
    it("caches particle roots instead of scanning scene children every frame", async () => {
        const scene = new Scene();
        const fire = createParticle("Fire");
        const water = createParticle("Water");
        const inert = new Object3D();
        scene.add(fire, inert, water);
        const animator = new ParticleAnimator({});
        await animator.create(scene, null, null);
        const refreshParticleObjects = vi.spyOn(animator as any, "refreshParticleObjects");

        animator.update({elapsedTime: 1}, 0.016);
        animator.update({elapsedTime: 2}, 0.016);

        expect(refreshParticleObjects).toHaveBeenCalledTimes(1);
        expect(fire.userData.fire.update).toHaveBeenCalledWith(1);
        expect(fire.userData.fire.update).toHaveBeenCalledWith(2);
        expect(water.update).toHaveBeenCalledTimes(2);
    });

    it("refreshes the particle cache when scene children change", async () => {
        const scene = new Scene();
        const smoke = createParticle("Smoke");
        scene.add(smoke);
        const animator = new ParticleAnimator({});
        await animator.create(scene, null, null);
        const refreshParticleObjects = vi.spyOn(animator as any, "refreshParticleObjects");

        animator.update({elapsedTime: 1}, 0.016);

        const emitter = createParticle("ParticleEmitter");
        scene.add(emitter);
        animator.update({elapsedTime: 2}, 0.033);

        expect(refreshParticleObjects).toHaveBeenCalledTimes(2);
        expect(smoke.update).toHaveBeenCalledWith(1);
        expect(smoke.update).toHaveBeenCalledWith(2);
        expect(emitter.userData.group.tick).toHaveBeenCalledWith(0.033);
    });

    it("removes scene listeners and clears the cache on dispose", async () => {
        const scene = new Scene();
        const removeEventListener = vi.spyOn(scene, "removeEventListener");
        const animator = new ParticleAnimator({});
        await animator.create(scene, null, null);

        animator.dispose();

        expect(removeEventListener).toHaveBeenCalledWith("childadded", expect.any(Function));
        expect(removeEventListener).toHaveBeenCalledWith("childremoved", expect.any(Function));
        expect(animator.scene).toBeNull();
        expect(animator.particleObjects).toEqual([]);
        expect(animator.particleObjectsDirty).toBe(true);
    });
});
