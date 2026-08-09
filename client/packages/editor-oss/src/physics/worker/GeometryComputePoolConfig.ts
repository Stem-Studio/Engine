let configuredWorkerCount: number | null = null;

/**
 * Set the maximum number of workers for the geometry compute pool.
 * Must be called before getGeometryComputePool() to take effect.
 */
export function setGeometryWorkerPoolSize(count: number): void {
    configuredWorkerCount = count;
    console.log(`⚙️  Geometry worker pool size configured: ${count} workers`);
}

export function getGeometryWorkerPoolSize(): number | null {
    return configuredWorkerCount;
}
