import {describe, expect, it, vi} from "vitest";
import * as THREE from "three";

import SceneObjectLookup from "./SceneObjectLookup";

describe("SceneObjectLookup", () => {
    it("indexes deep hierarchies without recursive Object3D traversal", () => {
        const scene = new THREE.Scene();
        let parent: THREE.Object3D = scene;
        for (let i = 0; i < 12_000; i++) {
            const child = new THREE.Object3D();
            parent.add(child);
            parent = child;
        }

        const traverseSpy = vi.spyOn(THREE.Object3D.prototype, "traverse").mockImplementation(() => {
            throw new Error("recursive traversal must not be used");
        });
        const lookup = new SceneObjectLookup(scene);

        expect(lookup.getById(parent.id)).toBe(parent);
        expect(lookup.getByUuid(parent.uuid)).toBe(parent);
        expect(traverseSpy).not.toHaveBeenCalled();
    });

    it("discovers direct additions and rejects removed cached objects", () => {
        const scene = new THREE.Scene();
        const initial = new THREE.Object3D();
        scene.add(initial);
        const lookup = new SceneObjectLookup(scene);

        expect(lookup.getByUuid(initial.uuid)).toBe(initial);

        const added = new THREE.Object3D();
        scene.add(added);
        expect(lookup.getById(added.id)).toBe(added);

        scene.remove(initial);
        expect(lookup.getByUuid(initial.uuid)).toBeNull();
    });

    it("registers and unregisters mutated subtrees incrementally", () => {
        const scene = new THREE.Scene();
        const lookup = new SceneObjectLookup(scene);
        expect(lookup.getByUuid("missing")).toBeNull();

        const parent = new THREE.Object3D();
        const child = new THREE.Object3D();
        parent.add(child);
        scene.add(parent);
        lookup.registerTree(parent);

        const sceneChildren = scene.children;
        Object.defineProperty(scene, "children", {
            configurable: true,
            get: () => {
                throw new Error("incrementally registered lookup rescanned the scene");
            },
        });
        expect(lookup.getByUuid(child.uuid)).toBe(child);
        Object.defineProperty(scene, "children", {configurable: true, value: sceneChildren, writable: true});

        lookup.unregisterTree(parent);
        scene.remove(parent);
        expect(lookup.getByUuid(child.uuid)).toBeNull();
    });

    it("serves repeated lookups without rescanning scene children", () => {
        const scene = new THREE.Scene();
        const target = new THREE.Object3D();
        scene.add(target);
        const lookup = new SceneObjectLookup(scene);

        expect(lookup.getById(target.id)).toBe(target);
        const children = scene.children;
        Object.defineProperty(scene, "children", {
            configurable: true,
            get: () => {
                throw new Error("cached lookup rescanned the scene");
            },
        });

        expect(lookup.getById(target.id)).toBe(target);
        expect(lookup.getByUuid(target.uuid)).toBe(target);
        Object.defineProperty(scene, "children", {configurable: true, value: children, writable: true});
    });

    it("resets automatically when a root provider returns a new scene", () => {
        let scene = new THREE.Scene();
        const first = new THREE.Object3D();
        scene.add(first);
        const lookup = new SceneObjectLookup(() => scene);

        expect(lookup.getById(first.id)).toBe(first);

        scene = new THREE.Scene();
        const second = new THREE.Object3D();
        scene.add(second);
        expect(lookup.getById(first.id)).toBeNull();
        expect(lookup.getByUuid(second.uuid)).toBe(second);
    });
});
