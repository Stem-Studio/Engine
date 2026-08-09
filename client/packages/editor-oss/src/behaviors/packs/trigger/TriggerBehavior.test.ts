import {BoxGeometry, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, Scene} from "three";
import {describe, expect, it, vi} from "vitest";

import {TRIGGER_ACTIVATION_TYPES} from "@stem/editor-oss/types/editor";
import TriggerBehavior from "./TriggerBehavior";

function createTrigger(target: Object3D, attributes: Record<string, any> = {}) {
    return new TriggerBehavior(target, "trigger", {
        attributes,
        gameObject: {} as any,
        erth: {
            store: {
                get: vi.fn(),
            },
        } as any,
    });
}

function createBox(name: string, z: number): Mesh {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    mesh.name = name;
    mesh.position.set(0, 0, z);
    return mesh;
}

describe("TriggerBehavior", () => {
    it("skips range detector updates when no press interaction condition is configured", () => {
        const scene = new Scene();
        const player = new Object3D();
        const source = new Object3D();
        scene.add(player, source);
        const behavior = createTrigger(source, {
            if_condition: [{conditionType: TRIGGER_ACTIVATION_TYPES.TIMER_ELAPSED, timerSeconds: 1}],
        }) as any;
        behavior.init({scene, player} as any);
        behavior.onAdded();
        const rangeUpdate = vi.spyOn(behavior.rangeDetector, "update");
        vi.spyOn(behavior, "isPlayerTouching").mockReturnValue(false);
        vi.spyOn(behavior, "checkConditions").mockReturnValue("none");

        behavior.update(0.016);

        expect(rangeUpdate).not.toHaveBeenCalled();
    });

    it("updates the range detector for press interaction triggers", () => {
        const scene = new Scene();
        const player = new Object3D();
        const source = new Object3D();
        scene.add(player, source);
        const behavior = createTrigger(source, {
            if_condition: [{conditionType: TRIGGER_ACTIVATION_TYPES.PRESS_E, interactionText: "Open"}],
        }) as any;
        behavior.init({scene, player} as any);
        behavior.onAdded();
        const rangeUpdate = vi.spyOn(behavior.rangeDetector, "update");
        vi.spyOn(behavior, "isPlayerTouching").mockReturnValue(false);
        vi.spyOn(behavior, "checkConditions").mockReturnValue("none");

        behavior.update(0.016);

        expect(rangeUpdate).toHaveBeenCalledOnce();
    });

    it("short-circuits non-stateful conditions once an and-chain has failed", () => {
        const source = new Object3D();
        const behavior = createTrigger(source, {
            if_operator: "and",
        }) as any;
        behavior.currentPlayerInside = false;
        const hasLineOfSight = vi.spyOn(behavior, "hasLineOfSight");

        const result = behavior.checkConditions([
            {conditionType: TRIGGER_ACTIVATION_TYPES.PLAYER_TOUCHES},
            {conditionType: TRIGGER_ACTIVATION_TYPES.LINE_OF_SIGHT, lineOfSightObjectUUID: "expensive"},
        ]);

        expect(result).toBe("none");
        expect(hasLineOfSight).not.toHaveBeenCalled();
    });

    it("keeps stateful condition side effects after a short-circuit decision", () => {
        const source = new Object3D();
        const behavior = createTrigger(source, {
            if_operator: "or",
        }) as any;
        behavior.elapsedTimeSec = 10;
        const random = vi.spyOn(Math, "random").mockReturnValue(0.25);

        const result = behavior.checkConditions([
            {conditionType: TRIGGER_ACTIVATION_TYPES.TIMER_ELAPSED, timerSeconds: 1},
            {conditionType: TRIGGER_ACTIVATION_TYPES.RANDOM_CHANCE, chancePercent: 50},
        ]);

        expect(result).toBe("all");
        expect(random).toHaveBeenCalledTimes(1);
        random.mockRestore();
    });

    it("compares distance conditions without changing threshold semantics", () => {
        const scene = new Scene();
        const source = new Object3D();
        const target = new Object3D();
        target.position.set(3, 4, 0);
        scene.add(source, target);
        scene.updateMatrixWorld(true);

        const behavior = createTrigger(source) as any;
        behavior.game = {
            scene,
            getObjectByUUID: (uuid: string) => scene.getObjectByProperty("uuid", uuid) ?? null,
        };

        expect(behavior.isDistanceConditionMet({
            conditionType: TRIGGER_ACTIVATION_TYPES.DISTANCE_COMPARE,
            distanceObjectUUID: target.uuid,
            distanceOperator: "lt",
            distanceValue: 6,
        })).toBe(true);
        expect(behavior.isDistanceConditionMet({
            conditionType: TRIGGER_ACTIVATION_TYPES.DISTANCE_COMPARE,
            distanceObjectUUID: target.uuid,
            distanceOperator: "gt",
            distanceValue: 6,
        })).toBe(false);
        expect(behavior.isDistanceConditionMet({
            conditionType: TRIGGER_ACTIVATION_TYPES.DISTANCE_COMPARE,
            distanceObjectUUID: target.uuid,
            distanceOperator: "gt",
            distanceValue: -1,
        })).toBe(true);
        expect(behavior.isDistanceConditionMet({
            conditionType: TRIGGER_ACTIVATION_TYPES.DISTANCE_COMPARE,
            distanceObjectUUID: target.uuid,
            distanceOperator: "lt",
            distanceValue: -1,
        })).toBe(false);
    });

    it("checks tag metadata without requiring pre-normalized arrays", () => {
        const source = new Object3D();
        const behavior = createTrigger(source) as any;

        source.userData.tags = ["interactive", 7];
        expect(behavior.isMetadataConditionMet({
            conditionType: TRIGGER_ACTIVATION_TYPES.HAS_TAG_TEAM_FACTION,
            metadataScope: "self",
            metadataKey: "tag",
            metadataValue: "7",
        })).toBe(true);

        source.userData.tags = "door, locked, interactable";
        expect(behavior.isMetadataConditionMet({
            conditionType: TRIGGER_ACTIVATION_TYPES.HAS_TAG_TEAM_FACTION,
            metadataScope: "self",
            metadataKey: "tag",
            metadataValue: "locked",
        })).toBe(true);
        expect(behavior.isMetadataConditionMet({
            conditionType: TRIGGER_ACTIVATION_TYPES.HAS_TAG_TEAM_FACTION,
            metadataScope: "self",
            metadataKey: "tag",
            metadataValue: "missing",
        })).toBe(false);
    });

    it("uses the current line-of-sight distance instead of a stale raycaster far value", () => {
        const scene = new Scene();
        const source = new Object3D();
        const blocker = createBox("blocker", -5);
        const destination = createBox("destination", -10);
        scene.add(source, blocker, destination);
        scene.updateMatrixWorld(true);

        const behavior = createTrigger(source) as any;
        behavior.game = {
            scene,
            getObjectByUUID: (uuid: string) => scene.getObjectByProperty("uuid", uuid) ?? null,
        };
        behavior.raycaster.far = 1;

        expect(behavior.hasLineOfSight({lineOfSightObjectUUID: destination.uuid})).toBe(false);
    });

    it("treats child mesh hits as interaction hits on their parent target", () => {
        const scene = new Scene();
        scene.userData.pressE = true;

        const source = new Object3D();
        const target = new Object3D();
        const childMesh = createBox("child", 0);
        target.position.set(0, 0, -5);
        target.add(childMesh);
        scene.add(source, target);

        const camera = new PerspectiveCamera(60, 1, 0.1, 100);
        camera.position.set(0, 0, 0);
        camera.lookAt(0, 0, -1);
        scene.add(camera);
        scene.updateMatrixWorld(true);

        const behavior = createTrigger(source) as any;
        behavior.game = {
            camera,
            scene,
            getObjectByUUID: (uuid: string) => scene.getObjectByProperty("uuid", uuid) ?? null,
        };

        expect(behavior.isOnInteractConditionMet({
            interactInputKey: "e",
            interactMaxDistance: 10,
            interactTargetUUID: target.uuid,
        })).toBe(true);
    });
});
