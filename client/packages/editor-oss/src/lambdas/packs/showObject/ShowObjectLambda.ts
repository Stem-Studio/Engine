import { Object3D } from "three";

import { LambdaBase } from "../../LambdaBase";
import {deleteRuntimeUserDataValue} from "@stem/editor-oss/utils/userDataRuntime";
import {traverseObjectDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";

const HIDE_OBJECT_PHYSICS_WAS_ENABLED_KEY = "__hideObjectPhysicsWasEnabled";
const HIDE_OBJECT_PHYSICS_REMOVED_KEY = "__hideObjectPhysicsRemoved";

export default class ShowObjectLambda extends LambdaBase {
    private showTarget(target: Object3D): void {
        target.visible = true;
        this.restorePhysicsIfNeeded(target);
    }

    private restorePhysicsIfNeeded(target: Object3D): void {
        if (target.userData[HIDE_OBJECT_PHYSICS_WAS_ENABLED_KEY] === undefined) {
            return;
        }

        const wasOriginallyEnabled = target.userData[HIDE_OBJECT_PHYSICS_WAS_ENABLED_KEY] === true;
        const physicsConfig = target.userData?.physics as { enabled?: boolean } | undefined;
        if (wasOriginallyEnabled && physicsConfig) {
            physicsConfig.enabled = true;
            if (target.userData[HIDE_OBJECT_PHYSICS_REMOVED_KEY] === true) {
                void this._game?.engine.physics?.addObject(target);
            }
        }

        deleteRuntimeUserDataValue(target, HIDE_OBJECT_PHYSICS_WAS_ENABLED_KEY);
        deleteRuntimeUserDataValue(target, HIDE_OBJECT_PHYSICS_REMOVED_KEY);
    }

    private applyVisibility(target: Object3D, includeChildren: boolean): void {
        this.showTarget(target);
        if (includeChildren) {
            traverseObjectDepthFirst(target, child => this.showTarget(child), {includeRoot: false});
        }
    }

    update(deltaTime: number = 0.016): void {
        this.processObjects(deltaTime, (object, data) => {
            const includeChildren = data.includeChildren !== false;
            this.applyVisibility(object, includeChildren);
        });
    }
}
