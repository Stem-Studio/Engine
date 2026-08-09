import {useEffect, useState} from "react";
import * as THREE from "three";

import {
    handleAddBox,
    handleAddCapsule,
    handleAddCone,
    handleAddCylinder,
    handleAddDodecahedron,
    handleAddIcosahedron,
    handleAddOctahedron,
    handleAddPlane,
    handleAddRing,
    handleAddSphere,
    handleAddTorus,
    handleAddTorusKnot,
    handleAddTriangle,
    handleAddCustomShape,
    handleAddCustomTube,
    handleAddText3D,
} from "./primitivesHelpers";
import {useAppGlobalContext} from "@stem/editor-oss/context";
import {RIGHT_PANEL_VERSIONS} from "@stem/editor-oss/context/appStateTypes";
import global from "@stem/editor-oss/global";
import {CurveType} from "../../../../../../../object/geometry/CustomTube";
import {IconsFlexContainer} from "../../../../common/IconsFlexContainer";
import capsuleIcon from "../../../../icons/assetsTab/primitives/Capsule.svg";
import coneIcon from "../../../../icons/assetsTab/primitives/cone.svg";
import cubeIcon from "../../../../icons/assetsTab/primitives/cube.svg";
import customShapeIcon from "../../../../icons/assetsTab/primitives/Custom Shape.svg";
import textIcon from "../../../../icons/assetsTab/primitives/Custom Text.svg";
import customTubeIcon from "../../../../icons/assetsTab/primitives/CustomTube.svg";
import cylinderIcon from "../../../../icons/assetsTab/primitives/cylinder.svg";
import dodecahedronIcon from "../../../../icons/assetsTab/primitives/Dodecahedron.svg";
import icosahedronIcon from "../../../../icons/assetsTab/primitives/Icosahedron.svg";
import octahedronIcon from "../../../../icons/assetsTab/primitives/Octahedron.svg";
import planeIcon from "../../../../icons/assetsTab/primitives/plane.svg";
import triangleIcon from "../../../../icons/assetsTab/primitives/pyramid.svg";
import ringIcon from "../../../../icons/assetsTab/primitives/Ring.svg";
import sphereIcon from "../../../../icons/assetsTab/primitives/sphere.svg";
import torusKnotIcon from "../../../../icons/assetsTab/primitives/Torus Knot.svg";
import torusIcon from "../../../../icons/assetsTab/primitives/Torus.svg";

export enum PRIMITIVES_NAME {
    SPHERE = "Sphere",
    BOX = "Cube",
    TRIANGLE = "Pyramid",
    CONE = "Cone",
    CYLINDER = "Cylinder",
    PLANE = "Plane",
    TORUS = "Torus",
    TORUSKNOT = "Torus Knot",
    CAPSULE = "Capsule",
    ICOSAHEDRON = "Icosahedron",
    OCTAHEDRON = "Octahedron",
    DODECAHEDRON = "Dodecahedron",
    RING = "Ring",
    CUSTOM_SHAPE = "Custom Shape",
    CUSTOM_TUBE = "Custom Tube",
    TEXT_3D = "Text",
}

export const PRIMITIVES_LIST = [
    {icon: sphereIcon, text: PRIMITIVES_NAME.SPHERE, name: PRIMITIVES_NAME.SPHERE},
    {icon: cubeIcon, text: PRIMITIVES_NAME.BOX, name: PRIMITIVES_NAME.BOX},
    {icon: cylinderIcon, text: PRIMITIVES_NAME.CYLINDER, name: PRIMITIVES_NAME.CYLINDER},
    {icon: triangleIcon, text: PRIMITIVES_NAME.TRIANGLE, name: PRIMITIVES_NAME.TRIANGLE},
    {icon: coneIcon, text: PRIMITIVES_NAME.CONE, name: PRIMITIVES_NAME.CONE},
    {icon: planeIcon, text: PRIMITIVES_NAME.PLANE, name: PRIMITIVES_NAME.PLANE},
    {icon: torusIcon, text: PRIMITIVES_NAME.TORUS, name: PRIMITIVES_NAME.TORUS},
    {icon: torusKnotIcon, text: PRIMITIVES_NAME.TORUSKNOT, name: PRIMITIVES_NAME.TORUSKNOT},
    {icon: capsuleIcon, text: PRIMITIVES_NAME.CAPSULE, name: PRIMITIVES_NAME.CAPSULE},
    {icon: icosahedronIcon, text: PRIMITIVES_NAME.ICOSAHEDRON, name: PRIMITIVES_NAME.ICOSAHEDRON},
    {icon: octahedronIcon, text: PRIMITIVES_NAME.OCTAHEDRON, name: PRIMITIVES_NAME.OCTAHEDRON},
    {icon: dodecahedronIcon, text: PRIMITIVES_NAME.DODECAHEDRON, name: PRIMITIVES_NAME.DODECAHEDRON},
    {icon: ringIcon, text: PRIMITIVES_NAME.RING, name: PRIMITIVES_NAME.RING},
    {icon: customShapeIcon, text: PRIMITIVES_NAME.CUSTOM_SHAPE, name: PRIMITIVES_NAME.CUSTOM_SHAPE},
    {icon: customTubeIcon, text: PRIMITIVES_NAME.CUSTOM_TUBE, name: PRIMITIVES_NAME.CUSTOM_TUBE},
    {icon: textIcon, text: PRIMITIVES_NAME.TEXT_3D, name: PRIMITIVES_NAME.TEXT_3D},
];

const INITIAL_VISIBLE_COUNT = 6;

export const PrimitivesTab = ({search}: {search: string}) => {
    const [list, setList] = useState<any[]>(PRIMITIVES_LIST);
    const [showAll, setShowAll] = useState<boolean>(false);
    const {setActiveRightPanel} = useAppGlobalContext();
    const app = (global as any).app;

    const handleClick = (name: PRIMITIVES_NAME, callback?: any) => {
        switch (name) {
            case PRIMITIVES_NAME.SPHERE:
                handleAddSphere(app, callback);
                break;
            case PRIMITIVES_NAME.BOX:
                handleAddBox(app, callback);
                break;
            case PRIMITIVES_NAME.TRIANGLE:
                handleAddTriangle(app, callback);
                break;
            case PRIMITIVES_NAME.CONE:
                handleAddCone(app, callback);
                break;
            case PRIMITIVES_NAME.CYLINDER:
                handleAddCylinder(app, callback);
                break;
            case PRIMITIVES_NAME.PLANE:
                handleAddPlane(app, callback);
                break;
            case PRIMITIVES_NAME.TORUS:
                handleAddTorus(app, callback);
                break;
            case PRIMITIVES_NAME.TORUSKNOT:
                handleAddTorusKnot(app, callback);
                break;
            case PRIMITIVES_NAME.CAPSULE:
                handleAddCapsule(app, callback);
                break;
            case PRIMITIVES_NAME.ICOSAHEDRON:
                handleAddIcosahedron(app, callback);
                break;
            case PRIMITIVES_NAME.OCTAHEDRON:
                handleAddOctahedron(app, callback);
                break;
            case PRIMITIVES_NAME.DODECAHEDRON:
                handleAddDodecahedron(app, callback);
                break;
            case PRIMITIVES_NAME.RING:
                handleAddRing(app, callback);
                break;
            case PRIMITIVES_NAME.CUSTOM_SHAPE: {
                // Create with default star SVG path
                const defaultSVG =
                    "M 0,50 L 15,15 L 50,10 L 20,-10 L 30,-50 L 0,-20 L -30,-50 L -20,-10 L -50,10 L -15,15 Z";
                handleAddCustomShape(app, defaultSVG, (obj: any) => {
                    app.editor.select(obj);
                    setActiveRightPanel(RIGHT_PANEL_VERSIONS.SVGPathEditor);
                    callback?.(obj);
                });
                break;
            }
            case PRIMITIVES_NAME.CUSTOM_TUBE: {
                // Create with default S-curve
                const defaultPoints = [
                    new THREE.Vector3(-2, 0, 0),
                    new THREE.Vector3(-1, 1, 0),
                    new THREE.Vector3(1, -1, 0),
                    new THREE.Vector3(2, 0, 0),
                ];
                handleAddCustomTube(app, defaultPoints, CurveType.CATMULL_ROM, 64, 0.2, 8, false, 0, (obj: any) => {
                    app.editor.select(obj);
                    setActiveRightPanel(RIGHT_PANEL_VERSIONS.CurveEditor);
                    callback?.(obj);
                });
                break;
            }
            case PRIMITIVES_NAME.TEXT_3D:
                void handleAddText3D(app, (obj: any) => {
                    app.editor.select(obj);
                    setActiveRightPanel(RIGHT_PANEL_VERSIONS.TextEditor);
                    callback?.(obj);
                });
                break;
            default:
                break;
        }
    };

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, name: string) => {
        e.dataTransfer.setData("asset-id", name);
        e.dataTransfer.setData("asset-type", "primitive");
    };

    useEffect(() => {
        if (!search) {
            setList(PRIMITIVES_LIST);
            setShowAll(false);
            return;
        } else {
            const filtered = PRIMITIVES_LIST?.filter(n => {
                return n.name.toLowerCase().indexOf(search.toLowerCase()) > -1;
            });
            setList(filtered);
            setShowAll(true); // Show all when searching
        }
    }, [search]);

    useEffect(() => {
        app.on(`dragEnd.PrimitivesTab`, (type: string, name: string, position: any) => {
            if (type === "primitive") {
                handleClick(name as PRIMITIVES_NAME, (obj: any) => {
                    app.editor.moveObjectToPoint(obj, position);
                });
            }
        });
        return () => {
            app.on(`dragEnd.PrimitivesTab`, null);
        };
    }, []);

    // Show only first 6 items unless showAll is true or search is active
    const displayList = showAll || search ? list : list.slice(0, INITIAL_VISIBLE_COUNT);
    const hasMore = list.length > INITIAL_VISIBLE_COUNT;

    return (
        <>
            <IconsFlexContainer
                list={displayList}
                onSelectItem={item => handleClick(item.name as PRIMITIVES_NAME)}
                disableSelection
                draggable
                onDragStart={(e, item) => handleDragStart(e, item.name)}
            />
            {hasMore && !search && 
                <button
                    type="button"
                    onClick={() => setShowAll(!showAll)}
                    aria-expanded={showAll}
                    style={{
                        cursor: "pointer",
                        padding: "8px",
                        textAlign: "center",
                        color: "#888",
                        fontSize: "14px",
                        userSelect: "none",
                        borderTop: "1px solid #333",
                        marginTop: "4px",
                        width: "100%",
                        minHeight: "44px",
                        border: 0,
                        background: "transparent",
                    }}
                >
                    {showAll ? "Show Less" : `... ${list.length - INITIAL_VISIBLE_COUNT} more`}
                </button>
            }
        </>
    );
};
