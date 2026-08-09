import type {QuaternionLike, Vector3Like} from "three";

import {BodyUpdate, BodyUpdateBatchEvent, PHYSICS_EVENTS} from "../common/events";
import {IDispatcher, ObjectMotionState} from "../common/types";

export class Dispatcher implements IDispatcher {
    private bodyUpdateBatch: BodyUpdate[] | null = null;

    onReady() {
        postMessage({event: PHYSICS_EVENTS.READY});
    }

    onBodyUpdate(uuid: string, position: Vector3Like, rotation: QuaternionLike, scale: Vector3Like, dt: number, motionState?: ObjectMotionState) {
        const update: BodyUpdate = {
            uuid,
            position: {x: position.x, y: position.y, z: position.z},
            quaternion: {x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w},
            scale: {x: scale.x, y: scale.y, z: scale.z},
            motionState: motionState
                ? {
                    onGround: motionState.onGround,
                    linearVelocity: {
                        x: motionState.linearVelocity.x,
                        y: motionState.linearVelocity.y,
                        z: motionState.linearVelocity.z,
                    },
                    angularVelocity: motionState.angularVelocity
                        ? {
                            x: motionState.angularVelocity.x,
                            y: motionState.angularVelocity.y,
                            z: motionState.angularVelocity.z,
                        }
                        : undefined,
                }
                : undefined,
            dt,
        };

        if (this.bodyUpdateBatch) {
            this.bodyUpdateBatch.push(update);
            return;
        }

        // Updates emitted outside simulate() retain the legacy event shape.
        postMessage({event: PHYSICS_EVENTS.BODY.UPDATE, ...update});
    }

    beginBodyUpdateBatch(): void {
        this.bodyUpdateBatch = [];
    }

    flushBodyUpdateBatch(): void {
        const updates = this.bodyUpdateBatch;
        this.bodyUpdateBatch = null;
        if (!updates || updates.length === 0) {
            return;
        }

        const event: BodyUpdateBatchEvent = {
            event: PHYSICS_EVENTS.BODY.UPDATE_BATCH,
            updates,
        };
        postMessage(event);
    }

    onCollision(uuid: string, listenerId: string) {
        postMessage({
            event: PHYSICS_EVENTS.COLLISION.DETECTED,
            uuid,
            listenerId
        });
    }
}

export default Dispatcher;
