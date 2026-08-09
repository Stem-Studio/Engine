import { BufferAttribute, BufferGeometry, Mesh, Object3D } from 'three';

import { AtlasConfig, AtlasRegion } from './types';
import {traverseObjectDepthFirst} from '../utils/SceneTraverser';

/**
 * UV transform parameters for mapping to atlas region
 */
export interface UVTransform {
    offsetX: number;
    offsetY: number;
    scaleX: number;
    scaleY: number;
}

/**
 * Calculate UV transform for a region within an atlas
 * UV coordinates are remapped from [0,1] to the region's position in the atlas
 * @param region
 * @param atlasWidth
 * @param atlasHeight
 */
export function calculateUVTransform(
    region: AtlasRegion,
    atlasWidth: number,
    atlasHeight: number,
): UVTransform {
    return {
        offsetX: region.x / atlasWidth,
        // Flip Y axis: UV origin is bottom-left, but atlas origin is top-left
        offsetY: 1 - (region.y + region.height) / atlasHeight,
        scaleX: region.width / atlasWidth,
        scaleY: region.height / atlasHeight,
    };
}

/**
 * Remap UVs of a geometry to use atlas region
 * Modifies the geometry's UV attribute in place
 * @param geometry
 * @param region
 * @param atlasWidth
 * @param atlasHeight
 */
export function remapGeometryUVs(
    geometry: BufferGeometry,
    region: AtlasRegion,
    atlasWidth: number,
    atlasHeight: number,
): void {
    const uvAttr = geometry.getAttribute('uv') as BufferAttribute | undefined;
    if (!uvAttr) {
        console.warn('UVRemapper: Geometry has no UV attribute');
        return;
    }

    const transform = calculateUVTransform(region, atlasWidth, atlasHeight);
    if (uvAttr instanceof BufferAttribute && uvAttr.array instanceof Float32Array && uvAttr.itemSize >= 2) {
        const uvArray = uvAttr.array;
        for (let index = 0; index < uvAttr.count; index++) {
            const offset = index * uvAttr.itemSize;
            uvArray[offset] = uvArray[offset]! * transform.scaleX + transform.offsetX;
            uvArray[offset + 1] = uvArray[offset + 1]! * transform.scaleY + transform.offsetY;
        }
    } else {
        for (let index = 0; index < uvAttr.count; index++) {
            uvAttr.setXY(
                index,
                uvAttr.getX(index) * transform.scaleX + transform.offsetX,
                uvAttr.getY(index) * transform.scaleY + transform.offsetY,
            );
        }
    }

    uvAttr.needsUpdate = true;
}

/**
 * Find the atlas region for a given name using various matching strategies
 * @param name
 * @param regions
 */
export function findRegionByName(
    name: string,
    regions: Record<string, AtlasRegion>,
): AtlasRegion | null {
    // Exact match first
    if (regions[name]) {
        return regions[name];
    }

    // Try case-insensitive match
    const nameLower = name.toLowerCase();
    for (const [key, region] of Object.entries(regions)) {
        if (key.toLowerCase() === nameLower) {
            return region;
        }
    }

    // Try matching without file extension
    const nameWithoutExt = name.replace(/\.[^/.]+$/, '');
    if (regions[nameWithoutExt]) {
        return regions[nameWithoutExt];
    }

    // Case-insensitive without extension
    const nameWithoutExtLower = nameWithoutExt.toLowerCase();
    for (const [key, region] of Object.entries(regions)) {
        const keyWithoutExt = key.replace(/\.[^/.]+$/, '').toLowerCase();
        if (keyWithoutExt === nameWithoutExtLower) {
            return region;
        }
    }

    return null;
}

/**
 * Apply atlas UV remapping to an Object3D tree
 * Uses mesh names or material names to match regions
 * @param object
 * @param atlasConfig
 * @param materialToRegionMap
 */
export function applyAtlasToObject(
    object: Object3D,
    atlasConfig: AtlasConfig,
    materialToRegionMap?: Map<string, string>,
): void {
    const regionEntries = Object.entries(atlasConfig.regions);
    const regionsByLowerName = new Map<string, AtlasRegion>();
    const regionsByLowerStem = new Map<string, AtlasRegion>();
    for (const [name, region] of regionEntries) {
        const lowerName = name.toLowerCase();
        if (!regionsByLowerName.has(lowerName)) regionsByLowerName.set(lowerName, region);
        const lowerStem = name.replace(/\.[^/.]+$/, '').toLowerCase();
        if (!regionsByLowerStem.has(lowerStem)) regionsByLowerStem.set(lowerStem, region);
    }
    const resolveRegion = (name: string): AtlasRegion | null => {
        const stem = name.replace(/\.[^/.]+$/, '');
        return atlasConfig.regions[name] ??
            regionsByLowerName.get(name.toLowerCase()) ??
            atlasConfig.regions[stem] ??
            regionsByLowerStem.get(stem.toLowerCase()) ??
            null;
    };

    type GeometryUsage = {
        users: number;
        tasks: Array<{mesh: Mesh; region: AtlasRegion}>;
    };
    const geometryUsage = new Map<BufferGeometry, GeometryUsage>();

    traverseObjectDepthFirst(object, child => {
        const mesh = child as Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        let usage = geometryUsage.get(mesh.geometry);
        if (!usage) {
            usage = {users: 0, tasks: []};
            geometryUsage.set(mesh.geometry, usage);
        }
        usage.users += 1;

        // Determine region name from mapping or mesh/material name
        let regionName: string | undefined;

        if (materialToRegionMap) {
            const materialName = Array.isArray(mesh.material)
                ? mesh.material[0]?.name
                : mesh.material?.name;
            regionName = materialToRegionMap.get(materialName || '') ||
                         materialToRegionMap.get(mesh.name);
        }

        // Fall back to mesh name or material name
        if (!regionName) {
            const materialName = Array.isArray(mesh.material)
                ? mesh.material[0]?.name
                : mesh.material?.name;
            regionName = mesh.name || materialName;
        }

        if (!regionName) return;

        const region = resolveRegion(regionName);
        if (!region) return;
        usage.tasks.push({mesh, region});
    });

    for (const [geometry, usage] of geometryUsage) {
        if (!geometry.hasAttribute('uv') || usage.tasks.length === 0) continue;

        const meshesByRegion = new Map<AtlasRegion, Mesh[]>();
        for (const {mesh, region} of usage.tasks) {
            const meshes = meshesByRegion.get(region);
            if (meshes) meshes.push(mesh);
            else meshesByRegion.set(region, [mesh]);
        }

        if (usage.tasks.length === usage.users && meshesByRegion.size === 1) {
            const region = meshesByRegion.keys().next().value as AtlasRegion;
            remapGeometryUVs(geometry, region, atlasConfig.width, atlasConfig.height);
            continue;
        }

        for (const [region, meshes] of meshesByRegion) {
            const remappedGeometry = geometry.clone();
            remapGeometryUVs(remappedGeometry, region, atlasConfig.width, atlasConfig.height);
            for (const mesh of meshes) mesh.geometry = remappedGeometry;
        }
    }
}
