import {Box3, Matrix3, Object3D, Raycaster, Scene, Vector3, type Intersection} from "three";

import CollisionDetector from '../../../behaviors/collisions/CollisionDetector';
import { ICameraControl } from '../../../controls/CameraControl';
import { CollisionBehavior, IPhysics } from '../../../physics/common/types';
import { COLLISION_TYPE } from '@stem/editor-oss/types/editor';
import BoundingBoxUtil from '@stem/editor-oss/utils/BoundingBoxUtil';
import {findObjectDepthFirst} from '@stem/editor-oss/utils/SceneTraverser';
import TagUtil from '@stem/editor-oss/utils/TagUtil';

/**
 * A helper class for character climbing behavior.
 */
export class ClimbingHelper {
    public climbingSpeed = 0;

    /** The maximum angle (in radians) from the "up" direction that is considered to be ground. */
    public groundNormalAngle = Math.PI / 6;

    public playerGravity = -9.81;

    private collisionListenerIds: {climbable: Object3D; listenerId: string}[] = [];
    private climbable: Object3D | null = null;

    private readonly localCharacterBox = new Box3();
    private readonly worldCharacterBox = new Box3();
    private readonly worldClimbableBox = new Box3();
    private readonly normalMatrix = new Matrix3();
    private readonly worldNormal = new Vector3();
    private readonly raycaster = new Raycaster();
    private readonly raycastIntersections: Intersection[] = [];
    private readonly characterPosition = new Vector3();
    private readonly climbablePosition = new Vector3();
    private readonly climbableDirection = new Vector3();
    private readonly climbableBoundsScratch = new Box3();
    private readonly climbVelocity = new Vector3();
    private readonly gravityVector = new Vector3();

    private readonly onObjectAddedListener = this.onObjectAdded.bind(this);
    private readonly onObjectRemovedListener = this.onObjectRemoved.bind(this);

    private static readonly upVector = new Vector3(0, 1, 0);

    constructor(
        private readonly scene: Scene,
        private readonly character: Object3D,
        private readonly physics: IPhysics,
        private readonly cameraControl: ICameraControl,
        private readonly collisionDetector: CollisionDetector,
        private readonly onClimbableCollision: (object: Object3D) => void,
    ) {
        // TODO: do we cache the character's bounding box anywhere?
        this.localCharacterBox = BoundingBoxUtil.getBoxWithoutTransform(this.character);
    }

    get isClimbing() {
        return this.climbable !== null;
    }

    public addLisiteners() {
        if (!this.collisionDetector || !this.character) {
            return;
        }

        const climbables = this.getClimbableObjects();

        for (const climbable of climbables) {
            this.addListener(climbable);
        }

        // Listen for objects being added / removed from the scene. Currently
        // we only listen for top-level objects.
        this.scene.addEventListener("childadded", this.onObjectAddedListener);
        this.scene.addEventListener("childremoved", this.onObjectRemovedListener);
    }

    public removeLisiteners() {
        if (!this.collisionDetector) {
            return;
        }

        this.scene.removeEventListener("childadded", this.onObjectAddedListener);
        this.scene.removeEventListener("childremoved", this.onObjectRemovedListener);

        for (const {climbable, listenerId} of this.collisionListenerIds) {
            this.collisionDetector.deleteListener(climbable, listenerId);
        }

        this.collisionListenerIds = [];
    }

    public startClimbing(climbable: Object3D) {
        // Verify that this is a climbable object.
        if (!this.isObjectClimbable(climbable)) {
            return;
        }

        this.cameraControl.resetCamera();
        // TODO: can we get this bounding box from the physics engine?
        this.worldClimbableBox.setFromObject(climbable);
        this.physics.setPlayerGravity(this.character.uuid, {x: 0, y: 0, z: 0});
        this.physics.setCollisionBehavior(this.character.uuid, CollisionBehavior.Ghost);
        this.climbable = climbable;
    }

    public stopClimbing() {
        if (!this.isClimbing) {
            return;
        }

        this.climbable = null;

        this.physics.setPlayerGravity(this.character.uuid, this.gravityVector.set(0, this.playerGravity, 0));

        this.physics.setCollisionBehavior(this.character.uuid, CollisionBehavior.Regular);
    }

    public move(direction: number, dt: number) {
        if (!this.isClimbing) {
            return;
        }

        if (direction > 0) {
            this.moveUp(dt);
        } else if (direction < 0) {
            this.moveDown(dt);
        } else {
            // Clear the vertical velocity
            this.physics.movePlayerObject(this.character.uuid, this.climbVelocity.set(0, 0, 0), false);
        }
    }

    public moveUp(dt: number) {
        if (!this.isClimbing) {
            return;
        }

        const upSpeed = !this.isAtTop() ? this.climbingSpeed : 0;

        this.physics.movePlayerObject(this.character.uuid, this.climbVelocity.set(0, upSpeed * dt, 0), false);
    }

    public moveDown(dt: number) {
        if (!this.isClimbing) {
            return;
        }

        if (this.isAtBottom()) {
            this.stopClimbing();
            return;
        }

        this.physics.movePlayerObject(this.character.uuid, this.climbVelocity.set(0, -this.climbingSpeed * dt, 0), false);
    }

    public isAtTop() {
        const worldCharacterBox = this.getWorldCharacterBox();
        return worldCharacterBox.max.y >= this.worldClimbableBox.max.y;
    }

    public isAtBottom() {
        // Note that the physics onGround motion state does not appear to be
        // accurate when the character is climbing. So instead we do a raycast
        // to determine if the character is on the ground.
        const worldCharacterBox = this.getWorldCharacterBox();
        const raycaster = this.raycaster;
        // Bottom center of character's bounding box
        raycaster.ray.origin.set(
            (worldCharacterBox.min.x + worldCharacterBox.max.x) / 2,
            worldCharacterBox.min.y,
            (worldCharacterBox.min.z + worldCharacterBox.max.z) / 2,
        );
        raycaster.ray.direction.set(0, -1, 0);
        raycaster.far = (worldCharacterBox.max.y - worldCharacterBox.min.y) / 4;

        // TODO: can we raycast against a smaller subset of objects?
        const intersections = this.raycastIntersections;
        intersections.length = 0;
        raycaster.intersectObject(this.scene, true, intersections);
        for (const intersection of intersections) {
            // Ignore intersections with the character and instersections
            // without a normal.
            if (intersection.object === this.character || !intersection.normal) {
                continue;
            }

            // Get the world-space normal.
            this.worldNormal.copy(intersection.normal);
            this.normalMatrix.getNormalMatrix(intersection.object.matrixWorld);
            this.worldNormal.applyMatrix3(this.normalMatrix);
            this.worldNormal.normalize();

            if (this.worldNormal.dot(ClimbingHelper.upVector) > Math.cos(this.groundNormalAngle)) {
                intersections.length = 0;
                return true;
            }
        }

        intersections.length = 0;
        return false;
    }

    public isMovingTowardClimbable(
        moveDirection: Vector3,
        climbable: Object3D,
        maxAngle: number = Math.PI / 10,
    ): boolean {
        // TODO: this could be improved by taking into account the bounds of the
        // climbable object, not just its position.
        const characterPosition = this.characterPosition;
        const climbablePosition = this.climbablePosition;
        const climbableDirection = this.climbableDirection;
        this.character.getWorldPosition(characterPosition);
        climbable.getWorldPosition(climbablePosition);
        climbableDirection.subVectors(climbablePosition, characterPosition);
        climbableDirection.y = 0;
        const angle = moveDirection.angleTo(climbableDirection);
        return angle < maxAngle;
    }

    /**
     * Indicates whether the player should start climbing the climbable.
     *
     * @remarks
     * This method should be called in response to the player colliding with a
     * climbable object. This method assumes that the player is in contact with
     * the climbable object.
     *
     * The player should start climbing if they are moving toward the climbable
     * and the climbable is tall enough.
     *
     * @param moveDirection - The direction the player is moving
     * @param climbable - The climbable object that the player has collided with
     * @returns true if the player should start climbing, false otherwise.
     */
    public shouldStartClimbing(moveDirection: Vector3, climbable: Object3D): boolean {
        // If the player is not moving toward the climbable, don't start
        // climbing.
        if (!this.isMovingTowardClimbable(moveDirection, climbable)) {
            return false;
        }

        // If the climbable is too short, don't start climbing.
        const climbableBox = this.climbableBoundsScratch.setFromObject(climbable);
        const climbableHeight = climbableBox.max.y - climbableBox.min.y;
        const characterBox = this.getWorldCharacterBox();
        const characterHeight = characterBox.max.y - characterBox.min.y;

        if (climbableHeight < characterHeight) {
            return false;
        }

        return true;
    }

    public dispose() {
        this.stopClimbing();
        this.removeLisiteners();
    }

    private getWorldCharacterBox() {
        this.character.updateMatrixWorld();
        return this.worldCharacterBox.copy(this.localCharacterBox).applyMatrix4(this.character.matrixWorld);
    }

    private addListener(climbable: Object3D) {
        const listenerId = this.collisionDetector.addListener(
            climbable,
            {
                type: COLLISION_TYPE.WITH_PLAYER,
                callback: () => this.onCollision(climbable.uuid),
            },
            true,
        );
        this.collisionListenerIds.push({climbable, listenerId});
    }

    private onObjectAdded(event: {child: Object3D}) {
        if (!this.isObjectClimbable(event.child)) {
            return;
        }

        this.addListener(event.child);
    }

    private onObjectRemoved(event: {child: Object3D}) {
        if (!this.isObjectClimbable(event.child)) {
            return;
        }

        const listenerIndex = this.collisionListenerIds.findIndex(({climbable}) => climbable === event.child);

        if (listenerIndex >= 0) {
            const {climbable, listenerId} = this.collisionListenerIds[listenerIndex]!;
            this.collisionDetector.deleteListener(climbable, listenerId);
            this.collisionListenerIds.splice(listenerIndex, 1);
        }

        // If the player is currently climbing the object being removed, stop
        // climbing.
        if (this.climbable === event.child) {
            this.stopClimbing();
        }
    }

    private onCollision(objectUuid: string) {
        const object = findObjectDepthFirst(this.scene, candidate => candidate.uuid === objectUuid);
        if (!object) {
            return;
        }

        // If the object is a climbable, start climbing.
        if (!this.isObjectClimbable(object)) {
            return;
        }

        this.onClimbableCollision(object);
    }

    private getClimbableObjects(): Object3D[] {
        return TagUtil.getObjectsByTag(this.scene, ["climbable", "physics.climbable"]);
    }

    private isObjectClimbable(object: Object3D): boolean {
        const isClimable = TagUtil.hasTag(object, "climbable");
        const isPhysicsClimable = TagUtil.hasTag(object, "physics.climbable");
        return isClimable || isPhysicsClimable;
    }
}
