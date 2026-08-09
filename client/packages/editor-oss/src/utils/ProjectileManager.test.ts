import {BoxGeometry, Mesh, MeshBasicMaterial, Scene, Vector3} from "three";
import {describe, expect, it, vi} from "vitest";

import {createProjectileManager} from "./ProjectileManager";

describe("ProjectileManager", () => {
    it("moves projectiles, reports hits, and removes the projectile after impact", () => {
        const scene = new Scene();
        const target = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
        target.position.set(0, 0, -1);
        scene.add(target);
        scene.updateMatrixWorld(true);

        const onHit = vi.fn();
        const manager = createProjectileManager(scene);
        manager.registerDefinition({
            id: "bolt",
            speed: 2,
            lifetime: 5,
            onHit,
        });

        manager.launch({
            definitionId: "bolt",
            origin: new Vector3(0, 0, 0),
            direction: new Vector3(0, 0, -1),
        });

        expect(manager.getActiveCount()).toBe(1);

        manager.update(1);

        expect(onHit).toHaveBeenCalledOnce();
        expect(onHit).toHaveBeenCalledWith(
            expect.objectContaining({
                object: target,
                projectileDefinition: expect.objectContaining({id: "bolt"}),
                damage: 1,
            }),
        );
        expect(manager.getActiveCount()).toBe(0);
    });

    it("reuses projectile state safely after lifetime expiry", () => {
        const scene = new Scene();
        const manager = createProjectileManager(scene);
        manager.registerDefinition({
            id: "short",
            speed: 1,
            lifetime: 0.1,
        });

        manager.launch({
            definitionId: "short",
            origin: new Vector3(1, 0, 0),
            direction: new Vector3(1, 0, 0),
        });
        manager.update(0.2);
        expect(manager.getActiveCount()).toBe(0);

        manager.launch({
            definitionId: "short",
            origin: new Vector3(2, 0, 0),
            direction: new Vector3(0, 0, 1),
        });

        expect(manager.getActiveCount()).toBe(1);

        manager.dispose();
        expect(manager.getActiveCount()).toBe(0);
    });

    it("excludes active projectile meshes from collision raycast targets", () => {
        const scene = new Scene();
        const manager = createProjectileManager(scene);
        manager.registerDefinition({
            id: "bolt",
            speed: 1,
            lifetime: 5,
        });

        manager.launch({
            definitionId: "bolt",
            origin: new Vector3(0, 0, 0),
            direction: new Vector3(1, 0, 0),
        });

        const projectileMesh = scene.children[0] as Mesh;
        const raycast = vi.spyOn(projectileMesh, "raycast");

        manager.update(0.1);

        expect(raycast).not.toHaveBeenCalled();
        expect(manager.getActiveCount()).toBe(1);

        manager.dispose();
    });
});
