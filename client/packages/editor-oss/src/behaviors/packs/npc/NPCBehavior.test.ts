import * as THREE from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import NPCBehavior from "./NPCBehavior";

const createNpc = ({withPlayer = true}: {withPlayer?: boolean} = {}) => {
    const npc = new THREE.Object3D();
    const player = new THREE.Object3D();
    const scene = new THREE.Scene();
    scene.add(npc);
    if (withPlayer) scene.add(player);

    const behavior = new NPCBehavior(npc, "npc", {
        gameObject: {target: npc} as any,
        erth: {} as any,
        attributes: {
            movementType: "standing",
            movementSpeed: 0,
            roamDistance: 10,
            engageDistance: 5,
            idleAnimation: "idle",
            walkAnimation: "walk",
            attackingAnimation: "attack",
        },
    });

    const game = {
        scene,
        player: withPlayer ? player : null,
        physics: {
            setRotation: vi.fn(),
            setLinearVelocity: vi.fn(),
        },
        animationController: {
            playAnimation: vi.fn(),
            stopAnimation: vi.fn(),
        },
        collisionDetector: {
            addListener: vi.fn(),
        },
    };

    behavior.init(game as any);
    behavior.onAdded();

    return {behavior, game, player};
};

describe("NPCBehavior", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("uses squared distance for player movement change checks", () => {
        const {behavior, player} = createNpc();
        const playerPosition = behavior.playerPosition;
        const distanceTo = vi.spyOn(playerPosition, "distanceTo");
        const distanceToSquared = vi.spyOn(playerPosition, "distanceToSquared");

        player.position.set(1, 0, 0);
        behavior.update(1);

        expect(distanceToSquared).toHaveBeenCalled();
        expect(distanceTo).not.toHaveBeenCalled();
    });

    it("does not start one polling interval per NPC while waiting for the player", () => {
        const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

        const {behavior, game, player} = createNpc({withPlayer: false});

        expect(setIntervalSpy).not.toHaveBeenCalled();
        expect(behavior.player).toBeNull();

        game.player = player;
        game.scene.add(player);
        player.position.set(1, 0, 0);

        behavior.update(1);

        expect(behavior.player).toBe(player);
        expect(game.physics.setRotation).toHaveBeenCalledWith(behavior.target.uuid, expect.any(THREE.Quaternion));
    });

    it("switches to a replacement player without restarting timers", () => {
        const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
        const {behavior, game} = createNpc();
        const replacementPlayer = new THREE.Object3D();
        replacementPlayer.position.set(4, 0, 2);
        game.scene.add(replacementPlayer);

        game.player = replacementPlayer;
        behavior.update(1);

        expect(setIntervalSpy).not.toHaveBeenCalled();
        expect(behavior.player).toBe(replacementPlayer);
        expect(behavior.prevPlayerPosition.toArray()).toEqual([4, 0, 2]);
    });
});
