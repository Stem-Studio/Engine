import * as THREE from "three";
import {HDRLoader} from "three/addons/loaders/HDRLoader.js";
import {toast} from "toastywave";

import {AssetType} from "@stem/network/api/asset";
import {createSceneAssetWithData} from "@stem/network/api/scene/v2";
import {getAssetResolutionContext, setAssetRevision} from "../../asset-management/AssetResolutionContext";
import {uploadImage, urlToFile} from "../../controls/AiWorldController/AiWorldController.utils";
import {applyTextureOverridesToObject} from "../../editor/assets/v2/materials/materialUtils";
import {IMaterialSettingsTextures} from "../../editor/assets/v2/RightPanel/sections/MaterialRenderingSection/types";
import global from "../../global";
import {getAIBackend} from "../../ai";
import {cloneJsonCompatible} from "../../utils/cloneJsonCompatible";
import {traverseObjectDepthFirst} from "../../utils/SceneTraverser";
import Command from "../Command";

class SetMaterialTextureCommand extends Command {
    private assetId: string;
    private provider: string;
    private model: THREE.Object3D | null = null;
    private assetName: string = "Generate 3D Object";
    private assetType: string = "textures";
    private originalMaterials: Map<THREE.Mesh, THREE.Material | THREE.Material[]> = new Map();
    private originalMaterialSettings: unknown;
    private downloads: any;

    constructor(model: THREE.Object3D, assetId: string, assetType: string, name: string, provider: string) {
        super();
        this.assetId = assetId;
        this.assetName = name;
        this.provider = provider;
        this.assetType = assetType;
        this.model = model;
    }

    async execute(): Promise<any> {
        try {
            if (this.provider === "polyhaven") {
                await this.getExternalAsset();
            }

            if (this.assetType === "textures" && this.model) {
                await this.applyTextureToModel();
                toast.success(`Texture "${this.assetName}" applied successfully.`);
            } else if (this.assetType === "hdris" && this.model) {
                await this.applyHDRIToModel();
                toast.success(`HDRI "${this.assetName}" applied successfully.`);
            }
        } catch (error) {
            console.error("Error executing SetMaterialTextureCommand:", error);
            toast.error("Failed to apply texture to model.");
            return {
                message: `SetMaterialTextureCommand: Execution failed - Error applying ${this.assetType === "textures" ? "texture" : "HDRI"} (${this.assetName})`,
                status: "error",
            };
        }

        return {
            message: `SetMaterialTextureCommand: ${this.assetType === "textures" ? "Texture" : "HDRI"} applied (${this.assetName})`,
            status: "success",
        };
    }

    private async applyTextureToModel(): Promise<void> {
        if (!this.model || !this.downloads) return;

        const scene = global.app?.scene;
        const sceneId = global.app?.editor?.sceneID;
        if (!scene || !sceneId) {
            throw new Error("Scene must be loaded before importing textures.");
        }

        this.originalMaterialSettings = this.model.userData?.materialSettings
            ? cloneJsonCompatible(this.model.userData.materialSettings)
            : undefined;

        const downloads = this.downloads.additionalFiles;
        const textureOverrides: Partial<Record<keyof IMaterialSettingsTextures, string>> = {};

        const assignOverride = (mapType: string, assetId: string) => {
            const normalized = mapType.toLowerCase();

            if (normalized.includes("color") || normalized.includes("diffuse") || normalized.includes("albedo")) {
                textureOverrides.base = assetId;
            } else if (normalized.includes("roughness") || normalized.includes("rough")) {
                textureOverrides.roughness = assetId;
            } else if (
                normalized.includes("metallic") ||
                normalized.includes("metalness") ||
                normalized.includes("metal")
            ) {
                textureOverrides.metallic = assetId;
            } else if (normalized.includes("normal") || normalized.includes("nor")) {
                textureOverrides.normal = assetId;
            } else if (normalized.includes("ao") || normalized.includes("occlusion")) {
                textureOverrides.ambient = assetId;
            } else if (normalized.includes("emissive")) {
                textureOverrides.emissive = assetId;
            } else if (normalized.includes("specular")) {
                textureOverrides.specular = assetId;
            } else if (normalized === "arm") {
                textureOverrides.ambient = assetId;
                textureOverrides.roughness = assetId;
                textureOverrides.metallic = assetId;
            }
        };

        const importPromises = Object.keys(downloads).map(async mapType => {
            if (downloads[mapType]?.url) {
                try {
                    const textureUrl = downloads[mapType].url;
                    const urlParts = textureUrl.split(".");
                    const extension = urlParts[urlParts.length - 1].toLowerCase().split("?")[0] || "png";
                    const mimeType = extension === "jpg" || extension === "jpeg" ? "image/jpeg" : `image/${extension}`;
                    const file = await urlToFile(textureUrl, `${mapType}.${extension}`, mimeType);
                    const asset = await createSceneAssetWithData({
                        sceneId,
                        type: AssetType.Image,
                        name: file.name,
                        data: file,
                        format: file.name.split(".").pop()?.toLowerCase() || extension,
                        contentType: file.type || mimeType,
                    });

                    setAssetRevision(scene, asset.id, asset.headRevisionId);
                    assignOverride(mapType, asset.id);
                } catch (error) {
                    console.warn(`Failed to import texture ${mapType}:`, error);
                }
            }
        });

        await Promise.allSettled(importPromises);

        traverseObjectDepthFirst(this.model, child => {
            if (child instanceof THREE.Mesh) {
                this.originalMaterials.set(child, child.material);
            }
        });

        const context = getAssetResolutionContext(scene);
        applyTextureOverridesToObject(this.model, textureOverrides, context);
    }

    private async applyHDRIToModel(): Promise<void> {
        if (!this.model || !this.downloads) return;

        const mainFileUrl = this.downloads.mainFile?.url;
        if (!mainFileUrl) {
            console.error("No HDRI file URL found");
            return;
        }

        try {
            // Use urlToFile to download HDRI through backend proxy
            const file = await urlToFile(mainFileUrl, `hdri.hdr`, "application/octet-stream");

            // Create object URL from file
            const url = await uploadImage(file);

            // Load HDRI using HDRLoader
            const loader = new HDRLoader();
            const hdriTexture = await new Promise<THREE.DataTexture>((resolve, reject) => {
                loader.load(
                    url,
                    texture => {
                        texture.mapping = THREE.EquirectangularReflectionMapping;
                        resolve(texture);
                    },
                    undefined,
                    error => {
                        reject(error);
                    },
                );
            });

            // Apply HDRI as environment map to model materials
            traverseObjectDepthFirst(this.model, child => {
                if (child instanceof THREE.Mesh) {
                    // Store original material for undo
                    this.originalMaterials.set(child, child.material);

                    const material = child.material;
                    if (Array.isArray(material)) {
                        material.forEach(mat => {
                            if (mat instanceof THREE.Material) {
                                (mat as THREE.MeshStandardMaterial).map = hdriTexture;

                                mat.needsUpdate = true;
                            }
                        });
                    } else if (material instanceof THREE.Material) {
                        (material as THREE.MeshStandardMaterial).map = hdriTexture;
                        material.needsUpdate = true;
                    }
                }
            });
        } catch (error) {
            console.error("Error loading HDRI:", error);
            throw error;
        }
    }

    undo(): {message: string; status: "success" | "info" | "error"} | void {
        if (this.assetType === "textures" && this.model && this.originalMaterials.size > 0) {
            traverseObjectDepthFirst(this.model, child => {
                if (child instanceof THREE.Mesh && this.originalMaterials.has(child)) {
                    child.material = this.originalMaterials.get(child)!;
                }
            });
            if (this.originalMaterialSettings !== undefined) {
                this.model.userData.materialSettings = this.originalMaterialSettings;
            } else if (this.model.userData?.materialSettings) {
                delete this.model.userData.materialSettings;
            }
            toast.success("Texture application undone.");
            return {
                message: "Texture application undone.",
                status: "success",
            };
        } else if (this.assetType === "hdris" && this.model && this.originalMaterials.size > 0) {
            // Restore original materials for HDRI
            traverseObjectDepthFirst(this.model, child => {
                if (child instanceof THREE.Mesh && this.originalMaterials.has(child)) {
                    child.material = this.originalMaterials.get(child)!;
                }
            });
            toast.success("HDRI application undone.");
            return {
                message: "HDRI application undone.",
                status: "success",
            };
        }
    }

    async redo(): Promise<any> {
        return await this.execute();
    }

    async getExternalAsset(): Promise<null> {
        try {
            const downloadRes = await getAIBackend().request<any>("/api/AI/DownloadAsset", {
                method: "POST",
                body: {
                    id: this.assetId,
                    provider: this.provider,
                    assetType: this.assetType,
                },
            });
            if (!downloadRes.ok || !downloadRes.data) {
                throw Error(`No response from AI (status ${downloadRes.status}).`);
            }

            const modelData = downloadRes.data;
            const downloads = modelData.downloads || [];

            // Store downloads for later use in texture application
            this.downloads = downloads;

            return null;
        } catch (error) {
            console.error("Error searching external models:", error);
            toast.error("Failed to add model to scene.");
            return null;
        }
    }
}

export {SetMaterialTextureCommand};
