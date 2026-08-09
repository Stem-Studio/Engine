import {Object3D} from "three";
import {describe, expect, it} from "vitest";

import LambdaScriptInjector from "./LambdaScriptInjector";

describe("LambdaScriptInjector runtime THREE endowment", () => {
    it("exposes core Three classes and node materials without importing three/webgpu as the namespace", () => {
        const LambdaClass = new LambdaScriptInjector().parse(
            "runtime-three-test",
            `
                this.createdObject = new THREE.Object3D();
                this.nodeMaterial = new THREE.MeshPhysicalNodeMaterial();
                this.legacyPhysicalNodeMaterial = new THREE.MeshPhysicalNodeMaterial({ reflectivity: 0.5 });
                this.standardNodeMaterial = new THREE.MeshStandardNodeMaterial();
                this.basicNodeMaterial = new THREE.MeshBasicNodeMaterial();
                this.pointsNodeMaterial = new THREE.PointsNodeMaterial();
                this.lineNodeMaterial = new THREE.LineBasicNodeMaterial();
                this.spriteNodeMaterial = new THREE.SpriteNodeMaterial();
                this.uniformFromNamespace = THREE.TSL.uniform(1.25);
                this.uniformFromAlias = TSL.uniform(2.5);
            `,
        );

        const lambda = new LambdaClass("test.lambda", {}) as any;

        expect(lambda.createdObject).toBeInstanceOf(Object3D);
        expect(lambda.nodeMaterial.type).toBe("MeshPhysicalNodeMaterial");
        expect(lambda.legacyPhysicalNodeMaterial.type).toBe("MeshPhysicalNodeMaterial");
        expect(lambda.standardNodeMaterial.type).toBe("MeshStandardNodeMaterial");
        expect(lambda.basicNodeMaterial.type).toBe("MeshBasicNodeMaterial");
        expect(lambda.pointsNodeMaterial.type).toBe("PointsNodeMaterial");
        expect(lambda.lineNodeMaterial.type).toBe("LineBasicNodeMaterial");
        expect(lambda.spriteNodeMaterial.type).toBe("SpriteNodeMaterial");
        expect(lambda.uniformFromNamespace.value).toBe(1.25);
        expect(lambda.uniformFromAlias.value).toBe(2.5);
    });

    it("revokes scoped browser resources when a lambda omits dispose", () => {
        const diagnostics = (globalThis as typeof globalThis & {
            __STEM_SCRIPT_RESOURCE_DIAGNOSTICS__?: () => {scopes: number; intervals: number};
        }).__STEM_SCRIPT_RESOURCE_DIAGNOSTICS__;
        expect(diagnostics).toBeTypeOf("function");
        const before = diagnostics!();

        const LambdaClass = new LambdaScriptInjector().parse(
            "runtime-resource-scope-fallback-dispose-test",
            `
                setInterval(() => {}, 60_000);
            `,
        );
        const lambda = new LambdaClass("test.lambda", {}) as any;

        expect(diagnostics!().intervals).toBeGreaterThan(before.intervals);
        lambda.dispose();
        expect(diagnostics!()).toEqual(before);
    });
});
