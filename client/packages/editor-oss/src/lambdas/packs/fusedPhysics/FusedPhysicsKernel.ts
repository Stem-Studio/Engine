/**
 * Pure physics computation kernel operating on raw TypedArray slices.
 * No Three.js or DOM dependencies — safe to run in a Web Worker.
 *
 * Computes updated velocities and position/rotation deltas per entity.
 */

export interface PhysicsKernelInput {
    count: number;
    deltaTime: number;
    gravity: number;
    // SoA fields (transferred ArrayBuffers)
    vx: Float32Array;
    vy: Float32Array;
    vz: Float32Array;
    avx: Float32Array;
    avy: Float32Array;
    avz: Float32Array;
    drag: Float32Array;
    angularDrag: Float32Array;
    gravityScale: Float32Array;
    damping: Float32Array;
    maxSpeed: Float32Array;
    useGravity: Uint8Array;
    isKinematic: Uint8Array;
    freezePositionX: Uint8Array;
    freezePositionY: Uint8Array;
    freezePositionZ: Uint8Array;
    freezeRotationX: Uint8Array;
    freezeRotationY: Uint8Array;
    freezeRotationZ: Uint8Array;
    visibilityMask: ArrayLike<number> | null;
    dpx?: Float32Array;
    dpy?: Float32Array;
    dpz?: Float32Array;
    drx?: Float32Array;
    dry?: Float32Array;
    drz?: Float32Array;
}

export interface PhysicsKernelOutput {
    // Updated velocities (written back in-place in input arrays)
    vx: Float32Array;
    vy: Float32Array;
    vz: Float32Array;
    avx: Float32Array;
    avy: Float32Array;
    avz: Float32Array;
    // Position/rotation deltas to apply on main thread
    dpx: Float32Array;
    dpy: Float32Array;
    dpz: Float32Array;
    drx: Float32Array;
    dry: Float32Array;
    drz: Float32Array;
}

function prepareOutputBuffer(buffer: Float32Array | undefined, count: number): Float32Array {
    if (!buffer || buffer.length < count) {
        return new Float32Array(count);
    }
    buffer.fill(0, 0, count);
    return buffer;
}

/**
 * Run the fused physics simulation kernel.
 * @param input SoA field arrays and simulation parameters.
 * @returns Updated velocities and position/rotation deltas.
 */
export function runPhysicsKernel(input: PhysicsKernelInput): PhysicsKernelOutput {
    const {
        count, deltaTime, gravity,
        vx, vy, vz, avx, avy, avz,
        drag: dragArr, angularDrag, gravityScale, damping: dampingArr,
        maxSpeed: maxSpeedArr, useGravity, isKinematic,
        freezePositionX: freezePX, freezePositionY: freezePY, freezePositionZ: freezePZ,
        freezeRotationX: freezeRX, freezeRotationY: freezeRY, freezeRotationZ: freezeRZ,
        visibilityMask,
    } = input;

    const dpx = prepareOutputBuffer(input.dpx, count);
    const dpy = prepareOutputBuffer(input.dpy, count);
    const dpz = prepareOutputBuffer(input.dpz, count);
    const drx = prepareOutputBuffer(input.drx, count);
    const dry = prepareOutputBuffer(input.dry, count);
    const drz = prepareOutputBuffer(input.drz, count);

    for (let i = 0; i < count; i++) {
        if (isKinematic[i]) continue;

        const multiplier = visibilityMask?.[i] ?? 1;
        if (multiplier === 0) continue;
        const effectiveDt = deltaTime * multiplier;

        let cvx = vx[i]!;
        let cvy = vy[i]!;
        let cvz = vz[i]!;

        // 1. Apply gravity
        if (useGravity[i]) {
            cvy -= gravity * gravityScale[i]! * effectiveDt;
        }

        // 2. Apply linear drag
        const d = dragArr[i]!;
        if (d > 0) {
            const factor = 1 - d;
            cvx *= factor;
            cvy *= factor;
            cvz *= factor;
        }

        // 3. Apply angular drag
        const ad = angularDrag[i]!;
        if (ad > 0) {
            const factor = 1 - ad;
            avx[i] = avx[i]! * factor;
            avy[i] = avy[i]! * factor;
            avz[i] = avz[i]! * factor;
        }

        // 4. Clamp speed
        const ms = maxSpeedArr[i]!;
        const speed = Math.sqrt(cvx * cvx + cvy * cvy + cvz * cvz);
        if (speed > ms && speed > 0) {
            const scale = ms / speed;
            cvx *= scale;
            cvy *= scale;
            cvz *= scale;
        }

        // 5. Apply damping
        const damp = dampingArr[i]!;
        if (damp > 0) {
            const factor = 1 - damp;
            cvx *= factor;
            cvy *= factor;
            cvz *= factor;
        }

        // Write back velocity
        vx[i] = cvx;
        vy[i] = cvy;
        vz[i] = cvz;

        // 6 & 7. Compute position + rotation deltas
        if (!freezePX[i]) dpx[i] = cvx * effectiveDt;
        if (!freezePY[i]) dpy[i] = cvy * effectiveDt;
        if (!freezePZ[i]) dpz[i] = cvz * effectiveDt;
        if (!freezeRX[i]) drx[i] = avx[i]! * effectiveDt;
        if (!freezeRY[i]) dry[i] = avy[i]! * effectiveDt;
        if (!freezeRZ[i]) drz[i] = avz[i]! * effectiveDt;
    }

    return {vx, vy, vz, avx, avy, avz, dpx, dpy, dpz, drx, dry, drz};
}
