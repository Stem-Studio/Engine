import * as THREE from "three";
import {describe, expect, it, vi} from "vitest";

import EnemyBehavior from "./EnemyBehavior";

const createEnemy = (attributes: Record<string, unknown> = {}) => {
    const enemy = new THREE.Object3D();
    const player = new THREE.Object3D();
    const scene = new THREE.Scene();
    scene.add(enemy, player);

    const behavior = new EnemyBehavior(enemy, "enemy", {
        gameObject: {target: enemy} as any,
        erth: {} as any,
        attributes: {
            movementSpeed: 0,
            rotationSpeed: 1,
            fightDistance: 1,
            roamDistance: 10,
            directionDuration: 1,
            attackDistance: 25,
            idleAnimation: "idle",
            runAnimation: "run",
            walkAnimation: "walk",
            attackAnimation: "attack",
            ...attributes,
        },
    });

    const game = {
        scene,
        player,
        multiplayerState: {
            isHost: vi.fn(() => true),
            setBehaviorData: vi.fn(),
        },
        physics: {
            setRotation: vi.fn(),
            setLinearVelocity: vi.fn(),
        },
        engine: {
            animationControl: {
                playAnimation: vi.fn(),
                stopAnimation: vi.fn(),
            },
        },
    };

    behavior.init(game as any);

    return {behavior, enemy, player, game};
};

const getState = (behavior: EnemyBehavior): string => (behavior as any).state;
const setState = (behavior: EnemyBehavior, state: string): void => {
    (behavior as any).state = state;
    (behavior as any).stateTimer = 0;
};

describe("EnemyBehavior", () => {
    it("uses engageDistance to decide when to pursue", () => {
        const {behavior, player} = createEnemy({engageDistance: 5, idleRetreatDelay: 30});
        player.position.set(8, 0, 0);

        behavior.update(1);
        expect(getState(behavior)).toBe("standing");

        player.position.set(4, 0, 0);
        behavior.update(1);
        expect(getState(behavior)).toBe("approaching");
    });

    it("uses strikeDistance to decide when to attack", () => {
        const {behavior, player} = createEnemy({engageDistance: 10, strikeDistance: 1});
        setState(behavior, "approaching");
        player.position.set(2, 0, 0);

        behavior.update(1);
        expect(getState(behavior)).toBe("approaching");

        player.position.set(0.5, 0, 0);
        behavior.update(1);
        expect(getState(behavior)).toBe("attacking");
    });

    it("uses authored timers for idle and retreat state transitions", () => {
        const {behavior, player} = createEnemy({
            engageDistance: 5,
            idleRetreatDelay: 0.25,
            retreatDuration: 0.5,
        });
        player.position.set(20, 0, 0);

        behavior.update(0.3);
        expect(getState(behavior)).toBe("retreating");

        behavior.update(0.6);
        expect(getState(behavior)).toBe("standing");
    });

    it("uses squared distance for player movement change checks", () => {
        const {behavior, player} = createEnemy({idleRetreatDelay: 30});
        const playerPosition = (behavior as any).playerPosition as THREE.Vector3;
        const distanceTo = vi.spyOn(playerPosition, "distanceTo");
        const distanceToSquared = vi.spyOn(playerPosition, "distanceToSquared");

        player.position.set(1, 0, 0);
        behavior.update(1);

        expect(distanceToSquared).toHaveBeenCalled();
        expect(distanceTo).not.toHaveBeenCalled();
    });

    it("uses squared target distances for per-frame enemy range thresholds", () => {
        const {behavior, enemy, player} = createEnemy({
            engageDistance: 5,
            strikeDistance: 1,
            idleRetreatDelay: 30,
            roamDistance: 10,
        });
        const distanceTo = vi.spyOn(enemy.position, "distanceTo");
        const distanceToSquared = vi.spyOn(enemy.position, "distanceToSquared");

        player.position.set(4, 0, 0);
        behavior.update(1);

        expect(getState(behavior)).toBe("approaching");
        expect(distanceToSquared).toHaveBeenCalledWith(expect.any(THREE.Vector3));
        expect(distanceTo).not.toHaveBeenCalled();
    });

    it("syncs transform state without JSON.stringify", () => {
        const stringifySpy = vi.spyOn(JSON, "stringify");
        const {behavior, enemy, game} = createEnemy();
        enemy.position.set(1, 2, 3);
        enemy.rotation.set(0.1, 0.2, 0.3);

        behavior.syncMultiplayerState();

        expect(stringifySpy).not.toHaveBeenCalled();
        expect(game.multiplayerState.setBehaviorData).toHaveBeenCalledWith(enemy, "enemy", "position", '{"x":1,"y":2,"z":3}');
        expect(game.multiplayerState.setBehaviorData).toHaveBeenCalledWith(enemy, "enemy", "rotation", '{"x":0.1,"y":0.2,"z":0.3}');
    });
});
