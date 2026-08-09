import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Material, Mesh, Object3D } from 'three';

import { useOffscreenCanvas } from '@stem/editor-oss/hooks/useOffscreenCanvas';
import { isGaussianSplatObject } from '@stem/editor-oss/model/gaussianSplats';
import RenderWorker from '../utils/render.worker.ts?worker';

type UseRenderPreviewProps = {
    previewModel: Object3D | undefined;
    canvasRef: React.RefObject<HTMLCanvasElement | null>;
    wrapperRef: React.RefObject<HTMLDivElement | null>;
    useOffscreen?: boolean;
};

type PreviewRendererKind = "webgl" | "webgpu";

type PreviewRenderer = {
    init: () => Promise<void> | void;
    updateModel: (model: Object3D) => void;
    setSize: (width: number, height: number) => void;
    dispose: () => void;
};

export const useRenderPreview = ({
    previewModel,
    canvasRef,
    wrapperRef,
    useOffscreen = true,
}: UseRenderPreviewProps) => {
    const rendererRef = useRef<PreviewRenderer | undefined>(undefined);
    const rendererKindRef = useRef<PreviewRendererKind | undefined>(undefined);
    const rendererRequestIdRef = useRef(0);
    const shouldUseOffscreen = useOffscreen && !isGaussianSplatObject(previewModel);

    const { worker, isOffscreen, isOffscreenRef } = useOffscreenCanvas({
        canvasRef,
        containerRef: wrapperRef,
        workerFactory: () => new RenderWorker(),
        enabled: shouldUseOffscreen,
    });

    const disposeRenderer = () => {
        rendererRequestIdRef.current++;
        if (rendererRef.current) {
            rendererRef.current.dispose();
            rendererRef.current = undefined;
            rendererKindRef.current = undefined;
        }
    };

    const ensureRenderer = async (
        kind: PreviewRendererKind,
        canvas: HTMLCanvasElement,
        width: number,
        height: number,
    ): Promise<PreviewRenderer | undefined> => {
        if (rendererRef.current && rendererKindRef.current === kind) {
            rendererRef.current.setSize(width, height);
            return rendererRef.current;
        }

        disposeRenderer();
        const requestId = ++rendererRequestIdRef.current;
        const { devicePixelRatio } = window;

        const Renderer = kind === "webgpu"
            ? (await import('../utils/ModelPreviewRenderer')).ModelPreviewRenderer
            : (await import('../utils/ModelPreviewWebGLRenderer')).ModelPreviewWebGLRenderer;

        if (requestId !== rendererRequestIdRef.current || isOffscreenRef.current) {
            return undefined;
        }

        const renderer = new Renderer(canvas, width, height, devicePixelRatio);
        rendererRef.current = renderer;
        rendererKindRef.current = kind;

        try {
            await renderer.init();
        } catch (error) {
            renderer.dispose();
            if (rendererRef.current === renderer) {
                rendererRef.current = undefined;
                rendererKindRef.current = undefined;
            }
            throw error;
        }

        if (requestId !== rendererRequestIdRef.current || isOffscreenRef.current) {
            if (rendererRef.current === renderer) {
                rendererRef.current = undefined;
                rendererKindRef.current = undefined;
            }
            renderer.dispose();
            return undefined;
        }

        return renderer;
    };

    useLayoutEffect(() => {
        return () => {
            disposeRenderer();
        };
    }, []);

    useEffect(() => {
        if (isOffscreenRef.current) {
            disposeRenderer();
        }
    }, [isOffscreen]);

    useEffect(() => {
        const wrapper = wrapperRef.current;
        if (!wrapper || isOffscreenRef.current) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                if (rendererRef.current) {
                    rendererRef.current.setSize(width, height);
                }
            }
        });

        observer.observe(wrapper);
        return () => observer.disconnect();
    }, [wrapperRef, isOffscreen]);

    useEffect(() => {
        if (!previewModel) return;

        const updateWorker = async () => {
             const [
                 { GLTFExporter },
                 WebGLTextureUtils,
             ] = await Promise.all([
                 import('three/addons/exporters/GLTFExporter.js'),
                 import('three/addons/utils/WebGLTextureUtils.js'),
             ]);
             const exporter = new GLTFExporter();

             try {
                 exporter.setTextureUtils(WebGLTextureUtils);
             } catch (e) {
                 console.warn("Could not setup TextureUtils for export. Compressed textures may cause issues:", e);
             }

            const tryExport = (model: Object3D, retryCount = 0) => {
                 exporter.parse(
                     model,
                     (gltf) => {
                         const buffer = gltf as ArrayBuffer;
                         if (isOffscreenRef.current && worker) {
                            worker.postMessage({
                                type: 'updateModel',
                                payload: buffer,
                            }, [buffer]);
                        } else if (rendererRef.current) {
                            rendererRef.current.updateModel(previewModel);
                        }
                     },
                     (error) => {
                         console.error('Failed to export model to GLB for worker:', error);

                         if (retryCount === 0 && error.message.includes('setTextureUtils')) {
                             console.warn('Compressed textures detected and export failed. Retrying with stripped textures as fallback.');

                             Promise.resolve().then(async () => {
                                const { clone: cloneModel } = await import('three/addons/utils/SkeletonUtils.js');
                                 const clone = cloneModel(model);
                                 clone.traverse((child) => {
                                     if ((child as Mesh).isMesh) {
                                         const mesh = child as Mesh;
                                         if (mesh.material) {
                                             const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                                             materials.forEach((m) => {
                                                 const mat = m as Material & {
                                                     map?: unknown;
                                                     normalMap?: unknown;
                                                     roughnessMap?: unknown;
                                                     metalnessMap?: unknown;
                                                     emissiveMap?: unknown;
                                                 };
                                                 if (mat.map) mat.map = null;
                                                 if (mat.normalMap) mat.normalMap = null;
                                                 if (mat.roughnessMap) mat.roughnessMap = null;
                                                 if (mat.metalnessMap) mat.metalnessMap = null;
                                                 if (mat.emissiveMap) mat.emissiveMap = null;
                                                 mat.needsUpdate = true;
                                             });
                                         }
                                     }
                                 });

                                 tryExport(clone, retryCount + 1);
                             }).catch(err => {
                                 console.error('Failed to load SkeletonUtils for clone:', err);
                                 const clone = model.clone();
                                 tryExport(clone, retryCount + 1);
                             });
                         }
                     },
                     { binary: true },
                 );
            };

            tryExport(previewModel);
        };

        if (isOffscreenRef.current && worker) {
            void updateWorker();
        } else {
            const canvas = canvasRef.current;
            const wrapper = wrapperRef.current;
            if (!canvas || !wrapper) return;

            let cancelled = false;
            const kind: PreviewRendererKind = isGaussianSplatObject(previewModel) ? "webgpu" : "webgl";
            const width = wrapper.offsetWidth || 100;
            const height = wrapper.offsetHeight || 100;

            ensureRenderer(kind, canvas, width, height)
                .then(renderer => {
                    if (!cancelled && renderer) {
                        renderer.updateModel(previewModel);
                    }
                })
                .catch(error => {
                    console.error("Failed to initialize model preview renderer:", error);
                });

            return () => {
                cancelled = true;
            };
        }

    }, [previewModel, isOffscreen, worker]);

    return {};
};
