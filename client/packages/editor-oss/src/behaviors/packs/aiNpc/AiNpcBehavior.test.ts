import {BoxGeometry, Mesh, MeshBasicMaterial, Object3D, Scene} from "three";
import {describe, expect, it, vi} from "vitest";

import AiNpcBehavior from "./AiNpcBehavior";

function createBehavior(target: Object3D, attributes: Record<string, any> = {}) {
    return new AiNpcBehavior(target, "ai-npc", {
        attributes,
        gameObject: {} as any,
        erth: {
            store: {
                get: vi.fn(),
            },
        } as any,
    });
}

describe("AiNpcBehavior", () => {
    it("reports nearby AI-visible objects in world space and skips NPC descendants", () => {
        const scene = new Scene();
        const npc = new Object3D();
        npc.name = "npc";
        npc.position.set(0, 0, 0);

        const npcChild = new Object3D();
        npcChild.name = "npc child";
        npcChild.userData.visibleByAI = true;
        npcChild.position.set(1, 0, 0);
        npc.add(npcChild);

        const parent = new Object3D();
        parent.position.set(10, 0, 0);

        const object = new Object3D();
        object.name = "crate";
        object.userData.visibleByAI = true;
        object.position.set(1, 0, 0);
        parent.add(object);

        scene.add(npc, parent);
        scene.updateMatrixWorld(true);

        const behavior = createBehavior(npc, {object_interaction_range: 12}) as any;
        behavior.gameManager = {scene};
        behavior.getSurroundedObjects();

        expect(behavior.gameContext.surroundedObjects).toHaveLength(1);
        expect(behavior.gameContext.surroundedObjects[0]).toEqual(
            expect.objectContaining({
                id: object.uuid,
                name: "crate",
                distance: 11,
                position: {x: 11, y: 0, z: 0},
            }),
        );
    });

    it("reuses and clears surrounded object results between context refreshes", () => {
        const scene = new Scene();
        const npc = new Object3D();
        const object = new Object3D();
        object.name = "crate";
        object.userData.visibleByAI = true;
        object.position.set(1, 0, 0);

        scene.add(npc, object);
        scene.updateMatrixWorld(true);

        const behavior = createBehavior(npc, {object_interaction_range: 5}) as any;
        behavior.gameManager = {scene};

        behavior.getSurroundedObjects();
        const firstResults = behavior.gameContext.surroundedObjects;
        expect(firstResults).toHaveLength(1);

        object.position.set(10, 0, 0);
        scene.updateMatrixWorld(true);

        behavior.getSurroundedObjects();
        expect(behavior.gameContext.surroundedObjects).toBe(firstResults);
        expect(behavior.gameContext.surroundedObjects).toHaveLength(0);

        behavior.gameManager = null;
        behavior.getSurroundedObjects();
        expect(behavior.gameContext.surroundedObjects).toBe(firstResults);
        expect(behavior.gameContext.surroundedObjects).toHaveLength(0);
    });

    it("uses squared distance for wandering roam-radius checks", () => {
        const npc = new Object3D();
        npc.position.set(4, 0, 0);
        const behavior = createBehavior(npc, {
            object_interaction_range: 4,
            walkAnimation: "walk",
            walkSpeed: 1,
        }) as any;
        behavior.physics = {
            setRotation: vi.fn(),
            setLinearVelocity: vi.fn(),
        };
        behavior.originalPosition.set(0, 0, 0);
        behavior.wanderTimer = 1;

        const distanceTo = vi.spyOn(npc.position, "distanceTo");
        const distanceToSquared = vi.spyOn(npc.position, "distanceToSquared");

        behavior.processWandering(0.016);

        expect(distanceToSquared).toHaveBeenCalledWith(behavior.originalPosition);
        expect(distanceTo).not.toHaveBeenCalled();
    });

    it("uses squared distance for movement target reach checks", () => {
        const npc = new Mesh(new BoxGeometry(1, 2, 1), new MeshBasicMaterial());
        const behavior = createBehavior(npc, {
            walkAnimation: "walk",
            walkSpeed: 1,
        }) as any;
        behavior.physics = {
            setRotation: vi.fn(),
            setLinearVelocity: vi.fn(),
        };
        behavior.targetPosition.set(2, 0, 0);
        behavior.hasTargetPosition = true;

        const currentPosition = behavior.scratchPosition;
        const distanceTo = vi.spyOn(currentPosition, "distanceTo");
        const distanceToSquared = vi.spyOn(currentPosition, "distanceToSquared");

        const reached = behavior.updateMovement(0.016);

        expect(reached).toBe(false);
        expect(distanceToSquared).toHaveBeenCalledWith(behavior.scratchPosition2);
        expect(distanceTo).not.toHaveBeenCalled();
    });

    it("uses squared distance for go-to-position player safety checks", () => {
        const npc = new Object3D();
        const player = new Object3D();
        const behavior = createBehavior(npc, {
            walkAnimation: "walk",
        }) as any;
        behavior.gameManager = {player};

        const distanceTo = vi.spyOn(player.position, "distanceTo");
        const distanceToSquared = vi.spyOn(player.position, "distanceToSquared");

        behavior.setupGoToPosition({x: 0, y: 0, z: 0});

        expect(distanceToSquared).toHaveBeenCalledWith(behavior.scratchPosition);
        expect(distanceTo).not.toHaveBeenCalled();
        expect(behavior.targetPosition.toArray()).toEqual([0, 0, 1]);
    });
});
