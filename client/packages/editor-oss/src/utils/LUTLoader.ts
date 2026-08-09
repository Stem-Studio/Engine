import * as THREE from "three";
import {LUT3dlLoader} from "three/addons/loaders/LUT3dlLoader.js";
import {LUTCubeLoader} from "three/addons/loaders/LUTCubeLoader.js";

/**
 * The resolved LUT payload consumed by the TSL-based `lut3D` post node.
 * `size` is the LUT side length (e.g. 32 for a 32×32×32 cube) — used by
 * the node to compute UV sample offsets.
 */
export interface LoadedLUT {
    /** 3D texture sample source (`Data3DTexture` in three.js terms). */
    texture: THREE.Data3DTexture;
    /** Side length of the LUT cube. */
    size: number;
    /** Source URL the LUT was loaded from, for bookkeeping/debug. */
    source: string;
}

type LUTLoaderResult = {
    size: number;
    texture: THREE.Data3DTexture;
    texture3D?: THREE.Data3DTexture;
};

function pickTexture(result: LUTLoaderResult): THREE.Data3DTexture {
    // Three.js versions differ: some expose `.texture`, others `.texture3D`.
    // Prefer the newer `.texture3D` when present.
    return result.texture3D ?? result.texture;
}

/**
 * Load a LUT from a URL. Supports `.cube` (industry standard) and `.3dl`
 * (Autodesk/Assimilate). Format is detected by file extension; callers
 * can override via the `format` option.
 *
 * Returns the loaded 3D texture ready to be wrapped in a TSL
 * `texture(...)` node and passed to `lut3D(inputNode, textureNode, size, intensity)`.
 *
 * Typical call site is `EffectRenderer`, but any module that wants to
 * apply programmatic color grading (e.g. for a screenshot export with a
 * specific look) can use it directly.
 */
export async function loadLUT(
    url: string,
    options: {format?: "cube" | "3dl"} = {},
): Promise<LoadedLUT> {
    const format =
        options.format ??
        (url.toLowerCase().endsWith(".3dl") ? "3dl" : "cube");

    const loader = format === "3dl" ? new LUT3dlLoader() : new LUTCubeLoader();

    return new Promise<LoadedLUT>((resolve, reject) => {
        loader.load(
            url,
            (result: unknown) => {
                const typed = result as LUTLoaderResult;
                const texture = pickTexture(typed);
                if (!texture) {
                    reject(new Error(`LUTLoader: no 3D texture produced for ${url}`));
                    return;
                }
                resolve({
                    texture,
                    size: typed.size,
                    source: url,
                });
            },
            undefined,
            (err: unknown) => {
                reject(err instanceof Error ? err : new Error(String(err)));
            },
        );
    });
}

/**
 * Build an identity-pass-through LUT — a 1-unit cube texture that maps
 * each color to itself. Useful as a default when `settings.lut.enabled`
 * is on but no `source` is set yet (avoids a visual flash on the UI
 * path where the user toggles LUT before picking a file).
 *
 * Size 2 is the smallest valid LUT: 8 RGB samples at the corners of the
 * unit cube, linearly interpolated.
 */
export function identityLUT(): LoadedLUT {
    const size = 2;
    const data = new Uint8Array(size * size * size * 4);
    for (let z = 0; z < size; z++) {
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const idx = 4 * (x + size * (y + size * z));
                data[idx + 0] = Math.round((x / (size - 1)) * 255);
                data[idx + 1] = Math.round((y / (size - 1)) * 255);
                data[idx + 2] = Math.round((z / (size - 1)) * 255);
                data[idx + 3] = 255;
            }
        }
    }
    const texture = new THREE.Data3DTexture(data, size, size, size);
    texture.format = THREE.RGBAFormat;
    texture.type = THREE.UnsignedByteType;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;

    return {texture, size, source: "<identity>"};
}
