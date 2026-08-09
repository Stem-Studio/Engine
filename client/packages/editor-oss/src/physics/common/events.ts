import type {QuaternionLike, Vector3Like} from "three";

import {CollisionBehavior, CollisionShape, CommonData, ObjectMotionState} from "./types";

export const SIMPLE_EVENTS = {
    ADD: {
        OBJECT: "simple:add:object",
        CHILD: "simple:add:child",
    },
    REMOVE: {
        OBJECT: "simple:rm:object",
        CHILD: "simple:remove:child",
        BEHAVIOR_DATA: "simple:remove:behavior:data",
    },
    UPDATE: {
        OBJECT: "simple:update:object",
    },
    SET: {
        BEHAVIOR_DATA: "simple:set:behavior:data",
        COLLISION_BEHAVIOR: "simple:set:collision:behavior",
        PLAYER: {
            OBJECT: "simple:set:player:object",
            DATA: "simple:set:player:data",
        },
    },
    CHAT: {
        MESSAGE: "simple:chat:message",
    },
    DISCONNECT_CLIENTS: "simple:disconnect:clients",
    HEARTBEAT: "simple:heartbeat",
};

export const SNAPSHOT_EVENTS = {
    REQUEST: "snapshot:request",
    RESPONSE: "snapshot:response",
    SYNC: {
        CHECK_REQUEST: "snapshot:sync:check_request",
        CHECK_RESPONSE: "snapshot:sync:check_response",
    },
    UPDATE: {
        OBJECT: "snapshot:update:object",
        OBJECT_USER_DATA: "snapshot:update:object:user_data",
        SCENE_CHILDREN: "snapshot:update:scene:children",
    },
    ADD: {
        OBJECT: "snapshot:add:object",
    },
    REMOVE: {
        OBJECT: "snapshot:remove:object",
    },
};

export const ASSET_EVENTS = {
    ADD: "asset:add",
    REMOVE: "asset:remove",
    UPDATE: "asset:update",
};

export const BEHAVIOR_EVENTS = {
    REGISTER: {
        BEHAVIOR: "behavior:register:behavior",
        SCRIPT: "behavior:register:script",
    },
    UNREGISTER: {
        BEHAVIOR: "behavior:unregister:behavior",
        SCRIPT: "behavior:unregister:script",
    },
    UPDATE: {
        BEHAVIOR: "behavior:update:behavior",
        SCRIPT: "behavior:update:script",
    },
};

export const LAMBDA_EVENTS = {
    REGISTER: "lambda:register",
    UNREGISTER: "lambda:unregister",
    UPDATE: "lambda:update",
};

export const PHYSICS_EVENTS = {
    TERMINATE: "physics:terminate",
    READY: "physics:ready",
    START: "physics:start",
    SIMULATE: "physics:simulate",
    SIMULATE_DONE: "physics:simulate_done",
    UPDATE: "physics:update",
    PAUSE: "physics:pause",
    RESUME: "physics:resume",
    PING: "physics:ping",
    PONG: "physics:pong",
    DEBUG: {
        ENABLE: "physics:debug:enable",
        FRAME: "physics:debug:frame",
    },

    ADD: {
        BODY: "physics:add:body",
        BOX: "physics:add:box",
        VEHICLE: "physics:add:vehicle",
        PLAYER: "physics:add:player",
        SPHERE: "physics:add:sphere",
        TERRAIN: "physics:add:terrain",
        CONVEXHULL: "physics:add:convexhull",
        CONCAVEHULL: "physics:add:concavehull",
        CAPSULE: "physics:add:capsule",
        SHAPE: "physics:add:shape",
        CONSTRAINT: {
            FIXED: "physics:add:constraint:fixed",
            P2P: "physics:add:constraint:p2p",
            HINGE: "physics:add:constraint:hinge",
        },
    } as const,

    REMOVE: {
        RIGID_BODY: "physics:remove:rigid_body",
        SHAPE: "physics:remove:shape",
        CONSTRAINT: "physics:remove:constraint",
    } as const,

    APPLY: {
        CENTRAL_IMPULSE: "physics:apply:central_impulse",
        IMPULSE_TO_RIGIDBODY: "physics:apply:impulse_to_rigidbody",
        KICK_NEARBY_OBJECTS: "physics:apply:kick_nearby_objects",
    } as const,

    SET: {
        SOLVER_ITERATIONS: "physics:set:solver_iterations",
        ORIGIN: "physics:set:origin",
        ROTATION: "physics:set:rotation",
        SCALE: "physics:set:scale",
        SHAPE: "physics:set:shape",
        ANGULAR_VELOCITY: "physics:set:angular_velocity",
        LINEAR_VELOCITY: "physics:set:linear_velocity",
        COLLISION_BEHAVIOR: "physics:set:collision_behavior",
        LINEAR_DAMPING: "physics:set:linear_damping",
        ANGULAR_DAMPING: "physics:set:angular_damping",
    } as const,

    BODY: {
        UPDATE: "physics:body:update",
        UPDATE_BATCH: "physics:body:update_batch",
    } as const,

    PLAYER: {
        ADD: "physics:player:add",
        READY: "physics:player:ready",
        REMOVE: "physics:player:remove",
        MOVE: "physics:player:move",
        APPLY_IMPULSE: "physics:player:apply_impulse",
        SET_GRAVITY: "physics:player:set_gravity",
        SET_POSITION: "physics:player:set_position",
    } as const,

    VEHICLE: {
        ADD: "physics:vehicle:add",
        REMOVE: "physics:vehicle:remove",
        MOVE: "physics:vehicle:move",
    } as const,

    COLLISION: {
        DETECTED: "physics:collision:detected",
        DETECT: "physics:collision:detect",
        ADD: {
            OBJECT: "physics:collision:add:object",
        } as const,
        REMOVE: {
            OBJECT: "physics:collision:remove:object",
        } as const,
    } as const,

    ANIMATION: {
        SET: "physics:animation:set",
    } as const,

    BATCH: {
        UPDATE: "physics:batch:update",
    } as const,
} as const;

export interface PhysicsDebugFrameEvent {
    event: typeof PHYSICS_EVENTS.DEBUG.FRAME;
    vertices: Float32Array;
    colors: Float32Array;
    drawCount: number;
}

export interface BatchObjectUpdate {
    position: Vector3Like | null;
    quaternion: QuaternionLike | null;
    scale: Vector3Like | null;
}

export interface BatchUpdateEvent {
    event: typeof PHYSICS_EVENTS.BATCH.UPDATE;
    objects: Record<string, BatchObjectUpdate>;
}

export interface BodyUpdate {
    uuid: string;
    position: Vector3Like;
    quaternion: QuaternionLike;
    scale: Vector3Like;
    motionState?: ObjectMotionState;
    dt: number;
}

export interface BodyUpdateBatchEvent {
    event: typeof PHYSICS_EVENTS.BODY.UPDATE_BATCH;
    updates: BodyUpdate[];
}

export interface AddShapeEvent {
    uuid: string;
    shape: CollisionShape;
}

export interface RemoveShapeEvent {
    uuid: string;
}

export interface AddBodyEvent extends CommonData {
    shapeUuid: string;
}

export interface SetCollisionBehaviorEvent {
    uuid: string;
    behavior: CollisionBehavior;
}
