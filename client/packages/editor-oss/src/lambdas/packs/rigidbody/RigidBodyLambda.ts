import { RIGIDBODY_SCHEMA } from "../../data/PhysicsComponentSchemas";
import type { LambdaOptions } from "../../Lambda";
import { SoALambdaBase } from "../../SoALambdaBase";

const RIGIDBODY_SYNC_FIELDS = ["vx", "vy", "vz", "avx", "avy", "avz"] as const;

export default class RigidBodyLambda extends SoALambdaBase {
    constructor(id: string, options: LambdaOptions) {
        super(id, options, RIGIDBODY_SCHEMA);
    }

    protected updateSoA(deltaTime: number): void {
        const store = this.store;
        const count = store.count;
        if (count === 0) return;

        const gravity = this.attributes.gravity ?? 9.81;

        const vx = store.getField("vx") as Float32Array;
        const vy = store.getField("vy") as Float32Array;
        const vz = store.getField("vz") as Float32Array;
        const avx = store.getField("avx") as Float32Array;
        const avy = store.getField("avy") as Float32Array;
        const avz = store.getField("avz") as Float32Array;
        const drag = store.getField("drag") as Float32Array;
        const angularDrag = store.getField("angularDrag") as Float32Array;
        const gravityScale = store.getField("gravityScale") as Float32Array;
        const useGravity = store.getField("useGravity") as Uint8Array;
        const isKinematic = store.getField("isKinematic") as Uint8Array;
        const freezePX = store.getField("freezePositionX") as Uint8Array;
        const freezePY = store.getField("freezePositionY") as Uint8Array;
        const freezePZ = store.getField("freezePositionZ") as Uint8Array;
        const freezeRX = store.getField("freezeRotationX") as Uint8Array;
        const freezeRY = store.getField("freezeRotationY") as Uint8Array;
        const freezeRZ = store.getField("freezeRotationZ") as Uint8Array;
        const objects = store.getObjectRefs();
        const visibilityMask = this._visibilityMask;

        for (let i = 0; i < count; i++) {
            if (isKinematic[i]) continue;

            const multiplier = visibilityMask ? visibilityMask[i]! : 1;
            if (multiplier === 0) continue;
            const effectiveDt = deltaTime * multiplier;

            // Apply gravity (time-integrated)
            if (useGravity[i]) {
                vy[i]! -= gravity * gravityScale[i]! * effectiveDt;
            }

            // Apply linear drag (rate-based)
            const d = drag[i]!;
            if (d > 0) {
                const factor = 1 - d;
                vx[i]! *= factor;
                vy[i]! *= factor;
                vz[i]! *= factor;
            }

            // Apply angular drag (rate-based)
            const ad = angularDrag[i]!;
            if (ad > 0) {
                const factor = 1 - ad;
                avx[i]! *= factor;
                avy[i]! *= factor;
                avz[i]! *= factor;
            }

            // Integrate position + rotation (time-integrated)
            const obj = objects[i];
            if (obj) {
                if (!freezePX[i]) obj.position.x += vx[i]! * effectiveDt;
                if (!freezePY[i]) obj.position.y += vy[i]! * effectiveDt;
                if (!freezePZ[i]) obj.position.z += vz[i]! * effectiveDt;
                if (!freezeRX[i]) obj.rotation.x += avx[i]! * effectiveDt;
                if (!freezeRY[i]) obj.rotation.y += avy[i]! * effectiveDt;
                if (!freezeRZ[i]) obj.rotation.z += avz[i]! * effectiveDt;
                obj.updateMatrix();
            }
        }

        // Sync velocities back to Map records
        this.syncSoAToMap(RIGIDBODY_SYNC_FIELDS);
    }
}
