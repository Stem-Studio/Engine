import type { Object3D } from "three";

import { BitSet } from "./BitSet";

export interface LambdaQueryDescriptor {
    /** ALL of these lambda types must be present */
    required?: string[];
    /** NONE of these lambda types may be present */
    excluded?: string[];
    /** At least ONE of these lambda types must be present */
    any?: string[];
}

/**
 * Assigns each lambda TYPE a unique bit index and maintains a per-object
 * archetype bitmask for O(1)-per-object cross-lambda queries.
 */
export class LambdaQueryRegistry {
    private typeBitIndex: Map<string, number> = new Map();
    private archetypes: Map<Object3D, BitSet> = new Map();
    private nextBit = 0;

    getOrAssignBit(lambdaTypeId: string): number {
        let bit = this.typeBitIndex.get(lambdaTypeId);
        if (bit === undefined) {
            bit = this.nextBit++;
            this.typeBitIndex.set(lambdaTypeId, bit);
        }
        return bit;
    }

    setArchetype(target: Object3D, typeIds: Iterable<string>): void {
        let mask = this.archetypes.get(target);
        if (!mask) {
            mask = new BitSet();
            this.archetypes.set(target, mask);
        } else {
            mask.reset();
        }
        for (const id of typeIds) {
            mask.set(this.getOrAssignBit(id));
        }
    }

    removeObject(target: Object3D): void {
        this.archetypes.delete(target);
    }

    query(descriptor: LambdaQueryDescriptor): Object3D[] {
        const requiredMask = this.buildMask(descriptor.required);
        const excludedMask = this.buildMask(descriptor.excluded);
        const anyMask = this.buildMask(descriptor.any);

        const results: Object3D[] = [];
        for (const [obj, mask] of this.archetypes) {
            if (requiredMask && !mask.contains(requiredMask)) continue;
            if (excludedMask && mask.intersects(excludedMask)) continue;
            if (anyMask && !mask.intersects(anyMask)) continue;
            results.push(obj);
        }
        return results;
    }

    /** Clear per-object archetypes (between play cycles) */
    clearArchetypes(): void {
        this.archetypes.clear();
    }

    /** Full reset including type bit assignments */
    dispose(): void {
        this.archetypes.clear();
        this.typeBitIndex.clear();
        this.nextBit = 0;
    }

    private buildMask(typeIds?: string[]): BitSet | null {
        if (!typeIds || typeIds.length === 0) return null;
        const mask = new BitSet();
        for (const id of typeIds) {
            const bit = this.typeBitIndex.get(id);
            if (bit !== undefined) mask.set(bit);
        }
        return mask;
    }
}
