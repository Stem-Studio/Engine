import { GRAVITY_SCHEMA } from "../../data/PhysicsComponentSchemas";
import type { LambdaOptions } from "../../Lambda";
import { SoALambdaBase } from "../../SoALambdaBase";

export default class GravityLambda extends SoALambdaBase {
    constructor(id: string, options: LambdaOptions) {
        super(id, options, GRAVITY_SCHEMA);
    }

    protected updateSoA(deltaTime: number): void {
        const store = this.store;
        const count = store.count;
        if (count === 0) return;

        const gravity = this.attributes.gravityStrength || 9.81;

        const mass = store.getField("mass") as Float32Array;
        const dragArr = store.getField("drag") as Float32Array;
        const useGravity = store.getField("useGravity") as Uint8Array;
        const objects = store.getObjectRefs();
        const visibilityMask = this._visibilityMask;

        for (let i = 0; i < count; i++) {
            if (!useGravity[i]) continue;

            const multiplier = visibilityMask ? visibilityMask[i]! : 1;
            if (multiplier === 0) continue;

            const force = gravity * mass[i]! * (deltaTime * multiplier);
            const dragFactor = 1 - dragArr[i]!;

            const obj = objects[i];
            if (obj) {
                obj.position.y -= force * dragFactor;
                obj.updateMatrix();
            }
        }
    }
}
