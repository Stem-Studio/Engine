import { Object3D } from "three";

import BehaviorData from "@stem/editor-oss/behaviors/BehaviorData";
import { LambdaBase } from "../../LambdaBase";
import {traverseObjectDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";

type MatchBy = "id" | "uuid";
type SetBehaviorEnabledComponentData = {
    behaviorRef?: string;
    matchBy?: MatchBy;
    enabled?: boolean;
    includeChildren?: boolean;
    applyOnce?: boolean;
};

export default class SetBehaviorEnabledLambda extends LambdaBase {
    private processedTargets: WeakSet<Object3D> = new WeakSet();

    private matchesBehavior(behavior: BehaviorData, matchBy: MatchBy, behaviorRef: string): boolean {
        if (!behaviorRef) {
            return false;
        }

        if (matchBy === "uuid") {
            return behavior.uuid === behaviorRef;
        }

        return behavior.id === behaviorRef;
    }

    private updateBehaviorRuntime(target: Object3D, behavior: BehaviorData): void {
        if (!this._game) {
            return;
        }

        if (behavior.enabled) {
            void this._game.addBehaviorToObject(target, behavior.id, {
                uuid: behavior.uuid,
                attributes: behavior.attributesData,
                throttleConfig: behavior.throttleConfig,
            });
            return;
        }

        this._game.removeBehaviorByUUID(behavior.uuid);
    }

    private applyToTarget(target: Object3D, data: SetBehaviorEnabledComponentData): void {
        const matchBy: MatchBy = data.matchBy === "uuid" ? "uuid" : "id";
        const behaviorRef = (data.behaviorRef || "").trim();
        const enabled = data.enabled !== false;
        const behaviorList = target.userData?.behaviors as BehaviorData[] | undefined;

        if (!behaviorList || behaviorList.length === 0 || !behaviorRef) {
            return;
        }

        for (const behavior of behaviorList) {
            if (!this.matchesBehavior(behavior, matchBy, behaviorRef)) {
                continue;
            }

            if (behavior.enabled === enabled) {
                continue;
            }

            behavior.enabled = enabled;
            this.updateBehaviorRuntime(target, behavior);
        }
    }

    update(deltaTime: number = 0.016): void {
        this.processObjects(deltaTime, (object, data) => {
            const componentData = data as SetBehaviorEnabledComponentData;
            const includeChildren = componentData.includeChildren === true;
            const applyOnce = componentData.applyOnce !== false;

            if (applyOnce && this.processedTargets.has(object)) {
                return;
            }

            if (includeChildren) {
                traverseObjectDepthFirst(object, target => this.applyToTarget(target, componentData));
            } else {
                this.applyToTarget(object, componentData);
            }

            if (applyOnce) {
                this.processedTargets.add(object);
            }
        });
    }

    onObjectRemoved(target: Object3D): void {
        this.processedTargets.delete(target);
    }
}
