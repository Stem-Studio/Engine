/**
 * Format priority for deduplication: higher index = higher priority.
 * When multiple files share the same base name, the highest-priority format wins.
 */
const FORMAT_PRIORITY: readonly string[] = [
    "usd",
    "usda",
    "usdc",
    "usdz",
    "3ds",
    "stl",
    "ply",
    "vrm",
    "dae",
    "obj",
    "fbx",
    "gltf",
    "glb",
];

/**
 * Formats that cannot be processed into usable 3D models.
 * - .blend: BlendLoader.js is a placeholder that returns an empty Group
 */
const UNPROCESSABLE_EXTENSIONS = new Set(["blend"]);

const getExtension = (filename: string): string => {
    const name = filename.split("/").pop() || filename;
    const dotIndex = name.lastIndexOf(".");
    return dotIndex > 0 ? name.substring(dotIndex + 1).toLowerCase() : "";
};

const getBaseName = (filename: string): string => {
    const name = filename.split("/").pop() || filename;
    const dotIndex = name.lastIndexOf(".");
    return dotIndex > 0 ? name.substring(0, dotIndex) : name;
};

export const isUnprocessableFormat = (filename: string): boolean => {
    return UNPROCESSABLE_EXTENSIONS.has(getExtension(filename));
};

/**
 * Deduplicates model files by base name, keeping only the highest-priority format per model.
 * Filters out unprocessable formats.
 *
 * @param files - Array of file-like objects with a `name` property
 * @returns Deduplicated array with one file per unique base name
 */
export const deduplicateModelFiles = <T extends { name: string }>(files: T[]): T[] => {
    if (files.length === 0) return [];

    // Filter out unprocessable formats first
    const processable = files.filter(f => !isUnprocessableFormat(f.name));
    if (processable.length === 0) return [];

    // Group by base name (case-insensitive)
    const groups = new Map<string, T[]>();
    for (const file of processable) {
        const key = getBaseName(file.name).toLowerCase();
        const group = groups.get(key);
        if (group) {
            group.push(file);
        } else {
            groups.set(key, [file]);
        }
    }

    // Pick highest-priority format from each group
    const result: T[] = [];
    for (const group of groups.values()) {
        if (group.length === 1) {
            result.push(group[0]!);
            continue;
        }

        let best = group[0]!;
        let bestPriority = FORMAT_PRIORITY.indexOf(getExtension(best.name));
        for (let i = 1; i < group.length; i++) {
            const priority = FORMAT_PRIORITY.indexOf(getExtension(group[i]!.name));
            if (priority > bestPriority) {
                best = group[i]!;
                bestPriority = priority;
            }
        }
        result.push(best);
    }

    return result;
};
