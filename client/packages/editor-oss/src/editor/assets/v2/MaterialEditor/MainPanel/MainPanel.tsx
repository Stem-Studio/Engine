import {useEffect, useRef, useState} from "react";
import styled from "styled-components";
import * as THREE from "three";

import EngineRuntime from "@stem/editor-oss/EngineRuntime";
import {getAssetResolutionContext} from "@stem/editor-oss/asset-management/AssetResolutionContext";
import {useAssetResolutionContext} from "@stem/editor-oss/context/AssetResolutionContext";
import global from "@stem/editor-oss/global";
import {cloneJsonCompatible} from "@stem/editor-oss/utils/cloneJsonCompatible";
import {LeftWrapper} from "../../AnimationCombiner/ModelAnimationCombiner.style";
import {StyledButton} from "../../common/StyledButton";
import {
    applyMaterialSettingsToObject,
    applyMaterialSettingsToSpecificMaterial,
    findMaterialByPathKey,
    generateMaterialPathKey,
    updateDynamicTexturesForMaterial,
} from "../../materials/materialUtils";
import {Separator} from "../../RightPanel/common/Separator";
import {MaterialInfo} from "../../RightPanel/ModelEditorButtons/ModelEditorButtons";
import {MaterialRenderingSection} from "../../RightPanel/sections/MaterialRenderingSection/MaterialRenderingSection";
import {IMaterialSettings} from "../../RightPanel/sections/MaterialRenderingSection/types";

export const Container = styled.div`
    box-sizing: border-box;
    position: fixed;
    z-index: 100;
    right: 12px;
    top: 12px;
    width: 240px;
    height: calc(100svh - 24px);
    background: var(--theme-grey-bg-tertiary);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: center;
    color: var(--theme-font-main-selected-color);
    z-index: 100;
    transition: height 0.2s ease-in-out;

    .propertiesButton {
        cursor: default;
        background: #262626;
        color: #f8fafc;
        &:hover {
            background: #262626;
            color: #f8fafc;
        }
        &:active {
            background: #262626;
            color: #f8fafc;
        }
    }

    .MaterialSection {
        row-gap: 12px;
    }
`;

type MaterialBackupItem = {
    material: THREE.Material;
    userData: any;
};

type Props = {
    onClose: () => void;
    materialInfo?: MaterialInfo | null;
    cloneRef: React.MutableRefObject<THREE.Object3D | null>;
    pendingSettings: {settings: IMaterialSettings; pathKey: string} | null;
    setPendingSettings: React.Dispatch<React.SetStateAction<{settings: IMaterialSettings; pathKey: string} | null>>;
};

export const MainPanel = ({onClose, materialInfo, cloneRef, pendingSettings, setPendingSettings}: Props) => {
    const {context, root} = useAssetResolutionContext();
    const app = global.app as EngineRuntime;
    const editor = app.editor;
    const [selectedBackup, setSelectedBackup] = useState<THREE.Object3D | null>(null);
    const [materialBackup, setMaterialBackup] = useState<MaterialBackupItem[] | null>(null);
    const selectedObject = editor?.getSelectedObject();
    const selectedBackupRef = useRef<THREE.Object3D | null>(null);
    const materialBackupRef = useRef<MaterialBackupItem[] | null>(null);

    useEffect(() => {
        selectedBackupRef.current = selectedBackup;
    }, [selectedBackup]);

    useEffect(() => {
        materialBackupRef.current = materialBackup;
    }, [materialBackup]);

    const backupSelectedObject = () => {
        if (!selectedObject) return;

        setSelectedBackup(selectedObject.clone());

        const materialsBackup: MaterialBackupItem[] = [];
        selectedObject.traverse(child => {
            if ((child instanceof THREE.Mesh || child instanceof THREE.SkinnedMesh) && child.material) {
                const materialToBackup = cloneMaterialDeep(child.material);

                materialsBackup.push({
                    material: materialToBackup,
                    userData: child.userData?.materialSettings
                        ? cloneJsonCompatible(child.userData.materialSettings)
                        : undefined,
                });
            }
        });
        setMaterialBackup(materialsBackup);
    };

    useEffect(backupSelectedObject, []);

    const handleSettingsChange = (settings: IMaterialSettings, pathKey: string) => {
        setPendingSettings({settings, pathKey});

        if (cloneRef.current) {
            const settingsMap: {[key: string]: IMaterialSettings} = {};
            settingsMap[pathKey] = settings;
            const contextRoot = root || app.editor?.scene;
            const freshContext = contextRoot ? getAssetResolutionContext(contextRoot) : context;
            applyMaterialSettingsToSpecificMaterial(cloneRef.current, settingsMap, pathKey, freshContext || undefined);
        }
    };

    const cloneMaterialDeep = (material: THREE.Material): THREE.Material => {
        let matClone: THREE.Material;

        if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial) {
            const cloned = material.clone();
            if (material.map) cloned.map = material.map;
            if (material.aoMap) cloned.aoMap = material.aoMap;
            if (material.roughnessMap) cloned.roughnessMap = material.roughnessMap;
            if (material.metalnessMap) cloned.metalnessMap = material.metalnessMap;
            if (material.normalMap) cloned.normalMap = material.normalMap;
            if (material.emissiveMap) cloned.emissiveMap = material.emissiveMap;
            matClone = cloned;
        } else if (material instanceof THREE.MeshPhongMaterial) {
            const cloned = material.clone();
            if (material.map) cloned.map = material.map;
            if (material.specularMap) cloned.specularMap = material.specularMap;
            if (material.normalMap) cloned.normalMap = material.normalMap;
            if (material.emissiveMap) cloned.emissiveMap = material.emissiveMap;
            if (material.aoMap) cloned.aoMap = material.aoMap;
            matClone = cloned;
        } else if (material instanceof THREE.MeshBasicMaterial) {
            const cloned = material.clone();
            if (material.map) cloned.map = material.map;
            matClone = cloned;
        } else {
            matClone = material.clone();
        }

        return matClone;
    };

    const restoreSelectedObject = () => {
        const contextRoot = root || app.editor?.scene;
        const freshContext = contextRoot ? getAssetResolutionContext(contextRoot) : context;

        if (!selectedBackupRef.current || !materialBackupRef.current || !selectedObject) return;
        if (selectedBackupRef.current.userData?.materialSettings) {
            selectedObject.userData.materialSettings = cloneJsonCompatible(
                selectedBackupRef.current.userData.materialSettings,
            );
        } else {
            delete selectedObject.userData.materialSettings;
        }

        let i = 0;
        selectedObject.traverse(child => {
            // @ts-expect-error - accessing array with index
            if ((child instanceof THREE.Mesh || child instanceof THREE.SkinnedMesh) && materialBackupRef.current[i]) {
                // @ts-expect-error - materialBackup is typed correctly
                const backupItem = materialBackupRef.current[i];
                if (!backupItem) return console.error("backupItem is undefined");
                child.material = cloneMaterialDeep(backupItem.material);

                if (backupItem.userData) {
                    child.userData.materialSettings = cloneJsonCompatible(backupItem.userData);
                } else {
                    delete child.userData.materialSettings;
                }

                child.material.needsUpdate = true;
                const materialSettingsMap = child.userData?.materialSettings;
                if (!materialSettingsMap && !child.material.map) {
                    // If no settings AND no map in backup, maybe we should try to restore from parent if possible?
                    // But backup captured the state. If map was null, it stays null.
                }

                // If backup restored a material that *already* has textures (via cloneMaterialDeep),
                // we might not need to run updateDynamicTexturesForMaterial unless we want to ensure
                // that the settings on the object (restored) match the material.

                // If the object has settings now (restored), apply them to be sure.
                if (materialSettingsMap) {
                    const firstKey = Object.keys(materialSettingsMap)[0];
                    if (firstKey) {
                        const settings: IMaterialSettings = materialSettingsMap[firstKey];
                        void updateDynamicTexturesForMaterial(child.material, settings, freshContext);
                    }
                }

                i++;
            }
        });

        app.call("objectChanged", app.editor, selectedObject);
        onClose();
    };

    const handleSave = () => {
        if (!selectedObject || !pendingSettings) return;

        const contextRoot = root || app.editor?.scene;
        const freshContext = contextRoot ? getAssetResolutionContext(contextRoot) : context;
        const {settings, pathKey} = pendingSettings;

        const foundMaterial = findMaterialByPathKey(selectedObject, pathKey);
        const startObject: THREE.Object3D = foundMaterial ? foundMaterial.mesh : selectedObject;

        let storageObject: THREE.Object3D = selectedObject;
        let foundModelRoot = false;

        let curr: THREE.Object3D | null = startObject;
        while (curr) {
            if (curr.userData.modelId || curr.userData.Url) {
                storageObject = curr;
                foundModelRoot = true;
                break;
            }
            if (curr.parent === curr) break;
            curr = curr.parent;
        }

        let settingsMap: {[key: string]: IMaterialSettings} = {};
        let targetPathKey = pathKey;

        if (foundModelRoot) {
            if (storageObject !== selectedObject) {
                const found = findMaterialByPathKey(selectedObject, pathKey);
                if (found) {
                    targetPathKey = generateMaterialPathKey(found.mesh, found.index, storageObject);
                }
            }

            if (storageObject.userData.materialSettings) {
                if (
                    "materialType" in storageObject.userData.materialSettings &&
                    "textures" in storageObject.userData.materialSettings
                ) {
                    settingsMap = {};
                } else {
                    settingsMap = {...(storageObject.userData.materialSettings as {[key: string]: IMaterialSettings})};
                }
            }

            settingsMap[targetPathKey] = {
                tileAmountX: settings.tileAmountX,
                tileAmountY: settings.tileAmountY,
                panningSpeedX: settings.panningSpeedX,
                panningSpeedY: settings.panningSpeedY,
                isDoubleSided: settings.isDoubleSided,
                materialType: settings.materialType,
                textures: {...settings.textures},
                texturesSettings: {...settings.texturesSettings},
            };

            storageObject.userData.materialSettings = settingsMap;

            if (materialInfo) {
                applyMaterialSettingsToSpecificMaterial(storageObject, settingsMap, targetPathKey, freshContext);
            } else {
                applyMaterialSettingsToObject(storageObject, settingsMap, freshContext);
            }

            if (storageObject !== selectedObject) {
                app.call("objectChanged", app.editor, storageObject);
            }
        } else {
            settingsMap = {};
            settingsMap[pathKey] = {
                tileAmountX: settings.tileAmountX,
                tileAmountY: settings.tileAmountY,
                panningSpeedX: settings.panningSpeedX,
                panningSpeedY: settings.panningSpeedY,
                isDoubleSided: settings.isDoubleSided,
                materialType: settings.materialType,
                textures: {...settings.textures},
                texturesSettings: {...settings.texturesSettings},
            };

            if (selectedObject.userData.materialSettings) {
                delete selectedObject.userData.materialSettings;
            }

            if (materialInfo) {
                applyMaterialSettingsToSpecificMaterial(selectedObject, settingsMap, pathKey, freshContext);
            } else {
                applyMaterialSettingsToObject(selectedObject, settingsMap, freshContext);
            }

            if (selectedObject.userData.materialSettings) {
                delete selectedObject.userData.materialSettings;
            }
        }

        app.call("objectChanged", app.editor, selectedObject);
        onClose();
    };

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                restoreSelectedObject();
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, []);

    return (
        <Container className="hidden-scroll">
            <StyledButton className="propertiesButton">Properties</StyledButton>
            <Separator margin="8px 0 12px" />
            <MaterialRenderingSection materialInfo={materialInfo}
                onSettingsChange={handleSettingsChange}
            />
            <LeftWrapper>
                <StyledButton width="50%"
                    isGrey
                    onClick={restoreSelectedObject}
                >
                    Cancel
                </StyledButton>
                <StyledButton isBlue
                    style={{margin: "0 auto"}}
                    width="50%"
                    onClick={handleSave}
                    className="blueBtn"
                >
                    Save
                </StyledButton>
            </LeftWrapper>
        </Container>
    );
};
