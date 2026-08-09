import {createRoot, Root} from "react-dom/client";
import * as THREE from "three";
import {CSS3DSprite} from "three/addons/renderers/CSS3DRenderer.js";
import trimImageData from "trim-image-data";

import ImageGeneratorProvider from "src/utils/ImageGeneratorProvider";

import {IAiTransformResponse} from "./AiWorldController.types";
import EngineRuntime from "@stem/editor-oss/EngineRuntime";
import {Indicator} from "@stem/editor-oss/editor/assets/v2/ContextMenu/Indicator/Indicator";
import global from "@stem/editor-oss/global";
import Box from "@stem/editor-oss/object/geometry/Box";
import Plane from '@stem/editor-oss/object/geometry/Plane';
import Ajax from "@stem/editor-oss/utils/Ajax";
import {backendUrlFromPath} from "@stem/editor-oss/utils/UrlUtils";
import {isPlaygroundMode} from "@web-shared/playgroundMode";

const activeIndicators = new Set<THREE.Group>();


/**
 * Convert old Upload path format to new API path format
 * Example: /Upload/Model/20250924043806_565000/CraftingHub.glb -> /api/Asset/Download/model/20250924043806_565000/CraftingHub.glb
 * @param oldPath
 */
function convertOldPathToNewFormat(oldPath: string): string {
    // Remove leading slash and split path
    const cleanPath = oldPath.replace(/^\//, '');
    const parts = cleanPath.split('/');

    if (parts.length < 3 || parts[0] !== 'Upload') {
        // If it doesn't match expected format, return as-is
        return oldPath;
    }

    const uploadDir = parts[1]!; // Model, Image, Texture, etc.
    const uniqueId = parts[2];
    const filename = parts.slice(3).join('/');

    // Map directory names to asset types (reverse of backend mapping)
    const dirToTypeMap: { [key: string]: string } = {
        'Model': 'model',
        'Image': 'image',
        'Texture': 'texture',
        'Video': 'video',
        'Animation': 'animation',
        'Avatar': 'avatar',
        'Audio': 'audio',
    };

    const assetType = dirToTypeMap[uploadDir];
    if (!assetType) {
        console.warn(`Unknown upload directory: ${uploadDir}, using as lowercase`);
        // Fallback: use directory name as lowercase type
        return `/api/Asset/Download/${uploadDir.toLowerCase()}/${uniqueId}/${filename}`;
    }

    return `/api/Asset/Download/${assetType}/${uniqueId}/${filename}`;
}

export const updatePosition = (object: THREE.Object3D, position: THREE.Vector3) => {
    object.position.set(position.x, position.y, position.z);
};

export const updateScale = (object: THREE.Object3D, scale: THREE.Vector3) => {
    const currentScale = object.scale;
    object.scale.set(scale.x * currentScale.x, scale.y * currentScale.y, scale.z * currentScale.z);
};

export const updateRotation = (object: THREE.Object3D, rotation: THREE.Euler) => {
    const currentRotation = object.rotation;
    object.rotation.set(rotation.x + currentRotation.x, rotation.y + currentRotation.y, rotation.z + currentRotation.z);
};

export const base64ToFile = (base64: string, fileName: string, mimeType = "application/octet-stream") => {
    const base64Data = base64.split(",")[1] || base64;
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);

    return new File([byteArray], fileName, {type: mimeType});
};

export const replaceTexture = (object: THREE.Object3D, url: string, isTransparent: boolean, isTwoSided: boolean) => {
    if (object instanceof THREE.Mesh) {
        const texture = new THREE.TextureLoader().load(url);
        object.material = new THREE.MeshBasicMaterial({
            map: texture,
            side: isTwoSided ? THREE.DoubleSide : THREE.FrontSide,
            transparent: isTransparent,
        });
    }
};

export const processTransform = (object: THREE.Object3D, transform: IAiTransformResponse) => {
    if (transform.position) {
        const {x, y, z} = transform.position;
        const position = new THREE.Vector3(x, y, z);
        updatePosition(object, position);
    }

    if (transform.scale) {
        const {x, y, z} = transform.scale;
        const scale = new THREE.Vector3(x, y, z);
        updateScale(object, scale);
    }

    if (transform.rotation) {
        const {x, y, z} = transform.rotation;
        const rotation = new THREE.Euler(
            x * THREE.MathUtils.DEG2RAD,
            y * THREE.MathUtils.DEG2RAD,
            z * THREE.MathUtils.DEG2RAD,
        );
        updateRotation(object, rotation);
    }
};

export const urlToFile = async (
    url: string,
    name: string,
    type: string,
    onProgress?: (loaded: number, total?: number) => void,
    signal?: AbortSignal,
) => {
    // Determine if this is a local asset or remote URL
    const isLocalAsset = url.startsWith('/api/Asset/Download') ||
                        url.startsWith('/Upload/') ||
                        !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('data:');

    if (isLocalAsset) {
        // Handle local assets - direct fetch
        let fetchUrl: string;
        if (url.startsWith('/api/Asset/Download')) {
            // Already properly formatted
            fetchUrl = backendUrlFromPath(url) || "";
        } else if (url.startsWith('/Upload/')) {
            // Convert old-style path to new path-based format
            const newPath = convertOldPathToNewFormat(url);
            fetchUrl = backendUrlFromPath(newPath) || "";
        } else {
            // Relative path, assume it's in uploads
            const newPath = convertOldPathToNewFormat(`/Upload/${url}`);
            fetchUrl = backendUrlFromPath(newPath) || "";
        }

        const res = await fetch(fetchUrl, { signal });
        if (!res.ok) {
            throw new Error(`Failed to fetch local asset: ${res.statusText}`);
        }

        // Handle progress for local assets
        if (onProgress && res.body) {
            const contentLength = res.headers.get('Content-Length');
            const total = contentLength ? parseInt(contentLength, 10) : undefined;

            const reader = res.body.getReader();
            const chunks: Uint8Array[] = [];
            let loaded = 0;

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    chunks.push(value);
                    loaded += value.length;
                    onProgress(loaded, total);
                }
            } finally {
                reader.releaseLock();
            }

            const blob = new Blob(chunks as unknown as BlobPart[]);
            return new File([blob], name, {type});
        } else {
            const blob = await res.blob();
            return new File([blob], name, {type});
        }
    } else {
        // Handle remote URLs via proxy with enhanced retry logic
        const fetchWithRetry = async (maxAttempts: number): Promise<Response> => {
            let attempt = 1;

            while (attempt <= maxAttempts) {
                try {
                    // Playground has no Go server: fetch the provider CDN URL
                    // directly. Elsewhere, route through `/api/Proxy/Download`
                    // to dodge CORS on external CDNs.
                    const res = isPlaygroundMode()
                        ? await fetch(url, {signal})
                        : await fetch(backendUrlFromPath(`/api/Proxy/Download`) || "", {
                            method: "POST",
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({url}),
                            signal, // Add abort signal support
                        });

                    if (res.ok) {
                        return res;
                    }

                    // Check if it's a server error (5xx) or network issue that should be retried
                    if (res.status >= 500 || res.status === 408 || res.status === 429) {
                        if (attempt === maxAttempts) {
                            throw new Error(`Server error ${res.status}: ${res.statusText}`);
                        }
                    } else {
                        // Client error (4xx) - don't retry
                        throw new Error(`Client error ${res.status}: ${res.statusText}`);
                    }
                } catch (error) {
                    if (attempt === maxAttempts) {
                        throw error;
                    }

                    // Network errors or timeouts should be retried
                    console.warn(`Attempt ${attempt} failed for ${url}, retrying...`, error);
                }

                // Exponential backoff: 500ms, 1s, 2s, 4s, 8s
                const delay = Math.min(500 * Math.pow(2, attempt - 1), 8000);
                await new Promise(resolve => setTimeout(resolve, delay));
                attempt++;
            }

            throw new Error(`Failed to fetch ${url} after ${maxAttempts} attempts`);
        };

        const res = await fetchWithRetry(5); // Increased from 3 to 5 attempts

        // Handle progress for remote URLs
        if (onProgress && res.body) {
            const contentLength = res.headers.get('Content-Length');
            const total = contentLength ? parseInt(contentLength, 10) : undefined;

            const reader = res.body.getReader();
            const chunks: Uint8Array[] = [];
            let loaded = 0;

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    chunks.push(value);
                    loaded += value.length;
                    onProgress(loaded, total);
                }
            } finally {
                reader.releaseLock();
            }

            const blob = new Blob(chunks as unknown as BlobPart[]);
            return new File([blob], name, {type});
        } else {
            const blob = await res.blob();
            return new File([blob], name, {type});
        }
    }
};

export const generateAssetFile = async (
    imageGeneratorProvider: ImageGeneratorProvider | null,
    assetId: string,
    onError: (message?: string) => void,
) => {
    const assetResponse = await imageGeneratorProvider?.getAssetById(assetId);
    if (!assetResponse.asset) {
        onError("Failed to load asset.");
        return;
    }

    let trimmedFile = null;

    try {
        const file = await urlToFile(assetResponse.asset.url, "image.png", "image/png");
        trimmedFile = await trimImage(file);
    } catch (error) {
        onError("Failed to upload image.");
        console.error(error);
    }

    return trimmedFile;
};

export const generateAssetUrl = async (
    imageGeneratorProvider: ImageGeneratorProvider | null,
    asset: {assetId?: string; assetUrl?: string},
    onError?: (message?: string) => void,
) => {
    let url = asset.assetUrl;
    if (asset.assetId) {
        const assetResponse = await imageGeneratorProvider?.getAssetById(asset.assetId);
        if (!assetResponse.asset) {
            onError?.("Failed to load asset.");
            return;
        }
        url = assetResponse.asset.url;
    }

    if (url) {
        try {
            const file = await urlToFile(url, "image.png", "image/png");
            const trimmedFile = await trimImage(file);
            url = await uploadImage(trimmedFile);
        } catch (error) {
            onError?.("Failed to upload image.");
            console.error(error);
        }
    }

    return url;
};

export const trimImage = async (file: File) => {
    const img = await fileToImage(file);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    if (!ctx) throw new Error("Canvas context not available");

    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const trimmedData = trimImageData(imageData);

    canvas.width = trimmedData.width;
    canvas.height = trimmedData.height;
    ctx.putImageData(trimmedData, 0, 0);

    return canvasToFile(canvas);
};

export const fileToImage = (file: File): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = reader.result as string;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
};

export const canvasToFile = async (canvas: HTMLCanvasElement): Promise<File> => {
    return new Promise(resolve => {
        canvas.toBlob(blob => {
            if (!blob) throw new Error("Failed to create Blob from canvas");
            resolve(new File([blob], "trimmed_image.png", {type: "image/png"}));
        }, "image/png");
    });
};

export const uploadImage = async (image: File) => {
    let url = "";
    const res = await Ajax.post({
        url: backendUrlFromPath(`/api/Upload`),
        data: {file: image},
        needAuthorization: false,
    });
    if (res?.data.Code === 200) {
        url = res.data.Data?.url;
    }
    return url;
};

// Utility functions for object data extraction
export const getObjectData = (
    object?: THREE.Object3D<THREE.Object3DEventMap> | THREE.Object3D<THREE.Object3DEventMap>[] | null,
    isPlayerObject = false,
) => {
    if (object && !(object instanceof Array)) {
        const {scale, rotation, position, userData} = object;
        const animations = (object as any)._obj
            ? (object as any)._obj.animations.map((animation: any) => animation.name)
            : object.animations?.map((animation: any) => animation.name) || [];

        const boundingBox = new THREE.Box3().setFromObject(object);
        const width = boundingBox.max.x - boundingBox.min.x;
        const height = boundingBox.max.y - boundingBox.min.y;
        const depth = boundingBox.max.z - boundingBox.min.z;

        return {
            uuid: object.uuid,
            name: object.name,
            type: object.type,
            scale: [{values: scale}],
            rotation: [{values: rotation}],
            position: [{values: position}],
            behaviors: userData.behaviors,
            animationNames: animations,
            width,
            height,
            depth,
        };
    } else if (isPlayerObject) {
        return {
            name: "Default Player Object",
            height: 2,
            width: 1,
            depth: 1,
        };
    } else {
        return "";
    }
};

export const getSceneData = (scene: THREE.Scene) => {
    const objects = scene?.children.map((object: any) => getObjectData(object));
    return {
        objects,
    };
};

export const createPlane = (width: number, height: number, name: string, material: THREE.Material) => {
    const geometry = new THREE.PlaneGeometry(width, height);
    const plane = new Plane(geometry, material);
    plane.name = name;
    return plane;
};

export const getLookAtPointOnGround = (camera: THREE.Camera) => {
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);

    const cameraPos = camera.position.clone();
    if (direction.y === 0) return null;

    const t = -cameraPos.y / direction.y;
    if (t < 0) return null;

    return new THREE.Vector3(
        cameraPos.x + t * direction.x,
        0, // y = 0
        cameraPos.z + t * direction.z,
    );
};

export const computeIntersectPoint = (
    position: {x: number; y: number},
    viewport: HTMLElement,
    camera: THREE.Camera,
    scene: THREE.Scene,
    sceneHelpers?: THREE.Object3D,
): THREE.Vector3 => {
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const rect = viewport.getBoundingClientRect();

    mouse.x = (position.x - rect.left) / rect.width * 2 - 1;
    mouse.y = -((position.y - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersectPoint = new THREE.Vector3();

    const sceneObjects: THREE.Object3D[] = [];
    scene.children.forEach(child => {
        if (child !== sceneHelpers) {
            sceneObjects.push(child);
        }
    });

    const intersections = raycaster.intersectObjects(sceneObjects, true);
    if (intersections.length > 0) {
        const intersection = intersections[0]!;
        intersectPoint.copy(intersection.point);
    } else {
        const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        raycaster.ray.intersectPlane(groundPlane, intersectPoint);
    }

    return intersectPoint;
};

export const addIndicator = (uuid: string, position: {x: number; y: number}, point?: THREE.Vector3, initialProgress = 0) => {
    const app = global.app as EngineRuntime;
    const group = new THREE.Group();

    const sceneHelpers = app.sceneHelpers;
    const viewport = app.viewport;

    const material = new THREE.MeshStandardMaterial({
        color: 0x0fa0e3,
        opacity: 0.4,
    });
    const geometry = new THREE.BoxGeometry(5, 0.001, 5);
    const meshPlane = new Box(geometry, material);
    group.add(meshPlane);

    const div = document.createElement("div");
    const indicator = new CSS3DSprite(div);
    indicator.position.y = 3;
    indicator.scale.set(0.01, 0.01, 0.01);
    const root = createRoot(div);
    root.render(<Indicator uuid={uuid} initialProgress={initialProgress} />);
    (div as any).__reactRoot = root;
    group.add(indicator);

    group.userData.reactRoot = root;
    group.userData.indicatorDiv = div;
    activeIndicators.add(group);

    let intersectPoint;

    if (point) {
        intersectPoint = point;
    } else {
        intersectPoint = viewport ? app.editor!.computeIntersectPoint(position, sceneHelpers) : new THREE.Vector3();
    }
    sceneHelpers?.add(group);

    group.position.copy(intersectPoint);

    return {indicator: group, intersectPoint};
};

export const removeIndicator = (indicator: THREE.Group) => {
    const app = global.app as EngineRuntime;
    const sceneHelpers = app?.sceneHelpers;

    // Unmount React root
    const root = indicator.userData.reactRoot as Root | undefined;
    if (root) {
        root.unmount();
        indicator.userData.reactRoot = null;
    }

    // Remove DOM element
    const div = indicator.userData.indicatorDiv as HTMLDivElement | undefined;
    if (div?.parentNode) {
        div.parentNode.removeChild(div);
    }

    // Dispose Three.js resources
    indicator.traverse(child => {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
            const material = mesh.material as THREE.Material;
            material.dispose();
        }
    });

    // Remove from scene
    sceneHelpers?.remove(indicator);

    // Remove from tracking set
    activeIndicators.delete(indicator);
};

export const clearAllIndicators = () => {
    const indicators = [...activeIndicators];
    indicators.forEach(removeIndicator);
};
