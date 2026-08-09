import {
    Box3,
    BufferAttribute,
    BufferGeometry,
    Matrix4,
    Mesh,
    Object3D,
    Quaternion,
    type QuaternionLike,
    Scene,
    Vector3,
    type Vector3Like,
} from "three";
import {SimplifyModifier} from "three/addons/modifiers/SimplifyModifier.js";

import {BodyShapeType, BoxShape, CapsuleShape, COLLISION_MAP, CollisionFlag, CommonData, ConcaveHullShape, ConvexHullShape, IPhysics, SphereShape} from "./common/types";
import {CollisionType, isConcaveHullEffectiveBodyTypeSupported, normalizeCType, PhysicsConfig, resolveEffectiveCollisionType} from "./common/physicsConfig";
import {GeometryExtractor} from "./GeometryExtractor";
import {HullCompute} from "./hull/HullCompute";
import {PhysicsShape} from "@stem/editor-oss/behaviors/state/IMultiplayerState";
import {getModelId, getModelRevisionId, isModelAssetInstance} from "@stem/editor-oss/model/userData";
import BoundingBoxUtil from "@stem/editor-oss/utils/BoundingBoxUtil";
import {cloneJsonCompatible} from "@stem/editor-oss/utils/cloneJsonCompatible";
import {
    traverseObjectDepthFirst,
    traverseObjectVisibleDepthFirst,
    updateObjectMatrixWorldDepthFirst,
} from "@stem/editor-oss/utils/SceneTraverser";
import TransformUtils from "@stem/editor-oss/utils/TransformUtils";
import {getGeometryComputePool} from "./worker/GeometryComputePool";

interface BoxShapeWithOffset extends BoxShape {
    center: Vector3Like;
    minY: number;
}

interface CapsuleShapeWithOffset extends CapsuleShape {
    center: Vector3Like;
    minY: number;
}

type ShapeDataMap = {
    [BodyShapeType.BOX]: BoxShapeWithOffset;
    [BodyShapeType.SPHERE]: SphereShape;
    [BodyShapeType.CAPSULE]: CapsuleShapeWithOffset;
    [BodyShapeType.CONVEX_HULL]: ConvexHullShape;
    [BodyShapeType.CONCAVE_HULL]: ConcaveHullShape;
};

/** Shapes built synchronously from object geometry. */
type FastShapeType = BodyShapeType.BOX | BodyShapeType.SPHERE | BodyShapeType.CAPSULE;
/** Shapes built from hull computation (convex/concave). */
type HullShapeType = BodyShapeType.CONVEX_HULL | BodyShapeType.CONCAVE_HULL;
/** Shapes that {@link PhysicsUtil.addObjectShapeToPhysics} can produce.
 *  Heightfields are excluded — terrain enters physics via `addTerrain`. */
type SupportedShapeType = FastShapeType | HullShapeType;

/**
 * In-flight shape builds, keyed by stable shape cache key. When several
 * model-asset instances of the same model are processed concurrently, the
 * first to enter the build path stashes its promise here and the rest await
 * it instead of redoing the geometry-worker hull computation.
 */
const pendingShapeBuilds = new Map<string, Promise<void>>();

const roundForKey = (n: number): string => n.toFixed(4);
const formatVec = (v: { x: number; y: number; z: number }): string =>
    `${roundForKey(v.x)},${roundForKey(v.y)},${roundForKey(v.z)}`;

const shapeKeyWorldPosition = new Vector3();
const shapeKeyWorldQuaternion = new Quaternion();
const shapeKeyWorldScale = new Vector3();
const IDENTITY_SHAPE_SCALE = { x: 1, y: 1, z: 1 } as const;

const SHAREABLE_ANY_SCALE = new Set<BodyShapeType>([BodyShapeType.CONCAVE_HULL]);
const SHAREABLE_SAME_SCALE = new Set<BodyShapeType>([BodyShapeType.CONVEX_HULL]);

/**
 * Runtime behavior scripts may construct physics configs directly instead of
 * passing through the editor serializer. Keep that boundary compatible with
 * the same friendly/legacy aliases accepted by `getPhysics`, while producing
 * only the retained Ammo/Rapier body-shape identifiers.
 */
const RUNTIME_BODY_SHAPE_ALIASES: Readonly<Record<string, BodyShapeType>> = {
    box: BodyShapeType.BOX,
    btboxshape: BodyShapeType.BOX,
    sphere: BodyShapeType.SPHERE,
    btsphereshape: BodyShapeType.SPHERE,
    capsule: BodyShapeType.CAPSULE,
    cylinder: BodyShapeType.CAPSULE,
    btcapsuleshape: BodyShapeType.CAPSULE,
    convexhull: BodyShapeType.CONVEX_HULL,
    btconvexhullshape: BodyShapeType.CONVEX_HULL,
    concavehull: BodyShapeType.CONCAVE_HULL,
    trimesh: BodyShapeType.CONCAVE_HULL,
    btconcavehullshape: BodyShapeType.CONCAVE_HULL,
};

const describeUnsupportedShape = (shape: unknown): string => {
    if (shape === undefined) return "<missing>";
    if (shape === null) return "<null>";
    if (typeof shape === "string") return JSON.stringify(shape);
    return String(shape);
};

/**
 * Decide whether a shared collision shape is appropriate for `object`, and
 * return a stable cache key if so.
 *
 * Sharing eligibility:
 * - Only model-asset instances (prefabs handled separately).
 * - Concave hulls share across any world scale — the engine wraps the shared
 *   shape in a per-body `btScaledBvhTriangleMeshShape` whose scaling is set
 *   per body via `setLocalScaling`.
 * - Convex hulls share only when the world scale matches, since the per-body
 *   wrapper (`btUniformScalingShape`) carries a single scalar and can't
 *   express non-uniform per-instance scaling.
 * - Box / sphere / capsule are not shared — they're already cheap to build
 *   (~0.03–0.5 ms each) and the bookkeeping isn't worth it.
 *
 * The cache key encodes everything that gets baked into the shape vertices:
 * - `modelId` + `revisionId` — the source geometry
 * - `excludeHidden` — whether hidden children are skipped
 * - `userShapeScale` — physics-config-supplied scale, applied to vertices
 *   inside `GeometryExtractor.extractGeometries`
 * - `localScale` — the object's own scale, also baked into vertices because
 *   `extractGeometries` zeroes parent transforms but keeps local scale
 * - `worldScale` (convex only) — see eligibility above
 *
 * @param object
 * @param shape
 * @param excludeHidden
 * @param physicsConfig
 * @returns a stable shape cache key, or `undefined` if no sharing is
 *   appropriate for this object/shape combination
 */
export const getModelAssetShapeKey = (
    object: Object3D,
    shape: BodyShapeType,
    excludeHidden: boolean,
    physicsConfig: PhysicsConfig,
): string | undefined => {
    if (!isModelAssetInstance(object)) return undefined;

    const concaveShareable = SHAREABLE_ANY_SCALE.has(shape);
    const convexShareable = SHAREABLE_SAME_SCALE.has(shape);
    if (!concaveShareable && !convexShareable) return undefined;

    const modelId = getModelId(object);
    const revisionId = modelId ? getModelRevisionId(object) : undefined;
    if (!modelId || !revisionId) return undefined;

    const userShapeScale = physicsConfig.userShapeScale ?? { x: 1, y: 1, z: 1 };
    const ls = formatVec(object.scale);
    const us = formatVec(userShapeScale);
    let key = `model:${modelId}:${revisionId}:${shape}:${excludeHidden}:ls=${ls}:us=${us}`;

    if (convexShareable) {
        object.updateWorldMatrix(true, false);
        object.matrixWorld.decompose(shapeKeyWorldPosition, shapeKeyWorldQuaternion, shapeKeyWorldScale);
        key += `:ws=${formatVec(shapeKeyWorldScale)}`;
    }

    return key;
};

/* 
the whole idea of physics shape calculation is:
you get vertices or bounding box of the object, without position and rotation but with scale (because of issue with bones)
then you calculate the anchor offset based on the bounding box
and then you add the shape to the physics engine with the anchor offset and parent scale
since we already have shape calculated based on the scale
*/

export class PhysicsUtil {
    private static tmpVectorA = new Vector3();
    private static tmpVectorB = new Vector3();
    private static tmpQuaternionA = new Quaternion();
    private static tmpMatrixA = new Matrix4();
    private static tmpMatrixB = new Matrix4();
    private static tmpBoxA = new Box3();

    public static setPhysicsConfig(object: Object3D, config: PhysicsConfig) {
        object.userData.physics = config;
    }

    public static getPhysicsConfig(object: Object3D): PhysicsConfig | undefined {
        return (object.userData.physics as PhysicsConfig | undefined | null) || undefined;
    }

    public static getPhysicsShape(object: Object3D, defaultShape: PhysicsShape): PhysicsShape {
        const physicsConfig = PhysicsUtil.getPhysicsConfig(object);
        if (physicsConfig) {
            return physicsConfig.shape as PhysicsShape;
        }
        return defaultShape;
    }

    public static clonePhysicsConfig(config: PhysicsConfig | undefined): PhysicsConfig | undefined {
        if (!config) {
            return undefined;
        }

        return cloneJsonCompatible(config);
    }

    public static copyPhysicsConfig(from: Object3D, to: Object3D) {
        to.userData.physics = PhysicsUtil.clonePhysicsConfig(PhysicsUtil.getPhysicsConfig(from));
    }

    public static updateShapeOffsetAndScale(object: Object3D) {
        const physicsConfig = PhysicsUtil.getPhysicsConfig(object);
        if (!physicsConfig) {
            console.warn(
                "PhysicsUtil: set physics data failed, physics config is not specified for object",
                object,
            );
            return;
        }

        const { shape: configuredShape, shapeExcludesHiddenObjects } = physicsConfig;
        const shape = PhysicsUtil.toBodyShapeType(configuredShape);
        if (!shape) {
            console.warn(
                `PhysicsUtil: set physics data failed, unsupported shape ${describeUnsupportedShape(configuredShape)} for object "${object.name || object.uuid}"`,
            );
            return;
        }
        const excludeHiddenObjects = shapeExcludesHiddenObjects ?? false;
        switch (shape) {
            case BodyShapeType.BOX:
                {
                    const box = PhysicsUtil.getShapeData(object, BodyShapeType.BOX, excludeHiddenObjects);
                    physicsConfig.anchorOffset = box.center;
                }
                break;
            case BodyShapeType.CAPSULE:
                {
                    const capsule = PhysicsUtil.getShapeData(object, BodyShapeType.CAPSULE, excludeHiddenObjects);
                    physicsConfig.anchorOffset = capsule.center;
                }
                break;
            case BodyShapeType.SPHERE:
                {
                    // Note that currently sphere shapes are centered around the object's
                    // origin and have no anchorOffset.
                    physicsConfig.anchorOffset = { x: 0, y: 0, z: 0 };
                }
                break;
            case BodyShapeType.CONCAVE_HULL:
                // Anchor for concave is not needed because it's calculated
                // based on the vertices.
                physicsConfig.anchorOffset = { x: 0, y: 0, z: 0 };
                break;
            case BodyShapeType.CONVEX_HULL:
                // Anchor for convex is not needed because it's calculated
                // based on the vertices.
                physicsConfig.anchorOffset = { x: 0, y: 0, z: 0 };
                break;
        }

        const userShapeOffset = physicsConfig.userShapeOffset;
        if (userShapeOffset) {
            if (!physicsConfig.anchorOffset) {
                physicsConfig.anchorOffset = { x: 0, y: 0, z: 0 };
            }

            physicsConfig.anchorOffset.x += userShapeOffset.x;
            physicsConfig.anchorOffset.y += userShapeOffset.y;
            physicsConfig.anchorOffset.z += userShapeOffset.z;
        }

        // The current object scale is "baked" into the physics shape, so set
        // the anchorScale to the inverse of the object scale.
        physicsConfig.anchorScale = {
            x: 1.0 / object.scale.x,
            y: 1.0 / object.scale.y,
            z: 1.0 / object.scale.z,
        };
    }

    private static getBoxData(object: Object3D, excludeHiddenObjects?: boolean): BoxShapeWithOffset {
        const physicsConfig = PhysicsUtil.getPhysicsConfig(object);
        const userShapeScale = physicsConfig?.userShapeScale || { x: 1, y: 1, z: 1 };
        const box = BoundingBoxUtil.getBoxWithoutTransform(object, excludeHiddenObjects, PhysicsUtil.tmpBoxA);
        //validate the box
        if (BoundingBoxUtil.isInfiniteBox(box)) {
            box.min.set(0, 0, 0);
            box.max.set(0, 0, 0);
            console.warn("PhysicsUtil: get box data failed, bounding box is infinite: ", object);
        }
        box.getCenter(PhysicsUtil.tmpVectorA);

        // Bake the local scale into the box dimensions
        const scaleY = object.scale.y * userShapeScale.y;
        return {
            type: BodyShapeType.BOX,
            width: (box.max.x - box.min.x) * object.scale.x * userShapeScale.x,
            height: (box.max.y - box.min.y) * scaleY,
            length: (box.max.z - box.min.z) * object.scale.z * userShapeScale.z,
            center: {
                x: PhysicsUtil.tmpVectorA.x * object.scale.x * userShapeScale.x,
                y: PhysicsUtil.tmpVectorA.y * scaleY,
                z: PhysicsUtil.tmpVectorA.z * object.scale.z * userShapeScale.z,
            },
            minY: box.min.y * scaleY,
        };
    }

    private static getSphereData(object: Object3D, excludeHiddenObjects?: boolean): SphereShape {
        const physicsConfig = PhysicsUtil.getPhysicsConfig(object);
        const userShapeScale = physicsConfig?.userShapeScale || { x: 1, y: 1, z: 1 };
        const scale = Math.max(
            object.scale.x * userShapeScale.x,
            object.scale.y * userShapeScale.y,
            object.scale.z * userShapeScale.z,
        );

        // Bake the local scale into the sphere radius. Note that this may not
        // produce a tight sphere when the scale is not uniform.
        return {
            type: BodyShapeType.SPHERE,
            radius: BoundingBoxUtil.getRadiusWithoutTransform(object, excludeHiddenObjects) * scale,
        };
    }

    private static getCapsuleData(object: Object3D, excludeHiddenObjects?: boolean): CapsuleShapeWithOffset {
        const physicsConfig = PhysicsUtil.getPhysicsConfig(object);
        const userShapeScale = physicsConfig?.userShapeScale || { x: 1, y: 1, z: 1 };
        const capsule = BoundingBoxUtil.getCapsuleWithoutTransform(object, excludeHiddenObjects);

        // Bake the local scale into the capsule dimensions, taking into account
        // that the total height of the capsule is the height of the cylinder
        // plus the radius of the sphere at each end.
        const boxHeight = capsule.height + capsule.radius * 2;
        const scaleY = object.scale.y * userShapeScale.y;
        const radiusScale = Math.max(
            object.scale.x * userShapeScale.x,
            object.scale.z * userShapeScale.z,
        );
        let radius = capsule.radius * radiusScale;
        let height = boxHeight * scaleY - radius * 2;

        if (height < 0) {
            const difference = Math.abs(height);
            radius -= difference / 2;
            height = 0;
        }
        return {
            type: BodyShapeType.CAPSULE,
            radius,
            height,
            center: {
                x: capsule.center.x * object.scale.x * userShapeScale.x,
                y: capsule.center.y * scaleY,
                z: capsule.center.z * object.scale.z * userShapeScale.z,
            },
            minY: (capsule.center.y - boxHeight / 2) * scaleY,
        };
    }

    private static getConvexHullData(object: Object3D, excludeHiddenObjects?: boolean): ConvexHullShape {
        // Sync version - call unified method without workers (cast away Promise)
        const result = PhysicsUtil.computeConvexHull(object, 0.7, excludeHiddenObjects ?? false, false);
        return {
            type: BodyShapeType.CONVEX_HULL,
            vertices: result as unknown as number[],
        };
    }

    private static getConcaveHullData(object: Object3D, excludeHiddenObjects?: boolean): ConcaveHullShape {
        // Sync version - call unified method without workers (cast away Promise)
        const result = PhysicsUtil.computeConcaveHull(object, excludeHiddenObjects ?? false, false);
        return {
            type: BodyShapeType.CONCAVE_HULL,
            ...(result as unknown as { vertices: number[][]; indexes: number[][] }),
        };
    }

    /**
     * Get shape data (e.g., descriptions of a box, sphere, capsule, etc.) for
     * an object.
     * 
     * @remarks
     * The shape will take into account the object's local scale, but it will
     * not take into account the object's position or rotation. That is, any
     * local scaling will be "baked" into the shape. This is done in order to
     * support non-uniform local scales of capsules, for example.
     * 
     * If the object is a child of another object, the parent transform will be
     * ignored.
     * 
     * @param object - The object to get the shape data for
     * @param shapeType - The type of shape
     * @param excludeHiddenObjects - Whether to exclude hidden objects (default false)
     * @returns A shape data object
     */
    public static getShapeData<T extends keyof ShapeDataMap>(
        object: Object3D,
        shapeType: T,
        excludeHiddenObjects?: boolean,
    ): ShapeDataMap[T] {
        const shapeFnMap: {
            [K in keyof ShapeDataMap]: (object: Object3D) => ShapeDataMap[K];
        } = {
            [BodyShapeType.BOX]: (obj) => PhysicsUtil.getBoxData(obj, excludeHiddenObjects),
            [BodyShapeType.SPHERE]: (obj) => PhysicsUtil.getSphereData(obj, excludeHiddenObjects),
            [BodyShapeType.CAPSULE]: (obj) => PhysicsUtil.getCapsuleData(obj, excludeHiddenObjects),
            [BodyShapeType.CONVEX_HULL]: (obj) => PhysicsUtil.getConvexHullData(obj, excludeHiddenObjects),
            [BodyShapeType.CONCAVE_HULL]: (obj) => PhysicsUtil.getConcaveHullData(obj, excludeHiddenObjects),
        };

        return shapeFnMap[shapeType](object);
    }

    /**
     * Compute a collision shape for the object and add it to the physics world.
     * 
     * @remarks
     * Uses worker threads for heavy computations (convex/concave hulls) by default.
     * Box, sphere, and capsule shapes are computed synchronously as they're fast.
     * 
     * @param object - The object to add to the physics world
     * @param physics - The physics engine
     * @param objectTemplate - The object template to use to compute the collision shape
     * @param useWorkers - Whether to use workers for hull computations (default: true)
     * @returns Promise that resolves when the object is added to physics
     */
    public static async addObjectShapeToPhysics(
        object: Object3D,
        physics: IPhysics | null,
        objectTemplate?: Object3D,
        useWorkers: boolean = true,
    ): Promise<void> {
        if (!physics) {
            console.warn(
                "PhysicsUtil: add object shape to physics failed, physics is not specified for object",
                object,
            );
            return;
        }

        const physicsConfig = PhysicsUtil.getPhysicsConfig(object);
        if (!physicsConfig) {
            console.warn(
                "PhysicsUtil: add object shape to physics failed, physics config is not specified for object",
                object,
            );
            return;
        }

        const configuredShape = physicsConfig.shape;
        const shape = PhysicsUtil.toBodyShapeType(configuredShape);
        if (!PhysicsUtil.isSupportedShape(shape)) {
            // Heightfields enter physics via `addTerrain`, not this function.
            // Anything else is genuinely unsupported.
            console.warn(
                `PhysicsUtil: addObjectShapeToPhysics: unsupported shape ${describeUnsupportedShape(configuredShape)} for object "${object.name || object.uuid}"`,
            );
            return;
        }

        // Triangle-mesh (concave) colliders are static-world geometry in the
        // shared Ammo/Rapier contract. Reject invalid body types before any
        // cache lookup, hull extraction, worker dispatch, or backend call so
        // both local and worker paths fail consistently and cheaply.
        if (shape === BodyShapeType.CONCAVE_HULL && !isConcaveHullEffectiveBodyTypeSupported(physicsConfig.ctype, physicsConfig.mass)) {
            const bodyType = resolveEffectiveCollisionType(physicsConfig.ctype, physicsConfig.mass);
            console.warn(
                `PhysicsUtil: rejected concave hull collider for object "${object.name || object.uuid}" ` +
                `(body type "${bodyType}"). Ammo/Rapier support concave hulls only for Static bodies; ` +
                `use ctype "Static" with mass <= 0 for fixed geometry, a ConvexHull for dynamic/kinematic bodies, ` +
                `or compound primitive colliders.`,
            );
            return;
        }

        const { shapeExcludesHiddenObjects } = physicsConfig;
        const excludeHiddenObjects = shapeExcludesHiddenObjects ?? false;

        // Box, sphere, capsule - always use sync (they're fast)
        const isFastShape = shape === BodyShapeType.BOX || shape === BodyShapeType.SPHERE || shape === BodyShapeType.CAPSULE;
        const shouldUseWorkers = !isFastShape && useWorkers;

        // Two paths share the same "build-shape-once-then-add-body" flow,
        // differing only in (a) what stable id keys the cache and (b) which
        // object's geometry produces the shape:
        //
        //   - `objectTemplate` (UUID-template assets): key off template.uuid;
        //     extract from the template (forced visible during extraction).
        //   - model-asset instances: key off modelId/revisionId/scale
        //     (`getModelAssetShapeKey`); extract from the instance itself.
        //
        // In both cases the body is added with the instance's commonData so
        // its world transform is correct.
        const addBodyWithSharedShape = async (
            shapeUuid: string,
            geometrySource: Object3D,
            forceVisibleDuringExtract: boolean,
        ): Promise<void> => {
            if (!physics.hasShape(shapeUuid)) {
                const pending = pendingShapeBuilds.get(shapeUuid);
                if (pending) {
                    await pending;
                } else if (PhysicsUtil.isFastShape(shape)) {
                    // Synchronous return type — `addShape` lands in the same
                    // tick as the `addBody` below, so fire-and-forget callers
                    // see both queued on return.
                    PhysicsUtil.buildFastShapeSync(physics, shape, shapeUuid, geometrySource, excludeHiddenObjects, forceVisibleDuringExtract);
                } else {
                    // Hulls run in geometry-compute workers. Register the
                    // build so concurrent callers for the same shape coalesce.
                    // The early-return at the top of the enclosing function
                    // guarantees `shape` is a hull here.
                    const buildPromise = PhysicsUtil
                        .buildHullShape(physics, shape, shapeUuid, geometrySource, excludeHiddenObjects, shouldUseWorkers, forceVisibleDuringExtract)
                        .finally(() => pendingShapeBuilds.delete(shapeUuid));
                    pendingShapeBuilds.set(shapeUuid, buildPromise);
                    await buildPromise;
                }
            }
            physics.addBody(object, shapeUuid, PhysicsUtil.getCommonData(object, physicsConfig));
        };

        if (objectTemplate) {
            // Cache key is template.uuid + shape + excludeHidden. Shape type
            // and excludeHidden come from the instance, so the same template
            // can host several distinct cached shapes.
            const shapeUuid = `${objectTemplate.uuid}-${shape}-${excludeHiddenObjects}`;
            // Templates are often hidden in the scene; force-visible during
            // extraction so meshes get traversed.
            await addBodyWithSharedShape(shapeUuid, objectTemplate, true);
            return;
        }

        const sharedKey = getModelAssetShapeKey(object, shape, excludeHiddenObjects, physicsConfig);
        if (sharedKey) {
            await addBodyWithSharedShape(sharedKey, object, false);
            return;
        }

        // Last resort: no shareable identity for this object, build a one-off
        // shape from the instance itself.
        const commonData = PhysicsUtil.getCommonData(object, physicsConfig);

        switch (shape) {
            case BodyShapeType.BOX: {
                const boxShape = PhysicsUtil.getShapeData(object, BodyShapeType.BOX, excludeHiddenObjects);
                physics.addBox(object, {
                    type: BodyShapeType.BOX,
                    ...commonData,
                    width: boxShape.width,
                    height: boxShape.height,
                    length: boxShape.length,
                });
                break;
            }
            case BodyShapeType.SPHERE: {
                const sphereShape = PhysicsUtil.getShapeData(object, BodyShapeType.SPHERE, excludeHiddenObjects);
                physics.addSphere(object, {
                    type: BodyShapeType.SPHERE,
                    ...commonData,
                    radius: sphereShape.radius,
                });
                break;
            }
            case BodyShapeType.CAPSULE: {
                const capsuleShape = PhysicsUtil.getShapeData(object, BodyShapeType.CAPSULE, excludeHiddenObjects);
                physics.addCapsuleShape(object, {
                    type: BodyShapeType.CAPSULE,
                    ...commonData,
                    radius: capsuleShape.radius,
                    height: capsuleShape.height,
                });
                break;
            }
            case BodyShapeType.CONVEX_HULL: {
                const vertices = await this.computeConvexHull(object, 0.7, excludeHiddenObjects, shouldUseWorkers);
                physics.addConvexHull(object, {
                    type: BodyShapeType.CONVEX_HULL,
                    ...commonData,
                    vertices,
                });
                break;
            }
            case BodyShapeType.CONCAVE_HULL: {
                const { vertices, indexes } = await this.computeConcaveHull(object, excludeHiddenObjects, shouldUseWorkers);
                physics.addConcaveHull(object, {
                    type: BodyShapeType.CONCAVE_HULL,
                    ...commonData,
                    vertices,
                    indexes,
                });
                break;
            }
            default:
                console.warn("PhysicsUtil: add object shape to physics failed, shape not supported", shape);
                break;
        }
    }

    /**
     * Build and register a fast (BOX/SPHERE/CAPSULE) collision shape. The
     * non-Promise return type is load-bearing: callers in `addBodyWithSharedShape`
     * rely on `addShape` landing synchronously so a follow-up `addBody` (or
     * caller-posted message like PLAYER.ADD) doesn't slip in front of it.
     * Don't introduce an `await` here.
     *
     * @param physics destination physics
     * @param shape one of BOX/SPHERE/CAPSULE
     * @param shapeUuid cache key for the shape
     * @param geometrySource object whose geometry produces the shape
     * @param excludeHiddenObjects skip hidden meshes during extraction
     * @param forceVisibleDuringExtract temporarily mark `geometrySource` visible
     */
    private static isSupportedShape(shape: BodyShapeType | undefined): shape is SupportedShapeType {
        if (shape === undefined) return false;
        return PhysicsUtil.isFastShape(shape) || PhysicsUtil.isHullShape(shape);
    }

    private static isFastShape(shape: BodyShapeType): shape is FastShapeType {
        return shape === BodyShapeType.BOX
            || shape === BodyShapeType.SPHERE
            || shape === BodyShapeType.CAPSULE;
    }

    private static isHullShape(shape: BodyShapeType): shape is HullShapeType {
        return shape === BodyShapeType.CONVEX_HULL || shape === BodyShapeType.CONCAVE_HULL;
    }

    private static buildFastShapeSync(
        physics: IPhysics,
        shape: FastShapeType,
        shapeUuid: string,
        geometrySource: Object3D,
        excludeHiddenObjects: boolean,
        forceVisibleDuringExtract: boolean,
    ): void {
        const oldVisible = geometrySource.visible;
        if (forceVisibleDuringExtract) geometrySource.visible = true;
        try {
            const shapeData = PhysicsUtil.getShapeData(geometrySource, shape, excludeHiddenObjects);
            if (!physics.hasShape(shapeUuid)) {
                physics.addShape(shapeUuid, shapeData);
            }
        } finally {
            if (forceVisibleDuringExtract) geometrySource.visible = oldVisible;
        }
    }

    /**
     * Build and register a hull (convex/concave) collision shape. Computation
     * runs in a geometry-compute worker pool and is therefore asynchronous;
     * callers in `addBodyWithSharedShape` register the returned promise so concurrent
     * builds for the same shape coalesce into one.
     *
     * @param physics destination physics
     * @param shape CONVEX_HULL or CONCAVE_HULL
     * @param shapeUuid cache key for the shape
     * @param geometrySource object whose geometry produces the shape
     * @param excludeHiddenObjects skip hidden meshes during extraction
     * @param shouldUseWorkers run hull compute on the worker pool when true
     * @param forceVisibleDuringExtract temporarily mark `geometrySource` visible
     */
    private static async buildHullShape(
        physics: IPhysics,
        shape: HullShapeType,
        shapeUuid: string,
        geometrySource: Object3D,
        excludeHiddenObjects: boolean,
        shouldUseWorkers: boolean,
        forceVisibleDuringExtract: boolean,
    ): Promise<void> {
        const oldVisible = geometrySource.visible;
        if (forceVisibleDuringExtract) geometrySource.visible = true;
        try {
            if (shape === BodyShapeType.CONVEX_HULL) {
                const vertices = await PhysicsUtil.computeConvexHull(geometrySource, 0.7, excludeHiddenObjects, shouldUseWorkers);
                if (!physics.hasShape(shapeUuid)) {
                    physics.addShape(shapeUuid, { type: BodyShapeType.CONVEX_HULL, vertices });
                }
            } else {
                const { vertices, indexes } = await PhysicsUtil.computeConcaveHull(geometrySource, excludeHiddenObjects, shouldUseWorkers);
                if (!physics.hasShape(shapeUuid)) {
                    physics.addShape(shapeUuid, { type: BodyShapeType.CONCAVE_HULL, vertices, indexes });
                }
            }
        } finally {
            if (forceVisibleDuringExtract) geometrySource.visible = oldVisible;
        }
    }

    /**
     * Compute concave hull vertices (unified method for sync/async).
     * @param object
     * @param excludeHiddenObjects
     * @param useWorkers
     * @private
     */
    private static computeConcaveHull(
        object: Object3D,
        excludeHiddenObjects: boolean,
        useWorkers: boolean,
    ): Promise<{ vertices: number[][]; indexes: number[][] }> | { vertices: number[][]; indexes: number[][] } {
        if (useWorkers) {
            const physicsConfig = PhysicsUtil.getPhysicsConfig(object);
            const userShapeScale = physicsConfig?.userShapeScale || { x: 1, y: 1, z: 1 };
            const geometries = GeometryExtractor.extractGeometries(
                object,
                excludeHiddenObjects,
                userShapeScale,
            );
            const pool = getGeometryComputePool();
            return pool.computeConcaveHull(geometries, IDENTITY_SHAPE_SCALE).then((result) => ({
                vertices: result.vertices,
                indexes: result.indices,
            }));
        } else {
            const simplifiedGeometry = this.getSimplifiedGeometry(object, 0, excludeHiddenObjects);
            const result = HullCompute.concaveHull(simplifiedGeometry, IDENTITY_SHAPE_SCALE);
            return { vertices: result.verticesArray, indexes: result.indicesArray };
        }
    }

    /**
     * Compute convex hull vertices (unified method for sync/async).
     * @param object
     * @param simplifyFactor
     * @param excludeHiddenObjects
     * @param useWorkers
     * @private
     */
    private static computeConvexHull(
        object: Object3D,
        simplifyFactor: number,
        excludeHiddenObjects: boolean,
        useWorkers: boolean,
    ): Promise<number[]> | number[] {
        if (useWorkers) {
            const physicsConfig = PhysicsUtil.getPhysicsConfig(object);
            const userShapeScale = physicsConfig?.userShapeScale || { x: 1, y: 1, z: 1 };
            const geometries = GeometryExtractor.extractGeometries(
                object,
                excludeHiddenObjects,
                userShapeScale,
            );
            const pool = getGeometryComputePool();
            return pool.computeConvexHull(geometries, simplifyFactor, IDENTITY_SHAPE_SCALE);
        } else {
            const simplifiedGeometry = this.getSimplifiedGeometry(object, simplifyFactor, excludeHiddenObjects);
            return HullCompute.convexHull(simplifiedGeometry, IDENTITY_SHAPE_SCALE);
        }
    }

    public static getConcaveHullVertices(object: Object3D, excludeHiddenObjects?: boolean) {
        return this.computeConcaveHull(object, excludeHiddenObjects ?? false, false);
    }

    public static getConvexHullVertices(
        object: Object3D,
        simplifyFactor: number = 0.7,
        excludeHiddenObjects?: boolean,
    ): number[] {
        return this.computeConvexHull(object, simplifyFactor, excludeHiddenObjects ?? false, false) as unknown as number[];
    }

    public static async getConvexHullVerticesAsync(
        object: Object3D,
        simplifyFactor: number = 0.7,
        excludeHiddenObjects?: boolean,
    ): Promise<number[]> {
        return this.computeConvexHull(object, simplifyFactor, excludeHiddenObjects ?? false, true);
    }

    public static async getConcaveHullVerticesAsync(
        object: Object3D,
        excludeHiddenObjects?: boolean,
    ): Promise<{ vertices: number[][]; indexes: number[][] }> {
        return this.computeConcaveHull(object, excludeHiddenObjects ?? false, true);
    }

    public static getSimplifiedGeometry(
        object: Object3D,
        simplifyFactor: number = 0.8,
        excludeHiddenObjects?: boolean,
    ): Array<BufferGeometry> {
        const parent = object.parent;
        if (parent) {
            object.parent = null;
        }

        const physicsConfig = PhysicsUtil.getPhysicsConfig(object);
        const userShapeScale = physicsConfig?.userShapeScale || { x: 1, y: 1, z: 1 };
        const simplifiedGeometry: Array<BufferGeometry> = [];
        const simplifyModifier = new SimplifyModifier();
        const prevPositionX = object.position.x;
        const prevPositionY = object.position.y;
        const prevPositionZ = object.position.z;
        const prevRotationX = object.rotation.x;
        const prevRotationY = object.rotation.y;
        const prevRotationZ = object.rotation.z;
        const prevRotationOrder = object.rotation.order;
        const prevScaleX = object.scale.x;
        const prevScaleY = object.scale.y;
        const prevScaleZ = object.scale.z;

        try {
            object.position.set(0, 0, 0);
            object.rotation.set(0, 0, 0);
            object.scale.multiply(userShapeScale);

            updateObjectMatrixWorldDepthFirst(object, true);

            const vertex = new Vector3();
            const traverseFn = (child: Object3D) => {
                if ((child as Mesh).isMesh && (child as Mesh).geometry) {
                    const mesh = child as Mesh;
                    const geometry = mesh.geometry.clone();

                    const positionAttribute = geometry.getAttribute("position");

                    // Skip if no position attribute or no data
                    if (!positionAttribute || !positionAttribute.array || positionAttribute.count === 0) {
                        return;
                    }

                    let newPositionAttribute = positionAttribute;

                    // if array is not Float32Array, convert it
                    if (!(positionAttribute.array as unknown instanceof Float32Array)) {
                        newPositionAttribute = new BufferAttribute(
                            new Float32Array(positionAttribute.array.length),
                            positionAttribute.itemSize,
                        );
                    }

                    for (let i = 0; i < positionAttribute.count; i++) {
                        mesh.getVertexPosition(i, vertex);
                        vertex.applyMatrix4(mesh.matrixWorld);
                        newPositionAttribute.setXYZ(i, vertex.x, vertex.y, vertex.z);
                    }

                    geometry.setAttribute("position", newPositionAttribute);

                    let newGeometry = geometry;

                    if (simplifyFactor > 0) {
                        try {
                            newGeometry = simplifyModifier.modify(
                                geometry,
                                Math.floor(positionAttribute.count * simplifyFactor),
                            );
                        } catch {
                            //error here but do nothing, just keep the original vertices
                        } finally {
                            if (newGeometry.getAttribute("position").count === 0) {
                                newGeometry = geometry;
                            }
                        }
                    }

                    simplifiedGeometry.push(newGeometry);
                }
            };

            if (excludeHiddenObjects) {
                traverseObjectVisibleDepthFirst(object, traverseFn);
            } else {
                traverseObjectDepthFirst(object, traverseFn);
            }
        } finally {
            object.position.set(prevPositionX, prevPositionY, prevPositionZ);
            object.rotation.set(prevRotationX, prevRotationY, prevRotationZ, prevRotationOrder);
            object.scale.set(prevScaleX, prevScaleY, prevScaleZ);

            if (parent) {
                object.parent = parent;
            }
        }

        return simplifiedGeometry;
    }

    public static removePhysicsObject(scene: Scene, physics: IPhysics | null, target: Object3D) {
        scene.remove(target);
        physics?.remove(target.uuid);
    }

    public static isPhysicsEnabled(target: Object3D): boolean {
        return PhysicsUtil.getPhysicsConfig(target)?.enabled || false;
    }

    public static isDynamicObject(target: Object3D) {
        const config = PhysicsUtil.getPhysicsConfig(target);
        if (!config?.enabled) return false;
        if (!config.ctype) return true; // legacy: missing ctype defaults to Dynamic
        return normalizeCType(config.ctype) === CollisionType.Dynamic;
    }

    /**
     * Update the transform of the object to match the physics position, roation
     * and scale.
     * 
     * @remarks
     * Note that positions, rotations and scales coming from the physics engine
     * are in world space, not local space. If the object is a child of another
     * object, we need to calculate the local space transform.
     * 
     * Additionally, the physics body can have an associated anchor offset and
     * anchor scale, which are taken into account when updating the transform.
     * 
     * The anchor offset is the offset of the physics body from the object's
     * origin. The anchor scale is the initial local scale of the object that
     * is "baked" into the physics shape.
     * 
     * The world space transform for the physics shape is calculated as follows:
     * 
     * ObjectTransform * AnchorScale * AnchorOffset
     * 
     * @param object - The object to update
     * @param bodyPosition - The physics body position, in word space
     * @param bodyQuaternion - The physics body rotation, in world space
     * @param bodyScale - The physics body scale, in world space
     */
    public static updateObjectTransformFromPhysics(
        object: Object3D,
        bodyPosition: Vector3Like,
        bodyQuaternion: QuaternionLike,
        bodyScale: Vector3Like,
    ): void {
        // Compose a matrix from the physics body's position, rotation and
        // scale (tmpMatrixA).
        PhysicsUtil.tmpVectorA.set(bodyPosition.x, bodyPosition.y, bodyPosition.z);
        PhysicsUtil.tmpQuaternionA.set(bodyQuaternion.x, bodyQuaternion.y, bodyQuaternion.z, bodyQuaternion.w);
        PhysicsUtil.tmpVectorB.set(bodyScale.x, bodyScale.y, bodyScale.z);
        PhysicsUtil.tmpMatrixA.compose(PhysicsUtil.tmpVectorA, PhysicsUtil.tmpQuaternionA, PhysicsUtil.tmpVectorB);

        // Apply the inverse anchor offset.
        const physicsConfig = PhysicsUtil.getPhysicsConfig(object);
        if (physicsConfig?.anchorOffset) {
            PhysicsUtil.tmpMatrixB.makeTranslation(
                -physicsConfig.anchorOffset.x,
                -physicsConfig.anchorOffset.y,
                -physicsConfig.anchorOffset.z,
            );
            PhysicsUtil.tmpMatrixA.multiply(PhysicsUtil.tmpMatrixB);
        }

        // Apply the inverse anchor scale.
        if (physicsConfig?.anchorScale) {
            PhysicsUtil.tmpMatrixB.makeScale(
                1.0 / physicsConfig.anchorScale.x,
                1.0 / physicsConfig.anchorScale.y,
                1.0 / physicsConfig.anchorScale.z,
            );
            PhysicsUtil.tmpMatrixA.multiply(PhysicsUtil.tmpMatrixB);
        }

        TransformUtils.setWorldTransform(object, PhysicsUtil.tmpMatrixA);
    }

    /**
     * Calculate the position, rotation and scale of the physics body (shape)
     * based on the object's transform.
     * 
     * @remarks
     * Note that bodyPosition, bodyQuaternion and bodyScale are in world space.
     * 
     * @see {@link updateObjectTransformFromPhysics} for details on how
     * anchor offsets and anchor scales are handled.
     * 
     * @param object - The object to calculate the physics transform for
     * @param bodyPosition - The physics body position, in world space
     * @param bodyQuaternion - The physics body rotation, in world space
     * @param bodyScale - The physics body scale, in world space
     */
    public static calculatePhysicsPositionFromObject(
        object: Object3D,
        bodyPosition: Vector3,
        bodyQuaternion: Quaternion,
        bodyScale: Vector3,
    ): void {
        // Start with the object's world matrix.
        object.updateWorldMatrix(true, false);
        PhysicsUtil.tmpMatrixA.copy(object.matrixWorld);

        // Apply the anchor scale.
        const physicsConfig = PhysicsUtil.getPhysicsConfig(object);
        if (physicsConfig?.anchorScale) {
            PhysicsUtil.tmpMatrixB.makeScale(
                physicsConfig.anchorScale.x,
                physicsConfig.anchorScale.y,
                physicsConfig.anchorScale.z,
            );
            PhysicsUtil.tmpMatrixA.multiply(PhysicsUtil.tmpMatrixB);
        }

        // Apply the anchor offset.
        if (physicsConfig?.anchorOffset) {
            PhysicsUtil.tmpMatrixB.makeTranslation(
                physicsConfig.anchorOffset.x,
                physicsConfig.anchorOffset.y,
                physicsConfig.anchorOffset.z,
            );
            PhysicsUtil.tmpMatrixA.multiply(PhysicsUtil.tmpMatrixB);
        }

        // Extract the physics body's position, rotation, and scale.
        PhysicsUtil.tmpMatrixA.decompose(bodyPosition, bodyQuaternion, bodyScale);
    }

    private static getCommonData(object: Object3D, physicsConfig: PhysicsConfig): CommonData {
        PhysicsUtil.calculatePhysicsPositionFromObject(
            object,
            PhysicsUtil.tmpVectorA,
            PhysicsUtil.tmpQuaternionA,
            PhysicsUtil.tmpVectorB,
        );

        return {
            uuid: object.uuid,
            template: "",
            name: object.name,
            position: {
                x: PhysicsUtil.tmpVectorA.x,
                y: PhysicsUtil.tmpVectorA.y,
                z: PhysicsUtil.tmpVectorA.z,
            },
            quaternion: {
                x: PhysicsUtil.tmpQuaternionA.x,
                y: PhysicsUtil.tmpQuaternionA.y,
                z: PhysicsUtil.tmpQuaternionA.z,
                w: PhysicsUtil.tmpQuaternionA.w,
            },
            scale: {
                x: PhysicsUtil.tmpVectorB.x,
                y: PhysicsUtil.tmpVectorB.y,
                z: PhysicsUtil.tmpVectorB.z,
            },
            mass: physicsConfig.mass,
            collision_flag: physicsConfig.ctype ? COLLISION_MAP.get(normalizeCType(physicsConfig.ctype) ?? physicsConfig.ctype) : CollisionFlag.DYNAMIC,
            restitution: physicsConfig.restitution,
            friction: physicsConfig.friction,
            rollingFriction: physicsConfig.rollingFriction,
            spinningFriction: physicsConfig.spinningFriction,
            contactStiffness: physicsConfig.contactStiffness,
            contactDamping: physicsConfig.contactDamping,
            ccd: physicsConfig.ccd === true,
            allowSleep: physicsConfig.allowSleep !== false,
            rotationLock: physicsConfig.rotationLock,
            //damping: physicsConfig.damping,
        };
    }

    /**
     * Map a PhysicsConfig shape type to a BodyShapeType.
     * 
     * @param shape - The PhysicsConfig shape type
     * @returns The corresponding BodyShapeType
     */
    public static toBodyShapeType(shape: unknown): BodyShapeType | undefined {
        if (typeof shape !== "string") return undefined;
        return RUNTIME_BODY_SHAPE_ALIASES[shape.trim().toLowerCase()];
    }
}
