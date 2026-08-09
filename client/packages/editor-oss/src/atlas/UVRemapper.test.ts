import { BufferAttribute, BufferGeometry, Group, InterleavedBuffer, InterleavedBufferAttribute, Mesh, MeshBasicMaterial, Object3D } from 'three';
import { describe, it, expect, vi } from 'vitest';

import { AtlasConfig, AtlasRegion } from './types';
import { applyAtlasToObject, calculateUVTransform, remapGeometryUVs, findRegionByName } from './UVRemapper';

describe('UVRemapper', () => {
    describe('calculateUVTransform', () => {
        it('should calculate correct UV transform for top-left region', () => {
            const region: AtlasRegion = { name: 'test', x: 0, y: 0, width: 512, height: 512 };
            const transform = calculateUVTransform(region, 1024, 1024);

            expect(transform.offsetX).toBeCloseTo(0);
            expect(transform.offsetY).toBeCloseTo(0.5); // Flipped Y: 1 - (0 + 512) / 1024 = 0.5
            expect(transform.scaleX).toBeCloseTo(0.5);
            expect(transform.scaleY).toBeCloseTo(0.5);
        });

        it('should calculate correct UV transform for center region', () => {
            const region: AtlasRegion = { name: 'test', x: 256, y: 256, width: 512, height: 512 };
            const transform = calculateUVTransform(region, 1024, 1024);

            expect(transform.offsetX).toBeCloseTo(0.25);
            expect(transform.offsetY).toBeCloseTo(0.25); // Flipped Y: 1 - (256 + 512) / 1024 = 0.25
            expect(transform.scaleX).toBeCloseTo(0.5);
            expect(transform.scaleY).toBeCloseTo(0.5);
        });

        it('should calculate correct UV transform for bottom-right region', () => {
            const region: AtlasRegion = { name: 'test', x: 512, y: 512, width: 512, height: 512 };
            const transform = calculateUVTransform(region, 1024, 1024);

            expect(transform.offsetX).toBeCloseTo(0.5);
            expect(transform.offsetY).toBeCloseTo(0); // Flipped Y: 1 - (512 + 512) / 1024 = 0
            expect(transform.scaleX).toBeCloseTo(0.5);
            expect(transform.scaleY).toBeCloseTo(0.5);
        });

        it('should handle non-square atlases', () => {
            const region: AtlasRegion = { name: 'test', x: 0, y: 0, width: 256, height: 512 };
            const transform = calculateUVTransform(region, 2048, 1024);

            expect(transform.offsetX).toBeCloseTo(0);
            expect(transform.offsetY).toBeCloseTo(0.5);
            expect(transform.scaleX).toBeCloseTo(0.125); // 256 / 2048
            expect(transform.scaleY).toBeCloseTo(0.5);   // 512 / 1024
        });
    });

    describe('remapGeometryUVs', () => {
        it('should remap UVs for a simple quad', () => {
            const geometry = new BufferGeometry();
            // Simple quad UVs: bottom-left, bottom-right, top-right, top-left
            const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
            geometry.setAttribute('uv', new BufferAttribute(uvs, 2));

            const region: AtlasRegion = { name: 'test', x: 0, y: 0, width: 512, height: 512 };
            remapGeometryUVs(geometry, region, 1024, 1024);

            const remapped = geometry.getAttribute('uv').array as Float32Array;

            // UV (0,0) -> (0, 0.5)
            expect(remapped[0]).toBeCloseTo(0);
            expect(remapped[1]).toBeCloseTo(0.5);

            // UV (1,0) -> (0.5, 0.5)
            expect(remapped[2]).toBeCloseTo(0.5);
            expect(remapped[3]).toBeCloseTo(0.5);

            // UV (1,1) -> (0.5, 1.0)
            expect(remapped[4]).toBeCloseTo(0.5);
            expect(remapped[5]).toBeCloseTo(1.0);

            // UV (0,1) -> (0, 1.0)
            expect(remapped[6]).toBeCloseTo(0);
            expect(remapped[7]).toBeCloseTo(1.0);
        });

        it('should handle geometry without UV attribute gracefully', () => {
            const geometry = new BufferGeometry();
            // No UV attribute set

            const region: AtlasRegion = { name: 'test', x: 0, y: 0, width: 512, height: 512 };

            // Should not throw
            expect(() => {
                remapGeometryUVs(geometry, region, 1024, 1024);
            }).not.toThrow();
        });

        it('should remap to offset region correctly', () => {
            const geometry = new BufferGeometry();
            const uvs = new Float32Array([0, 0, 1, 1]);
            geometry.setAttribute('uv', new BufferAttribute(uvs, 2));

            // Region at (512, 512) in a 1024x1024 atlas
            const region: AtlasRegion = { name: 'test', x: 512, y: 512, width: 512, height: 512 };
            remapGeometryUVs(geometry, region, 1024, 1024);

            const remapped = geometry.getAttribute('uv').array as Float32Array;

            // UV (0,0) should map to (0.5, 0) - bottom-right quadrant, bottom-left corner
            expect(remapped[0]).toBeCloseTo(0.5);
            expect(remapped[1]).toBeCloseTo(0);

            // UV (1,1) should map to (1.0, 0.5) - bottom-right quadrant, top-right corner
            expect(remapped[2]).toBeCloseTo(1.0);
            expect(remapped[3]).toBeCloseTo(0.5);
        });

        it('supports interleaved UV attributes', () => {
            const geometry = new BufferGeometry();
            const data = new InterleavedBuffer(new Float32Array([9, 0, 0, 9, 1, 1]), 3);
            geometry.setAttribute('uv', new InterleavedBufferAttribute(data, 2, 1));

            remapGeometryUVs(
                geometry,
                {name: 'test', x: 512, y: 512, width: 512, height: 512},
                1024,
                1024,
            );

            const uv = geometry.getAttribute('uv');
            expect(uv.getX(0)).toBeCloseTo(0.5);
            expect(uv.getY(0)).toBeCloseTo(0);
            expect(uv.getX(1)).toBeCloseTo(1);
            expect(uv.getY(1)).toBeCloseTo(0.5);
        });
    });

    describe('findRegionByName', () => {
        const regions: Record<string, AtlasRegion> = {
            'wall_texture': { name: 'wall_texture', x: 0, y: 0, width: 512, height: 512 },
            'floor.png': { name: 'floor.png', x: 512, y: 0, width: 512, height: 512 },
            'CeilingMaterial': { name: 'CeilingMaterial', x: 0, y: 512, width: 512, height: 512 },
        };

        it('should find region by exact name', () => {
            const region = findRegionByName('wall_texture', regions);
            expect(region).not.toBeNull();
            expect(region?.name).toBe('wall_texture');
        });

        it('should find region case-insensitively', () => {
            const region = findRegionByName('WALL_TEXTURE', regions);
            expect(region).not.toBeNull();
            expect(region?.name).toBe('wall_texture');
        });

        it('should find region by name with extension', () => {
            const region = findRegionByName('floor.png', regions);
            expect(region).not.toBeNull();
            expect(region?.name).toBe('floor.png');
        });

        it('should find region when searching without extension', () => {
            const region = findRegionByName('floor', regions);
            expect(region).not.toBeNull();
            expect(region?.name).toBe('floor.png');
        });

        it('should return null for non-existent region', () => {
            const region = findRegionByName('nonexistent', regions);
            expect(region).toBeNull();
        });

        it('should handle mixed case matching', () => {
            const region = findRegionByName('ceilingmaterial', regions);
            expect(region).not.toBeNull();
            expect(region?.name).toBe('CeilingMaterial');
        });
    });

    describe('applyAtlasToObject', () => {
        const config: AtlasConfig = {
            image: 'atlas.png',
            width: 100,
            height: 100,
            regions: {
                left: {name: 'left', x: 0, y: 0, width: 50, height: 100},
                right: {name: 'right', x: 50, y: 0, width: 50, height: 100},
            },
        };
        const geometry = () => {
            const value = new BufferGeometry();
            value.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 1]), 2));
            return value;
        };
        const mesh = (name: string, value: BufferGeometry) => {
            const result = new Mesh(value, new MeshBasicMaterial());
            result.name = name;
            return result;
        };

        it('remaps shared geometry only once when users resolve to the same region', () => {
            const shared = geometry();
            const first = mesh('left', shared);
            const second = mesh('left', shared);
            const root = new Group();
            root.add(first, second);

            applyAtlasToObject(root, config);

            expect(first.geometry).toBe(shared);
            expect(second.geometry).toBe(shared);
            expect(Array.from(shared.getAttribute('uv').array)).toEqual([0, 0, 0.5, 1]);
        });

        it('clones shared geometry for different regions without cross-remapping UVs', () => {
            const shared = geometry();
            const left = mesh('left', shared);
            const right = mesh('right', shared);
            const root = new Group();
            root.add(left, right);

            applyAtlasToObject(root, config);

            expect(left.geometry).not.toBe(right.geometry);
            expect(Array.from(left.geometry.getAttribute('uv').array)).toEqual([0, 0, 0.5, 1]);
            expect(Array.from(right.geometry.getAttribute('uv').array)).toEqual([0.5, 0, 1, 1]);
            expect(Array.from(shared.getAttribute('uv').array)).toEqual([0, 0, 1, 1]);
        });

        it('preserves original UVs for unmatched users of shared geometry', () => {
            const shared = geometry();
            const matched = mesh('left', shared);
            const unmatched = mesh('unmatched', shared);
            const root = new Group();
            root.add(matched, unmatched);

            applyAtlasToObject(root, config);

            expect(matched.geometry).not.toBe(shared);
            expect(unmatched.geometry).toBe(shared);
            expect(Array.from(shared.getAttribute('uv').array)).toEqual([0, 0, 1, 1]);
        });

        it('handles deeply nested models without recursive Three traversal', () => {
            const root = new Group();
            let parent: Object3D = root;
            for (let index = 0; index < 12_000; index++) {
                const child = new Object3D();
                parent.add(child);
                parent = child;
            }
            parent.add(mesh('left', geometry()));
            const traverseSpy = vi.spyOn(Object3D.prototype, 'traverse').mockImplementation(() => {
                throw new Error('recursive traversal must not be used');
            });

            try {
                applyAtlasToObject(root, config);
                expect(traverseSpy).not.toHaveBeenCalled();
            } finally {
                traverseSpy.mockRestore();
            }
        });
    });
});
