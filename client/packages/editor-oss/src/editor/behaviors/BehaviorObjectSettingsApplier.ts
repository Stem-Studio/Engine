import * as THREE from "three";

import { ObjectSettings } from "./BehaviorConfig";
import global from "@stem/editor-oss/global";
import { BodyShapeType } from "../../physics/common/types";
import { PhysicsUtil } from "../../physics/PhysicsUtil";
import ShadowUtils from "@stem/editor-oss/utils/ShadowUtils";
import { CollisionType } from "../assets/v2/types/physics";
import {findObjectDepthFirst} from "../../utils/SceneTraverser";

/**
 * Class for applying object settings from the behavior configuration
 */
class BehaviorObjectSettingsApplier {
    private static readonly PRIMITIVE_GEOMETRY_TO_COLLIDER: Record<string, BodyShapeType> = {
        BoxGeometry: BodyShapeType.BOX,
        SphereGeometry: BodyShapeType.SPHERE,
        CapsuleGeometry: BodyShapeType.CAPSULE,
        PlaneGeometry: BodyShapeType.BOX,
        CylinderGeometry: BodyShapeType.BOX,
        ConeGeometry: BodyShapeType.BOX,
        TetrahedronGeometry: BodyShapeType.BOX,
        TorusGeometry: BodyShapeType.BOX,
        TorusKnotGeometry: BodyShapeType.BOX,
        IcosahedronGeometry: BodyShapeType.BOX,
        OctahedronGeometry: BodyShapeType.BOX,
        DodecahedronGeometry: BodyShapeType.BOX,
        RingGeometry: BodyShapeType.BOX,
    };
    
    static applyObjectSettings(object: THREE.Object3D, objectSettings?: ObjectSettings): void {
        if (!objectSettings) {
            return;
        }

        if (objectSettings.visibility) {
            this.applyVisibilitySettings(object, objectSettings.visibility);
        }

        if (objectSettings.physics) {
            this.applyPhysicsSettings(object, objectSettings.physics);
        }

        if (objectSettings.lighting) {
            this.applyLightingSettings(object, objectSettings.lighting);
        }

        global.app?.call("objectChanged", this, object);
    }

    private static applyVisibilitySettings(object: THREE.Object3D, visibilitySettings: ObjectSettings['visibility']): void {
        if (!visibilitySettings) return;
        
        if (visibilitySettings.visible !== undefined) {
            object.visible = visibilitySettings.visible;
        }
        
        if (visibilitySettings.backfaceCulling !== undefined) {
            if (object instanceof THREE.Mesh) {
                object.material.side = visibilitySettings.backfaceCulling ? THREE.FrontSide : THREE.DoubleSide;
            }
        }
    }

    private static applyPhysicsSettings(object: THREE.Object3D, physicsSettings: ObjectSettings['physics']): void {
        if (!physicsSettings) return;

        // Did the object already carry an explicit `enabled` choice (set by the
        // user, or by an import's `physics set`) BEFORE this behavior's default
        // physics was applied? A behavior's default physics is a convenience for
        // objects that have none — it must NOT silently override a deliberate
        // `enabled` value. Without this guard, attaching a behavior whose
        // default physics is `enabled:true` (e.g. the character controller's
        // dynamic capsule) onto an object whose physics was intentionally turned
        // off re-enables a body that then hijacks the object's transform — which
        // is exactly how a "disabled" character behavior froze the pirate ship.
        const hadExplicitEnabled = object.userData.physics?.enabled !== undefined;

        if (!object.userData.physics) {
            object.userData.physics = {
                enabled: false,
            };
        }

        if (physicsSettings.enabled !== undefined && !hadExplicitEnabled) {
            object.userData.physics.enabled = physicsSettings.enabled;
        }
        
        if (physicsSettings.mass !== undefined) {
            object.userData.physics.mass = physicsSettings.mass;
        }
        
        if (physicsSettings.type !== undefined) {
            const typeMap: Record<string, CollisionType> = {
                'dynamic': CollisionType.Dynamic,
                'static': CollisionType.Static,
                'kinematic': CollisionType.Kinematic,
            };
            object.userData.physics.ctype = typeMap[physicsSettings.type];
        }
        
        if (physicsSettings.shape !== undefined) {
            const shapeMap: Record<string, BodyShapeType> = {
                'box': BodyShapeType.BOX,
                'sphere': BodyShapeType.SPHERE,
                'capsule': BodyShapeType.CAPSULE,
                'convex': BodyShapeType.CONVEX_HULL,
                'concave': BodyShapeType.CONCAVE_HULL,
            };
            const requestedShape = shapeMap[physicsSettings.shape];
            const inferredPrimitiveShape =
                requestedShape === BodyShapeType.CAPSULE
                    ? this.getPrimitiveColliderShape(object)
                    : null;

            object.userData.physics.shape = inferredPrimitiveShape ?? requestedShape;
            PhysicsUtil.updateShapeOffsetAndScale(object);
        }
    }

    private static getPrimitiveColliderShape(object: THREE.Object3D): BodyShapeType | null {
        const meshWithGeometry = this.findFirstMeshWithGeometry(object);
        if (!meshWithGeometry) {
            return null;
        }

        return this.PRIMITIVE_GEOMETRY_TO_COLLIDER[meshWithGeometry.geometry.type] ?? null;
    }

    private static findFirstMeshWithGeometry(object: THREE.Object3D): THREE.Mesh | null {
        return findObjectDepthFirst(object, child => child instanceof THREE.Mesh && !!child.geometry) as THREE.Mesh | null;
    }

    private static applyLightingSettings(object: THREE.Object3D, lightingSettings: ObjectSettings['lighting']): void {
        if (!lightingSettings) return;
        
        if (object instanceof THREE.Mesh) {
            if (lightingSettings.castShadows !== undefined) {
                ShadowUtils.applyCastShadow(object, lightingSettings.castShadows, true);
            }
            
            if (lightingSettings.receiveShadows !== undefined) {
                ShadowUtils.applyReceiveShadow(object, lightingSettings.receiveShadows, true);
            }
        }
    }
}

export default BehaviorObjectSettingsApplier;
