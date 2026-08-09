import {BatchedMesh, Box3, Frustum, Matrix4, Sphere} from "three";

import frustumCullWGSL from "./shaders/frustum_cull.wgsl?raw";

// WebGPU flag constants — defined here because the project's tsconfig lib does
// not include WebGPU types, but the runtime always has these values available.
const GPUShaderStage = {COMPUTE: 4} as const;
const GPUBufferUsage = {MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128} as const;
const GPUMapMode = {READ: 1} as const;

/**
 * GPU-accelerated frustum culling via WebGPU compute shader.
 *
 * Reads per-instance bounding spheres and 6 frustum planes, writes a u32
 * visibility flag per instance, then applies the result through
 * `BatchedMesh.setVisibleAt()`.
 *
 * Uses 1-frame-delayed async readback to avoid GPU stalls.
 */
export class GPUFrustumCuller {
    private device: GPUDevice | null = null;
    private pipeline: GPUComputePipeline | null = null;
    private bindGroupLayout: GPUBindGroupLayout | null = null;

    // Per-batch state keyed by BatchedMesh uuid
    private batchStates: Map<string, BatchState> = new Map();

    private _tmpSphere = new Sphere();
    private _tmpBox = new Box3();
    private _tmpMatrix = new Matrix4();

    /**
     * Initialise with the WebGPU device extracted from the renderer.
     * Call once after the renderer is ready.
     * @param renderer Three.js WebGPU renderer
     * @returns Whether initialisation succeeded.
     */
    init(renderer: {backend?: {device?: GPUDevice; utils?: {device?: GPUDevice}}}): boolean {
        try {
            const device: GPUDevice | undefined =
                renderer?.backend?.device ?? renderer?.backend?.utils?.device;
            if (!device) return false;
            this.device = device;
            this.createPipeline();
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Whether the culler is ready to dispatch work.
     * @returns True if the GPU device and pipeline are initialised.
     */
    get ready(): boolean {
        return this.device !== null && this.pipeline !== null;
    }

    /**
     * Submit culling work for one BatchedMesh.
     * Uploads bounding spheres and frustum planes, dispatches the compute
     * shader, and maps the result buffer. Results are applied on the *next*
     * call (1-frame delay) to avoid GPU stalls.
     * @param batchedMesh
     * @param frustum
     */
    cull(batchedMesh: BatchedMesh, frustum: Frustum): void {
        if (!this.device || !this.pipeline || !this.bindGroupLayout) return;

        const instanceCount =
            (batchedMesh as BatchedMesh & {_instanceInfo?: unknown[]})._instanceInfo?.length ?? 0;
        if (instanceCount === 0) return;

        const uuid = batchedMesh.uuid;
        let state = this.batchStates.get(uuid);
        if (!state) {
            state = {capacity: 0, paramsBuffer: null, spheresBuffer: null, visBuffer: null, readBuffer: null, pending: null};
            this.batchStates.set(uuid, state);
        }

        // Apply previous frame's results (1-frame delayed readback)
        this.applyPending(batchedMesh, state);

        // Reallocate GPU buffers if instance count grew
        if (instanceCount > state.capacity) {
            this.allocateBuffers(state, instanceCount);
        }
        if (!state.paramsBuffer || !state.spheresBuffer || !state.visBuffer || !state.readBuffer) return;

        // Upload bounding spheres
        const sphereData = this.collectBoundingSpheres(batchedMesh, instanceCount);

        // Upload frustum planes
        const paramsData = this.encodeFrustumParams(frustum, instanceCount);

        this.device.queue.writeBuffer(state.paramsBuffer, 0, paramsData.buffer);
        this.device.queue.writeBuffer(state.spheresBuffer, 0, sphereData.buffer);

        // Dispatch
        const encoder = this.device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(this.pipeline);

        const bindGroup = this.device.createBindGroup({
            layout: this.bindGroupLayout,
            entries: [
                {binding: 0, resource: {buffer: state.paramsBuffer}},
                {binding: 1, resource: {buffer: state.spheresBuffer}},
                {binding: 2, resource: {buffer: state.visBuffer}},
            ],
        });
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(Math.ceil(instanceCount / 64));
        pass.end();

        // Copy result to mappable read buffer
        encoder.copyBufferToBuffer(state.visBuffer, 0, state.readBuffer, 0, instanceCount * 4);
        this.device.queue.submit([encoder.finish()]);

        // Start async map (will be consumed next frame)
        // Only map if there's no pending operation and buffer is unmapped
        if (!state.pending && state.readBuffer.mapState === "unmapped") {
            state.pending = {count: instanceCount, promise: state.readBuffer.mapAsync(GPUMapMode.READ)};
        }
    }

    dispose(): void {
        for (const state of this.batchStates.values()) {
            state.paramsBuffer?.destroy();
            state.spheresBuffer?.destroy();
            state.visBuffer?.destroy();
            state.readBuffer?.destroy();
        }
        this.batchStates.clear();
        this.device = null;
        this.pipeline = null;
    }

    // -- internals --

    private createPipeline(): void {
        if (!this.device) return;

        const shaderModule = this.device.createShaderModule({code: frustumCullWGSL});

        this.bindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                {binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: {type: "uniform"}},
                {binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: {type: "read-only-storage"}},
                {binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: {type: "storage"}},
            ],
        });

        this.pipeline = this.device.createComputePipeline({
            layout: this.device.createPipelineLayout({bindGroupLayouts: [this.bindGroupLayout]}),
            compute: {module: shaderModule, entryPoint: "main"},
        });
    }

    private allocateBuffers(state: BatchState, count: number): void {
        if (!this.device) return;
        // Round up to nearest 256 for alignment
        const aligned = Math.ceil(count / 64) * 64;
        state.paramsBuffer?.destroy();
        state.spheresBuffer?.destroy();
        state.visBuffer?.destroy();
        state.readBuffer?.destroy();

        // params: 6 planes * 16 bytes + 4 bytes instanceCount + 12 padding = 112 bytes
        state.paramsBuffer = this.device.createBuffer({size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
        state.spheresBuffer = this.device.createBuffer({size: aligned * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST});
        state.visBuffer = this.device.createBuffer({size: aligned * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC});
        state.readBuffer = this.device.createBuffer({size: aligned * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST});
        state.capacity = aligned;
    }

    private collectBoundingSpheres(bm: BatchedMesh, count: number): Float32Array {
        const data = new Float32Array(count * 4);
        for (let i = 0; i < count; i++) {
            // Get instance bounding box, compute bounding sphere
            try {
                bm.getBoundingBoxAt(i, this._tmpBox);
                this._tmpBox.getBoundingSphere(this._tmpSphere);
                // Transform sphere center by instance matrix
                bm.getMatrixAt(i, this._tmpMatrix);
                this._tmpSphere.center.applyMatrix4(this._tmpMatrix);
                const scale = this._tmpMatrix.getMaxScaleOnAxis();
                data[i * 4] = this._tmpSphere.center.x;
                data[i * 4 + 1] = this._tmpSphere.center.y;
                data[i * 4 + 2] = this._tmpSphere.center.z;
                data[i * 4 + 3] = this._tmpSphere.radius * scale;
            } catch {
                // Instance may not have a bounding box; mark as visible
                data[i * 4 + 3] = 1e10; // huge radius = always visible
            }
        }
        return data;
    }

    private encodeFrustumParams(frustum: Frustum, instanceCount: number): Float32Array {
        // Layout: 6 planes (vec3 normal + f32 distance) + u32 instanceCount + padding
        // Total: 6*16 + 16 = 112 bytes = 28 floats
        const data = new Float32Array(28);
        for (let i = 0; i < 6; i++) {
            const plane = frustum.planes[i]!;
            data[i * 4] = plane.normal.x;
            data[i * 4 + 1] = plane.normal.y;
            data[i * 4 + 2] = plane.normal.z;
            data[i * 4 + 3] = plane.constant;
        }
        // instanceCount as u32 at offset 96 bytes (index 24)
        const u32View = new Uint32Array(data.buffer);
        u32View[24] = instanceCount;
        return data;
    }

    private applyPending(bm: BatchedMesh, state: BatchState): void {
        if (!state.pending || !state.readBuffer) return;

        const {count, promise} = state.pending;

        // Check if the map resolved (non-blocking: if not ready yet, skip this frame)
        void promise.then(() => {
            try {
                const mapped = new Uint32Array(state.readBuffer!.getMappedRange());
                const setVisible = (
                    bm as BatchedMesh & {setVisibleAt?: (index: number, visible: boolean) => void}
                ).setVisibleAt?.bind(bm);
                if (setVisible) {
                    for (let i = 0; i < count; i++) {
                        setVisible(i, mapped[i] === 1);
                    }
                }
            } finally {
                state.readBuffer?.unmap();
                // Clear pending only after unmap completes
                state.pending = null;
            }
        }).catch(() => {
            // Silently ignore readback failures; instances stay visible by default
            state.pending = null;
        });
    }
}

interface BatchState {
    capacity: number;
    paramsBuffer: GPUBuffer | null;
    spheresBuffer: GPUBuffer | null;
    visBuffer: GPUBuffer | null;
    readBuffer: GPUBuffer | null;
    pending: {count: number; promise: Promise<void>} | null;
}
