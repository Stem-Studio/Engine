export function shouldCollectCSS3DTraversal(
    hasCSS3DObjects: boolean,
    now: number,
    lastScanTime: number,
    scanIntervalMs: number,
): boolean {
    if (hasCSS3DObjects) {
        return true;
    }
    const interval = Number.isFinite(scanIntervalMs) && scanIntervalMs > 0
        ? scanIntervalMs
        : 0;
    return now - lastScanTime >= interval;
}
