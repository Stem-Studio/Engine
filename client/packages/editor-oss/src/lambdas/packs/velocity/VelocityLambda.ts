import { VELOCITY_SCHEMA } from "../../data/PhysicsComponentSchemas";
import type { LambdaOptions } from "../../Lambda";
import { SoALambdaBase } from "../../SoALambdaBase";

const VELOCITY_SYNC_FIELDS = ["vx", "vy", "vz"] as const;

export default class VelocityLambda extends SoALambdaBase {
    constructor(id: string, options: LambdaOptions) {
        super(id, options, VELOCITY_SCHEMA);
    }

    protected updateSoA(deltaTime: number): void {
        const store = this.store;
        const count = store.count;
        if (count === 0) return;

        const vx = store.getField("vx") as Float32Array;
        const vy = store.getField("vy") as Float32Array;
        const vz = store.getField("vz") as Float32Array;
        const damping = store.getField("damping") as Float32Array;
        const maxSpeed = store.getField("maxSpeed") as Float32Array;
        const objects = store.getObjectRefs();
        const visibilityMask = this._visibilityMask;

        for (let i = 0; i < count; i++) {
            const multiplier = visibilityMask ? visibilityMask[i]! : 1;
            if (multiplier === 0) continue;
            const effectiveDt = deltaTime * multiplier;

            let cvx = vx[i]!;
            let cvy = vy[i]!;
            let cvz = vz[i]!;

            // Clamp speed
            const speed = Math.sqrt(cvx * cvx + cvy * cvy + cvz * cvz);
            const ms = maxSpeed[i]!;
            if (speed > ms && speed > 0) {
                const scale = ms / speed;
                cvx *= scale;
                cvy *= scale;
                cvz *= scale;
            }

            // Integrate velocity → position (time-integrated)
            const obj = objects[i];
            if (obj) {
                obj.position.x += cvx * effectiveDt;
                obj.position.y += cvy * effectiveDt;
                obj.position.z += cvz * effectiveDt;
                obj.updateMatrix();
            }

            // Apply damping (rate-based)
            const d = damping[i]!;
            if (d > 0) {
                const factor = 1 - d;
                cvx *= factor;
                cvy *= factor;
                cvz *= factor;
            }

            vx[i] = cvx;
            vy[i] = cvy;
            vz[i] = cvz;
        }

        // Sync modified velocity back to Map records for external readers
        this.syncSoAToMap(VELOCITY_SYNC_FIELDS);
    }
}
