/**
 * Dedicated Web Worker for FusedPhysicsLambda.
 *
 * Receives SoA typed-array buffers (transferred), runs the physics kernel,
 * and transfers the results (updated velocities + position deltas) back.
 */

import {runPhysicsKernel} from "@stem/editor-oss/lambdas/packs/fusedPhysics/FusedPhysicsKernel";

export interface PhysicsWorkerMessage {
    type: "run";
    count: number;
    deltaTime: number;
    gravity: number;
    // Transferred ArrayBuffers
    vx: ArrayBuffer;
    vy: ArrayBuffer;
    vz: ArrayBuffer;
    avx: ArrayBuffer;
    avy: ArrayBuffer;
    avz: ArrayBuffer;
    drag: ArrayBuffer;
    angularDrag: ArrayBuffer;
    gravityScale: ArrayBuffer;
    damping: ArrayBuffer;
    maxSpeed: ArrayBuffer;
    useGravity: ArrayBuffer;
    isKinematic: ArrayBuffer;
    freezePositionX: ArrayBuffer;
    freezePositionY: ArrayBuffer;
    freezePositionZ: ArrayBuffer;
    freezeRotationX: ArrayBuffer;
    freezeRotationY: ArrayBuffer;
    freezeRotationZ: ArrayBuffer;
    visibilityMask: ArrayBuffer | null;
}

export interface PhysicsWorkerResult {
    type: "result";
    vx: ArrayBuffer;
    vy: ArrayBuffer;
    vz: ArrayBuffer;
    avx: ArrayBuffer;
    avy: ArrayBuffer;
    avz: ArrayBuffer;
    dpx: ArrayBuffer;
    dpy: ArrayBuffer;
    dpz: ArrayBuffer;
    drx: ArrayBuffer;
    dry: ArrayBuffer;
    drz: ArrayBuffer;
}

self.onmessage = (e: MessageEvent<PhysicsWorkerMessage>) => {
    const msg = e.data;
    if (msg.type !== "run") return;

    const {count, deltaTime, gravity} = msg;

    const result = runPhysicsKernel({
        count,
        deltaTime,
        gravity,
        vx: new Float32Array(msg.vx),
        vy: new Float32Array(msg.vy),
        vz: new Float32Array(msg.vz),
        avx: new Float32Array(msg.avx),
        avy: new Float32Array(msg.avy),
        avz: new Float32Array(msg.avz),
        drag: new Float32Array(msg.drag),
        angularDrag: new Float32Array(msg.angularDrag),
        gravityScale: new Float32Array(msg.gravityScale),
        damping: new Float32Array(msg.damping),
        maxSpeed: new Float32Array(msg.maxSpeed),
        useGravity: new Uint8Array(msg.useGravity),
        isKinematic: new Uint8Array(msg.isKinematic),
        freezePositionX: new Uint8Array(msg.freezePositionX),
        freezePositionY: new Uint8Array(msg.freezePositionY),
        freezePositionZ: new Uint8Array(msg.freezePositionZ),
        freezeRotationX: new Uint8Array(msg.freezeRotationX),
        freezeRotationY: new Uint8Array(msg.freezeRotationY),
        freezeRotationZ: new Uint8Array(msg.freezeRotationZ),
        visibilityMask: msg.visibilityMask ? new Uint8Array(msg.visibilityMask) : null,
    });

    const response: PhysicsWorkerResult = {
        type: "result",
        vx: result.vx.buffer as ArrayBuffer,
        vy: result.vy.buffer as ArrayBuffer,
        vz: result.vz.buffer as ArrayBuffer,
        avx: result.avx.buffer as ArrayBuffer,
        avy: result.avy.buffer as ArrayBuffer,
        avz: result.avz.buffer as ArrayBuffer,
        dpx: result.dpx.buffer as ArrayBuffer,
        dpy: result.dpy.buffer as ArrayBuffer,
        dpz: result.dpz.buffer as ArrayBuffer,
        drx: result.drx.buffer as ArrayBuffer,
        dry: result.dry.buffer as ArrayBuffer,
        drz: result.drz.buffer as ArrayBuffer,
    };

    (self as unknown as Worker).postMessage(response, [
        response.vx, response.vy, response.vz,
        response.avx, response.avy, response.avz,
        response.dpx, response.dpy, response.dpz,
        response.drx, response.dry, response.drz,
    ]);
};
