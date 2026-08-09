import { Object3D, Quaternion, Vector3 } from 'three';

import MathUtils from "../../../physics/common/math";
import { IPhysics } from "../../../physics/common/types";
import { PhysicsUtil } from "../../../physics/PhysicsUtil";
import { isDirectionalLight } from '@stem/editor-oss/utils/LightUtils';
import { BehaviorBase } from "../../Behavior";
import GameManager from "../../game/GameManager";

class FollowBehavior extends BehaviorBase {
    protected game: GameManager | null = null;

    private static tmpVectorA = new Vector3();
    private static tmpVectorB = new Vector3();
    private static tmpQuaternionA = new Quaternion();

    private followTarget: Object3D | null = null;
    private physics?: IPhysics;
    private isActive: boolean = false;
    private hasInitialOffset: boolean = false;
    private readonly initialOffset = new Vector3();
    private readonly followPosition = new Vector3();
    private readonly newPosition = new Vector3();
    private readonly newQuaternion = new Quaternion();

    init(game: GameManager) {
        this.game = game;

        this.followTarget = game.getObjectByUUID(this.attributes.followTargetUuid);
        this.physics = game.collisionDetector?.physics;
        if (!this.attributes.startOnTrigger) {
            this.isActive = true;
        }
    }

    update(deltaTime: number) {
        if (!this.isActive || !this.followTarget || !this.target || this.attributes.speed <= 0) {
            return;
        }

        const followPosition = this.followPosition.copy(this.followTarget.position);

        if (isDirectionalLight(this.target)) {
            if (!this.hasInitialOffset) {
                this.initialOffset.copy(this.target.position).sub(followPosition);
                this.hasInitialOffset = true;
            }

            this.target.target.position.copy(followPosition);
            if (this.target.target.updateMatrixWorld) {
                this.target.target.updateMatrixWorld();
            }
            this.target.position.copy(followPosition).add(this.initialOffset);
            return;
        }

        const currentDistanceSq = this.target.position.distanceToSquared(followPosition);
        const newPosition = this.newPosition.copy(this.target.position);
        const newQuaternion = this.newQuaternion.copy(this.target.quaternion);

        const alpha = MathUtils.clamp(this.attributes.speed * deltaTime, 0, 1);

        const followDistance = Number(this.attributes.distance);
        if (Number.isFinite(followDistance) && (followDistance < 0 || followDistance * followDistance < currentDistanceSq)) {
            newPosition.lerp(followPosition, alpha);
        }

        if (this.attributes.rotate) {
            this.target.lookAt(followPosition);
            newQuaternion.slerp(this.target.quaternion, alpha);
        }

        this.target.quaternion.copy(newQuaternion);
        this.target.position.copy(newPosition);

        this.updatePhysicsObject();
    }

    private updatePhysicsObject() {
        if (!this.physics || !this.target || !PhysicsUtil.isPhysicsEnabled(this.target)) {
            return;
        }

        PhysicsUtil.calculatePhysicsPositionFromObject(
            this.target,
            FollowBehavior.tmpVectorA,
            FollowBehavior.tmpQuaternionA,
            FollowBehavior.tmpVectorB,
        );
        this.physics.setOrigin(this.target.uuid, FollowBehavior.tmpVectorA);
        this.physics.setRotation(this.target.uuid, FollowBehavior.tmpQuaternionA);
    }

    onStart(): void {

    }

    onStop(): void {

    }

    onReset() {

    }

    onAttributesUpdated(): void {
        this.followTarget = this.game?.getObjectByUUID(this.attributes.followTargetUuid) ?? null;
    }

    onEvent(msg: string, data: unknown): void {
        if (msg === "trigger" && typeof data === "object" && data !== null && "actionType" in data) {
            this.isActive = (data as { actionType?: string }).actionType === "activate";
        }
    }
}

export default FollowBehavior;
