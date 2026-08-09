import {BoxGeometry, DirectionalLight, Mesh, MeshBasicMaterial, Scene} from "three";

import {
    applyAutomaticFallbackRuntimeShadowBudget,
    applyRuntimeShadowBudget,
    restoreRuntimeShadowBudget,
} from "./runtimeShadowBudget";

function runtimeMesh(name: string, triangles = 12): Mesh {
    const geometry = new BoxGeometry(1, 1, 1);
    if (triangles !== 12) {
        geometry.index = {count: triangles * 3} as never;
    }
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    mesh.name = name;
    mesh.castShadow = true;
    return mesh;
}

describe("runtimeShadowBudget", () => {
    it("only budgets runtime descendants and restores authored state", () => {
        const scene = new Scene();
        const authored = runtimeMesh("authored");
        scene.add(authored);
        const runtimeRoot = new Mesh();
        runtimeRoot.userData.isRuntimeOnly = true;
        const runtimeA = runtimeMesh("runtime-a");
        const runtimeB = runtimeMesh("runtime-b");
        runtimeB.userData.runtimeShadowPriority = 10;
        runtimeRoot.add(runtimeA, runtimeB);
        scene.add(runtimeRoot);
        scene.userData.rendering = {runtimeShadowBudget: {enabled: true, maxMeshes: 1}};

        const stats = applyRuntimeShadowBudget(scene);
        expect(stats.meshesConsidered).toBe(2);
        expect(stats.meshesDisabled).toBe(1);
        expect(authored.castShadow).toBe(true);
        expect(runtimeB.castShadow).toBe(true);
        expect(runtimeA.castShadow).toBe(false);

        restoreRuntimeShadowBudget(scene);
        expect(runtimeA.castShadow).toBe(true);
        expect(runtimeB.castShadow).toBe(true);
    });

    it("preserves player descendants even when they are runtime-only", () => {
        const scene = new Scene();
        const player = new Mesh();
        player.name = "Player";
        player.userData.isRuntimeOnly = true;
        const body = runtimeMesh("body");
        player.add(body);
        const decorationRoot = new Mesh();
        decorationRoot.userData.isRuntimeOnly = true;
        const decoration = runtimeMesh("decoration");
        decoration.userData.runtimeShadowPriority = 10;
        decorationRoot.add(decoration);
        scene.add(player, decorationRoot);
        scene.userData.rendering = {runtimeShadowBudget: {enabled: true, maxMeshes: 1}};

        const stats = applyRuntimeShadowBudget(scene);
        expect(stats.meshesPreserved).toBe(1);
        expect(body.castShadow).toBe(true);
    });

    it("requires explicit scene opt-in", () => {
        const scene = new Scene();
        const root = new Mesh();
        root.userData.isRuntimeOnly = true;
        const child = runtimeMesh("runtime");
        root.add(child);
        scene.add(root);

        const stats = applyRuntimeShadowBudget(scene, {maxMeshes: 1});
        expect(stats.enabled).toBe(false);
        expect(child.castShadow).toBe(true);
    });

    it("does not resurrect disabled casters during stabilization", () => {
        const scene = new Scene();
        const root = new Mesh();
        root.userData.isRuntimeOnly = true;
        const first = runtimeMesh("first");
        const second = runtimeMesh("second");
        root.add(first, second);
        scene.add(root);
        scene.userData.rendering = {runtimeShadowBudget: {enabled: true, maxMeshes: 1}};

        applyRuntimeShadowBudget(scene);
        expect([first.castShadow, second.castShadow].filter(Boolean)).toHaveLength(1);
        scene.userData.rendering.runtimeShadowBudget.maxMeshes = 2;
        const stats = applyRuntimeShadowBudget(scene);
        expect(stats.meshesPreserved).toBe(1);
        expect([first.castShadow, second.castShadow].filter(Boolean)).toHaveLength(1);

        const rebuilt = applyRuntimeShadowBudget(scene, {reconsiderHidden: true});
        expect(rebuilt.meshesPreserved).toBe(2);
        expect(first.castShadow).toBe(true);
        expect(second.castShadow).toBe(true);
    });

    it("automatically caps runtime shadows only on a fallback-dominated CSM scene", () => {
        const scene = new Scene();
        const authored = runtimeMesh("authored", 500_000);
        scene.add(authored);

        const runtimeRoot = new Mesh();
        runtimeRoot.userData.isRuntimeOnly = true;
        const runtime = runtimeMesh("runtime", 600_000);
        runtimeRoot.add(runtime);
        scene.add(runtimeRoot);

        const light = new DirectionalLight();
        light.castShadow = true;
        light.shadow.shadowNode = {cascades: 3} as never;
        scene.add(light);

        const stats = applyAutomaticFallbackRuntimeShadowBudget(scene, {isWebGPU: false});
        expect(stats.automatic).toBe(true);
        expect(stats.enabled).toBe(true);
        expect(stats.cascadeCount).toBe(3);
        expect(stats.estimatedShadowTriangles).toBe(3_300_000);
        expect(stats.runtimeShare).toBeCloseTo(600_000 / 1_100_000);
        expect(stats.meshesDisabled).toBe(1);
        expect(runtime.castShadow).toBe(false);
        expect(authored.castShadow).toBe(true);

        restoreRuntimeShadowBudget(scene);
        expect(runtime.castShadow).toBe(true);
    });

    it("skips the automatic policy on WebGPU and explicit fallback opt-out", () => {
        const scene = new Scene();
        const runtimeRoot = new Mesh();
        runtimeRoot.userData.isRuntimeOnly = true;
        const runtime = runtimeMesh("runtime", 600_000);
        runtimeRoot.add(runtime);
        scene.add(runtimeRoot);
        const light = new DirectionalLight();
        light.castShadow = true;
        light.shadow.shadowNode = {cascades: 3} as never;
        scene.add(light);

        const webgpuStats = applyAutomaticFallbackRuntimeShadowBudget(scene, {isWebGPU: true});
        expect(webgpuStats.automatic).toBe(false);
        expect(runtime.castShadow).toBe(true);

        scene.userData.rendering = {runtimeShadowBudget: {enabled: false}};
        const optedOutStats = applyAutomaticFallbackRuntimeShadowBudget(scene, {isWebGPU: false});
        expect(optedOutStats.automatic).toBe(false);
        expect(runtime.castShadow).toBe(true);
    });

    it("does not let a partial non-enabled config override the automatic cap", () => {
        const scene = new Scene();
        const runtimeRoot = new Mesh();
        runtimeRoot.userData.isRuntimeOnly = true;
        const runtime = runtimeMesh("runtime", 600_000);
        runtimeRoot.add(runtime);
        scene.add(runtimeRoot);
        const light = new DirectionalLight();
        light.castShadow = true;
        light.shadow.shadowNode = {cascades: 3} as never;
        scene.add(light);
        scene.userData.rendering = {runtimeShadowBudget: {maxTriangles: 1_000_000}};

        const stats = applyAutomaticFallbackRuntimeShadowBudget(scene, {isWebGPU: false});
        expect(stats.automatic).toBe(true);
        expect(stats.maxTriangles).toBe(100_000);
        expect(runtime.castShadow).toBe(false);
    });

    it("keeps automatic stabilization active after a caster is disabled", () => {
        const scene = new Scene();
        const runtimeRoot = new Mesh();
        runtimeRoot.userData.isRuntimeOnly = true;
        const runtime = runtimeMesh("runtime", 600_000);
        runtimeRoot.add(runtime);
        scene.add(runtimeRoot);
        const light = new DirectionalLight();
        light.castShadow = true;
        light.shadow.shadowNode = {cascades: 3} as never;
        scene.add(light);

        const first = applyAutomaticFallbackRuntimeShadowBudget(scene, {isWebGPU: false});
        expect(first.automatic).toBe(true);
        expect(runtime.castShadow).toBe(false);

        const stabilized = applyAutomaticFallbackRuntimeShadowBudget(scene, {isWebGPU: false});
        expect(stabilized.automatic).toBe(true);
        expect(stabilized.enabled).toBe(true);
        expect(runtime.castShadow).toBe(false);

        restoreRuntimeShadowBudget(scene);
        expect(runtime.castShadow).toBe(true);
    });

    it("restores automatic casters when fallback eligibility disappears", () => {
        const scene = new Scene();
        const runtimeRoot = new Mesh();
        runtimeRoot.userData.isRuntimeOnly = true;
        const runtime = runtimeMesh("runtime", 600_000);
        runtimeRoot.add(runtime);
        scene.add(runtimeRoot);
        const light = new DirectionalLight();
        light.castShadow = true;
        light.shadow.shadowNode = {cascades: 3} as never;
        scene.add(light);

        const applied = applyAutomaticFallbackRuntimeShadowBudget(scene, {isWebGPU: false});
        expect(applied.automatic).toBe(true);
        expect(runtime.castShadow).toBe(false);

        // Removing the cascaded shadow setup makes the fallback policy
        // ineligible. The next stabilization pass must restore the runtime
        // caster rather than leaving a stale quality downgrade in place.
        scene.remove(light);
        const restored = applyAutomaticFallbackRuntimeShadowBudget(scene, {isWebGPU: false});
        expect(restored.automatic).toBe(false);
        expect(runtime.castShadow).toBe(true);
    });
});
