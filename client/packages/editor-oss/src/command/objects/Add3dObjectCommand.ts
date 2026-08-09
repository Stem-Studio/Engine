import JSZip from "jszip";
import * as THREE from "three";
import {toast} from "toastywave";

import {getAsset} from "@stem/network/api/asset";
import {getAIBackend} from "../../ai";
import EngineRuntime from "../../EngineRuntime";
import {
    emptyAssetResolutionContext,
    getAssetResolutionContext,
    setAssetRevision,
} from "../../asset-management/AssetResolutionContext";
import AIWorldController from "../../controls/AiWorldController/AiWorldController";
import global from "../../global";
import {uploadModelFromUrl} from "../../model/uploadModelFromUrl";
import {loadModel} from "../../model/load-util";
import {setModelId, setModelRevisionId} from "../../model/util";
import Command from "../Command";
import {AddObjectCommand, MoveObjectCommand, RemoveObjectCommand} from "../Commands";
class Add3dObjectCommand extends Command {
    private aiWorldController: AIWorldController;
    private assetId: string;
    private provider: string;
    private downloadUrl: string;
    private downloads: any = {};
    private position: THREE.Vector3 | null = null;
    private model: THREE.Object3D | null = null;
    private width: number = 1;
    private height: number = 1;
    private assetName: string = "Generate 3D Object";
    private callback: ((model: THREE.Object3D) => void) | undefined;
    private parentObj: THREE.Object3D | undefined;

    constructor(
        id: string,
        name: string,
        provider: string,
        downloadUrl: string,
        position: THREE.Vector3,
        width: number = 1,
        height: number = 1,
        callback?: (model: THREE.Object3D) => void,
        parentObj?: THREE.Object3D,
    ) {
        super();
        this.aiWorldController = AIWorldController.getInstance(global.app as EngineRuntime);
        this.assetId = id;
        this.assetName = name;
        this.provider = provider;
        this.downloadUrl = downloadUrl;
        this.model = null;
        this.position = position;
        this.width = width;
        this.height = height;
        this.callback = callback;
        this.parentObj = parentObj;
    }

    async execute(): Promise<void | {message: string; status: "success" | "info" | "error"}> {
        try {
            if (this.provider === "local") {
                this.model = await this.addLocalModel();
            } else if (this.provider === "sketchfab") {
                this.model = await this.addExternalSingleFileModel();
            } else if (this.provider === "polyhaven") {
                this.model = await this.addExternalMultipleFilesModel();
            } else if (this.provider === "meshy") {
                this.model = await this.addExternalSingleFileModel();
            } else {
                toast.error("Unsupported provider for adding 3D object.");
                return {
                    message: `Add3dObjectCommand: Execution failed - Unsupported provider (${this.provider})`,
                    status: "error",
                };
            }

            if (this.model) {
                this.aiWorldController.addObjectToScene(
                    this.model,
                    false,
                    this.width,
                    this.height,
                    this.position || new THREE.Vector3(),
                );
                if (this.parentObj) {
                    new MoveObjectCommand(this.model, this.parentObj).execute();
                }
                this.callback?.(this.model);
            } else {
                throw new Error("failed to add model to scene");
            }
        } catch (error) {
            console.error("Error executing Add3dObjectCommand:", error);
            toast.error("Failed to add 3D object to scene.");
            return {
                message: `Add3dObjectCommand: Execution failed - Error adding 3D object (${this.assetName})`,
                status: "error",
            };
        }
        return {
            message: `Add3dObjectCommand: 3D object added (${this.assetName})`,
            status: "success",
        };
    }

    undo(): {message: string; status: "success" | "info" | "error"} | void {
        if (this.model) {
            const removeCommand = new RemoveObjectCommand(this.model);
            return removeCommand.execute() as {message: string; status: "success" | "error" | "info"};
        }
    }

    async redo(): Promise<{message: string; status: "success" | "info" | "error"} | void> {
        if (this.model) {
            const addCommand = new AddObjectCommand(this.model);
            return await addCommand.execute() as {message: string; status: "success" | "error" | "info"};
        } else {
            return await this.execute();
        }
    }

    private async downloadAsset(): Promise<any> {
        const downloadRes = await getAIBackend().request<unknown>("/api/AI/DownloadAsset", {
            method: "POST",
            body: {
                id: this.assetId,
                provider: this.provider,
                assetType: "models",
            },
        });

        if (!downloadRes.ok || !downloadRes.data) {
            throw new Error(`No response from AI (status ${downloadRes.status}).`);
        }

        return downloadRes.data;
    }

    async addExternalMultipleFilesModel(): Promise<THREE.Object3D | null> {
        try {
            const assetData = await this.downloadAsset();
            this.downloads = assetData.downloads;
            const thumbnailUrl = assetData.thumbnail;
            // Extract main file info
            const mainFile = this.downloads.mainFile;
            if (!mainFile?.url) {
                throw new Error("No main file URL found in downloads");
            }

            // Get file extension from main file URL
            const mainFileUrl = mainFile.url;
            const mainFileName = mainFileUrl.split("/").pop() || "model";
            const fileExtension = mainFileName.split(".").pop()?.toLowerCase() || "gltf";

            // Create ZIP archive
            const zip = new JSZip();

            // Download and add main file to ZIP
            const mainFileData = await this.urlToFile(mainFileUrl, mainFileName, this.getMimeType(fileExtension));
            zip.file(mainFileName, mainFileData);

            // Download and add included files to ZIP with proper folder structure
            if (mainFile.include) {
                const downloadPromises = Object.entries(mainFile.include).map(
                    async ([filePath, fileInfo]: [string, any]) => {
                        try {
                            const fileName = filePath.split("/").pop() || "file";
                            const fileExtension = fileName.split(".").pop()?.toLowerCase() || "";
                            const fileData = await this.urlToFile(
                                fileInfo.url,
                                fileName,
                                this.getMimeType(fileExtension),
                            );

                            // Add file to ZIP with proper folder structure
                            zip.file(filePath, fileData);
                        } catch (error) {
                            console.warn(`Failed to download file ${filePath}:`, error);
                        }
                    },
                );

                // Wait for all downloads to complete
                await Promise.allSettled(downloadPromises);
            }

            // Generate ZIP blob
            const zipBlob = await zip.generateAsync({type: "blob"});
            const zipFile = new File([zipBlob], `${this.assetName}.${fileExtension}.zip`, {type: "application/zip"});

            try {
                // Upload the ZIP file and get object data
                const objectData = await this.aiWorldController.uploadObjectByUrl(
                    "",
                    thumbnailUrl,
                    this.assetName,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    zipFile,
                );

                if (!objectData) {
                    throw new Error("Failed to upload ZIP file");
                }

                // Add model to scene
                this.model =
                    (await this.aiWorldController.addModelToSceneFromServer(objectData, this.assetName)) || null;
                if (!this.model) {
                    throw new Error("Failed to add model to scene");
                }

                return this.model;
            } catch (error) {
                console.error("Error uploading ZIP file or adding model to scene:", error);
                throw new Error("Failed to add model to scene");
            }
        } catch (error) {
            console.error("Error adding external multiple files model:", error);
            toast.error("Failed to add model to scene.");
            return null;
        }
    }

    async addExternalSingleFileModel(): Promise<THREE.Object3D | null> {
        try {
            const modelData = await this.downloadAsset();
            this.downloadUrl = modelData.downloads.mainFile.url || modelData.downloadUrl;

            if (!this.downloadUrl) {
                throw new Error("No download URL found for model");
            }

            // Upload with LODs, texture compression, and scene association
            const result = await uploadModelFromUrl({
                url: this.downloadUrl,
                name: this.assetName,
                settings: {
                    assetSource: global.app?.editor?.assetSource,
                },
            });

            setAssetRevision(global.app!.scene, result.assetId, result.revisionId);
            global.app?.call("objectChanged", null, global.app.scene);

            // Use the already-loaded object from uploadModelFromUrl instead of
            // re-loading via loadModel(), which requires an AssetLoader that may
            // not have the newly uploaded asset in its cache yet.
            const object = result.object;
            setModelId(object, result.assetId);
            setModelRevisionId(object, result.revisionId);

            object.name = this.assetName;

            return object;
        } catch (error) {
            console.error("Error searching external models:", error);
            toast.error("Failed to add model to scene.");
            return null;
        }
    }

    async addLocalModel(): Promise<THREE.Object3D | null> {
        try {
            const asset = await getAsset(this.assetId, {includeLatestRelease: true});
            const revisionId = asset.latestRelease?.revisionId || asset.headRevisionId;
            if (!revisionId) {
                throw new Error(`No released revision found for asset ${this.assetId}`);
            }

            const scene = global.app!.scene;
            setAssetRevision(scene, this.assetId, revisionId);
            global.app?.call("objectChanged", null, scene);

            const context = getAssetResolutionContext(scene) ?? emptyAssetResolutionContext;
            console.log("Adding model to scene with asset data", this.assetId);

            console.log("Asset resolution context:", context);

            const object = await loadModel(this.assetId, context);
            object.name = this.assetName;

            return object;
        } catch (error) {
            console.error("Error loading asset from API:", error);
            toast.error("Failed to add model to scene.");
            return null;
        }
    }

    private async urlToFile(url: string, filename: string, mimeType: string): Promise<File> {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
        }
        const blob = await response.blob();
        return new File([blob], filename, {type: mimeType});
    }

    private getMimeType(extension: string): string {
        const mimeTypes: {[key: string]: string} = {
            gltf: "model/gltf+json",
            glb: "model/gltf-binary",
            fbx: "application/octet-stream",
            bin: "application/octet-stream",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            png: "image/png",
            webp: "image/webp",
        };
        return mimeTypes[extension] || "application/octet-stream";
    }
}

export {Add3dObjectCommand};
