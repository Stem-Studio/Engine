import { useEffect, useState } from "react";
import {
    BoxGeometry,
    BufferGeometry,
    CapsuleGeometry,
    DoubleSide,
    Light,
    Mesh,
    MeshBasicMaterial,
    Object3D,
    Quaternion,
    SphereGeometry,
    Vector3,
} from "three";
import { ConvexGeometry } from "three/addons/geometries/ConvexGeometry.js";

import { PhysicsCheckboxes } from "./PhysicsCheckboxes";
import { PhysicsNumericInput } from "./PhysicsNumericInput";
import { PhysicsSelect } from "./PhysicsSelect";
import EngineRuntime from "@stem/editor-oss/EngineRuntime";
import global from "@stem/editor-oss/global";
import { BodyShapeType } from "../../../../../../physics/common/types";
import { PhysicsUtil } from "../../../../../../physics/PhysicsUtil";
import { COLLISION_MATERIAL_TYPE } from "@stem/editor-oss/types/editor";
import { Item } from "../../../common/BasicCombobox/BasicCombobox";
import { BouncinessPreset, BOUNCINESS_PRESET_VALUES, CollisionType, PhysicsConfig, Shape } from "../../../types/physics";
import { getPhysics } from "../../../utils/getPhysics";
import { IPhysicsHandler } from "../PhysicsSection";

const collistionTypes = Object.keys(CollisionType).map(key => {
    return {
        key: `${key}`,
        value: CollisionType[key as keyof typeof CollisionType],
    };
});

const getShapes = (isNotMesh: boolean) => {
    const shapes = Object.keys(Shape).map(key => {
        return {
            key: `${key}`,
            value: Shape[key as keyof typeof Shape],
        };
    });

    if (isNotMesh) {
        return shapes.filter(shape => shape.key !== "btSphereShape");
    } else {
        return shapes;
    }
};

interface Props {
    isLocked?: boolean;
}

export const PhysicsSection = ({ isLocked }: Props) => {
    const app = global.app as EngineRuntime;
    const editor = app?.editor;
    const selected = editor?.selected;

    const previewShapeColor = 0x00ff00;
    const previewShapeOpacity = 0.5;

    let userData: any = undefined;
    let rigidBodyPreviewObjects = [] as any;
    if (selected && !(selected instanceof Array)) {
        userData = selected?.userData;
    }

    const [physicsEnabledState, setPhysicsEnabledState] = useState(userData?.physics?.enabled ?? false);
    const [physics, setPhysics] = useState(getPhysics(userData?.physics));
    const [shapes, setShapes] = useState(getShapes(!(selected instanceof Mesh)));

    const collisionMaterialOptions: Item[] = Object.values(COLLISION_MATERIAL_TYPE).map((material, index) => ({
        key: index.toString(),
        value: material,
    }));

    const bouncinessPresetOptions: Item[] = Object.values(BouncinessPreset).map((preset, index) => ({
        key: index.toString(),
        value: preset,
    }));

    const handleCollisionMaterialChange = (value: string) => {
        const selected = app.editor?.selected;
        if (selected && !(selected instanceof Array) && selected?.userData?.physics) {
            selected.userData.physics = {
                ...selected.userData.physics,
                collision_material: value,
            };
            setPhysics(getPhysics(selected.userData.physics));
            app?.call(`objectChanged`, selected, selected);
        }
    };

    const handleBouncinessPresetChange = (preset: BouncinessPreset) => {
        const selected = app.editor?.selected;
        if (selected && !(selected instanceof Array) && selected?.userData?.physics) {
            const presetValues = BOUNCINESS_PRESET_VALUES[preset];
            if (preset === BouncinessPreset.CUSTOM) {
                selected.userData.physics = {
                    ...selected.userData.physics,
                    bounciness_preset: preset,
                };
            } else {
                selected.userData.physics = {
                    ...selected.userData.physics,
                    bounciness_preset: preset,
                    restitution: presetValues.restitution,
                    friction: presetValues.friction,
                    contactStiffness: presetValues.contactStiffness,
                    contactDamping: presetValues.contactDamping,
                };
            }
            setPhysics(getPhysics(selected.userData.physics));
            app?.call(`objectChanged`, selected, selected);
        }
    };
    const clearScenePreviewObjects = () => {
        if (!rigidBodyPreviewObjects) {
            return;
        }

        const sceneHelpers = app?.editor?.sceneHelpers;
        if (sceneHelpers) {
            while (rigidBodyPreviewObjects.length > 0) {
                const object = rigidBodyPreviewObjects.pop();
                sceneHelpers.remove(object);
            }
        }
    };

    const handlePhysicsChange = (arg: IPhysicsHandler) => {
        const { value, name } = arg;
        if (
            name === "ctype" &&
            value !== CollisionType.Dynamic &&
            selected &&
            !(selected instanceof Array) &&
            selected?.userData.physics.mass > 0
        ) {
            selected.userData.physics = {
                ...selected.userData.physics,
                [name]: value,
                mass: 0,
            };
            app?.call(`objectChanged`, selected, selected);
            return;
        }

        if (selected && !(selected instanceof Array) && selected?.userData.physics) {
            if (name === "ctype" && value === CollisionType.Dynamic) {
                selected.userData.physics = {
                    ...selected.userData.physics,
                    [name]: value,
                    mass: 1,
                };
            } else {
                selected.userData.physics = {
                    ...selected.userData.physics,
                    [name]: value,
                };
            }
        }

        app?.call(`objectChanged`, selected, selected);
    };

    const updatePhysics = () => {
        clearScenePreviewObjects();

        const selected = app.editor?.selected;
        if (!selected || selected instanceof Array || (selected as unknown) instanceof Light) {
            return;
        }

        const physicsConfig = PhysicsUtil.getPhysicsConfig(selected);
        setPhysics(getPhysics(physicsConfig));
        setShapes(getShapes(!((selected as unknown) instanceof Mesh)));
        setPhysicsEnabledState(physicsConfig?.enabled ?? true);

        const sceneHelpers = app?.editor?.sceneHelpers;
        if (!sceneHelpers || !physicsConfig?.enable_preview || !physicsConfig?.enabled) {
            return;
        }

        selected.updateMatrixWorld(true);
        PhysicsUtil.updateShapeOffsetAndScale(selected);

        let previewObject: Object3D | Object3D[] | null = null;
        switch (physicsConfig.shape) {
            case "btBoxShape":
                previewObject = getBoxPreview(selected);
                break;
            case "btSphereShape":
                previewObject = getSpherePreview(selected);
                break;
            case "btCapsuleShape":
                previewObject = getCapsulePreview(selected);
                break;
            case "btConcaveHullShape":
                previewObject = getConcaveHullPreview(selected);
                break;
            case "btConvexHullShape":
                previewObject = getConvexHullPreview(selected);
                break;
            default:
                break;
        }

        if (!previewObject) {
            return;
        }

        const previewObjects = previewObject instanceof Array ? previewObject : [previewObject];

        previewObjects.forEach(obj => {
            rigidBodyPreviewObjects.push(obj);
            sceneHelpers.add(obj);
        });
    };

    const getBoxPreview = (object: Object3D) => {
        const physicsConfig = PhysicsUtil.getPhysicsConfig(object)!;
        const { width, height, length } = PhysicsUtil.getShapeData(object, BodyShapeType.BOX, physicsConfig.shapeExcludesHiddenObjects);
        const boxGeometry = new BoxGeometry(width, height, length);
        const boxMaterial = new MeshBasicMaterial({
            color: previewShapeColor,
            transparent: true,
            opacity: previewShapeOpacity,
        });
        const boxMesh = new Mesh(boxGeometry, boxMaterial);

        PhysicsUtil.calculatePhysicsPositionFromObject(object, boxMesh.position, boxMesh.quaternion, boxMesh.scale);

        boxMesh.name = "rigidBodyPreview_" + boxMesh.name;
        return boxMesh;
    };

    const getSpherePreview = (object: Object3D) => {
        const physicsConfig = PhysicsUtil.getPhysicsConfig(object)!;
        const { radius } = PhysicsUtil.getShapeData(object, BodyShapeType.SPHERE, physicsConfig.shapeExcludesHiddenObjects);
        if (radius <= 0) {
            return null;
        }

        const sphereGeometry = new SphereGeometry(radius);
        const sphereMaterial = new MeshBasicMaterial({
            color: previewShapeColor,
            transparent: true,
            opacity: previewShapeOpacity,
        });
        const sphereMesh = new Mesh(sphereGeometry, sphereMaterial);

        PhysicsUtil.calculatePhysicsPositionFromObject(
            object,
            sphereMesh.position,
            sphereMesh.quaternion,
            sphereMesh.scale,
        );

        sphereMesh.name = "rigidBodyPreview_" + sphereMesh.name;
        return sphereMesh;
    };

    const getConcaveHullPreview = (object: Object3D) => {
        // this is hacky, but it's the same way we calculate the concave hull for physics
        const physicsConfig = PhysicsUtil.getPhysicsConfig(object)!;
        const geometrySimplified = PhysicsUtil.getSimplifiedGeometry(object, 0, physicsConfig.shapeExcludesHiddenObjects);
        if (geometrySimplified.length === 0) {
            return null;
        }

        const meshes: Mesh[] = [];

        geometrySimplified.forEach((geometry: BufferGeometry) => {
            const concaveMaterial = new MeshBasicMaterial({
                color: previewShapeColor,
                transparent: true,
                opacity: previewShapeOpacity,
                side: DoubleSide, // Disable backface culling
            });
            const concaveMesh = new Mesh(geometry, concaveMaterial);

            PhysicsUtil.calculatePhysicsPositionFromObject(
                object,
                concaveMesh.position,
                concaveMesh.quaternion,
                concaveMesh.scale,
            );

            concaveMesh.name = "rigidBodyPreview_" + concaveMesh.name;
            meshes.push(concaveMesh);
        });

        return meshes;
    };

    const getConvexHullPreview = (object: Object3D) => {
        const physicsConfig = PhysicsUtil.getPhysicsConfig(object)!;
        const hullPoints = PhysicsUtil.getShapeData(object, BodyShapeType.CONVEX_HULL, physicsConfig.shapeExcludesHiddenObjects).vertices;

        const convexVerts: Vector3[] = [];
        for (let i = 0; i < hullPoints.length; i += 3) {
            convexVerts.push(new Vector3(hullPoints[i], hullPoints[i + 1], hullPoints[i + 2]));
        }

        const convexGeometry = new ConvexGeometry(convexVerts);
        const convexMaterial = new MeshBasicMaterial({
            color: previewShapeColor,
            transparent: true,
            opacity: previewShapeOpacity,
        });
        const convexMesh = new Mesh(convexGeometry, convexMaterial);

        PhysicsUtil.calculatePhysicsPositionFromObject(
            object,
            convexMesh.position,
            convexMesh.quaternion,
            convexMesh.scale,
        );

        convexMesh.name = "rigidBodyPreview_" + convexMesh.name;

        return convexMesh;
    };

    const getCapsulePreview = (object: Object3D) => {
        const physicsConfig = PhysicsUtil.getPhysicsConfig(object)!;
        const { radius, height } = PhysicsUtil.getShapeData(object, BodyShapeType.CAPSULE, physicsConfig.shapeExcludesHiddenObjects);

        const position = new Vector3();
        const quaternion = new Quaternion();
        const scale = new Vector3();
        PhysicsUtil.calculatePhysicsPositionFromObject(
            object,
            position,
            quaternion,
            scale,
        );

        // Scale the radius and height directly instead of applying the scale
        // to capsuleMesh.scale; otherwise the ends of the capsule will distort.
        // This implementation keeps the ends of the capsule spherical.
        const capsuleGeometry = new CapsuleGeometry(radius * scale.x, height * scale.y, 4, 12);
        const capsuleMaterial = new MeshBasicMaterial({
            color: previewShapeColor,
            transparent: true,
            opacity: previewShapeOpacity,
        });

        const capsuleMesh = new Mesh(capsuleGeometry, capsuleMaterial);
        capsuleMesh.position.copy(position);
        capsuleMesh.quaternion.copy(quaternion);

        PhysicsUtil.calculatePhysicsPositionFromObject(
            object,
            capsuleMesh.position,
            capsuleMesh.quaternion,
            capsuleMesh.scale,
        );

        capsuleMesh.name = "rigidBodyPreview_" + capsuleMesh.name;
        return capsuleMesh;
    };

    useEffect(() => {
        app?.on("objectChanged.PhysicsSection", updatePhysics);
        app?.on("objectSelected.PhysicsSection", updatePhysics);
        app?.on("objectArraySelected.PhysicsSection", updatePhysics);

        return () => {
            clearScenePreviewObjects();
            app?.on("objectChanged.PhysicsSection", null);
            app?.on("objectSelected.PhysicsSection", null);
            app?.on("objectArraySelected.PhysicsSection", null);
        };
    }, []);

    useEffect(() => {
        if (physicsEnabledState !== undefined) {
            if (selected && !(selected instanceof Array) && selected?.userData) {
                if (!selected?.userData.physics) {
                    selected.userData.physics = {};
                }
                selected.userData.physics.enabled = physicsEnabledState;
                app?.call(`objectChanged`, selected, selected);
            }
        }
    }, [physicsEnabledState]);

    useEffect(() => {
        if (selected && !(selected instanceof Array) && selected?.userData?.physics) {
            setPhysicsEnabledState(selected.userData.physics.enabled);
        }
    }, [selected]);

    useEffect(() => {
        // ensure that the physics state always is synced with the selected object physics
        if (physics && selected && !(selected instanceof Array) && selected?.userData) {
            if (selected?.userData.physics) {
                Object.keys(physics).forEach(key => {
                    if (physics[key as keyof PhysicsConfig] !== undefined) {
                        selected.userData.physics[key as keyof PhysicsConfig] = physics[key as keyof PhysicsConfig];
                    }
                });
            }
        }
    }, [physics]);

    return (
        <>

            <PhysicsCheckboxes
                handlePhysicsChange={handlePhysicsChange}
                physicsEnabledState={physicsEnabledState}
                setPhysicsEnabledState={setPhysicsEnabledState}
                isLocked={isLocked}
                physics={physics}
            />
            {physicsEnabledState &&
                <>
                    <PhysicsNumericInput
                        handlePhysicsChange={handlePhysicsChange}
                        physics={physics}
                        isLocked={isLocked}
                        bouncinessPresetOptions={bouncinessPresetOptions}
                        handleBouncinessPresetChange={handleBouncinessPresetChange}
                        collisionMaterialOptions={collisionMaterialOptions}
                        handleCollisionMaterialChange={handleCollisionMaterialChange}
                        section="bounciness"
                    />
                    <PhysicsSelect
                        physics={physics}
                        shapes={shapes}
                        collistionTypes={collistionTypes}
                        isLocked={isLocked}
                        handlePhysicsChange={handlePhysicsChange}
                        section="physicsType"
                    />
                </>
            }

        </>
    );
};
