/// <reference no-default-lib="true"/>
/// <reference lib="webworker" />
import { Document, WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { expose, transfer } from 'comlink';
import { ktx2 } from 'ktx2-encoder/gltf-transform';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

// ktx2() checks for window to determine if it's running in a browser or not
if (typeof window === 'undefined') {
  self.window = self;
}

const MODEL_UTILS_WORKER_DEBUG = false;
const TEXTURE_SLOTS = [
    'BaseColorTexture',
    'EmissiveTexture',
    'NormalTexture',
    'OcclusionTexture',
    'MetallicRoughnessTexture',
] as const;

const disposeWorkerDocument = (doc: Document): void => {
    const root = doc.getRoot();

    for (const material of root.listMaterials()) {
        material.dispose();
    }

    for (const mesh of root.listMeshes()) {
        mesh.dispose();
    }

    for (const texture of root.listTextures()) {
        texture.dispose();
    }

    for (const accessor of root.listAccessors()) {
        accessor.dispose();
    }

    for (const buffer of root.listBuffers()) {
        buffer.dispose();
    }
};

export interface CompressTexturesInput {
    glbData: ArrayBuffer;
    options: { compressTextures?: boolean };
}

const processCompressTextures = async (input: CompressTexturesInput): Promise<ArrayBuffer> => {
    const { glbData, options } = input;
    if (!glbData) {
        throw new Error('No glbData provided');
    }

    await MeshoptEncoder.ready;
    await MeshoptDecoder.ready;
    const io = new WebIO()
        .registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({
            "meshopt.encoder": MeshoptEncoder,
            "meshopt.decoder": MeshoptDecoder,
        });

    const doc = await io.readBinary(new Uint8Array(glbData));

    // Clean up null or invalid texture references before processing
    // This prevents ktx2 transform from crashing on external texture references
    // that weren't properly embedded in the GLB
    const root = doc.getRoot();
    const materials = root.listMaterials();
    if (MODEL_UTILS_WORKER_DEBUG) {
        console.debug(`[ModelUtilsWorker] Processing ${materials.length} materials`);
    }

    for (const material of materials) {
        // Skip if material is somehow invalid
        if (!material || typeof material.getBaseColorTexture !== 'function') {
            console.warn(`[ModelUtilsWorker] Skipping invalid material`);
            continue;
        }

        const materialName = MODEL_UTILS_WORKER_DEBUG ? material.getName?.() || 'unnamed' : '';
        if (MODEL_UTILS_WORKER_DEBUG) {
            console.debug(`[ModelUtilsWorker] Checking material: ${materialName}`);
        }

        // Check each texture slot and clear if the texture has no image data
        for (const slotName of TEXTURE_SLOTS) {
            const getter = `get${slotName}` as keyof typeof material;
            const setter = `set${slotName}` as keyof typeof material;

            if (typeof material[getter] === 'function' && typeof material[setter] === 'function') {
                try {
                    const texture = (material[getter] as () => {
                        getName?: () => string;
                        getURI?: () => string;
                        getImage?: () => {byteLength?: number} | null | undefined;
                    } | null | undefined)();
                    if (texture) {
                        const image = texture.getImage?.();

                        if (MODEL_UTILS_WORKER_DEBUG) {
                            const textureName = texture.getName?.() || texture.getURI?.() || 'unnamed';
                            const imageSize = image?.byteLength ?? 0;
                            console.debug(`[ModelUtilsWorker] Material "${materialName}" ${slotName}: texture="${textureName}", imageSize=${imageSize}`);
                        }

                        // Only remove if there's no image data
                        if (!image || image.byteLength === 0) {
                            console.warn(`[ModelUtilsWorker] Removing texture with no image data from ${slotName}`);
                            (material[setter] as (v: null) => void)(null);
                        }
                    }
                } catch (e) {
                    console.warn(`[ModelUtilsWorker] Error checking ${slotName}, clearing it:`, e);
                    try {
                        (material[setter] as (v: null) => void)(null);
                    } catch { /* ignore */ }
                }
            }
        }
    }

    // Also remove any orphaned textures with no image data
    const textures = root.listTextures();
    if (MODEL_UTILS_WORKER_DEBUG) {
        console.debug(`[ModelUtilsWorker] Checking ${textures.length} textures for orphaned/empty`);
    }

    for (const texture of textures) {
        try {
            const image = texture.getImage?.();

            if (MODEL_UTILS_WORKER_DEBUG) {
                const textureName = texture.getName?.() || texture.getURI?.() || 'unnamed';
                const imageSize = image?.byteLength ?? 0;
                console.debug(`[ModelUtilsWorker] Texture "${textureName}": imageSize=${imageSize}`);
            }

            // Only dispose if there's no image data
            if (!image || image.byteLength === 0) {
                const textureName = texture.getName?.() || texture.getURI?.() || 'unnamed';
                console.warn(`[ModelUtilsWorker] Disposing orphaned/empty texture: ${textureName}`);
                texture.dispose();
            }
        } catch (e) {
            console.warn(`[ModelUtilsWorker] Error checking texture, disposing it:`, e);
            try {
                texture.dispose();
            } catch { /* ignore */ }
        }
    }

    // Remove textures whose graph is detached from the document.
    // This happens with JSON glTF files where textures have valid image data
    // but lose their document graph relationship after the GLB round-trip.
    // Without this, ktx2's listTextureSlots calls Document.fromGraph() which
    // returns null and crashes on .getRoot().
    for (const texture of root.listTextures()) {
        try {
            const graphDoc = Document.fromGraph(texture.getGraph());
            if (!graphDoc) {
                const textureName = texture.getName?.() || texture.getURI?.() || 'unnamed';
                console.warn(`[ModelUtilsWorker] Disposing texture with detached graph: ${textureName}`);
                texture.dispose();
            }
        } catch (e) {
            console.warn(`[ModelUtilsWorker] Error validating texture graph, disposing:`, e);
            try { texture.dispose(); } catch { /* ignore */ }
        }
    }

    let optimizedGlbData: Uint8Array<ArrayBuffer>;

    try {
        if (options.compressTextures) {
            try {
                await doc.transform(
                    ktx2({
                        slots: /normal/,
                        isKTX2File: true,
                        isUASTC: false,
                        isNormalMap: true,
                        // Treat normal maps as having linear data
                        isSetKTX2SRGBTransferFunc: false,
                        isPerceptual: false,
                        qualityLevel: 255,
                        enableDebug: false,
                        // Setting this to false because the mipmaps generated for normal
                        // maps are not correct. Likely the library is not handling the
                        // vectors correctly.
                        generateMipmap: false,
                        jsUrl: "/assets/js/ktx2/basis_encoder.js",
                        wasmUrl: "/assets/js/ktx2/basis_encoder.wasm",
                    }),
                    ktx2({
                        // Don't specify slots here - compress all remaining textures
                        isKTX2File: true,
                        isUASTC: false,
                        isNormalMap: false,
                        // Treate other maps as sRGB.
                        isSetKTX2SRGBTransferFunc: true,
                        isPerceptual: true,
                        qualityLevel: 128,
                        enableDebug: false,
                        generateMipmap: true,
                        jsUrl: "/assets/js/ktx2/basis_encoder.js",
                        wasmUrl: "/assets/js/ktx2/basis_encoder.wasm",
                    }),
                );
            } catch (e) {
                console.warn('[ModelUtilsWorker] KTX2 texture compression failed, continuing without compression:', e);
                // Continue without texture compression - the model will still work
            }
        }

        optimizedGlbData = await io.writeBinary(doc);
    } finally {
        disposeWorkerDocument(doc);
    }

    return transfer(optimizedGlbData.buffer, [optimizedGlbData.buffer]);
};

const api = {
    processCompressTextures,
};

expose(api);

export type ModelUtilsWorkerAPI = typeof api;

// Default export for bun test compatibility (?worker imports resolve as regular modules in tests)
export default api;
