import { Box3, Object3D } from 'three';

const GAUSSIAN_SPLAT_FLAG = '__isGaussianSplat';
const GAUSSIAN_SPLAT_SPZ_FORMAT = 'spz';
export const GAUSSIAN_SPLAT_PLY_METADATA_KEY = 'gaussianSplatPly';
const MAX_PLY_HEADER_BYTES = 64 * 1024;
const REQUIRED_GAUSSIAN_PLY_PROPERTIES = [
    'scale_0',
    'scale_1',
    'scale_2',
    'rot_0',
    'rot_1',
    'rot_2',
    'rot_3',
    'opacity',
];
const GAUSSIAN_PLY_COLOR_PROPERTIES = ['f_dc_0', 'packed_color'];

type BoundingBoxCapableObject = Object3D & {
    getBoundingBox?: (centersOnly?: boolean) => Box3;
};

export const markGaussianSplatObject = (object: Object3D, format?: string) => {
    object.userData[GAUSSIAN_SPLAT_FLAG] = true;
    object.userData.gaussianSplatFormat = format ?? true;
};

export const isGaussianSplatObject = (object: Object3D | null | undefined): boolean => {
    if (!object) {
        return false;
    }

    const stack: Object3D[] = [object];
    while (stack.length > 0) {
        const child = stack.pop()!;
        const candidate = child as BoundingBoxCapableObject;
        if (
            child.userData?.[GAUSSIAN_SPLAT_FLAG] === true ||
            child.userData?.gaussianSplatFormat ||
            child.type === 'SplatMesh' ||
            typeof candidate.getBoundingBox === 'function'
        ) {
            return true;
        }

        for (let i = child.children.length - 1; i >= 0; i--) {
            const descendant = child.children[i];
            if (descendant) {
                stack.push(descendant);
            }
        }
    }

    return false;
};

export const isGaussianSplatFormat = (format: string | null | undefined): boolean => {
    return format?.toLowerCase() === GAUSSIAN_SPLAT_SPZ_FORMAT;
};

export const isGaussianSplatAsset = (
    format: string | null | undefined,
    object?: Object3D | null,
): boolean => {
    return isGaussianSplatFormat(format) || isGaussianSplatObject(object);
};

export const hasGaussianSplatPlyMetadata = (metadata: Record<string, unknown> | null | undefined): boolean => {
    return metadata?.[GAUSSIAN_SPLAT_PLY_METADATA_KEY] === true;
};

export const getObjectBoundingBox = (object: Object3D, centersOnly = true): Box3 => {
    const candidate = object as BoundingBoxCapableObject;
    if (typeof candidate.getBoundingBox === 'function') {
        const box = candidate.getBoundingBox(centersOnly);
        if (box && !box.isEmpty()) {
            return box.clone();
        }
    }

    return new Box3().setFromObject(object);
};

export const isGaussianSplatPlyHeader = (headerText: string): boolean => {
    const header = headerText.split('end_header')[0]?.toLowerCase() ?? headerText.toLowerCase();
    const hasRequiredProperties = REQUIRED_GAUSSIAN_PLY_PROPERTIES.every((propertyName) =>
        header.includes(`property float ${propertyName}`) || header.includes(`property double ${propertyName}`),
    );
    const hasColorEncoding = GAUSSIAN_PLY_COLOR_PROPERTIES.some((propertyName) =>
        header.includes(propertyName),
    );

    return hasRequiredProperties && hasColorEncoding;
};

export const readPlyHeaderFromBlob = async (blob: Blob): Promise<string> => {
    const slice = blob.slice(0, MAX_PLY_HEADER_BYTES);
    const buffer = await slice.arrayBuffer();
    return new TextDecoder().decode(buffer);
};

export const isGaussianSplatPlyBlob = async (blob: Blob): Promise<boolean> => {
    const header = await readPlyHeaderFromBlob(blob);
    return isGaussianSplatPlyHeader(header);
};

export const isGaussianSplatPlyUrl = async (url: string): Promise<boolean> => {
    const readHeader = async (useRange: boolean): Promise<string> => {
        const response = await fetch(url, {
            ...(useRange
                ? {
                    headers: {
                        Range: `bytes=0-${MAX_PLY_HEADER_BYTES - 1}`,
                    },
                }
                : {}),
        });

        if (!response.ok) {
            throw new Error(`Failed to inspect PLY header: ${response.status} ${response.statusText}`);
        }

        return new TextDecoder().decode(await response.arrayBuffer());
    };

    try {
        return isGaussianSplatPlyHeader(await readHeader(true));
    } catch (rangeError) {
        try {
            return isGaussianSplatPlyHeader(await readHeader(false));
        } catch {
            throw rangeError;
        }
    }
};
