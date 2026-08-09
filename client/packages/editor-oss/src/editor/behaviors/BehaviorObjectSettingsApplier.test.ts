import { BoxGeometry, BufferGeometry, Group, Mesh, MeshBasicMaterial, SphereGeometry } from "three";
import { describe, expect, it, vi } from "vitest";

import BehaviorObjectSettingsApplier from "./BehaviorObjectSettingsApplier";
import { BodyShapeType } from "../../physics/common/types";

describe("BehaviorObjectSettingsApplier", () => {
    it("uses sphere collider for sphere primitive when behavior requests capsule", () => {
        const object = new Mesh(new SphereGeometry(1), new MeshBasicMaterial());

        BehaviorObjectSettingsApplier.applyObjectSettings(object, {
            physics: { enabled: true, shape: "capsule" },
        });

        expect(object.userData.physics.shape).toBe(BodyShapeType.SPHERE);
    });

    it("uses box collider for box primitive when behavior requests capsule", () => {
        const object = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());

        BehaviorObjectSettingsApplier.applyObjectSettings(object, {
            physics: { enabled: true, shape: "capsule" },
        });

        expect(object.userData.physics.shape).toBe(BodyShapeType.BOX);
    });

    it("keeps capsule collider for non-primitive geometry", () => {
        const object = new Mesh(new BufferGeometry(), new MeshBasicMaterial());

        BehaviorObjectSettingsApplier.applyObjectSettings(object, {
            physics: { enabled: true, shape: "capsule" },
        });

        expect(object.userData.physics.shape).toBe(BodyShapeType.CAPSULE);
    });

    it("detects primitive geometry on child mesh", () => {
        const group = new Group();
        const child = new Mesh(new SphereGeometry(1), new MeshBasicMaterial());
        group.add(child);

        BehaviorObjectSettingsApplier.applyObjectSettings(group, {
            physics: { enabled: true, shape: "capsule" },
        });

        expect(group.userData.physics.shape).toBe(BodyShapeType.SPHERE);
    });

    it("detects primitive geometry in deep object trees without recursive traversal", () => {
        const group = new Group();
        let cursor = group;
        for (let i = 0; i < 12_000; i++) {
            const child = new Group();
            cursor.add(child);
            cursor = child;
        }
        cursor.add(new Mesh(new SphereGeometry(1), new MeshBasicMaterial()));
        const traverseSpy = vi.spyOn(group, "traverse");

        BehaviorObjectSettingsApplier.applyObjectSettings(group, {
            physics: { enabled: true, shape: "capsule" },
        });

        expect(traverseSpy).not.toHaveBeenCalled();
        expect(group.userData.physics.shape).toBe(BodyShapeType.SPHERE);
    });

    it("seeds default physics on an object that has none", () => {
        const object = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());

        BehaviorObjectSettingsApplier.applyObjectSettings(object, {
            physics: { enabled: true, shape: "capsule" },
        });

        // No prior physics → the behavior default applies, including enabling it.
        expect(object.userData.physics.enabled).toBe(true);
    });

    it("does NOT override an explicit physics.enabled:false with a behavior default", () => {
        // Repro of the pirate-ship freeze: the object's physics was deliberately
        // disabled (e.g. by an import's `physics set ... enabled:false`). Attaching
        // a behavior whose default physics is enabled (the character controller)
        // must NOT re-enable it — a re-enabled dynamic body would hijack the
        // object's transform and override the game's own controller.
        const object = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
        object.userData.physics = { enabled: false };

        BehaviorObjectSettingsApplier.applyObjectSettings(object, {
            physics: { enabled: true, shape: "capsule" },
        });

        expect(object.userData.physics.enabled).toBe(false);
    });
});
