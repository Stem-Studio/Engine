import {describe, expect, it} from "vitest";
import {
    DataTexture,
    DynamicDrawUsage,
    InstancedBufferAttribute,
    MeshBasicMaterial,
    RGBAFormat,
    UnsignedByteType,
} from "three";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import type {Font} from "@ni2khanna/uikit/dist/text/font.js";

function createMat4Attribute(instanceCount = 2) {
    const attribute = new InstancedBufferAttribute(new Float32Array(instanceCount * 16), 16, false);
    attribute.setUsage(DynamicDrawUsage);
    return attribute;
}

function createRootStub(): any {
    return {
        component: {parent: null},
        onUpdateMatrixWorldSet: new Set<() => void>(),
    };
}

describe("@ni2khanna/uikit node material patch", () => {
    it("builds panel node materials from original instanced mat4 data and clipping buffers", async () => {
        const source = readFileSync(
            resolve(process.cwd(), "node_modules/@ni2khanna/uikit/dist/panel/panel-node-material.js"),
            "utf8",
        );
        expect(source).toContain("new InstancedInterleavedBuffer(sourceAttr.array, 16, 1)");
        expect(source).toContain("instancedDynamicBufferAttribute(interleaved, 'vec4', 16, offset).setInstanced(true)");
        expect(source).toContain("interleaved.needsUpdate = true");
        expect(source).toContain("max(fwidth(distanceToPlane).mul(0.5), float(1e-6))");
        expect(source).not.toContain("attribute('aData0'");

        const {createPanelNodeMaterial, initNodeMaterials} = await import(
            "@ni2khanna/uikit/dist/panel/panel-node-material.js"
        );
        const instanceData = createMat4Attribute();
        const instanceClipping = createMat4Attribute();

        await initNodeMaterials();
        const material = createPanelNodeMaterial(MeshBasicMaterial, {
            type: "instanced",
            instanceData,
            instanceClipping,
        });

        expect(material.colorNode).toBeTruthy();
        expect(material.opacityNode).toBeTruthy();
        expect(material.userData.uikitSyncInstancedBuffers).toBeTypeOf("function");
        expect(() => material.userData.uikitSyncInstancedBuffers()).not.toThrow();
        instanceData.needsUpdate = true;
        instanceClipping.needsUpdate = true;
        expect(() => material.userData.uikitSyncInstancedBuffers()).not.toThrow();
    });

    it("keeps panel and glyph geometry on original mat4 attributes without split vec4 attributes", async () => {
        const {InstancedPanelMesh} = await import("@ni2khanna/uikit/dist/panel/instanced-panel-mesh.js");
        const {InstancedGlyphMesh} = await import("@ni2khanna/uikit/dist/text/render/instanced-glyph-mesh.js");
        const root = createRootStub();
        const instanceMatrix = createMat4Attribute();
        const instanceData = createMat4Attribute();
        const instanceClipping = createMat4Attribute();

        const panelMesh = new InstancedPanelMesh(root, instanceMatrix, instanceData, instanceClipping);
        expect(panelMesh.geometry.getAttribute("aData")).toBe(instanceData);
        expect(panelMesh.geometry.getAttribute("aClipping")).toBe(instanceClipping);
        expect(panelMesh.geometry.getAttribute("aData0")).toBeUndefined();
        expect(panelMesh.geometry.getAttribute("aClipping0")).toBeUndefined();

        const glyphMesh = new InstancedGlyphMesh(
            root,
            instanceMatrix,
            new InstancedBufferAttribute(new Float32Array(8), 4, false),
            new InstancedBufferAttribute(new Float32Array(8), 4, false),
            instanceClipping,
            new MeshBasicMaterial(),
        );
        expect(glyphMesh.geometry.getAttribute("instanceClipping")).toBe(instanceClipping);
        expect(glyphMesh.geometry.getAttribute("instanceClipping0")).toBeUndefined();
    });

    it("builds glyph node materials from the original instanced mat4 clipping buffer", async () => {
        const source = readFileSync(
            resolve(process.cwd(), "node_modules/@ni2khanna/uikit/dist/text/render/instanced-glyph-node-material.js"),
            "utf8",
        );
        expect(source).toContain("new InstancedInterleavedBuffer(sourceAttr.array, 16, 1)");
        expect(source).toContain("instancedDynamicBufferAttribute(interleaved, 'vec4', 16, offset).setInstanced(true)");
        expect(source).toContain("interleaved.needsUpdate = true");
        expect(source).toContain("max(fwidth(distanceToPlane).div(2.0), float(1e-6))");
        expect(source).not.toContain("attribute('instanceClipping0'");

        const {createGlyphNodeMaterial, initGlyphNodeMaterials} = await import(
            "@ni2khanna/uikit/dist/text/render/instanced-glyph-node-material.js"
        );
        const instanceClipping = createMat4Attribute();
        const page = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat, UnsignedByteType);
        page.needsUpdate = true;

        await initGlyphNodeMaterials();
        const font = {
            page,
            pageWidth: 1,
            pageHeight: 1,
            distanceRange: 4,
            renderMode: "bitmap-alpha",
        } as unknown as Font;
        const material = createGlyphNodeMaterial(font, instanceClipping);

        expect(material.colorNode).toBeTruthy();
        expect(material.opacityNode).toBeTruthy();
        expect(material.userData.uikitSyncInstancedBuffers).toBeTypeOf("function");
        expect(() => material.userData.uikitSyncInstancedBuffers()).not.toThrow();
        instanceClipping.needsUpdate = true;
        expect(() => material.userData.uikitSyncInstancedBuffers()).not.toThrow();
    });

    it("keeps CSS-style position aliases for UIKit fullscreen placement", () => {
        const aliasSource = readFileSync(
            resolve(process.cwd(), "node_modules/@ni2khanna/uikit/dist/properties/alias.js"),
            "utf8",
        );
        const aliasTypes = readFileSync(
            resolve(process.cwd(), "node_modules/@ni2khanna/uikit/dist/properties/alias.d.ts"),
            "utf8",
        );

        expect(aliasSource).toContain("top: ['positionTop']");
        expect(aliasSource).toContain("right: ['positionRight']");
        expect(aliasSource).toContain("bottom: ['positionBottom']");
        expect(aliasSource).toContain("left: ['positionLeft']");
        expect(aliasTypes).toContain('readonly top: readonly ["positionTop"]');
        expect(aliasTypes).toContain('readonly right: readonly ["positionRight"]');
        expect(aliasTypes).toContain('readonly bottom: readonly ["positionBottom"]');
        expect(aliasTypes).toContain('readonly left: readonly ["positionLeft"]');
    });
});
