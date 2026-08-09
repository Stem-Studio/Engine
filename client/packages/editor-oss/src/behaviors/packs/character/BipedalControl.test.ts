import {Object3D, Scene, Vector3} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import BipedalControl, {MOVEMENT_STATES} from "./BipedalControl";
import MotionStateHelper from "../../../physics/MotionStateHelper";

afterEach(() => {
    vi.restoreAllMocks();
});

describe("BipedalControl", () => {
    it("reuses the physics movement velocity payload between updates", () => {
        const control = Object.create(BipedalControl.prototype) as any;
        const movePlayerObject = vi.fn();

        control.character = new Object3D();
        control.character.uuid = "player-1";
        control.characterOptions = {
            walkSpeed: 6,
            runSpeed: 9,
            groundAcceleration: 1,
            groundDeceleration: 1,
            airAcceleration: 1,
            airDeceleration: 1,
        };
        control.movementState = {
            forward: MOVEMENT_STATES.FORWARD,
            lateral: MOVEMENT_STATES.NONE,
            mode: MOVEMENT_STATES.WALK,
            action: MOVEMENT_STATES.NONE,
        };
        control.inputMoveDirection = new Vector3();
        control.movePlayerVelocity = new Vector3();
        control.velocity = new Vector3();
        control.moveAngle = 0;
        control.isGrounded = true;
        control.physics = {movePlayerObject};

        control.updateMotion(false);
        const firstVelocityPayload = movePlayerObject.mock.calls[0]![1];

        control.updateMotion(true);

        expect(movePlayerObject).toHaveBeenCalledTimes(2);
        expect(movePlayerObject.mock.calls[1]![1]).toBe(firstVelocityPayload);
        expect(firstVelocityPayload).toBe(control.movePlayerVelocity);
        expect(firstVelocityPayload.y).toBe(0);
        expect(movePlayerObject.mock.calls[1]).toEqual(["player-1", firstVelocityPayload, true]);
    });

    it("skips movement direction normalization and sqrt stop checks while idle", () => {
        const control = Object.create(BipedalControl.prototype) as any;
        const movePlayerObject = vi.fn();

        control.character = new Object3D();
        control.character.uuid = "player-1";
        control.characterOptions = {
            walkSpeed: 6,
            runSpeed: 9,
            groundAcceleration: 1,
            groundDeceleration: 1,
            airAcceleration: 1,
            airDeceleration: 1,
        };
        control.movementState = {
            forward: MOVEMENT_STATES.NONE,
            lateral: MOVEMENT_STATES.NONE,
            mode: MOVEMENT_STATES.NONE,
            action: MOVEMENT_STATES.NONE,
        };
        control.inputMoveDirection = new Vector3();
        control.movePlayerVelocity = new Vector3();
        control.velocity = new Vector3(0.000001, 0, 0);
        control.moveAngle = 0;
        control.isGrounded = true;
        control.physics = {movePlayerObject};

        const normalize = vi.spyOn(control.inputMoveDirection, "normalize");
        const length = vi.spyOn(control.velocity, "length");
        const lengthSq = vi.spyOn(control.velocity, "lengthSq");

        control.updateMotion(false);

        expect(normalize).not.toHaveBeenCalled();
        expect(length).not.toHaveBeenCalled();
        expect(lengthSq).toHaveBeenCalledOnce();
        expect(control.velocity.toArray()).toEqual([0, 0, 0]);
        expect(movePlayerObject).toHaveBeenCalledWith("player-1", control.movePlayerVelocity, false);
    });

    it("caches movement tuning coefficients until character options change", () => {
        const control = Object.create(BipedalControl.prototype) as any;
        const movePlayerObject = vi.fn();

        control.character = new Object3D();
        control.character.uuid = "player-1";
        control.characterOptions = {
            walkSpeed: 6,
            runSpeed: 9,
            groundAcceleration: 0.5,
            groundDeceleration: 0.25,
            airAcceleration: 0.2,
            airDeceleration: 0.1,
        };
        control.movementState = {
            forward: MOVEMENT_STATES.NONE,
            lateral: MOVEMENT_STATES.NONE,
            mode: MOVEMENT_STATES.NONE,
            action: MOVEMENT_STATES.NONE,
        };
        control.inputMoveDirection = new Vector3();
        control.movePlayerVelocity = new Vector3();
        control.velocity = new Vector3();
        control.moveAngle = 0;
        control.isGrounded = true;
        control.physics = {movePlayerObject};
        const linearToExp = vi.spyOn(control, "linearToExp");

        control.updateMotion(false);
        control.updateMotion(false);
        control.characterOptions.airDeceleration = 0.4;
        control.updateMotion(false);

        expect(linearToExp).toHaveBeenCalledTimes(5);
        expect(control.groundAccelerationCoefficient).toBe(0.25);
        expect(control.groundDecelerationCoefficient).toBe(0.9375);
        expect(control.airAccelerationCoefficient).toBeCloseTo(0.04);
        expect(control.airDecelerationCoefficient).toBe(0.84);
    });

    it("reuses the frame motion state when classifying airborne movement", () => {
        const control = Object.create(BipedalControl.prototype) as any;

        control.character = new Object3D();
        control.character.userData.motionState = {
            onGround: false,
            linearVelocity: {x: 0, y: -1, z: 0},
        };
        control.characterOptions = {
            jumpHeight: 1,
        };
        control.inputState = {
            lateral: 0,
            forward: 0,
            run: false,
            jump: false,
            use: false,
            drop: false,
            pull: false,
            primary: false,
        };
        control.movementState = {
            forward: MOVEMENT_STATES.NONE,
            lateral: MOVEMENT_STATES.NONE,
            mode: MOVEMENT_STATES.NONE,
            action: MOVEMENT_STATES.NONE,
        };
        control.isGrounded = true;
        control.wasGrounded = false;
        control.climbingHelper = null;

        const getMotionState = vi.spyOn(MotionStateHelper, "getMotionState");

        control.updateGroundedState();
        control.updateMovementState();

        expect(getMotionState).toHaveBeenCalledTimes(1);
        expect(control.movementState.action).toBe(MOVEMENT_STATES.FALL);
    });

    it("finds spawn points in deep scenes without recursive traversal", () => {
        const control = Object.create(BipedalControl.prototype) as any;
        const scene = new Scene();
        let cursor: Object3D = scene;
        for (let i = 0; i < 12_000; i++) {
            const child = new Object3D();
            cursor.add(child);
            cursor = child;
        }
        const spawnPoint = new Object3D();
        spawnPoint.userData.isSpawnPoint = true;
        cursor.add(spawnPoint);
        control.scene = scene;
        const traverse = vi.spyOn(scene, "traverse");

        const spawnPoints = control.getSpawnPointObjects();

        expect(spawnPoints).toEqual([spawnPoint]);
        expect(traverse).not.toHaveBeenCalled();
    });
});
