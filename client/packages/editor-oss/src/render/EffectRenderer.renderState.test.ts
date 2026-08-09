import {
    InstancedBufferAttribute,
    InstancedBufferGeometry,
    InstancedMesh,
    MeshBasicMaterial,
    Object3D,
    Scene,
    BoxGeometry,
} from "three";
import {describe, expect, it, vi} from "vitest";

import EffectRenderer, {installFiniteDrawGuard, normalizeNonFiniteInstanceCounts} from "./EffectRenderer";

describe("EffectRenderer render-state normalization", () => {
    it("repairs a recoverable non-finite draw and retries in the same frame", () => {
        const scene = new Scene();
        const geometry = new InstancedBufferGeometry();
        geometry.setAttribute(
            "position",
            new InstancedBufferAttribute(new Float32Array([0, 0, 0]), 3),
        );
        geometry.setAttribute(
            "instanceOffset",
            new InstancedBufferAttribute(new Float32Array(4 * 3), 3),
        );
        scene.add(Object.assign(new Object3D(), {geometry}));

        const render = vi.fn()
            .mockImplementationOnce(() => {
                throw new TypeError("Value is infinite and not of type 'unsigned long' at drawIndexed");
            })
            .mockImplementationOnce(() => undefined);
        const runtime = {
            scene,
            camera: {},
            renderer: {render},
            rendererCSS: null,
            batchEnabled: false,
            batchManager: null,
            isRuntimeSceneRevealActive: () => false,
            shouldSyncCSS3DObjects: () => false,
            updateSceneMatricesForRender: vi.fn(() => false),
            updateBatches: vi.fn(),
            shouldRenderCSS3D: () => false,
        } as any;

        EffectRenderer.prototype._standardRender.call(runtime);

        expect(render).toHaveBeenCalledTimes(2);
        expect(geometry.instanceCount).toBe(4);
    });

    it("infers a finite InstancedBufferGeometry count from instanced attributes", () => {
        const scene = new Scene();
        const geometry = new InstancedBufferGeometry();
        geometry.setAttribute(
            "position",
            new InstancedBufferAttribute(new Float32Array([0, 0, 0]), 3),
        );
        geometry.setAttribute(
            "instanceOffset",
            new InstancedBufferAttribute(new Float32Array(4 * 3), 3),
        );
        scene.add(new Object3D().add(new Object3D()));
        scene.add(Object.assign(new Object3D(), {geometry}));

        expect(geometry.instanceCount).toBe(Infinity);
        expect(normalizeNonFiniteInstanceCounts(scene)).toBe(1);
        expect(geometry.instanceCount).toBe(4);
    });

    it("does not freeze a runtime instanced geometry before its attributes arrive", () => {
        const scene = new Scene();
        const geometry = new InstancedBufferGeometry();
        scene.add(Object.assign(new Object3D(), {geometry}));

        expect(normalizeNonFiniteInstanceCounts(scene)).toBe(0);
        expect(geometry.instanceCount).toBe(Infinity);
    });

    it("clamps malformed InstancedMesh and multi-draw counts", () => {
        const scene = new Scene();
        const mesh = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 3);
        mesh.count = Infinity;
        scene.add(mesh);

        const batched = new Object3D() as Object3D & {
            isBatchedMesh: boolean;
            _multiDrawCounts: number[] | Float32Array;
            _multiDrawStarts: number[] | Float32Array;
        };
        batched.isBatchedMesh = true;
        batched._multiDrawCounts = new Float32Array([4, Infinity]);
        batched._multiDrawStarts = new Float32Array([0, Infinity]);
        scene.add(batched);

        expect(normalizeNonFiniteInstanceCounts(scene)).toBe(3);
        expect(mesh.count).toBe(3);
        expect(Array.from(batched._multiDrawCounts)).toEqual([4, 0]);
        expect(Array.from(batched._multiDrawStarts)).toEqual([0, 0]);
    });

    it("repairs non-finite draw-range and group offsets before WebGPU consumes them", () => {
        const scene = new Scene();
        const geometry = new BoxGeometry();
        geometry.drawRange.start = Infinity;
        geometry.drawRange.count = NaN;
        geometry.clearGroups();
        geometry.addGroup(Infinity, NaN, 0);
        scene.add(Object.assign(new Object3D(), {geometry}));

        expect(normalizeNonFiniteInstanceCounts(scene)).toBe(4);
        expect(geometry.drawRange.start).toBe(0);
        expect(geometry.drawRange.count).toBe(Infinity);
        expect(geometry.groups[0]).toMatchObject({start: 0, count: Infinity});
    });

    it("blocks non-finite RenderObject parameters at the backend draw boundary", () => {
        let observed = null;
        let getDrawParametersCalls = 0;
        const renderObject = {
            object: {},
            getDrawParameters() {
                getDrawParametersCalls += 1;
                return {vertexCount: Infinity, instanceCount: Infinity, firstVertex: Infinity, firstInstance: Infinity};
            },
        };
        const backend = {
            draw(object: {getDrawParameters: () => unknown}) {
                observed = object.getDrawParameters();
            },
        };
        expect(installFiniteDrawGuard({backend})).toBe(true);
        backend.draw(renderObject);
        expect(observed).toBeNull();
        const guardedGetter = renderObject.getDrawParameters;
        expect(installFiniteDrawGuard({backend})).toBe(false);
        backend.draw(renderObject);
        expect(renderObject.getDrawParameters).toBe(guardedGetter);
        expect(getDrawParametersCalls).toBe(2);
    });

    it("quarantines only an unsigned-infinite WebGPU draw failure", () => {
        const renderObject = {
            object: new Object3D(),
            getDrawParameters() {
                return {vertexCount: 3, instanceCount: 1, firstVertex: 0, firstInstance: 0};
            },
        };
        const backend = {
            draw(_renderObject?: unknown) {
                throw new TypeError("Value is infinite and not of type 'unsigned long' at drawIndexed");
            },
        };

        expect(installFiniteDrawGuard({backend})).toBe(true);
        expect(() => backend.draw(renderObject)).not.toThrow();
        expect((backend as typeof backend & {__stemFiniteDrawGuardStats?: unknown}).__stemFiniteDrawGuardStats).toMatchObject({
            skippedNonFiniteDraws: 1,
        });
    });

    it("does not swallow unrelated WebGPU backend failures", () => {
        const renderObject = {
            object: new Object3D(),
            getDrawParameters() {
                return {vertexCount: 3, instanceCount: 1, firstVertex: 0, firstInstance: 0};
            },
        };
        const backend = {
            draw(_renderObject?: unknown) {
                throw new Error("pipeline compilation failed");
            },
        };

        expect(installFiniteDrawGuard({backend})).toBe(true);
        expect(() => backend.draw(renderObject)).toThrow("pipeline compilation failed");
    });

    it("infers an indexed vertex count when the draw range uses Infinity as all geometry", () => {
        const geometry = new BoxGeometry();
        geometry.drawRange.start = 0;
        geometry.drawRange.count = Infinity;
        let observed = null;
        const renderObject = {
            object: {geometry},
            getDrawParameters() {
                return {vertexCount: Infinity, instanceCount: 1, firstVertex: 0, firstInstance: 0};
            },
        };
        const backend = {
            draw(object: typeof renderObject) {
                observed = object.getDrawParameters();
            },
        };

        expect(installFiniteDrawGuard({backend})).toBe(true);
        backend.draw(renderObject);
        expect(observed).toMatchObject({
            vertexCount: geometry.index!.count,
            instanceCount: 1,
        });
    });

    it("does not wrap the WebGLBackend draw hot path", () => {
        const draw = () => undefined;
        const backend = {isWebGLBackend: true, draw};

        expect(installFiniteDrawGuard({backend})).toBe(false);
        expect(backend.draw).toBe(draw);
        expect((backend as {__stemFiniteDrawGuardInstalled?: boolean}).__stemFiniteDrawGuardInstalled).not.toBe(true);
    });

    it("keeps valid draw parameters on the cached object without copying them", () => {
        const params = {vertexCount: 3, instanceCount: 1, firstVertex: 0, firstInstance: 0};
        const renderObject = {
            object: {},
            getDrawParameters: () => params,
        };
        const observed: Array<typeof params> = [];
        const backend = {
            draw(object: typeof renderObject) {
                observed.push(object.getDrawParameters());
            },
        };

        expect(installFiniteDrawGuard({backend})).toBe(true);
        backend.draw(renderObject);
        backend.draw(renderObject);

        expect(observed).toEqual([params, params]);
        expect(observed[0]).toBe(params);
        expect(observed[1]).toBe(params);
    });
});
