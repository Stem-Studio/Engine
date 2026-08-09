import {Matrix4, Object3D, Quaternion, Vector3} from "three";

import {BehaviorBase} from "../../Behavior";
import GameManager from "../../game/GameManager";

class HingeJointBehavior extends BehaviorBase {

    game: GameManager | null = null;
    private jointObjectBUuid?: string;

    init(game: GameManager) {
        this.game = game;
    }

    onStart(): void {
        const objectA = this.target;
        const objectB = this.game?.getObjectByUUID(this.attributes.objectB);

        if (!objectB) {
            console.warn("FixedJointBehavior: object B is not found in the scene: "+this.attributes.objectB);
            return;
        }

        const relRotation = this.getRelativeRotation(objectB, objectA);
        const relPosition = this.getRelativePosition(objectB, objectA);

        const axis = new Vector3(this.attributes.axis.x, this.attributes.axis.y, this.attributes.axis.z);

        const angularLimitEnabled = this.attributes.angularLimitEnabled as boolean;
        const angularLimit = new Vector3(this.attributes.angularLimit.x, this.attributes.angularLimit.y, this.attributes.angularLimit.z);

        this.game?.physics?.addHingeJoint(
            this.attributes.collisionEnabled as boolean,
            this.target.uuid,
            this.attributes.objectB,
            axis,
            relPosition,
            relRotation,
            angularLimitEnabled,
            angularLimit,
            this.attributes.motorEnabled as boolean,
            this.attributes.motorSpeed as number,
            this.attributes.motorTorque as number,
        );
        this.jointObjectBUuid = objectB.uuid;
    }

    onStop(): void {
        if (!this.jointObjectBUuid) {
            return;
        }

        this.game?.physics?.removeJoint(this.target.uuid, this.jointObjectBUuid);
        this.jointObjectBUuid = undefined;
    }

    getRelativeRotation(meshA: Object3D, meshB: Object3D): Quaternion {
        const worldQuatB = new Quaternion();
        meshB.getWorldQuaternion(worldQuatB);
        const worldQuatA = new Quaternion();
        meshA.getWorldQuaternion(worldQuatA);
        return worldQuatA.invert().multiply(worldQuatB);
    }

    getRelativePosition(meshA: Object3D, meshB: Object3D): Vector3{
        const worldPositionB = new Vector3();
        meshB.getWorldPosition(worldPositionB); // Get world position of MeshB
        const inverseMatrixA = new Matrix4();
        inverseMatrixA.copy(meshA.matrixWorld).invert(); // Invert MeshA's world matrix
        return worldPositionB.clone().applyMatrix4(inverseMatrixA);
    }

}

export default HingeJointBehavior;
