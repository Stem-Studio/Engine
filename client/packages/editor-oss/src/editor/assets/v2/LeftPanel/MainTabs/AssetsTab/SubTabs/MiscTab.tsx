import I18n from "i18next";
import {useCallback, useEffect, useMemo, useState} from "react";
import * as THREE from "three";

import {useThrottle} from "./hooks/useThrottle";
import EngineRuntime, {
    BILLBOARD_BEHAVIOR_ID,
    CESIUM_BEHAVIOR_ID,
    IMAGE_BILLBOARD_BEHAVIOR_ID,
    VIDEO_BILLBOARD_BEHAVIOR_ID,
    GENERIC_SOUND_BEHAVIOR_ID,
    SPAWN_POINT_BEHAVIOR_ID,
    VOLUME_BEHAVIOR_ID,
    TERRAIN_BEHAVIOR_ID,
} from "@stem/editor-oss/EngineRuntime";
import {BehaviorThrottlePriority} from "../../../../../../../behaviors/performance/interfaces/IThrottleStrategy";
import {AddObjectCommand, AttachBehaviorCommand} from "@stem/editor-oss/command/Commands";
import {useAppGlobalContext, useAuthorizationContext} from "@stem/editor-oss/context";
import {RIGHT_PANEL_VERSIONS} from "@stem/editor-oss/context/appStateTypes";
import Editor from "../../../../../../../editor/Editor";
import global from "@stem/editor-oss/global";
import {ExtendedDirectionalLight} from "@stem/editor-oss/light/ExtendedDirectionalLight";
import Plane from "../../../../../../../object/geometry/Plane";
import {generateUniqueName} from "../../../../../../../v2/pages/services";
import {IconsFlexContainer} from "../../../../common/IconsFlexContainer";
import directionalLight from "../../../../icons/assetsTab/lights/directional.svg";
import pointLight from "../../../../icons/assetsTab/lights/point.svg";
import rectAreaLight from "../../../../icons/assetsTab/lights/rect-area.svg";
import spotLight from "../../../../icons/assetsTab/lights/spot.svg";
import avatarCreatorIcon from "../../../../ActionBar/icons/avatar-creator.jpg";
import billboardIcon from "../../../../icons/assetsTab/misc/billboard.svg";
import boxIcon from "../../../../icons/assetsTab/misc/box.svg";
import spawnPoint from "../../../../icons/assetsTab/misc/spawn-point.svg";
import soundIcon from "../../../../icons/assetsTab/new-misc/sound.svg";
import terrainIcon from "../../../../icons/assetsTab/terrain/terrain.svg";
import {handleAddCesium} from "../../../../utils/createCesium";
import {handleAddTerrain} from "../../../../utils/createTerrain";

export enum LIGHT_NAME {
    SPOT = "Spot Light",
    POINT = "Point Light",
    DIRECTIONAL = "Directional",
    AMBIENT = "Ambient",
    RECT_AREA = "Rect Area Light",
    HEMISPHERE = "Hemisphere Light",
}

export enum NEW_MISC_NAME {
    TERRAIN = "Terrain",
    CESIUM = "Cesium Globe",
    BILLBOARD = "Billboard",
    IMAGE_BILLBOARD = "Image Billboard",
    VIDEO_BILLBOARD = "Video Billboard",
    VOLUMES = "Scene Volumes",
    SPAWN_POINT = "Spawn Point",
    POINT_SOUND = "Point Sound",
    DEFAULT_LIGHTS_FOG = "Environment lights and fog",
    AVATAR_CREATOR = "Avatar Creator",
}

export const ADMIN_ONLY_MISC_NAMES = [NEW_MISC_NAME.CESIUM, LIGHT_NAME.RECT_AREA];

const LIGHTS_MISC_OPTIONS = [
    {icon: terrainIcon, text: "Terrain", name: NEW_MISC_NAME.TERRAIN},
    {icon: terrainIcon, text: "Cesium Globe", name: NEW_MISC_NAME.CESIUM},
    {icon: billboardIcon, text: NEW_MISC_NAME.BILLBOARD, name: NEW_MISC_NAME.BILLBOARD},
    {icon: billboardIcon, text: NEW_MISC_NAME.IMAGE_BILLBOARD, name: NEW_MISC_NAME.IMAGE_BILLBOARD},
    {icon: billboardIcon, text: NEW_MISC_NAME.VIDEO_BILLBOARD, name: NEW_MISC_NAME.VIDEO_BILLBOARD},
    {icon: boxIcon, text: "Scene Volumes", name: NEW_MISC_NAME.VOLUMES},
    {icon: spawnPoint, text: "Spawn Point", name: NEW_MISC_NAME.SPAWN_POINT},
    {icon: soundIcon, text: "Point Sound", name: NEW_MISC_NAME.POINT_SOUND},
    {icon: avatarCreatorIcon, text: "Avatar Creator", name: NEW_MISC_NAME.AVATAR_CREATOR},
    {
        icon: directionalLight,
        text: "Directional </br> Light",
        name: LIGHT_NAME.DIRECTIONAL,
    },
    {
        icon: rectAreaLight,
        text: "Rect Area </br> Light",
        name: LIGHT_NAME.RECT_AREA,
    },
    {icon: pointLight, text: "Point Light", name: LIGHT_NAME.POINT},
    {icon: spotLight, text: "Spot Light", name: LIGHT_NAME.SPOT},
    // {icon: ambientLight, text: "Ambient </br> Light", name: LIGHT_NAME.AMBIENT},
    // {
    //     icon: hemisphereLight,
    //     text: "Hemisphere </br> Light",
    //     name: LIGHT_NAME.HEMISPHERE,
    // },
];

export const MiscTab = ({search, isOpen}: {search: string; isOpen: boolean}) => {
    const {isAdmin} = useAuthorizationContext();
    const {setActiveRightPanel} = useAppGlobalContext();
    const [toolAvailability, setToolAvailability] = useState({hasTerrain: false, hasCesium: false});
    const engine = global.app as EngineRuntime;
    const editor = engine.editor as Editor;

    // Check if terrain exists in the scene
    const checkForTerrain = useCallback(() => {
        let terrainExists = false;
        let cesiumExists = false;
        editor?.scene?.traverse((object: THREE.Object3D) => {
            const behaviors = object.userData?.behaviors;
            if (Array.isArray(behaviors)) {
                const behavior = behaviors.find((b: {id: string}) => b.id === TERRAIN_BEHAVIOR_ID);
                if (behavior) {
                    terrainExists = true;
                }
                const cesiumBehavior = behaviors.find((b: {id: string}) => b.id === CESIUM_BEHAVIOR_ID);
                if (cesiumBehavior) {
                    cesiumExists = true;
                }
            }
        });
        setToolAvailability({hasTerrain: terrainExists, hasCesium: cesiumExists});
    }, [editor]);
    const throttledCheckForTerrain = useThrottle(checkForTerrain, 200);

    // Check for terrain on mount and when scene changes
    useEffect(() => {
        checkForTerrain();

        // Listen for scene changes
        engine?.on("sceneGraphChanged.MiscTab", throttledCheckForTerrain);
        engine?.on("objectAdded.MiscTab", throttledCheckForTerrain);
        engine?.on("objectRemoved.MiscTab", throttledCheckForTerrain);

        return () => {
            engine?.on("sceneGraphChanged.MiscTab", null);
            engine?.on("objectAdded.MiscTab", null);
            engine?.on("objectRemoved.MiscTab", null);
        };
    }, [engine, checkForTerrain, throttledCheckForTerrain]);

    const list = useMemo(() => {
        const visibleOptions = LIGHTS_MISC_OPTIONS.filter(n => n.name !== NEW_MISC_NAME.AVATAR_CREATOR);
        const options = isAdmin ? visibleOptions : visibleOptions.filter(n => !ADMIN_ONLY_MISC_NAMES.includes(n.name));
        return options.map(option => ({
            ...option,
            disabled: (option.name === NEW_MISC_NAME.TERRAIN && toolAvailability.hasTerrain) ||
                (option.name === NEW_MISC_NAME.CESIUM && toolAvailability.hasCesium),
            disabledTooltip:
                option.name === NEW_MISC_NAME.TERRAIN && toolAvailability.hasTerrain
                    ? "Terrain already exists in scene"
                    : option.name === NEW_MISC_NAME.CESIUM && toolAvailability.hasCesium
                        ? "Cesium Globe already exists in scene"
                        : undefined,
        }));
    }, [isAdmin, toolAvailability]);
    const [filteredList, setFilteredList] = useState<typeof list>(list);

    // Helper to get current names in the scene
    const getCurrentNames = (): Set<string> => {
        const names = new Set<string>();
        editor?.scene.children.forEach((child: THREE.Object3D) => {
            if (child.name) {
                names.add(child.name);
            }
        });
        return names;
    };

    async function addBehaviorObject<T extends THREE.Object3D>({
        object,
        baseName,
        behaviorID,
        behaviorOptions,
        offset,
        clearSelection = false,
        callback,
    }: {
        object: T;
        baseName: string;
        behaviorID: string;
        behaviorOptions?: any;
        offset?: THREE.Vector3;
        clearSelection?: boolean;
        callback?: (obj: T) => void;
    }) {
        if (clearSelection && engine?.editor?.selected) {
            engine.editor.select(null);
        }

        object.name = generateUniqueName(baseName, getCurrentNames());
        await editor.addBehaviorToObject(object, behaviorID, behaviorOptions);
        addObjectToSceneInCameraView(object, offset);
        callback?.(object);
        return object;
    }

    const handleAddAmbientLight = useCallback(
        (callback?: (obj: THREE.AmbientLight) => void) => {
            const names = getCurrentNames();
            const color = 0xaaaaaa;
            const light = new THREE.AmbientLight(color);
            const uniqueName = generateUniqueName(I18n.t("Ambient Light"), names);
            light.name = uniqueName;

            addObjectToSceneCenter(light, new THREE.Vector3(0, 10, 0));
            if (callback) callback(light);
        },
        [editor, I18n],
    );

    const handleAddDirectionalLight = useCallback(
        async (callback?: (obj: THREE.DirectionalLight) => void) => {
            const names = getCurrentNames();
            const color = 0xffffff;
            const intensity = 1;

            const light = new ExtendedDirectionalLight(color, intensity);
            light.name = generateUniqueName(I18n.t("Directional Light"), names);
            light.isUnityStyle = true;
            light.castShadow = false;
            light.shadow.radius = 3;
            light.shadow.bias = 0;
            light.shadow.normalBias = 0.1;
            light.shadow.mapSize.x = 2048;
            light.shadow.mapSize.y = 2048;
            light.shadow.camera.left = -100;
            light.shadow.camera.right = 100;
            light.shadow.camera.top = 100;
            light.shadow.camera.bottom = -100;
            // near/far are auto-computed from ortho size in Unity-style mode
            await new AttachBehaviorCommand(light, "dayNightCycle", {
                enabled: false,
                throttleConfig: {
                    throttlePriority: BehaviorThrottlePriority.CRITICAL,
                    enableFrustumCulling: false,
                    enableDistanceThrottling: false,
                    requiresConsistentUpdates: true,
                },
            }).execute();
            addObjectToSceneCenter(light, new THREE.Vector3(5, 10, 7.5));
            callback?.(light);
        },
        [editor, I18n],
    );

    const handleAddPointLight = useCallback(
        (callback?: (obj: THREE.PointLight) => void) => {
            const names = getCurrentNames();
            const uniqueName = generateUniqueName(I18n.t("Point Light"), names);

            const color = 0xffffff;
            const intensity = 1;
            const distance = 0;

            const light = new THREE.PointLight(color, intensity, distance);
            light.name = uniqueName;

            light.castShadow = false;
            light.shadow.bias = 0;
            light.shadow.normalBias = 0;
            light.shadow.radius = 3;
            light.shadow.mapSize.x = 512;
            light.shadow.mapSize.y = 512;

            addObjectToSceneInCameraView(light, new THREE.Vector3(0, 5, 0));
            if (callback) callback(light);
        },
        [editor, I18n],
    );

    const handleAddSpotLight = useCallback(
        (callback?: (obj: THREE.SpotLight) => void) => {
            const names = getCurrentNames();
            const color = 0xffffff;
            const intensity = 1;
            const distance = 0;
            const angle = Math.PI * 0.1;
            const penumbra = 0;

            const light = new THREE.SpotLight(color, intensity, distance, angle, penumbra);
            light.name = generateUniqueName(I18n.t("Spot Light"), names);
            light.castShadow = false;
            light.shadow.radius = 3;
            light.shadow.bias = 0;
            light.shadow.normalBias = 0.1;

            addObjectToSceneInCameraView(light, new THREE.Vector3(0, 5, 0));
            if (callback) callback(light);
        },
        [editor, I18n],
    );

    const handleAddHemisphereLight = useCallback(
        (callback?: (obj: THREE.HemisphereLight) => void) => {
            const names = getCurrentNames();
            const skyColor = 0x00aaff;
            const groundColor = 0xffaa00;
            const intensity = 1;

            const light = new THREE.HemisphereLight(skyColor, groundColor, intensity);
            const uniqueName = generateUniqueName(I18n.t("Hemisphere Light"), names);
            light.name = uniqueName;

            addObjectToSceneCenter(light, new THREE.Vector3(0, 10, 0));
            if (callback) callback(light);
        },
        [editor, I18n],
    );

    const handleAddRectAreaLight = useCallback(
        (callback?: (obj: THREE.RectAreaLight) => void) => {
            const names = getCurrentNames();
            const color = 0xffffff;
            const intensity = 1;
            const width = 20;
            const height = 10;

            const light = new THREE.RectAreaLight(color, intensity, width, height);
            light.name = generateUniqueName(I18n.t("Rect Area Light"), names);

            addObjectToSceneInCameraView(light, new THREE.Vector3(0, 5, 0));
            if (callback) callback(light);
        },
        [editor, I18n],
    );

    const handleAddVolumes = async (callback?: (obj: THREE.Mesh) => void) => {
        const geometry = new THREE.BoxGeometry(3, 3, 3);
        const material = new THREE.MeshBasicMaterial({
            color: 0x00aaff,
            transparent: true,
            opacity: 0.15,
            wireframe: true,
            depthWrite: false,
        });
        const volumeObject = new THREE.Mesh(geometry, material);
        volumeObject.visible = true;
        volumeObject.userData.isSceneVolume = true;
        volumeObject.userData.editorVisibility = true;
        volumeObject.userData.gameVisibility = false;

        await addBehaviorObject({
            object: volumeObject,
            baseName: NEW_MISC_NAME.VOLUMES,
            behaviorID: VOLUME_BEHAVIOR_ID,
            clearSelection: true,
            callback,
        });
    };

    const handleStartSpawnPointTool = useCallback(
        async (callback?: (obj: THREE.Object3D) => void) => {
            const point = new THREE.Object3D();
            await addBehaviorObject({
                object: point,
                baseName: NEW_MISC_NAME.SPAWN_POINT,
                behaviorID: SPAWN_POINT_BEHAVIOR_ID,
                clearSelection: true,
                callback,
            });
        },
        [editor],
    );

    const handleAddPointSound = useCallback(async () => {
        const object = new THREE.Object3D();
        await addBehaviorObject({
            object,
            baseName: NEW_MISC_NAME.POINT_SOUND,
            behaviorID: GENERIC_SOUND_BEHAVIOR_ID,
            behaviorOptions: {attributesData: {autoPlay: true, positional: true}},
            offset: new THREE.Vector3(0, 5, 0),
        });
    }, [editor, I18n]);

    const handleBillboard = async (name: NEW_MISC_NAME, callback?: (obj: THREE.Object3D) => void) => {
        if (name === NEW_MISC_NAME.IMAGE_BILLBOARD) {
            await handleAddPlane(IMAGE_BILLBOARD_BEHAVIOR_ID, callback);
        } else if (name === NEW_MISC_NAME.VIDEO_BILLBOARD) {
            await handleAddPlane(VIDEO_BILLBOARD_BEHAVIOR_ID, callback);
        } else if (name === NEW_MISC_NAME.BILLBOARD) {
            await handleAddPlane(BILLBOARD_BEHAVIOR_ID, callback);
        }
    };

    const handleTerrain = async () => {
        await handleAddTerrain(editor);
        setActiveRightPanel(RIGHT_PANEL_VERSIONS.Terrain);
    };

    const handleCesium = async () => {
        await handleAddCesium(editor);
    };

    const handleClick = async (name: LIGHT_NAME | NEW_MISC_NAME, callback?: (obj: THREE.Object3D) => void) => {
        switch (name) {
            case NEW_MISC_NAME.TERRAIN:
                await handleTerrain();
                break;
            case NEW_MISC_NAME.CESIUM:
                await handleCesium();
                break;
            case NEW_MISC_NAME.BILLBOARD:
            case NEW_MISC_NAME.IMAGE_BILLBOARD:
            case NEW_MISC_NAME.VIDEO_BILLBOARD:
                await handleBillboard(name, callback);
                break;
            case NEW_MISC_NAME.VOLUMES:
                await handleAddVolumes(callback);
                setActiveRightPanel(RIGHT_PANEL_VERSIONS.Volume);
                break;
            case NEW_MISC_NAME.SPAWN_POINT:
                await handleStartSpawnPointTool(callback);
                setActiveRightPanel(RIGHT_PANEL_VERSIONS.SpawnPoint);
                break;
            case NEW_MISC_NAME.POINT_SOUND:
                await handleAddPointSound();
                setActiveRightPanel(RIGHT_PANEL_VERSIONS.GenericSound);
                break;
            case NEW_MISC_NAME.DEFAULT_LIGHTS_FOG:
                editor.select(null);
                setActiveRightPanel(RIGHT_PANEL_VERSIONS.DEFAULT_LIGHTS_FOG);
                break;
            case NEW_MISC_NAME.AVATAR_CREATOR:
                editor.component?.openAvatarCreator?.();
                break;
            case LIGHT_NAME.DIRECTIONAL:
                await handleAddDirectionalLight(callback);
                setActiveRightPanel(RIGHT_PANEL_VERSIONS.None);
                break;
            case LIGHT_NAME.AMBIENT:
                handleAddAmbientLight(callback);
                setActiveRightPanel(RIGHT_PANEL_VERSIONS.None);
                break;
            case LIGHT_NAME.RECT_AREA:
                handleAddRectAreaLight(callback);
                setActiveRightPanel(RIGHT_PANEL_VERSIONS.None);
                break;
            case LIGHT_NAME.POINT:
                handleAddPointLight(callback);
                setActiveRightPanel(RIGHT_PANEL_VERSIONS.None);
                break;
            case LIGHT_NAME.SPOT:
                handleAddSpotLight(callback);
                setActiveRightPanel(RIGHT_PANEL_VERSIONS.None);
                break;
            case LIGHT_NAME.HEMISPHERE:
                handleAddHemisphereLight(callback);
                setActiveRightPanel(RIGHT_PANEL_VERSIONS.None);
                break;
            default:
                break;
        }
    };

    const addObjectToSceneInCameraView = (object: THREE.Object3D, offset?: THREE.Vector3) => {
        editor.moveObjectToCameraClosestPoint(object);
        addObjectToSceneCenter(object, offset);
    };

    const generateRandomColor = () => {
        const red = Math.floor(Math.random() * 256);
        const green = Math.floor(Math.random() * 256);
        const blue = Math.floor(Math.random() * 256);

        const redHex = red.toString(16).padStart(2, "0");
        const greenHex = green.toString(16).padStart(2, "0");
        const blueHex = blue.toString(16).padStart(2, "0");

        const randomColor = `#${redHex}${greenHex}${blueHex}`;

        return randomColor;
    };

    const handleAddPlane = useCallback(
        async (behaviorID: string, callback?: (obj: THREE.Object3D) => void) => {
            const material = new THREE.MeshStandardMaterial({
                color: generateRandomColor(),
                side: THREE.DoubleSide,
            });
            const geometry = new THREE.BoxGeometry(10, 10, 0.001);
            const billboard = new Plane(geometry, material);
            const billboardWrapper = new THREE.Object3D();

            billboard.userData.isBillboardContent = true;
            billboard.userData.isSelectable = false;
            billboard.userData.isRuntimeOnly = true;

            billboardWrapper.add(billboard);
            billboardWrapper.userData.isBillboard = true;
            billboardWrapper.userData.billboardBehaviorID = behaviorID;
            await addBehaviorObject({
                object: billboardWrapper,
                baseName: NEW_MISC_NAME.BILLBOARD,
                behaviorID,
                callback,
            });
        },
        [editor],
    );

    const addObjectToSceneCenter = (object: THREE.Object3D, offset?: THREE.Vector3) => {
        if (offset) {
            object.position.add(offset);
        }
        // add command already selects the object
        void editor.execute(new (AddObjectCommand as any)(object));
    };

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, name: string) => {
        e.dataTransfer.setData("asset-id", name);
        e.dataTransfer.setData("asset-type", "lights");
    };

    useEffect(() => {
        if (!search) {
            setFilteredList(list);
            return;
        } else {
            setFilteredList(
                list?.filter(n => {
                    return n.name.toLowerCase().indexOf(search.toLowerCase()) > -1;
                }),
            );
        }
    }, [search, list]);

    useEffect(() => {
        if (engine.on) {
            engine.on(`dragEnd.LightsTab`, (type: string, name: string, position: THREE.Vector3) => {
                if (type === "lights") {
                    if (typeof handleClick === "function") {
                        void handleClick(name as LIGHT_NAME, (obj: THREE.Object3D) => {
                            if (editor.moveObjectToPoint) {
                                editor.moveObjectToPoint(obj, position);
                            }
                        });
                    }
                }
            });
        }
        return () => {
            if (engine.on) {
                engine.on(`dragEnd.LightsTab`, null);
            }
        };
    }, []);

    if (!isOpen) return null;

    return (
        <>
            <IconsFlexContainer
                list={filteredList}
                onSelectItem={item => handleClick(item.name as LIGHT_NAME | NEW_MISC_NAME)}
                draggable
                onDragStart={(e, item) => handleDragStart(e, item.name)}
            />
        </>
    );
};
