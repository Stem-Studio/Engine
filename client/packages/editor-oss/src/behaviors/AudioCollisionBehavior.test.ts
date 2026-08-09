import {afterEach, describe, expect, it, vi} from "vitest";

const hoisted = vi.hoisted(() => ({
    audioPlay: vi.fn(),
    audioSetBuffer: vi.fn(),
    audioSetVolume: vi.fn(),
    load: vi.fn(),
}));

vi.mock("three", async importOriginal => {
    const actual = await importOriginal<typeof import("three")>();

    class FakeAudioListener extends actual.Object3D {}

    class FakeAudio extends actual.Object3D {
        constructor(_listener: unknown) {
            super();
        }

        setBuffer(buffer: unknown) {
            hoisted.audioSetBuffer(buffer);
        }

        setVolume(volume: number) {
            hoisted.audioSetVolume(volume);
        }

        play() {
            hoisted.audioPlay();
        }
    }

    class FakeAudioLoader {
        load(url: string, onLoad: (buffer: unknown) => void, onProgress?: unknown, onError?: (error: Error) => void) {
            return hoisted.load(url, onLoad, onProgress, onError);
        }
    }

    return {
        ...actual,
        AudioListener: FakeAudioListener,
        Audio: FakeAudio,
        AudioLoader: FakeAudioLoader,
    };
});

import * as THREE from "three";

import {AudioCollisionBehavior} from "./AudioCollisionBehavior";

describe("AudioCollisionBehavior", () => {
    afterEach(() => {
        for (const behavior of AudioCollisionBehavior.activeInstances) {
            behavior.stop();
        }
        AudioCollisionBehavior.cancelAnimationLoop();
        vi.restoreAllMocks();
        hoisted.audioPlay.mockReset();
        hoisted.audioSetBuffer.mockReset();
        hoisted.audioSetVolume.mockReset();
        hoisted.load.mockReset();
        delete (globalThis as {requestAnimationFrame?: unknown}).requestAnimationFrame;
        delete (globalThis as {cancelAnimationFrame?: unknown}).cancelAnimationFrame;
    });

    it("cancels its animation loop and key listener on dispose", () => {
        const scene = new THREE.Scene();
        const requestAnimationFrame = vi.fn(() => 123);
        const cancelAnimationFrame = vi.fn();
        (globalThis as {requestAnimationFrame?: unknown}).requestAnimationFrame = requestAnimationFrame;
        (globalThis as {cancelAnimationFrame?: unknown}).cancelAnimationFrame = cancelAnimationFrame;
        const addEventListener = vi.spyOn(document, "addEventListener");
        const removeEventListener = vi.spyOn(document, "removeEventListener");

        const behavior = new AudioCollisionBehavior(scene);
        behavior.dispose();

        expect(requestAnimationFrame).toHaveBeenCalledWith(expect.any(Function));
        expect(cancelAnimationFrame).toHaveBeenCalledWith(123);
        expect(addEventListener).toHaveBeenCalledWith("keydown", behavior.handleKeyPress);
        expect(removeEventListener).toHaveBeenCalledWith("keydown", behavior.handleKeyPress);
    });

    it("shares one requestAnimationFrame loop across active instances", () => {
        const firstScene = new THREE.Scene();
        const secondScene = new THREE.Scene();
        const requestAnimationFrame = vi.fn(() => 123);
        const cancelAnimationFrame = vi.fn();
        (globalThis as {requestAnimationFrame?: unknown}).requestAnimationFrame = requestAnimationFrame;
        (globalThis as {cancelAnimationFrame?: unknown}).cancelAnimationFrame = cancelAnimationFrame;

        const first = new AudioCollisionBehavior(firstScene);
        const second = new AudioCollisionBehavior(secondScene);

        expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

        first.dispose();
        expect(cancelAnimationFrame).not.toHaveBeenCalled();

        second.dispose();
        expect(cancelAnimationFrame).toHaveBeenCalledWith(123);
    });

    it("resolves the selected collision object without requiring scene fps_player", () => {
        const scene = new THREE.Scene();
        const player = new THREE.Object3D();
        player.name = "Player";
        const pickup = new THREE.Object3D();
        pickup.position.set(1, 0, 0);
        pickup.userData = {
            collision_sensitivity: 2,
            selected_collision_object: "Player",
            soundEnabled: true,
            soundUrl: "/coin.mp3",
            soundVolume: 0.5,
        };
        scene.add(player, pickup);
        hoisted.load.mockImplementation((_url, onLoad) => onLoad("buffer"));

        const behavior = new AudioCollisionBehavior(scene);
        behavior.stop();
        behavior.checkForObjectsWithData();

        expect(hoisted.load).toHaveBeenCalledWith("/coin.mp3", expect.any(Function), undefined, expect.any(Function));
        expect(hoisted.audioSetBuffer).toHaveBeenCalledWith("buffer");
        expect(hoisted.audioSetVolume).toHaveBeenCalledWith(0.5);
        expect(hoisted.audioPlay).toHaveBeenCalledOnce();
        expect(pickup.visible).toBe(false);
        expect(pickup.userData.collected).toBe(true);
    });

    it("does not start duplicate audio loads while a pickup is already loading", () => {
        const scene = new THREE.Scene();
        const player = new THREE.Object3D();
        player.name = "Player";
        const pickup = new THREE.Object3D();
        pickup.position.set(1, 0, 0);
        pickup.userData = {
            collision_sensitivity: 2,
            selected_collision_object: "Player",
            soundEnabled: true,
            soundUrl: "/coin.mp3",
        };
        scene.add(player, pickup);
        hoisted.load.mockImplementation(() => undefined);

        const behavior = new AudioCollisionBehavior(scene);
        behavior.stop();
        behavior.checkForObjectsWithData();
        behavior.checkForObjectsWithData();

        expect(hoisted.load).toHaveBeenCalledTimes(1);
    });

    it("does not start duplicate audio loads across active instances", () => {
        const scene = new THREE.Scene();
        const player = new THREE.Object3D();
        player.name = "Player";
        const pickup = new THREE.Object3D();
        pickup.position.set(1, 0, 0);
        pickup.userData = {
            collision_sensitivity: 2,
            selected_collision_object: "Player",
            soundEnabled: true,
            soundUrl: "/coin.mp3",
        };
        scene.add(player, pickup);
        hoisted.load.mockImplementation(() => undefined);

        const first = new AudioCollisionBehavior(scene);
        const second = new AudioCollisionBehavior(scene);
        first.stop();
        second.stop();
        first.checkForObjectsWithData();
        second.checkForObjectsWithData();

        expect(hoisted.load).toHaveBeenCalledTimes(1);
    });

    it("indexes named collision targets during each scene scan", () => {
        const scene = new THREE.Scene();
        const player = new THREE.Object3D();
        player.name = "Player";
        const firstPickup = new THREE.Object3D();
        const secondPickup = new THREE.Object3D();
        firstPickup.position.set(1, 0, 0);
        secondPickup.position.set(1.5, 0, 0);
        firstPickup.userData = {
            collision_sensitivity: 2,
            selected_collision_object: "Player",
            soundEnabled: true,
            soundUrl: "/coin-a.mp3",
        };
        secondPickup.userData = {
            collision_sensitivity: 2,
            selected_collision_object: "Player",
            soundEnabled: true,
            soundUrl: "/coin-b.mp3",
        };
        scene.add(player, firstPickup, secondPickup);
        const getObjectByName = vi.spyOn(scene, "getObjectByName");
        const traverse = vi.spyOn(scene, "traverse");
        hoisted.load.mockImplementation((_url, onLoad) => onLoad("buffer"));

        const behavior = new AudioCollisionBehavior(scene);
        behavior.stop();

        expect(getObjectByName).not.toHaveBeenCalled();
        expect(traverse).not.toHaveBeenCalled();
        expect(hoisted.load).toHaveBeenCalledTimes(2);
    });

    it("scans deep scenes without recursive traversal", () => {
        const scene = new THREE.Scene();
        const player = new THREE.Object3D();
        player.name = "Player";
        scene.add(player);

        let cursor: THREE.Object3D = scene;
        for (let i = 0; i < 12_000; i++) {
            const child = new THREE.Object3D();
            cursor.add(child);
            cursor = child;
        }

        const pickup = new THREE.Object3D();
        pickup.position.set(1, 0, 0);
        pickup.userData = {
            collision_sensitivity: 2,
            selected_collision_object: "Player",
            soundEnabled: true,
            soundUrl: "/deep-coin.mp3",
        };
        cursor.add(pickup);
        const traverse = vi.spyOn(scene, "traverse");
        hoisted.load.mockImplementation((_url, onLoad) => onLoad("buffer"));

        const behavior = new AudioCollisionBehavior(scene);
        behavior.stop();

        expect(traverse).not.toHaveBeenCalled();
        expect(hoisted.load).toHaveBeenCalledWith("/deep-coin.mp3", expect.any(Function), undefined, expect.any(Function));
        expect(pickup.userData.collected).toBe(true);
    });

    it("resolves public collision target lookups without recursive getObjectByName", () => {
        const scene = new THREE.Scene();
        const player = new THREE.Object3D();
        player.name = "Player";
        scene.add(player);
        const getObjectByName = vi.spyOn(scene, "getObjectByName");
        const traverse = vi.spyOn(scene, "traverse");

        const behavior = new AudioCollisionBehavior(scene);
        behavior.stop();

        expect(behavior.getCollisionTarget("Player")).toBe(player);
        expect(getObjectByName).not.toHaveBeenCalled();
        expect(traverse).not.toHaveBeenCalled();
    });
});
