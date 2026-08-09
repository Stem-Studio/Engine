import { Matrix4, Object3D } from "three";

import { LambdaBase } from "../../LambdaBase";

type SetParentData = {
    parentUUID?: string;
    keepWorldTransform?: boolean;
};

export default class SetParentLambda extends LambdaBase {
    private worldMatrix = new Matrix4();
    private parentInverseMatrix = new Matrix4();

    private resolveParent(parentUUID?: string): Object3D | null {
        if (!this._game?.scene) {
            return null;
        }
        if (!parentUUID) {
            return this._game.scene;
        }
        return this._game.getObjectByUUID(parentUUID);
    }

    update(deltaTime: number = 0.016): void {
        this.processObjects(deltaTime, (object, data) => {
            const cfg = data as SetParentData;
            const parent = this.resolveParent(cfg.parentUUID);
            if (!parent || object.parent === parent) {
                return;
            }

            const keepWorld = cfg.keepWorldTransform !== false;
            if (keepWorld) {
                this.worldMatrix.copy(object.matrixWorld);
            }

            parent.add(object);

            if (keepWorld) {
                this.parentInverseMatrix.copy(parent.matrixWorld).invert();
                object.matrix.copy(this.parentInverseMatrix.multiply(this.worldMatrix));
                object.matrix.decompose(object.position, object.quaternion, object.scale);
            }
        });
    }
}
