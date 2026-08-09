import { Object3D, Scene } from "three";
import { describe, expect, it } from "vitest";

import TagUtil from "./TagUtil";

describe("TagUtil", () => {
    it("checks simple tags without duplicating entries", () => {
        const object = new Object3D();

        TagUtil.addTag(object, ["player", "player", "interactive"]);

        expect(TagUtil.getTags(object)).toEqual(["player", "interactive"]);
        expect(TagUtil.hasTag(object, "player")).toBe(true);
        expect(TagUtil.hasAnyTag(object, ["missing", "interactive"])).toBe(true);
        expect(TagUtil.hasAllTags(object, ["player", "interactive"])).toBe(true);
    });

    it("checks nested userData paths with the same public hasTag API", () => {
        const object = new Object3D();
        object.userData.physics = {
            climbable: true,
            hazard: false,
        };

        expect(TagUtil.hasTag(object, "physics.climbable")).toBe(true);
        expect(TagUtil.hasTag(object, "physics.hazard")).toBe(false);
        expect(TagUtil.hasTag(object, "physics.missing.value")).toBe(false);
    });

    it("reuses parsed matchers for repeated nested tag checks", () => {
        const object = new Object3D();
        object.userData.physics = {
            climbable: true,
        };
        const cache = (TagUtil as unknown as {matcherCache: Map<string, unknown>}).matcherCache;

        cache.clear();
        expect(TagUtil.hasTag(object, "physics.climbable")).toBe(true);
        const matcher = cache.get("physics.climbable");

        expect(TagUtil.hasTag(object, "physics.climbable")).toBe(true);
        expect(cache.get("physics.climbable")).toBe(matcher);
        expect(cache.size).toBe(1);
    });

    it("finds objects by simple or nested tags in one traversal without duplicate results", () => {
        const scene = new Scene();
        const simpleMatch = new Object3D();
        const nestedMatch = new Object3D();
        const doubleMatch = new Object3D();
        const miss = new Object3D();

        TagUtil.addTag(simpleMatch, "climbable");
        nestedMatch.userData.physics = { climbable: true };
        TagUtil.addTag(doubleMatch, "climbable");
        doubleMatch.userData.physics = { climbable: true };

        scene.add(simpleMatch, nestedMatch, doubleMatch, miss);

        expect(TagUtil.getObjectsByTag(scene, ["climbable", "physics.climbable"])).toEqual([
            simpleMatch,
            nestedMatch,
            doubleMatch,
        ]);
    });

    it("finds only the first object by simple or nested tags", () => {
        const scene = new Scene();
        const simpleMatch = new Object3D();
        const nestedMatch = new Object3D();
        const laterMatch = new Object3D();

        TagUtil.addTag(simpleMatch, "player");
        nestedMatch.userData.physics = { climbable: true };
        TagUtil.addTag(laterMatch, "player");
        scene.add(simpleMatch, nestedMatch, laterMatch);

        expect(TagUtil.getFirstObjectByTag(scene, ["missing", "physics.climbable"])).toBe(nestedMatch);
        expect(TagUtil.getFirstObjectByTag(scene, "player")).toBe(simpleMatch);
        expect(TagUtil.getFirstObjectByTag(scene, "missing")).toBeNull();
    });

    it("includes the root object in tag searches", () => {
        const root = new Object3D();
        const child = new Object3D();
        TagUtil.addTag(root, "player");
        TagUtil.addTag(child, "player");
        root.add(child);

        expect(TagUtil.getObjectsByTag(root, "player")).toEqual([root, child]);
    });

    it("finds tags in deeply nested hierarchies without recursive stack growth", () => {
        const root = new Object3D();
        let cursor = root;
        for (let i = 0; i < 12000; i++) {
            const child = new Object3D();
            cursor.add(child);
            cursor = child;
        }
        TagUtil.addTag(cursor, "deep-match");

        expect(() => TagUtil.getObjectsByTag(root, "deep-match")).not.toThrow();
        expect(TagUtil.getObjectsByTag(root, "deep-match")).toEqual([cursor]);
        expect(() => TagUtil.getFirstObjectByTag(root, "deep-match")).not.toThrow();
        expect(TagUtil.getFirstObjectByTag(root, "deep-match")).toBe(cursor);
    });
});
