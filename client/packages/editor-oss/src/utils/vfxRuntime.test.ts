import {Object3D, Scene} from "three";
import {describe, expect, it, vi} from "vitest";

import {
    allEmittersPlayer,
    collectEmitters,
    findTopVFXParent,
    isVFXAutoStartEnabled,
    isVFXParent,
    setVFXAutoStart,
    type ParticleEmitterLike,
    type ParticleSystemLike,
} from "./vfxRuntime";

function makeEmitter(name: string, system: ParticleSystemLike = {}): ParticleEmitterLike {
    const emitter = new Object3D() as ParticleEmitterLike;
    emitter.name = name;
    emitter.type = "ParticleEmitter";
    emitter.system = system;
    return emitter;
}

describe("vfxRuntime", () => {
    it("collects emitters in scene order, including ParticleSystem emitter links", () => {
        const root = new Object3D();
        const linkedEmitter = makeEmitter("linked");
        const linkedHost = new Object3D() as Object3D & {emitter?: ParticleEmitterLike};
        linkedHost.emitter = linkedEmitter;
        const child = new Object3D();
        const childEmitter = makeEmitter("child");

        child.add(childEmitter);
        root.add(linkedHost, child);

        expect(collectEmitters(root).map(({name}) => name)).toEqual(["linked", "child"]);
    });

    it("keeps VFX parent detection scoped to descendant emitters", () => {
        const emitter = makeEmitter("self");
        const wrapper = new Object3D();
        wrapper.add(emitter);

        expect(isVFXParent(emitter)).toBe(false);
        expect(isVFXParent(wrapper)).toBe(true);
    });

    it("finds the top VFX parent below the scene for nested selections", () => {
        const scene = new Scene();
        const top = new Object3D();
        const wrapper = new Object3D();
        const emitter = makeEmitter("emitter");
        const childMesh = new Object3D();

        emitter.add(childMesh);
        wrapper.add(emitter);
        top.add(wrapper);
        scene.add(top);

        expect(findTopVFXParent(childMesh, scene)).toBe(top);
        expect(findTopVFXParent(emitter, scene)).toBe(top);
        expect(findTopVFXParent(top, scene)).toBe(top);
    });

    it("keeps direct scene child emitters outside the top-parent wrapper path", () => {
        const scene = new Scene();
        const emitter = makeEmitter("direct");
        scene.add(emitter);

        expect(findTopVFXParent(emitter, scene)).toBeNull();
    });

    it("reads and toggles auto-start on descendant emitters without mutating the wrapper", () => {
        const wrapper = new Object3D();
        const first = makeEmitter("first");
        const second = makeEmitter("second");
        second.userData.autoStart = false;
        wrapper.add(first, second);

        expect(isVFXAutoStartEnabled(wrapper)).toBe(false);

        setVFXAutoStart(wrapper, true);

        expect(wrapper.userData.autoStart).toBeUndefined();
        expect(first.userData.autoStart).toBe(true);
        expect(first.userData.autoplay).toBe(true);
        expect(first.userData.autoPlay).toBe(true);
        expect(second.userData.autoStart).toBe(true);
        expect(isVFXAutoStartEnabled(wrapper)).toBe(true);
    });

    it("plays, restarts, pauses, and stops all descendant emitters", () => {
        const root = new Object3D();
        const pausedSystem = {
            paused: true,
            play: vi.fn(),
            restart: vi.fn(),
            pause: vi.fn(),
            stop: vi.fn(),
        };
        const activeSystem = {
            paused: false,
            play: vi.fn(),
            restart: vi.fn(),
            pause: vi.fn(),
            stop: vi.fn(),
        };
        root.add(makeEmitter("paused", pausedSystem), makeEmitter("active", activeSystem));

        allEmittersPlayer(root, "play");
        allEmittersPlayer(root, "pause");
        allEmittersPlayer(root, "stop");

        expect(pausedSystem.play).toHaveBeenCalledTimes(1);
        expect(pausedSystem.restart).not.toHaveBeenCalled();
        expect(activeSystem.play).not.toHaveBeenCalled();
        expect(activeSystem.restart).toHaveBeenCalledTimes(1);
        expect(pausedSystem.pause).toHaveBeenCalledTimes(1);
        expect(activeSystem.pause).toHaveBeenCalledTimes(1);
        expect(pausedSystem.stop).toHaveBeenCalledTimes(1);
        expect(activeSystem.stop).toHaveBeenCalledTimes(1);
    });
});
