import {createContext, useContext, useState, useRef, ReactNode} from "react";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
    AmbientLight,
    Color,
    DirectionalLight,
    Object3D,
    PerspectiveCamera,
    Scene,
} from "three";

import { useAssetResolutionContext } from "./AssetResolutionContext";
import {
    getSceneAssets,
    getAssetRevision,
    getAssetDerivatives,
    AssetType,
    AssetDerivativeType,
    Asset,
    SUPPORTED_MODEL_CONTENT_TYPES,
} from "@stem/network/api/asset";
import { saveScene } from "@stem/network/api/scene";
import { useCreateAssetRevisionWithData, useCreateAssetDerivativeWithData } from "../editor/asset-management/hooks/assets";
import { UploadSettings, LodSettings } from "../editor/assets/v2/LeftPanel/MainTabs/AssetsTab/ModelUpload/types";
import { positionCameraForModel } from "../editor/assets/v2/utils/positionCameraForModel";
import { convertToGlb } from "../model/convertToGlb";
import { createLods } from "../model/load-util";
import { loadModelFromFile } from "../model/loadModelFromFile";
import { showToast } from "../showToast";

interface BatchLodGenerationContextType {
    generateLodsForScene: (sceneId: string, lodSettings: LodSettings[], uploadSettings: Omit<UploadSettings, "lodSettings">) => Promise<void>;
    cancelBatchLodGeneration: () => void;
    isProcessing: boolean;
    progress: number;
    total: number;
}

const BatchLodGenerationContext = createContext<BatchLodGenerationContextType | undefined>(undefined);

export const useBatchLodGenerationContext = () => {
    const context = useContext(BatchLodGenerationContext);
    if (!context) {
        throw new Error("useBatchLodGenerationContext must be used within a BatchLodGenerationContextProvider");
    }
    return context;
};

const renderModelPreview = async (model: Object3D) => {
    try {
        const {WebGPURenderer} = await import("three/webgpu");
        const renderer = new WebGPURenderer({
            antialias: true,
            alpha: false,
        });
        await renderer.init();

        const scene = new Scene();
        scene.name = "BatchLodGenerationContextScene";
        scene.background = new Color(0x27272a);

        const light = new AmbientLight(0xffffff, 5);
        scene.add(light);

        const directionalLight = new DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(5, 10, 7.5);
        scene.add(directionalLight);

        scene.add(model);

        const camera = new PerspectiveCamera(45, 1, 0.1, 1000);
        const controls = new OrbitControls(camera, renderer.domElement);

        positionCameraForModel(model, camera, controls);

        renderer.render(scene, camera);

        renderer.dispose();
        if (renderer.isWebGPURenderer) {
            (renderer.backend as any)?.device?.destroy();
        }

        controls.dispose();
    } catch (e) {
        console.warn("Failed to render model preview during batch processing", e);
    }
};

export const BatchLodGenerationContextProvider = ({ children }: { children: ReactNode }) => {
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [total, setTotal] = useState(0);
    const abortControllerRef = useRef<AbortController | null>(null);

    const createAssetRevisionMutation = useCreateAssetRevisionWithData();
    const createAssetDerivativeMutation = useCreateAssetDerivativeWithData();
    const { setAssetRevision } = useAssetResolutionContext();

    const cancelBatchLodGeneration = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
            showToast({ type: "info", title: "Batch LOD generation cancelled" });
        }
    };

    const generateLodsForScene = async (sceneId: string, lodSettings: LodSettings[], uploadSettings: Omit<UploadSettings, "lodSettings">) => {
        if (isProcessing) return;
        setIsProcessing(true);
        setProgress(0);
        setTotal(0);

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        try {
            const { assets: modelAssets } = await getSceneAssets(sceneId, { types: [AssetType.Model] });
            
            const supportedAssets = modelAssets;
            setTotal(supportedAssets.length);

            if (supportedAssets.length === 0) {
                showToast({ type: "info", title: "No supported models found in scene" });
                setIsProcessing(false);
                return;
            }

            for (let i = 0; i < supportedAssets.length; i++) {
                if (abortController.signal.aborted) break;
                const asset = supportedAssets[i];
                if (!asset) continue;
                try {
                    await processAsset(asset, lodSettings, uploadSettings, abortController.signal);
                } catch (e) {
                    if (abortController.signal.aborted) throw e;
                    console.error(`Failed to process asset ${asset.name}:`, e);
                    showToast({ type: "error", title: `Failed to process ${asset.name}` });
                }
                setProgress(i + 1);
            }

            if (!abortController.signal.aborted) {
                await saveScene(false, false);
                showToast({ type: "success", title: "Batch LOD generation complete. Please reload the scene to apply changes." });
            }
        } catch (e) {
            if (abortControllerRef.current?.signal.aborted || e instanceof Error && e.name === 'AbortError') {
                // Cancelled
            } else {
                console.error("Batch LOD generation failed:", e);
                showToast({ type: "error", title: "Batch LOD generation failed" });
            }
        } finally {
            setIsProcessing(false);
            abortControllerRef.current = null;
        }
    };

    const processAsset = async (asset: Asset, lodSettings: LodSettings[], uploadSettings: Omit<UploadSettings, "lodSettings">, signal: AbortSignal) => {
        if (!asset.headRevisionId) return;

        const revision = await getAssetRevision(asset.id, asset.headRevisionId, { includeDataUrl: true });
        if (!revision.dataUrl) throw new Error("No data URL for asset");

        const response = await fetch(revision.dataUrl);
        const blob = await response.blob();
        
        const ext = revision.format || asset.format || "glb";
        const fileName = asset.name.includes(".") ? asset.name : `${asset.name}.${ext}`;
        const file = new File([blob], fileName);
        const { model, format } = await loadModelFromFile(file, signal);

        // NOTE: Render model to ensure textures are properly loaded before conversion
        await renderModelPreview(model);

        const buffer = await convertToGlb(model, signal, {});

        // Fetch thumbnail
        let thumbnailBlob: Blob | null = null;
        let thumbnailFormat = "png";
        let thumbnailMetadata: Record<string, unknown> = {};
        try {
            const derivatives = await getAssetDerivatives(asset.id, asset.headRevisionId, { includeDataUrl: true });
            const thumbnailDerivative = derivatives.find(d => d.type === String(AssetDerivativeType.Thumbnail));
            if (thumbnailDerivative && thumbnailDerivative.dataUrl) {
                const thumbResponse = await fetch(thumbnailDerivative.dataUrl);
                thumbnailBlob = await thumbResponse.blob();
                thumbnailFormat = thumbnailDerivative.format;
                thumbnailMetadata = thumbnailDerivative.metadata || {};
            }
        } catch (e) {
            console.warn("Failed to fetch thumbnail for asset", asset.id, e);
        }

        const settings: UploadSettings = {
            ...uploadSettings,
            lodSettings: lodSettings,
        };

        const lods = await createLods(buffer, asset.name, settings, signal);

        if (signal.aborted) return;

        const contentType = SUPPORTED_MODEL_CONTENT_TYPES[format][0];
        const newRevision = await createAssetRevisionMutation.mutateAsync({
            assetId: asset.id,
            parentRevisionId: asset.headRevisionId,
            data: blob,
            format,
            contentType,
            options: {
                metadata: {
                    generatedBy: "BatchLODGeneration",
                    generatedAt: new Date().toISOString(),
                },
            },
        });

        for (const lod of lods) {
            await createAssetDerivativeMutation.mutateAsync({
                assetId: asset.id,
                revisionId: newRevision.id,
                type: AssetDerivativeType.Model,
                format: "glb",
                contentType: "model/gltf-binary",
                data: lod.file,
                lodLevel: lod.level,
                metadata: {
                    vertexCount: lod.vertexCount,
                    polygonCount: lod.polygonCount,
                    compression: lod.compression,
                },
            });
        }

        if (thumbnailBlob) {
            await createAssetDerivativeMutation.mutateAsync({
                assetId: asset.id,
                revisionId: newRevision.id,
                type: AssetDerivativeType.Thumbnail,
                format: thumbnailFormat,
                contentType: thumbnailBlob.type,
                data: thumbnailBlob,
                metadata: {
                    width: thumbnailMetadata.width as number,
                    height: thumbnailMetadata.height as number,
                },
            });
        }

        setAssetRevision(asset.id, newRevision.id);
    };

    return (
        <BatchLodGenerationContext.Provider value={{ generateLodsForScene, cancelBatchLodGeneration, isProcessing, progress, total }}>
            {children}
        </BatchLodGenerationContext.Provider>
    );
};
