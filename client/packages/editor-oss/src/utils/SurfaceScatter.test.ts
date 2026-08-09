import * as THREE from "three";
import {describe, it, expect, beforeEach} from "vitest";

import {scatterOnSurface} from "./SurfaceScatter";

describe("scatterOnSurface", () => {
    let source: THREE.Mesh;
    let target: THREE.Mesh;

    beforeEach(() => {
        // 1-unit cube as the thing being scattered
        source = new THREE.Mesh(
            new THREE.BoxGeometry(0.1, 0.1, 0.1),
            new THREE.MeshStandardMaterial(),
        );
        source.name = "Prop";
        // 10x10 plane as the target surface
        target = new THREE.Mesh(
            new THREE.PlaneGeometry(10, 10),
            new THREE.MeshStandardMaterial(),
        );
        target.name = "Ground";
    });

    it("produces an InstancedMesh with the requested count", () => {
        const result = scatterOnSurface(source, target, {count: 25, seed: 1});
        expect(result).toBeInstanceOf(THREE.InstancedMesh);
        expect(result.count).toBe(25);
    });

    it("stores scatterParams in userData for reproducibility + serialization", () => {
        const result = scatterOnSurface(source, target, {
            count: 10,
            seed: 42,
            scale: 0.5,
            scaleJitter: 0.1,
            rotationJitter: 0.2,
            alignToNormal: true,
        });
        expect(result.userData.type).toBe("SurfaceScatter");
        expect(result.userData.scatterParams.count).toBe(10);
        expect(result.userData.scatterParams.seed).toBe(42);
        expect(result.userData.scatterParams.scale).toBe(0.5);
        expect(result.userData.scatterParams.sourceUuid).toBe(source.uuid);
        expect(result.userData.scatterParams.targetUuid).toBe(target.uuid);
    });

    it("is reproducible with the same seed", () => {
        const a = scatterOnSurface(source, target, {count: 20, seed: 7, scaleJitter: 0.5});
        const b = scatterOnSurface(source, target, {count: 20, seed: 7, scaleJitter: 0.5});
        // Sample the first instance matrix — same seed → same transform.
        const matA = new THREE.Matrix4();
        const matB = new THREE.Matrix4();
        a.getMatrixAt(0, matA);
        b.getMatrixAt(0, matB);
        for (let i = 0; i < 16; i++) {
            expect(matA.elements[i]!).toBeCloseTo(matB.elements[i]!, 5);
        }
    });

    it("is reproducible with rotation jitter enabled", () => {
        const a = scatterOnSurface(source, target, {
            count: 20,
            seed: 11,
            rotationJitter: Math.PI,
            scaleJitter: 0.25,
        });
        const b = scatterOnSurface(source, target, {
            count: 20,
            seed: 11,
            rotationJitter: Math.PI,
            scaleJitter: 0.25,
        });
        const matA = new THREE.Matrix4();
        const matB = new THREE.Matrix4();
        a.getMatrixAt(8, matA);
        b.getMatrixAt(8, matB);

        for (let i = 0; i < 16; i++) {
            expect(matA.elements[i]!).toBeCloseTo(matB.elements[i]!, 5);
        }
    });

    it("differs across different seeds", () => {
        const a = scatterOnSurface(source, target, {count: 20, seed: 1});
        const b = scatterOnSurface(source, target, {count: 20, seed: 2});
        const matA = new THREE.Matrix4();
        const matB = new THREE.Matrix4();
        a.getMatrixAt(5, matA);
        b.getMatrixAt(5, matB);
        // Extract positions — different seeds should give different samples.
        const posA = new THREE.Vector3().setFromMatrixPosition(matA);
        const posB = new THREE.Vector3().setFromMatrixPosition(matB);
        expect(posA.distanceTo(posB)).toBeGreaterThan(1e-3);
    });

    it("places instances on the target surface plane (y≈0 for XY-plane)", () => {
        // Default PlaneGeometry is in the XY plane. All sampled positions
        // should have Z approximately 0 in local space, which after the
        // target's identity matrixWorld stays 0 in world space.
        const result = scatterOnSurface(source, target, {count: 30, seed: 3, alignToNormal: false});
        const mat = new THREE.Matrix4();
        const pos = new THREE.Vector3();
        for (let i = 0; i < result.count; i++) {
            result.getMatrixAt(i, mat);
            pos.setFromMatrixPosition(mat);
            expect(pos.z).toBeCloseTo(0, 3);
            // Within plane bounds
            expect(Math.abs(pos.x)).toBeLessThanOrEqual(5.01);
            expect(Math.abs(pos.y)).toBeLessThanOrEqual(5.01);
        }
    });

    it("inherits source geometry + material", () => {
        const result = scatterOnSurface(source, target, {count: 5, seed: 10});
        expect(result.geometry).toBe(source.geometry);
        expect(result.material).toBe(source.material);
    });

    it("throws on missing source geometry", () => {
        const bad = new THREE.Mesh();
        // Clear out geometry to simulate a malformed mesh.
        bad.geometry = new THREE.BufferGeometry();
        expect(() => scatterOnSurface(bad, target, {count: 10})).toThrow();
    });

    it("normalizes count to at least 1", () => {
        const result = scatterOnSurface(source, target, {count: 0});
        expect(result.count).toBe(1);
    });

    it("respects target world transform when sampling", () => {
        // Move the target far away — scattered instances should land near it.
        target.position.set(100, 50, 20);
        target.updateMatrixWorld(true);
        const result = scatterOnSurface(source, target, {count: 10, seed: 1, alignToNormal: false});
        const mat = new THREE.Matrix4();
        const pos = new THREE.Vector3();
        result.getMatrixAt(0, mat);
        pos.setFromMatrixPosition(mat);
        // Within the plane extent around the translated origin.
        expect(pos.x).toBeGreaterThan(100 - 5.01);
        expect(pos.x).toBeLessThan(100 + 5.01);
        expect(pos.y).toBeGreaterThan(50 - 5.01);
        expect(pos.y).toBeLessThan(50 + 5.01);
    });
});
