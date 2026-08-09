/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {debounce, isArray} from "lodash";
import {useCallback, useEffect, useMemo, useRef, useState, type RefObject} from "react";
import * as THREE from "three";

import EngineRuntime from "@stem/editor-oss/EngineRuntime";
import {MoveObjectCommand} from "@stem/editor-oss/command/Commands";
import {useAppGlobalContext} from "@stem/editor-oss/context";
import {RIGHT_PANEL_VERSIONS} from "@stem/editor-oss/context/appStateTypes";
import Editor from "../../../../../../editor/Editor";
import {isStemEditor} from "../../../../../../editor/stem-editor/isStemEditor";
import type {StemEditorMetadata} from "../../../../../../editor/stem-editor/saveStemEditor";
import global from "@stem/editor-oss/global";
import type {LambdaInstanceData} from "../../../../../../lambdas/Lambda";
import {getPrefabId, isPrefab} from "@stem/editor-oss/prefab/util";
import {showToast} from "@stem/editor-oss/showToast";
import {isProtectedTreeNode} from "../../../../../../ui/tree/v2/helpers";
import {Tree} from "../../../../../../ui/tree/v2/Tree";
import {TreeItemData} from "../../../../../../ui/tree/v2/TreeItem";
import {shouldIncludeProjectTreeObject, shouldRecurseProjectTreeObject} from "./projectTreeFilters";
import {TextInput} from "../../../common/TextInput";
import searchIcon from "../../../icons/search-icon-small.svg";
import "../../css/ProjectTab.css";
import {ObjectViewButton} from "../../ObjectViewButton/ObjectViewButton";

type Props = {
    isVisible: boolean;
    unlockedPanelState?: boolean;
    setIsAddObjectViewOpen?: (value: React.SetStateAction<boolean>) => void;
};

const commonDefaultValues = {
    draggable: false,
    children: [],
    cameraIcon: false,
    noMaxWidth: true,
    isDefaultItem: true,
    noLock: true,
    expanded: false,
};

export const ProjectTab = ({isVisible, setIsAddObjectViewOpen, unlockedPanelState}: Props) => {
    const treeRef = useRef<HTMLUListElement>(null);
    const suppressAutoScrollRef = useRef(false);
    const suppressAutoScrollTimeoutRef = useRef<number | null>(null);
    const [data, setData] = useState<TreeItemData[]>([]);
    const [selected, setSelected] = useState<string[] | null>(null);
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [search, setSearch] = useState("");
    const [searchDebaunced, setSearchDebaunced] = useState(search);
    const [foundObjects, setFoundObjects] = useState<THREE.Object3D[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const {setActiveRightPanel} = useAppGlobalContext();
    const [anchorUuid, setAnchorUuid] = useState<string | null>(null);
    const foundObjectsRef = useRef<THREE.Object3D[]>([]);
    const searchRef = useRef("");

    const app = global.app as EngineRuntime;
    const editor = app.editor as Editor;
    const isCollaborativEditing = editor?.isCollaborative || (editor?.isSandbox && editor.isMultiplayer);
    const [lockedItems, setLockedItems] = useState<string[]>(editor?.sceneLockedItems || []);

    const flattenTree = (nodes: TreeItemData[]): TreeItemData[] => {
        return nodes.flatMap(node => [node, ...(node.children ? flattenTree(node.children) : [])]);
    };

    const isSingleSelectOnlyValue = (value: string) => {
        return value === editor?.scene?.uuid || value === editor?.camera?.uuid;
    };

    const isLambdaOrLambdaGroup = (val: string) => {
        if (val === "lambdas-group") return true;
        const instances = (editor?.scene.userData?.projectLambdaInstances || []) as LambdaInstanceData[];
        return instances.some(i => i.instanceId === val);
    };

    const handleSelect = (value: string, multiselect: boolean, noSelectByUuid?: boolean, rangeSelect?: boolean) => {
        // Lambda items are not scene objects — deselect and clear right panel
        if (isLambdaOrLambdaGroup(value)) {
            app?.editor?.select(null);
            setActiveRightPanel(RIGHT_PANEL_VERSIONS.None);
            setSelected([value]);
            return;
        }

        const selectedObj = editor?.objectByUuid(value);
        if (
            isCollaborativEditing &&
            selectedObj?.userData?.selectedBy &&
            selectedObj.userData.selectedBy !== app?.userId
        ) {
            console.log("[ProjectTab] Selection blocked due to collaboration lock");
            return;
        }

        const stopFunc = adminSandboxSelectNotAllowed(selectedObj);

        if (stopFunc) return;

        // Compute new selection outside of setState to avoid side effects during render
        let newSelected: string[] = [];
        const prevSelected = selected;
        const shouldForceSingleSelect =
            isSingleSelectOnlyValue(value) ||
            (!!anchorUuid && isSingleSelectOnlyValue(anchorUuid)) ||
            !!prevSelected?.some(isSingleSelectOnlyValue);
        const allowRangeSelect = !!rangeSelect && !!data && !shouldForceSingleSelect;
        const allowMultiselect = !!multiselect && !!data && !shouldForceSingleSelect;

        if (allowRangeSelect) {
            const anchor = anchorUuid ?? value;

            if (!anchorUuid && !noSelectByUuid) {
                setAnchorUuid(value);
            }
            const flatData = flattenTree(data);

            const startIndex = flatData.findIndex(item => item.value === anchor);
            const endIndex = flatData.findIndex(item => item.value === value);

            if (startIndex !== -1 && endIndex !== -1) {
                const [from, to] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
                newSelected = flatData.slice(from, to + 1).map(item => item.value);
            } else {
                newSelected = [value];
                if (!noSelectByUuid) setAnchorUuid(value);
            }
        } else if (allowMultiselect) {
            if (!anchorUuid) {
                newSelected = [value];
                if (!noSelectByUuid) setAnchorUuid(value);
            } else {
                if (prevSelected?.includes(value)) {
                    newSelected = prevSelected.filter(item => item !== value);
                } else {
                    newSelected = prevSelected ? [...prevSelected, value] : [value];
                }
                if (!noSelectByUuid) {
                    setAnchorUuid(value);
                }
            }
        } else {
            newSelected = [value];
            if (!noSelectByUuid) {
                setAnchorUuid(value);
            }
        }

        // Update state
        setSelected(newSelected);

        // Call selectByUuid outside of setState to avoid React state transition errors
        if (!noSelectByUuid) {
            const selectionParam = newSelected.length === 1 ? newSelected[0] : newSelected;
            if (selectionParam) {
                app?.editor?.selectByUuid(selectionParam);
            }
        }
    };

    const adminSandboxSelectNotAllowed = (selectedObj: THREE.Object3D<THREE.Object3DEventMap> | null | undefined) => {
        if (selectedObj && app.mode === "play" && app.editor?.component?.showUI && !selectedObj.userData.isSelectable) {
            console.log("[ProjectTab] Selection blocked due to selection lock");
            showToast({type: "info", title: "Object is not selectable"});
            setActiveRightPanel(RIGHT_PANEL_VERSIONS.GameSettings);
            return true;
        } else return false;
    };

    const handleDoubleClick = (value: any) => {
        const selectedObj = app?.editor?.objectByUuid(value);
        if (
            isCollaborativEditing &&
            selectedObj?.userData?.selectedBy &&
            selectedObj.userData.selectedBy !== app?.userId
        ) {
            return;
        }
        const stopFunc = adminSandboxSelectNotAllowed(selectedObj);

        if (stopFunc) return;

        setSelected([value]);
        app?.editor?.focusByUUID(value);
    };

    const handleObjectSelected = (object: THREE.Object3D | null) => {
        if (!app || !app.editor) return;
        if (!object) {
            setSelected(null);
            return;
        }
        const selectedUuid = object.uuid;
        handleSelect(selectedUuid, false, true);
    };

    const handleObjectArraySelected = (selectedObjectsArr: THREE.Object3D[] | null) => {
        if (!selectedObjectsArr || selectedObjectsArr.length === 0) {
            setSelected(null);
            return;
        }
        const uniqueObjects = selectedObjectsArr.filter((obj, index, self) => self.indexOf(obj) === index);
        const uuids = uniqueObjects.map(obj => obj.uuid);
        setSelected(uuids);
    };

    const updateUI = (shouldExpandData = false) => {
        if (!app || !app.editor) return;
        const scene = app.editor.scene;
        const camera = app.editor.camera;

        // Build locked items list from both manual locks and collaboration locks
        const manuallyLockedItems = app.editor.sceneLockedItems || [];
        const collaborativelyLockedItems: string[] = [];

        // If in collaborative editing mode, add items locked by other users
        if (isCollaborativEditing) {
            scene.traverse(obj => {
                if (obj.userData?.selectedBy && obj.userData.selectedBy !== app.userId) {
                    collaborativelyLockedItems.push(obj.uuid);
                }
            });
        }

        // Merge both lists (remove duplicates)
        const allLockedItems = Array.from(new Set([...manuallyLockedItems, ...collaborativelyLockedItems]));
        setLockedItems(allLockedItems);
        const stemEditorMode = isStemEditor(scene);
        const objectList: TreeItemData[] = stemEditorMode
            ? []
            : [
                  {
                      ...commonDefaultValues,
                      value: "0",
                      text: "Project Settings",
                      tooltipText:
                          "Configure project details, player/account features, gameplay rules, integrations, and editor defaults.",
                      onClick: () => {
                          global.app?.editor?.select(null);
                          setActiveRightPanel(RIGHT_PANEL_VERSIONS.GameSettings);
                      },
                      type: "Project Settings",
                  },
                  {
                      ...commonDefaultValues,
                      value: "2",
                      text: "Rendering & Performance",
                      type: "Rendering & Performance",
                      tooltipText:
                          "Tune visual quality, optimization systems, behavior update budgets, and model LOD generation.",
                      onClick: () => {
                          global.app?.editor?.select(null);
                          setActiveRightPanel(RIGHT_PANEL_VERSIONS.RenderingAndPerformance);
                      },
                  },
                  {
                      ...commonDefaultValues,
                      value: scene.uuid,
                      text: "Default Scene",
                      tooltipText:
                          "Set global scene environment including lighting, fog, background, tone mapping, and shadows.",
                      type: "Scene",
                      children: [],
                  },
                  {
                      ...commonDefaultValues,
                      value: camera.uuid,
                      text: camera.name,
                      tooltipText:
                          "Configure the default gameplay camera, follow behavior, occlusion, and post-processing effects.",
                      type: "Camera",
                      cameraIcon: true,
                      children: [],
                      isCamera: true,
                  },
              ];

        // Add top-level (project) lambda instances inside a collapsible group
        const projectLambdas = (scene.userData?.projectLambdaInstances || []) as LambdaInstanceData[];
        if (projectLambdas.length > 0) {
            const lambdaChildren: TreeItemData[] = projectLambdas.map(inst => {
                const lambdaConfig = editor.lambdaConfigRegistry?.getConfig(inst.lambdaId);
                return {
                    value: inst.instanceId,
                    text: lambdaConfig?.name || inst.lambdaId,
                    type: "Lambda",
                    expanded: false,
                    children: [],
                    isDefaultItem: true,
                    noLock: true,
                    noMaxWidth: true,
                };
            });
            objectList.push({
                value: "lambdas-group",
                text: "Lambdas",
                type: "Group",
                expanded: true,
                children: lambdaChildren,
                isDefaultItem: true,
                noLock: true,
                noMaxWidth: true,
            });
        }

        if (shouldExpandData && app.editor.selected && !Array.isArray(app.editor.selected)) {
            expandData(app.editor.selected.uuid, objectList);
        }

        scene.children.forEach(obj => {
            _parseData(obj, objectList);
        });
        setData(objectList);

        if (isArray(app.editor.selected)) return;
        setSelected([(app.editor.selected as any)?.uuid]);
    };

    const expandData = (uuid: string, list: readonly TreeItemData[]) => {
        for (const item of list) {
            if (uuid === item.value) {
                return true;
            }
            if (item.children && expandData(uuid, item.children)) {
                const copy = {...expanded};
                copy[item.value] = true;
                setExpanded(copy);
                item.expanded = true;
                return true;
            }
        }
        return false;
    };

    const getCls = (obj: THREE.Object3D) => {
        const scene = app?.editor?.scene;

        if (obj === scene) {
            return "Scene";
        } else if (obj instanceof THREE.Line) {
            return "Line";
        } else if (obj instanceof THREE.Light) {
            return "Light";
        } else if (obj instanceof THREE.Points) {
            return "Points";
        }

        return "Default";
    };

    const _parseData = (obj: THREE.Object3D, list: TreeItemData[]) => {
        if (!app || !app.editor) return;
        const scene = app.editor.scene;
        const camera = app.editor.camera;

        if (!shouldIncludeProjectTreeObject(obj)) {
            return;
        }

        // In stem-editor mode, hide scene-template scaffolding (directional
        // light, GlobalBehaviorsHost, etc.) and show only the stem itself.
        if (obj.parent === scene && isStemEditor(scene)) {
            const stemMeta = scene.userData.stemEditor as StemEditorMetadata | undefined;
            if (getPrefabId(obj) !== stemMeta?.assetId) {
                return;
            }
        }

        if (obj === scene && expanded[obj.uuid] === undefined) {
            expanded[obj.uuid] = true;
        }

        const selected = app.editor?.selected;
        let isChildSelectedAndFound = false;
        let isChildFound = false;

        obj.traverse(child => {
            if (foundObjects.indexOf(child) > -1) {
                isChildFound = true;
                if (!isArray(selected) && child.uuid === selected?.uuid) {
                    isChildSelectedAndFound = true;
                }
            }
        });

        const data = {
            value: obj.uuid,
            text: obj.name,
            vertices:
                obj instanceof THREE.Mesh &&
                Object.prototype.hasOwnProperty.call(obj.geometry.attributes, "position")
                    ? obj.geometry.attributes.position.count
                    : -1,
            expanded: !!expanded[obj.uuid] || isChildSelectedAndFound,
            draggable: obj !== scene && obj !== camera,
            cls: getCls(obj),
            children: [],
            isCamera: (obj as THREE.Camera).isCamera || false,
            isObject3D: obj.isObject3D || false,
            isLight: (obj as THREE.Light).isLight || false,
            isMesh: (obj as THREE.Mesh).isMesh || false,
            type: obj.type,
            icons: [
                {
                    name: "visible",
                    icon: obj.visible ? "visible" : "invisible",
                    title: obj.visible ? "Hide" : "Show",
                },
            ],
            userData: obj.userData,
        };
        if (list.some(item => item.value === obj.uuid)) return;

        if (search) {
            if (isChildFound) {
                list.push(data);
            }
        } else {
            list.push(data);
        }

        if (Array.isArray(obj.children)) {
            obj.children.forEach(child => {
                if (shouldRecurseProjectTreeObject(child, isPrefab(child))) {
                    _parseData(child, data.children);
                }
            });
        }
    };

    const matchTags = (obj: THREE.Object3D, searchValue: string): boolean => {
        const tags = obj.userData.tags;
        if (!tags || !Array.isArray(tags)) return false;

        return tags.some((tag: string) => tag.toLowerCase().includes(searchValue.toLowerCase()));
    };

    const searchObjects = (obj: THREE.Object3D, searchValue: string): THREE.Object3D[] => {
        const matched: THREE.Object3D[] = [];
        obj.traverse(node => {
            const nameMatch = node.name?.toLowerCase().includes(searchValue.toLowerCase());
            const tagMatch = matchTags(node, searchValue);

            if (searchValue && (nameMatch || tagMatch)) {
                matched.push(node);
            }
        });

        return matched;
    };

    const handleExpand = (value: string) => {
        const expandedCopy = {...expanded};

        if (expandedCopy[value]) {
            expandedCopy[value] = false;
        } else {
            expandedCopy[value] = true;
        }

        setExpanded(expandedCopy);
    };

    const handleEditLambda = async (instanceId: string) => {
        const editor = app?.editor;
        if (!editor) return;
        const instances = (editor.scene.userData?.projectLambdaInstances || []) as LambdaInstanceData[];
        const inst = instances.find(i => i.instanceId === instanceId);
        if (!inst) return;
        const meta = editor.lambdaConfigRegistry?.getAssetMeta(inst.lambdaId);
        if (!meta) return;
        editor.component?.closeRevisionPopup();
        editor.component?.openCodeEditor({kind: "lambda", id: meta.assetId});
    };

    const handleDeleteLambda = (instanceId: string) => {
        const editor = app?.editor;
        if (!editor) return;
        const instances = editor.scene.userData?.projectLambdaInstances as LambdaInstanceData[] | undefined;
        if (!instances) return;
        const idx = instances.findIndex(i => i.instanceId === instanceId);
        if (idx === -1) return;
        instances.splice(idx, 1);
        app?.game?.lambdaManager?.destroyInstance(instanceId);
        app?.call("objectChanged", editor, editor.selected);
        updateUI();
    };

    const handleDrop = (values: string[], target: HTMLElement, area: number) => {
        const editor = app?.editor;
        if (!editor || !values.length) return;
        suppressAutoScrollRef.current = true;
        if (suppressAutoScrollTimeoutRef.current !== null) {
            window.clearTimeout(suppressAutoScrollTimeoutRef.current);
        }
        suppressAutoScrollTimeoutRef.current = window.setTimeout(() => {
            suppressAutoScrollRef.current = false;
            suppressAutoScrollTimeoutRef.current = null;
        }, 250);

        const targetValue = target.getAttribute("value");
        const targetParentValue = target.parentElement?.parentElement?.getAttribute("value") || editor.scene.uuid;
        const nextSiblingValue = target.nextElementSibling?.getAttribute("value") || null;

        values.forEach(uuid => {
            const object = editor.objectByUuid(uuid);
            if (!object || isProtectedTreeNode(uuid, editor)) return;

            let newParentValue: string | null = null;
            let newBeforeValue: string | null = null;

            if (area < 0.25) {
                newParentValue = targetParentValue;
                newBeforeValue = targetValue;
            } else if (area > 0.75) {
                newParentValue = targetParentValue;
                newBeforeValue = nextSiblingValue;
            } else {
                newParentValue = targetValue;
                newBeforeValue = null;
            }

            if (newParentValue === editor.camera.uuid || isProtectedTreeNode(newBeforeValue, editor)) return;

            const parent =
                newParentValue === editor.scene.uuid
                    ? editor.scene
                    : newParentValue
                      ? editor.objectByUuid(newParentValue)
                      : null;
            if (!parent) return;
            const lastParent = newBeforeValue ? editor.objectByUuid(newBeforeValue) : undefined;

            editor.execute(new (MoveObjectCommand as any)(object, parent, lastParent));

            if (newParentValue) {
                const expandedCopy = {...expanded};
                expandedCopy[newParentValue] = true;
                setExpanded(expandedCopy);
            }
        });

        app.call("updateSelection");
        updateUI();
    };
    const handleLockClick = (id: string) => {
        if (!app || !app.editor) return;

        // Check if this object is locked by another collaborator
        const object = app.editor.objectByUuid(id);
        if (isCollaborativEditing && object?.userData?.selectedBy && object.userData.selectedBy !== app.userId) {
            console.log("[ProjectTab] Cannot manually lock/unlock object being edited by another user");
            showToast({
                type: "info",
                title: "Object is being edited by another user",
            });
            return;
        }

        const lockedItemsCopy = [...(app.editor.sceneLockedItems || [])];
        let locked = false;

        if (lockedItemsCopy?.includes(id)) {
            lockedItemsCopy.splice(lockedItemsCopy.indexOf(id), 1);
        } else {
            lockedItemsCopy.push(id);
            locked = true;
        }

        app.editor.sceneLockedItems = lockedItemsCopy;

        const object2 = app.editor.objectByUuid(id);
        app.call(`objectChanged`, app.editor, object2);

        if (locked) {
            app.call(`objectLocked`, app.editor, object2);
        } else {
            app.call(`objectUnlocked`, app.editor, object2);
        }
    };

    const debouncedHandleSearch = useCallback(
        debounce(async searchValue => {
            setSearchDebaunced(searchValue);
        }, 500),
        [],
    );

    const handleSearch = (value: string) => {
        setSearch(value);
        debouncedHandleSearch(value);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
        switch (event.key) {
            case "ArrowUp":
                if (foundObjects.length > 0 && search) {
                    setSelectedIndex(prevIndex => Math.max(prevIndex - 1, 0));
                }
                break;
            case "ArrowDown":
                if (foundObjects.length > 0 && search) {
                    setSelectedIndex(prevIndex => Math.min(prevIndex + 1, foundObjects.length - 1));
                }
                break;
        }
    };

    const handleOpenCameraSettings = () => {
        setActiveRightPanel(RIGHT_PANEL_VERSIONS.CameraSettings);
    };
    const handleOpenSceneSettings = () => {
        setActiveRightPanel(RIGHT_PANEL_VERSIONS.DEFAULT_LIGHTS_FOG);
    };

    useEffect(() => {
        if (foundObjects.length > 0) {
            setSelectedIndex(0);
        }
    }, [foundObjects]);

    useEffect(() => {
        updateUI();
    }, [expanded, lockedItems?.length]);

    useEffect(() => {
        if (!app?.editor?.scene || !searchDebaunced) {
            setFoundObjects([]);
            return;
        }

        setSelectedIndex(0);

        const results = searchObjects(app.editor.scene, searchDebaunced);

        setFoundObjects(results);
    }, [searchDebaunced]);

    useEffect(() => {
        if (foundObjects[selectedIndex]) {
            if (!app || !app.editor) return;
            app.editor.select(foundObjects[selectedIndex]);
            foundObjectsRef.current = foundObjects;
        }
        updateUI();
    }, [selectedIndex, foundObjects]);

    useEffect(() => {
        searchRef.current = searchDebaunced;
    }, [selectedIndex, searchDebaunced]);

    useEffect(() => {
        if (!app) return;
        updateUI();
        app.on(`sceneGraphChanged.ProjectTab`, updateUI);
        app.on(`objectChanged.ProjectTab`, updateUI);
        app.on(`objectRemoved.ProjectTab`, updateUI);
        app.on(`objectSelected.ProjectTab`, handleObjectSelected);
        app.on(`objectArraySelected.ProjectTab`, handleObjectArraySelected);
        app?.on(`objectRemoved.ProjectTab`, () => {
            const results = searchObjects(app.editor!.scene, searchRef.current);
            setFoundObjects(results);
        });
        app?.on(`objectCloned.ProjectTab`, () => {
            const results = searchObjects(app.editor!.scene, searchRef.current);
            setFoundObjects(results);
        });

        return () => {
            app.on(`sceneGraphChanged.ProjectTab`, null);
            app.on(`objectChanged.ProjectTab`, null);
            app.on(`objectRemoved.ProjectTab`, null);
            app.on(`objectSelected.ProjectTab`, null);
            app.on(`objectArraySelected.ProjectTab`, handleObjectArraySelected);
            app?.on(`objectRemoved.ModelsTabContext`, null);
        };
    }, []);

    useEffect(() => {
        window.addEventListener("keydown", handleKeyDown);

        // Cleanup event listener on component unmount
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [foundObjects]);

    const scrollToSelected = (uuid?: string) => {
        if (!uuid && suppressAutoScrollRef.current) {
            return;
        }

        if (treeRef.current) {
            const selectedElement = uuid
                ? treeRef.current.querySelector(`li[value="${uuid}"]`)
                : treeRef.current.querySelector(`li.selected`);
            if (selectedElement) {
                treeRef.current.scrollTo({
                    top: (selectedElement as HTMLElement).offsetTop - 30,
                    left: 0,
                    behavior: "smooth",
                });
            }
        }
    };

    useEffect(() => {
        app.on("sceneTriggeredSelect.ProjectTab", (data: THREE.Object3D) => {
            scrollToSelected(data.uuid);
        });
        return () => {
            app.on("sceneTriggeredSelect.ProjectTab", null);
            if (suppressAutoScrollTimeoutRef.current !== null) {
                window.clearTimeout(suppressAutoScrollTimeoutRef.current);
            }
        };
    }, []);

    const foundObjectsTreeData = useMemo(() => {
        return foundObjects.map(obj => ({
            value: obj.uuid,
            text: obj.name,
            type: obj.type,
            cls: getCls(obj),
            expanded: false,
            draggable: !isSingleSelectOnlyValue(obj.uuid),
            children: [],
        }));
    }, [foundObjects]);

    return (
        <div
            className="ProjectTab"
            style={!isVisible ? {display: "none"} : {}}
        >
            <div className="tab-header">
                <div className="wrapper">
                    <div className="search">
                        <TextInput
                            height="32px"
                            value={search}
                            width="100%"
                            setValue={handleSearch}
                            placeholder="Search"
                        />
                        <img
                            src={searchIcon}
                            alt="search"
                            className="icon"
                        />
                    </div>
                    {unlockedPanelState && setIsAddObjectViewOpen && (
                        <ObjectViewButton
                            setViewState={setIsAddObjectViewOpen}
                            showCloseButton={false}
                        />
                    )}
                </div>
            </div>
            <Tree
                data={searchDebaunced ? foundObjectsTreeData : data}
                selected={selected}
                treeRef={treeRef as RefObject<HTMLUListElement>}
                onSelect={handleSelect}
                onDoubleClick={handleDoubleClick}
                onExpand={handleExpand}
                onLockClick={handleLockClick}
                lockedItems={lockedItems}
                onDrop={handleDrop}
                openCameraSettings={handleOpenCameraSettings}
                openSceneSettings={handleOpenSceneSettings}
                className="project-tab-tree"
                style={{}}
                scrollToSelected={scrollToSelected}
                onEditLambda={handleEditLambda}
                onDeleteLambda={handleDeleteLambda}
            />
        </div>
    );
};
