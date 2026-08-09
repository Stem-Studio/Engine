import type {Matrix4, Object3D, Quaternion, QuaternionLike, Vector3, Vector3Like} from "three";

import {cloneJsonCompatible} from "@stem/editor-oss/utils/cloneJsonCompatible";
import TransformUtils from "@stem/editor-oss/utils/TransformUtils";
import type {PhysicsConfig} from "./common/physicsConfig";

export class PhysicsRuntimeUtil {
    private static tmpVectorA: Vector3 | null = null;
    private static tmpVectorB: Vector3 | null = null;
    private static tmpQuaternionA: Quaternion | null = null;
    private static tmpMatrixA: Matrix4 | null = null;
    private static tmpMatrixB: Matrix4 | null = null;

    private static ensureTemps(object: Object3D): void {
        PhysicsRuntimeUtil.tmpVectorA ??= object.position.clone();
        PhysicsRuntimeUtil.tmpVectorB ??= object.scale.clone();
        PhysicsRuntimeUtil.tmpQuaternionA ??= object.quaternion.clone();
        PhysicsRuntimeUtil.tmpMatrixA ??= object.matrix.clone();
        PhysicsRuntimeUtil.tmpMatrixB ??= object.matrix.clone();
    }

    static getPhysicsConfig(object: Object3D): PhysicsConfig | undefined {
        return (object.userData.physics as PhysicsConfig | undefined | null) || undefined;
    }

    static setPhysicsConfig(object: Object3D, physicsConfig: PhysicsConfig): void {
        object.userData.physics = physicsConfig;
    }

    static getPhysicsShape<TShape extends string>(object: Object3D, fallbackShape: TShape): TShape {
        return (PhysicsRuntimeUtil.getPhysicsConfig(object)?.shape as TShape | undefined) ?? fallbackShape;
    }

    static clonePhysicsConfig(physicsConfig: PhysicsConfig | undefined): PhysicsConfig | undefined {
        if (!physicsConfig) {
            return undefined;
        }
        return cloneJsonCompatible(physicsConfig);
    }

    static copyPhysicsConfig(from: Object3D, to: Object3D): void {
        to.userData.physics = PhysicsRuntimeUtil.clonePhysicsConfig(PhysicsRuntimeUtil.getPhysicsConfig(from));
    }

    static isPhysicsEnabled(target: Object3D): boolean {
        return PhysicsRuntimeUtil.getPhysicsConfig(target)?.enabled || false;
    }

    static isDynamicObject(target: Object3D): boolean {
        const physicsConfig = PhysicsRuntimeUtil.getPhysicsConfig(target);
        if (!physicsConfig?.enabled) {
            return false;
        }
        return physicsConfig.ctype
            ? String(physicsConfig.ctype).toLowerCase() === "dynamic"
            : true;
    }

    static removePhysicsObject(
        scene: {remove(object: Object3D): void},
        physics: {remove(uuid: string): void} | null | undefined,
        target: Object3D,
    ): void {
        scene.remove(target);
        physics?.remove(target.uuid);
    }

    static updateObjectTransformFromPhysics(
        object: Object3D,
        bodyPosition: Vector3Like,
        bodyQuaternion: QuaternionLike,
        bodyScale: Vector3Like,
    ): void {
        PhysicsRuntimeUtil.ensureTemps(object);
        const tmpVectorA = PhysicsRuntimeUtil.tmpVectorA!;
        const tmpVectorB = PhysicsRuntimeUtil.tmpVectorB!;
        const tmpQuaternionA = PhysicsRuntimeUtil.tmpQuaternionA!;
        const tmpMatrixA = PhysicsRuntimeUtil.tmpMatrixA!;
        const tmpMatrixB = PhysicsRuntimeUtil.tmpMatrixB!;

        tmpVectorA.set(bodyPosition.x, bodyPosition.y, bodyPosition.z);
        tmpQuaternionA.set(bodyQuaternion.x, bodyQuaternion.y, bodyQuaternion.z, bodyQuaternion.w);
        tmpVectorB.set(bodyScale.x, bodyScale.y, bodyScale.z);
        tmpMatrixA.compose(tmpVectorA, tmpQuaternionA, tmpVectorB);

        const physicsConfig = PhysicsRuntimeUtil.getPhysicsConfig(object);
        if (physicsConfig?.anchorOffset) {
            tmpMatrixB.makeTranslation(
                -physicsConfig.anchorOffset.x,
                -physicsConfig.anchorOffset.y,
                -physicsConfig.anchorOffset.z,
            );
            tmpMatrixA.multiply(tmpMatrixB);
        }

        if (physicsConfig?.anchorScale) {
            tmpMatrixB.makeScale(
                1.0 / physicsConfig.anchorScale.x,
                1.0 / physicsConfig.anchorScale.y,
                1.0 / physicsConfig.anchorScale.z,
            );
            tmpMatrixA.multiply(tmpMatrixB);
        }

        TransformUtils.setWorldTransform(object, tmpMatrixA);
    }

    static calculatePhysicsPositionFromObject(
        object: Object3D,
        bodyPosition: Vector3,
        bodyQuaternion: Quaternion,
        bodyScale: Vector3,
    ): void {
        PhysicsRuntimeUtil.ensureTemps(object);
        const tmpMatrixA = PhysicsRuntimeUtil.tmpMatrixA!;
        const tmpMatrixB = PhysicsRuntimeUtil.tmpMatrixB!;

        object.updateWorldMatrix(true, false);
        tmpMatrixA.copy(object.matrixWorld);

        const physicsConfig = PhysicsRuntimeUtil.getPhysicsConfig(object);
        if (physicsConfig?.anchorScale) {
            tmpMatrixB.makeScale(
                physicsConfig.anchorScale.x,
                physicsConfig.anchorScale.y,
                physicsConfig.anchorScale.z,
            );
            tmpMatrixA.multiply(tmpMatrixB);
        }

        if (physicsConfig?.anchorOffset) {
            tmpMatrixB.makeTranslation(
                physicsConfig.anchorOffset.x,
                physicsConfig.anchorOffset.y,
                physicsConfig.anchorOffset.z,
            );
            tmpMatrixA.multiply(tmpMatrixB);
        }

        tmpMatrixA.decompose(bodyPosition, bodyQuaternion, bodyScale);
    }

}
