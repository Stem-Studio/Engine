import { useEffect, useRef, useState } from "react";
import type { Object3D } from "three";

import { DEFAULT_UPLOAD_SETTINGS } from './constants';
import { useModelWarnings } from './hooks/useModelWarnings';
import { useRenderPreview } from './hooks/useRenderPreview';
import { Container, Content, Wrapper, LoadingOverlay, LoadingText } from "./ModelPreview.style";
import { ModelPreviewFooter } from "./ModelPreviewFooter";
import { LodLevel } from './types';
import type { UploadSettings } from './types';
import { UploadSettingsSection } from './UploadSettingsSection';
import { cleanupInvalidTextures } from './utils/cleanupInvalidTextures';
import { getModelPolygonCount } from './utils/getModelPolygonCount';
import { isModelMixamoCompatible } from './utils/isModelMixamoCompatible';
import { voxelizeModel } from './utils/voxelizeModel';
import type { ModelFormat } from '@stem/network/api/asset';
import { isGaussianSplatObject } from '@stem/editor-oss/model/gaussianSplats';
import GradientSpinner from '@web-shared/player/component/GradientSpinner';
import { cloneObject } from "@stem/editor-oss/utils/ObjectUtils";

type ModelPreviewProps = {
    model: Object3D;
    isLoading: boolean;
    format?: ModelFormat;
    maxLodLevel?: LodLevel;
    showWarnings?: boolean;
    hasMoreModels?: boolean;
    onSave?: (settings: UploadSettings) => void;
    onSkip?: () => void;
    onCancel: () => void;
};

export const ModelPreview = ({
    model,
    isLoading,
    format,
    maxLodLevel = LodLevel.Original,
    showWarnings = true,
    hasMoreModels = false,
    onSave,
    onSkip,
    onCancel,
}: ModelPreviewProps) => {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const [previewModel, setPreviewModel] = useState<Object3D | undefined>();
    const [uploadSettings, setUploadSettings] = useState<UploadSettings>(DEFAULT_UPLOAD_SETTINGS);
    const [polygonCount, setPolygonCount] = useState(0);
    const [isMixamoSupported, setIsMixamoSupported] = useState(false);
    const [isVoxelizing, setIsVoxelizing] = useState(false);

    // Generate a preview model from the original model
    useEffect(() => {
        if (!model) {
            return;
        }

        let cancelled = false;

        const processModel = async () => {
            const isGaussianSplat = isGaussianSplatObject(model);

            if (isGaussianSplat) {
                const previewSplat = model;
                previewSplat.userData.skipPreviewDispose = true;
                setIsVoxelizing(false);
                setPreviewModel(previewSplat);
                setPolygonCount(0);
                setIsMixamoSupported(false);
                return;
            }

            // Clone the original model
            const cloned = cloneObject(model);

            // Clean up invalid textures (e.g., missing external textures from FBX files)
            // This replaces broken textures with a default placeholder
            await cleanupInvalidTextures(cloned);

            if (cancelled) return;

            // Apply voxelization if enabled
            if (uploadSettings.voxelize) {
                setIsVoxelizing(true);
                const resolution = uploadSettings.voxelResolution ?? 32;
                try {
                    const voxelized = await voxelizeModel(cloned, resolution, uploadSettings.removeHiddenFaces);
                    if (cancelled) return;
                    setPreviewModel(voxelized);
                    setPolygonCount(getModelPolygonCount(voxelized));
                } catch (error) {
                    console.error('Failed to voxelize model for preview:', error);
                    if (cancelled) return;
                    setPreviewModel(cloned);
                    setPolygonCount(getModelPolygonCount(model));
                } finally {
                    if (!cancelled) setIsVoxelizing(false);
                }
            } else {
                setIsVoxelizing(false);
                setPreviewModel(cloned);
                setPolygonCount(getModelPolygonCount(model));
            }

            setIsMixamoSupported(isModelMixamoCompatible(model));
        };

        processModel().catch(error => {
            console.error('[ModelPreview] Error processing model:', error);
        });

        return () => {
            cancelled = true;
            delete model.userData.skipPreviewDispose;
            setPreviewModel(undefined);
        };
    }, [model, uploadSettings.voxelize, uploadSettings.voxelResolution, uploadSettings.removeHiddenFaces]);

    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Render a preview of the model
    useRenderPreview({
        previewModel,
        canvasRef,
        wrapperRef,
        useOffscreen: !isGaussianSplatObject(model),
    });

    // Generate warnings
    const { warnings } = useModelWarnings({
        polygonCount,
        isMixamoSupported,
        format,
        uploadSettings,
    });

    return (
        <Container>
            <Wrapper ref={wrapperRef}>
                <canvas ref={canvasRef}
                    style={{ display: 'block', width: '100%', height: '100%' }}
                />
                {isVoxelizing && 
                    <LoadingOverlay>
                        <GradientSpinner />
                        <LoadingText>Voxelizing model...</LoadingText>
                    </LoadingOverlay>
                }
            </Wrapper>
            <Content className="hidden-scroll">
                {isLoading
                    ? <GradientSpinner />
                    : <UploadSettingsSection
                            maxLodLevel={maxLodLevel}
                            uploadSettings={uploadSettings}
                            setUploadSettings={setUploadSettings}
                      />
                }
                <ModelPreviewFooter
                    warnings={showWarnings ? warnings : []}
                    polygonCount={polygonCount}
                    isLoading={isLoading}
                    hasMoreModels={hasMoreModels}
                    handleSave={() => onSave?.(uploadSettings)}
                    handleSkip={onSkip}
                    handleCancel={onCancel}
                />
            </Content>
        </Container>
    );
};

ModelPreview.displayName = "ModelPreview";
