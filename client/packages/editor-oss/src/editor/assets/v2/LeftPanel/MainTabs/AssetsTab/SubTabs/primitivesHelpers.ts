import {
    BoxGeometry,
    CapsuleGeometry,
    ConeGeometry,
    CylinderGeometry,
    DodecahedronGeometry,
    DoubleSide,
    IcosahedronGeometry,
    MeshStandardMaterial,
    Object3D,
    OctahedronGeometry,
    PlaneGeometry,
    RingGeometry,
    SphereGeometry,
    TetrahedronGeometry,
    TorusGeometry,
    TorusKnotGeometry,
    Vector3,
} from "three";
import {Font, FontLoader} from "three/addons/loaders/FontLoader.js";

import {PRIMITIVES_NAME} from "./PrimitivesTab";
import EngineRuntime from "@stem/editor-oss/EngineRuntime";
import {AddObjectCommand} from "@stem/editor-oss/command/Commands";
import Fire from "../../../../../../../object/component/Fire.js";
import Smoke from "../../../../../../../object/component/Smoke.js";
import {createMirror} from "../../../../../../../object/component/Mirror";
import Water from "../../../../../../../object/component/Water.js";
import Box from "../../../../../../../object/geometry/Box.js";
import Capsule from "../../../../../../../object/geometry/Capsule.js";
import Cone from "../../../../../../../object/geometry/Cone.js";
import CustomShape from "../../../../../../../object/geometry/CustomShape";
import CustomTube, {CurveType} from "../../../../../../../object/geometry/CustomTube";
import Cylinder from "../../../../../../../object/geometry/Cylinder.js";
import Dodecahedron from "../../../../../../../object/geometry/Dodecahedron.js";
import Icosahedron from "../../../../../../../object/geometry/Icosahedron.js";
import Octahedron from "../../../../../../../object/geometry/Octahedron.js";
import Plane from "../../../../../../../object/geometry/Plane.js";
import Ring from "../../../../../../../object/geometry/Ring.js";
import Sphere from "../../../../../../../object/geometry/Sphere.js";
import Text3D from "../../../../../../../object/geometry/Text3D";
import Torus from "../../../../../../../object/geometry/Torus.js";
import TorusKnot from "../../../../../../../object/geometry/TorusKnot.js";
import Triangle from "../../../../../../../object/geometry/Triangle.js";
import {generateUniqueName} from "../../../../../../../v2/pages/services";
import {BouncinessPreset, BOUNCINESS_PRESET_VALUES} from "../../../../types/physics";
import {generateRandomColor} from "../../../../utils/generateRandomColor";

export enum PRIMITIVES_GEOMETRY {
    PLANE = "PlaneGeometry",
    BOX = "BoxGeometry",
    CYLINDER = "CylinderGeometry",
    SPHERE = "SphereGeometry",
    CONE = "ConeGeometry",
    TRIANGLE = "TetrahedronGeometry",
    TORUS = "TorusGeometry",
    TORUSKNOT = "TorusKnotGeometry",
    CAPSULE = "CapsuleGeometry",
    ICOSAHEDRON = "IcosahedronGeometry",
    OCTAHEDRON = "OctahedronGeometry",
    DODECAHEDRON = "DodecahedronGeometry",
    RING = "RingGeometry",
}

const size = 1;
export const basePlaneY = 0.1;

const applyPrimitivePhysicsPreset = (object: Object3D, preset: BouncinessPreset) => {
    const presetValues = BOUNCINESS_PRESET_VALUES[preset];
    object.userData.physics = {
        ...(object.userData.physics || {}),
        collision_material: preset,
        bounciness_preset: preset,
        restitution: presetValues.restitution,
        friction: presetValues.friction,
        contactStiffness: presetValues.contactStiffness,
        contactDamping: presetValues.contactDamping,
    };
};

const getExistingNames = (engine: EngineRuntime): Set<string> => {
    return new Set(engine.editor?.scene.children.map(obj => obj.name));
};

const addObjectToSceneInCameraView = (object: Object3D, engine: EngineRuntime) => {
    engine.editor?.moveObjectToCameraClosestPoint(object);
    engine.editor?.execute(new AddObjectCommand(object));
};

const addObjectToSceneInClickPoint = (object: Object3D, engine: EngineRuntime) => {
    if (engine.editor) {
        const {mouseAuxPosition, sceneHelpers} = engine.editor;
        const point = engine.editor.computeIntersectPoint(mouseAuxPosition, sceneHelpers);
        engine.editor.moveObjectToPoint(object, point);
        engine.editor.execute(new AddObjectCommand(object));
    } else {
        console.error("EngineRuntime editor is not initialized.");
    }
};

export const handleAddPlane = (engine: EngineRuntime, callback?: (obj: Object3D) => void, cursorBased?: boolean) => {
    const material = new MeshStandardMaterial({
        color: generateRandomColor(),
        side: DoubleSide,
    });

    const geometry = new PlaneGeometry(10, 10);
    geometry.rotateX(-Math.PI / 2);

    const plane = new Plane(geometry, material);
    applyPrimitivePhysicsPreset(plane, BouncinessPreset.GROUND);
    plane.scale.set(1, basePlaneY, 1);
    const uniqueName = generateUniqueName(PRIMITIVES_NAME.PLANE, getExistingNames(engine));
    plane.name = uniqueName;
    material.name = uniqueName;

    if (cursorBased) {
        addObjectToSceneInClickPoint(plane, engine);
    } else {
        addObjectToSceneInCameraView(plane, engine);
    }

    callback?.(plane);
};

export const handleAddBox = (engine: EngineRuntime, callback?: (obj: Object3D) => void, cursorBased?: boolean) => {
    const material = new MeshStandardMaterial({
        color: generateRandomColor(),
    });
    const geometry = new BoxGeometry(size, size, size);
    const box = new Box(geometry, material);
    applyPrimitivePhysicsPreset(box, BouncinessPreset.PLASTIC);
    const uniqueName = generateUniqueName(PRIMITIVES_NAME.BOX, getExistingNames(engine));
    box.name = uniqueName;
    material.name = uniqueName;

    if (cursorBased) {
        addObjectToSceneInClickPoint(box, engine);
    } else {
        addObjectToSceneInCameraView(box, engine);
    }

    callback?.(box);
};

export const handleAddCylinder = (engine: EngineRuntime, callback?: (obj: Object3D) => void, cursorBased?: boolean) => {
    const material = new MeshStandardMaterial({
        color: generateRandomColor(),
    });
    const geometry = new CylinderGeometry(size / 2, size / 2, size, 32);
    const cylinder = new Cylinder(geometry, material);
    applyPrimitivePhysicsPreset(cylinder, BouncinessPreset.PLASTIC);
    const uniqueName = generateUniqueName(PRIMITIVES_NAME.CYLINDER, getExistingNames(engine));
    cylinder.name = uniqueName;
    material.name = uniqueName;

    if (cursorBased) {
        addObjectToSceneInClickPoint(cylinder, engine);
    } else {
        addObjectToSceneInCameraView(cylinder, engine);
    }

    callback?.(cylinder);
};

export const handleAddSphere = (engine: EngineRuntime, callback?: (obj: Object3D) => void, cursorBased?: boolean) => {
    const material = new MeshStandardMaterial({
        color: generateRandomColor(),
    });
    const geometry = new SphereGeometry(size / 2, 32, 32);
    const sphere = new Sphere(geometry, material);
    applyPrimitivePhysicsPreset(sphere, BouncinessPreset.PLASTIC);
    const uniqueName = generateUniqueName(PRIMITIVES_NAME.SPHERE, getExistingNames(engine));
    sphere.name = uniqueName;
    material.name = uniqueName;

    if (cursorBased) {
        addObjectToSceneInClickPoint(sphere, engine);
    } else {
        addObjectToSceneInCameraView(sphere, engine);
    }

    callback?.(sphere);
};

export const handleAddTriangle = (engine: EngineRuntime, callback?: (obj: Object3D) => void, cursorBased?: boolean) => {
    const material = new MeshStandardMaterial({
        color: generateRandomColor(),
    });
    const geometry = new TetrahedronGeometry(size, 0);
    const triangle = new Triangle(geometry, material);
    applyPrimitivePhysicsPreset(triangle, BouncinessPreset.PLASTIC);
    const uniqueName = generateUniqueName(PRIMITIVES_NAME.TRIANGLE, getExistingNames(engine));
    triangle.name = uniqueName;
    material.name = uniqueName;

    if (cursorBased) {
        addObjectToSceneInClickPoint(triangle, engine);
    } else {
        addObjectToSceneInCameraView(triangle, engine);
    }

    callback?.(triangle);
};

export const handleAddCone = (engine: EngineRuntime, callback?: (obj: Object3D) => void, cursorBased?: boolean) => {
    const material = new MeshStandardMaterial({
        color: generateRandomColor(),
    });
    const geometry = new ConeGeometry(size, size * 2, 32);
    const cone = new Cone(geometry, material);
    applyPrimitivePhysicsPreset(cone, BouncinessPreset.PLASTIC);
    const uniqueName = generateUniqueName(PRIMITIVES_NAME.CONE, getExistingNames(engine));
    cone.name = uniqueName;
    material.name = uniqueName;

    if (cursorBased) {
        addObjectToSceneInClickPoint(cone, engine);
    } else {
        addObjectToSceneInCameraView(cone, engine);
    }

    callback?.(cone);
};

export const handleAddTorus = (engine: EngineRuntime, callback?: (obj: Object3D) => void, cursorBased?: boolean) => {
    const material = new MeshStandardMaterial({
        color: generateRandomColor(),
    });
    const geometry = new TorusGeometry(size / 2, size / 4, 32, 32);
    const torus = new Torus(geometry, material);
    applyPrimitivePhysicsPreset(torus, BouncinessPreset.PLASTIC);
    const uniqueName = generateUniqueName(PRIMITIVES_NAME.TORUS, getExistingNames(engine));
    torus.name = uniqueName;
    material.name = uniqueName;

    if (cursorBased) {
        addObjectToSceneInClickPoint(torus, engine);
    } else {
        addObjectToSceneInCameraView(torus, engine);
    }

    callback?.(torus);
};

export const handleAddTorusKnot = (engine: EngineRuntime, callback?: (obj: Object3D) => void, cursorBased?: boolean) => {
    const material = new MeshStandardMaterial({
        color: generateRandomColor(),
    });
    const geometry = new TorusKnotGeometry(size / 2, size / 6, 64, 12, 2, 3);
    const torusKnot = new TorusKnot(geometry, material);
    applyPrimitivePhysicsPreset(torusKnot, BouncinessPreset.PLASTIC);
    const uniqueName = generateUniqueName(PRIMITIVES_NAME.TORUSKNOT, getExistingNames(engine));
    torusKnot.name = uniqueName;
    material.name = uniqueName;

    if (cursorBased) {
        addObjectToSceneInClickPoint(torusKnot, engine);
    } else {
        addObjectToSceneInCameraView(torusKnot, engine);
    }

    callback?.(torusKnot);
};

export const handleAddCapsule = (engine: EngineRuntime, callback?: (obj: Object3D) => void, cursorBased?: boolean) => {
    const material = new MeshStandardMaterial({
        color: generateRandomColor(),
    });
    const geometry = new CapsuleGeometry(size / 4, size / 2, 4, 8);
    const capsule = new Capsule(geometry, material);
    applyPrimitivePhysicsPreset(capsule, BouncinessPreset.PLASTIC);
    const uniqueName = generateUniqueName(PRIMITIVES_NAME.CAPSULE, getExistingNames(engine));
    capsule.name = uniqueName;
    material.name = uniqueName;

    if (cursorBased) {
        addObjectToSceneInClickPoint(capsule, engine);
    } else {
        addObjectToSceneInCameraView(capsule, engine);
    }

    callback?.(capsule);
};

export const handleAddIcosahedron = (engine: EngineRuntime, callback?: (obj: Object3D) => void, cursorBased?: boolean) => {
    const material = new MeshStandardMaterial({
        color: generateRandomColor(),
    });
    const geometry = new IcosahedronGeometry(size / 2, 0);
    const icosahedron = new Icosahedron(geometry, material);
    applyPrimitivePhysicsPreset(icosahedron, BouncinessPreset.PLASTIC);
    const uniqueName = generateUniqueName(PRIMITIVES_NAME.ICOSAHEDRON, getExistingNames(engine));
    icosahedron.name = uniqueName;
    material.name = uniqueName;

    if (cursorBased) {
        addObjectToSceneInClickPoint(icosahedron, engine);
    } else {
        addObjectToSceneInCameraView(icosahedron, engine);
    }

    callback?.(icosahedron);
};

export const handleAddOctahedron = (engine: EngineRuntime, callback?: (obj: Object3D) => void, cursorBased?: boolean) => {
    const material = new MeshStandardMaterial({
        color: generateRandomColor(),
    });
    const geometry = new OctahedronGeometry(size / 2, 0);
    const octahedron = new Octahedron(geometry, material);
    applyPrimitivePhysicsPreset(octahedron, BouncinessPreset.PLASTIC);
    const uniqueName = generateUniqueName(PRIMITIVES_NAME.OCTAHEDRON, getExistingNames(engine));
    octahedron.name = uniqueName;
    material.name = uniqueName;

    if (cursorBased) {
        addObjectToSceneInClickPoint(octahedron, engine);
    } else {
        addObjectToSceneInCameraView(octahedron, engine);
    }

    callback?.(octahedron);
};

export const handleAddDodecahedron = (engine: EngineRuntime, callback?: (obj: Object3D) => void, cursorBased?: boolean) => {
    const material = new MeshStandardMaterial({
        color: generateRandomColor(),
    });
    const geometry = new DodecahedronGeometry(size / 2, 0);
    const dodecahedron = new Dodecahedron(geometry, material);
    applyPrimitivePhysicsPreset(dodecahedron, BouncinessPreset.PLASTIC);
    const uniqueName = generateUniqueName(PRIMITIVES_NAME.DODECAHEDRON, getExistingNames(engine));
    dodecahedron.name = uniqueName;
    material.name = uniqueName;

    if (cursorBased) {
        addObjectToSceneInClickPoint(dodecahedron, engine);
    } else {
        addObjectToSceneInCameraView(dodecahedron, engine);
    }

    callback?.(dodecahedron);
};

export const handleAddRing = (engine: EngineRuntime, callback?: (obj: Object3D) => void, cursorBased?: boolean) => {
    const material = new MeshStandardMaterial({
        color: generateRandomColor(),
        side: DoubleSide,
    });
    const geometry = new RingGeometry(size / 4, size / 2, 32);
    const ring = new Ring(geometry, material);
    applyPrimitivePhysicsPreset(ring, BouncinessPreset.PLASTIC);
    const uniqueName = generateUniqueName(PRIMITIVES_NAME.RING, getExistingNames(engine));
    ring.name = uniqueName;
    material.name = uniqueName;

    if (cursorBased) {
        addObjectToSceneInClickPoint(ring, engine);
    } else {
        addObjectToSceneInCameraView(ring, engine);
    }

    callback?.(ring);
};

export const handleAddCustomShape = (
    engine: EngineRuntime,
    svgPath: string,
    callback?: (obj: Object3D) => void,
    cursorBased?: boolean,
) => {
    const material = new MeshStandardMaterial({
        color: generateRandomColor(),
        side: DoubleSide,
    });
    const customShape = new CustomShape(svgPath, undefined, material);
    applyPrimitivePhysicsPreset(customShape, BouncinessPreset.PLASTIC);
    const uniqueName = generateUniqueName(PRIMITIVES_NAME.CUSTOM_SHAPE, getExistingNames(engine));
    customShape.name = uniqueName;
    material.name = uniqueName;

    if (cursorBased) {
        addObjectToSceneInClickPoint(customShape, engine);
    } else {
        addObjectToSceneInCameraView(customShape, engine);
    }

    callback?.(customShape);
};

export const handleAddCustomTube = (
    engine: EngineRuntime,
    curvePoints: Vector3[],
    curveType: CurveType,
    tubularSegments: number,
    radius: number,
    radialSegments: number,
    closed: boolean,
    extrudeDepth: number,
    callback?: (obj: Object3D) => void,
    cursorBased?: boolean,
) => {
    const material = new MeshStandardMaterial({
        color: generateRandomColor(),
    });

    // CustomTube expects Vector3[] - they should already be Vector3 from the dialog
    const customTube = new CustomTube(
        curvePoints,
        curveType,
        tubularSegments,
        radius,
        radialSegments,
        closed,
        extrudeDepth,
        undefined,
        material,
    );
    applyPrimitivePhysicsPreset(customTube, BouncinessPreset.PLASTIC);
    const uniqueName = generateUniqueName(
        extrudeDepth > 0 ? "Custom Extruded Shape" : PRIMITIVES_NAME.CUSTOM_TUBE,
        getExistingNames(engine),
    );
    customTube.name = uniqueName;
    material.name = uniqueName;

    if (cursorBased) {
        addObjectToSceneInClickPoint(customTube, engine);
    } else {
        addObjectToSceneInCameraView(customTube, engine);
    }

    callback?.(customTube);
};

let cachedFont: Font | null = null;

export const handleAddText3D = async (engine: EngineRuntime, callback?: (obj: Object3D) => void, cursorBased?: boolean) => {
    try {
        // Load font if not already loaded
        if (!cachedFont) {
            const fontLoader = new FontLoader();
            cachedFont = await new Promise<Font>((resolve, reject) => {
                fontLoader.load(
                    "/assets/fonts/helvetiker_regular.typeface.json",
                    (font: Font) => resolve(font),
                    undefined,
                    (error: unknown) => reject(error),
                );
            });
        }

        const material = new MeshStandardMaterial({
            color: generateRandomColor(),
        });

        // Default configuration
        const text3D = new Text3D(
            "Text",
            cachedFont,
            {
                fontSize: 1,
                lineHeight: 1.2,
                spacing: 0,
                fontName: "helvetiker",
                weight: "regular",
                horizontalAlign: "center",
                verticalAlign: "middle",
                case: "normal",
                extrusion: 0.2,
                bevel: 0,
                bevelSides: 1,
            },
            material,
        );
        applyPrimitivePhysicsPreset(text3D, BouncinessPreset.PLASTIC);

        const uniqueName = generateUniqueName(PRIMITIVES_NAME.TEXT_3D, getExistingNames(engine));
        text3D.name = uniqueName;
        material.name = uniqueName;

        if (cursorBased) {
            addObjectToSceneInClickPoint(text3D, engine);
        } else {
            addObjectToSceneInCameraView(text3D, engine);
        }

        callback?.(text3D);
    } catch (error) {
        console.error("Failed to load font or create text:", error);
    }
};

export const handleAddFire = (engine: EngineRuntime, callback?: (obj: Object3D) => void, cursorBased?: boolean) => {
    // Fire uses WebGPU-compatible TSL particle system (no longer requires camera)
    const camera = engine.editor?.camera;
    if (!camera) return;

    const fire = new Fire(camera, {
        width: 2,
        height: 4,
        depth: 2,
        particleCount: 200,
        intensity: 1.0,
    }) as unknown as Object3D;
    const uniqueName = generateUniqueName("Fire", getExistingNames(engine));
    fire.name = uniqueName;

    if (cursorBased) {
        addObjectToSceneInClickPoint(fire, engine);
    } else {
        addObjectToSceneInCameraView(fire, engine);
    }

    callback?.(fire);
};

export const handleAddSmoke = (engine: EngineRuntime, callback?: (obj: Object3D) => void, cursorBased?: boolean) => {
    // Smoke uses WebGPU-compatible TSL particle system (no longer requires camera/renderer)
    const smoke = new Smoke({
        particleCount: 64,
        size: 3,
        lifetime: 10,
        color: 0x888888,
        spreadRadius: 1,
        riseSpeed: 0.5,
    }) as unknown as Object3D;
    const uniqueName = generateUniqueName("Smoke", getExistingNames(engine));
    smoke.name = uniqueName;

    if (cursorBased) {
        addObjectToSceneInClickPoint(smoke, engine);
    } else {
        addObjectToSceneInCameraView(smoke, engine);
    }

    callback?.(smoke);
};

export const handleAddWater = (engine: EngineRuntime, callback?: (obj: Object3D) => void, cursorBased?: boolean) => {
    // Water uses WebGPU-compatible TSL procedural waves (no longer requires renderer)
    const water = new Water({
        size: 100,
        segments: 64,
        waterColor: 0x0077be, // Ocean blue
        waveHeight: 0.5,
        waveSpeed: 1.0,
    }) as unknown as Object3D;
    const uniqueNameWater = generateUniqueName("Water", getExistingNames(engine));
    water.name = uniqueNameWater;

    if (cursorBased) {
        addObjectToSceneInClickPoint(water, engine);
    } else {
        addObjectToSceneInCameraView(water, engine);
    }

    callback?.(water);
};

export const handleAddMirror = (engine: EngineRuntime, callback?: (obj: Object3D) => void, cursorBased?: boolean) => {
    // Flat mirror primitive — reflects the scene via the `reflector()` TSL node.
    // Pairs with the global SSR pass: SSR covers any metallic surface but only
    // reflects what's on-screen; a dedicated Mirror reflects off-screen geometry
    // with a dedicated render target.
    const mirror = createMirror({width: 2, height: 2}) as unknown as Object3D;
    mirror.name = generateUniqueName("Mirror", getExistingNames(engine));

    if (cursorBased) {
        addObjectToSceneInClickPoint(mirror, engine);
    } else {
        addObjectToSceneInCameraView(mirror, engine);
    }

    callback?.(mirror);
};
