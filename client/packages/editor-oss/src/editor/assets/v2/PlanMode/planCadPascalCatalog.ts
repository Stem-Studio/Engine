import type { PlanItemSource, PlanSize3 } from "./planCadCore";
import type { PlanCadPartCategory, PlanCadPartPreset } from "./planCadEditorBridge";

type PascalPlacement = "floor" | "wall" | "ceiling";

interface PascalAssetInput {
    id: string;
    category: string;
    name: string;
    thumbnail: string;
    src: string;
    dimensions: PlanSize3;
    tags: string[];
    attachTo?: "wall" | "wall-side" | "ceiling";
    offset?: PlanSize3;
    rotation?: PlanSize3;
    scale?: PlanSize3;
}

const PASCAL_ITEMS_BASE_URL =
    "https://byrpxoiotywskoojsrzd.supabase.co/storage/v1/object/public/items/system";

export const PASCAL_CATALOG_SOURCE_URL =
    "https://raw.githubusercontent.com/pascalorg/editor/main/packages/editor/src/components/ui/item-catalog/catalog-items.tsx";

const PASCAL_CATEGORY_LABELS: Record<string, string> = {
    appliance: "Pascal Appliances",
    bathroom: "Pascal Bath",
    furniture: "Pascal Furniture",
    kitchen: "Pascal Kitchen",
    outdoor: "Pascal Outdoor",
};

function toTitleCase(value: string) {
    return value
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
        .join(" ");
}

function toPlanSize3(
    values: number[] | null | undefined,
    options: { allowNegative?: boolean } = {},
): PlanSize3 | null {
    if (!values || values.length < 3) return null;
    const x = values[0];
    const y = values[1];
    const z = values[2];
    if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") return null;
    if (![x, y, z].every((value) => Number.isFinite(value) && (options.allowNegative || value >= 0))) return null;
    return { x, y, z };
}

function getPascalPlacement(asset: PascalAssetInput): PascalPlacement {
    if (asset.attachTo === "wall" || asset.attachTo === "wall-side") return "wall";
    if (asset.attachTo === "ceiling") return "ceiling";
    return "floor";
}

function getPascalMaterial(asset: PascalAssetInput) {
    const haystack = `${asset.category} ${asset.name} ${asset.tags.join(" ")}`.toLowerCase();
    if (haystack.includes("ceramic") || haystack.includes("bath") || haystack.includes("toilet")) return "ceramic";
    if (haystack.includes("metal") || haystack.includes("steel") || haystack.includes("appliance")) return "metal";
    if (haystack.includes("glass") || haystack.includes("mirror")) return "glass";
    if (haystack.includes("wood") || haystack.includes("table") || haystack.includes("shelf")) return "wood";
    if (haystack.includes("sofa") || haystack.includes("chair") || haystack.includes("bed")) return "fabric";
    return "default";
}

function getPascalSource(asset: PascalAssetInput): PlanItemSource {
    const transform: PlanItemSource["transform"] = {};
    if (asset.offset) transform.offset = asset.offset;
    if (asset.rotation) transform.rotation = asset.rotation;
    if (asset.scale) transform.scale = asset.scale;

    return {
        type: "model",
        provider: "pascal",
        providerAssetId: asset.id,
        assetId: asset.id,
        url: asset.src,
        format: "glb",
        thumbnailUrl: asset.thumbnail,
        attribution: "Pascal Editor",
        license: "MIT",
        transform: Object.keys(transform).length > 0 ? transform : undefined,
    };
}

function assetToPreset(asset: PascalAssetInput): PlanCadPartPreset {
    return {
        id: `pascal-${asset.id}`,
        label: `Pascal ${asset.name}`,
        category: `pascal-${asset.category}`,
        placement: getPascalPlacement(asset),
        dimensions: asset.dimensions,
        material: getPascalMaterial(asset),
        tags: ["pascal", asset.category, ...asset.tags],
        source: getPascalSource(asset),
    };
}

function pascalModelSource(
    id: string,
    transform?: PlanItemSource["transform"],
): PlanItemSource {
    return {
        type: "model",
        provider: "pascal",
        providerAssetId: id,
        assetId: id,
        url: `${PASCAL_ITEMS_BASE_URL}/${id}/model.glb`,
        format: "glb",
        thumbnailUrl: `${PASCAL_ITEMS_BASE_URL}/${id}/thumbnail.png`,
        attribution: "Pascal Editor",
        license: "MIT",
        transform,
    };
}

function fallbackPreset(
    id: string,
    label: string,
    category: string,
    dimensions: PlanSize3,
    material: string,
    tags: string[],
    transform?: PlanItemSource["transform"],
): PlanCadPartPreset {
    return {
        id: `pascal-${id}`,
        label,
        category,
        placement: "floor",
        dimensions,
        material,
        tags: ["pascal", ...tags],
        source: pascalModelSource(id, transform),
    };
}

export const PASCAL_PLAN_CAD_FALLBACK_CATALOGS: PlanCadPartCategory[] = [
    {
        id: "pascal-furniture",
        label: "Pascal Furniture",
        presets: [
            fallbackPreset("sofa", "Pascal Sofa", "pascal-furniture", { x: 2.5, y: 0.8, z: 1.5 }, "fabric", [
                "furniture",
                "seating",
                "living",
            ]),
            fallbackPreset(
                "livingroom-chair",
                "Pascal Living Chair",
                "pascal-furniture",
                { x: 1.5, y: 0.8, z: 1.5 },
                "fabric",
                ["furniture", "seating", "living"],
                { offset: { x: 0.01, y: 0, z: 0 } },
            ),
            fallbackPreset("coffee-table", "Pascal Coffee Table", "pascal-furniture", { x: 2, y: 0.4, z: 1.5 }, "wood", [
                "furniture",
                "table",
                "living",
            ]),
            fallbackPreset("tv-stand", "Pascal TV Stand", "pascal-furniture", { x: 2, y: 0.4, z: 0.5 }, "wood", [
                "furniture",
                "storage",
                "living",
            ], { offset: { x: 0, y: 0.21, z: 0 } }),
            fallbackPreset("double-bed", "Pascal Double Bed", "pascal-furniture", { x: 2, y: 0.8, z: 2.5 }, "fabric", [
                "furniture",
                "bedroom",
                "bed",
            ], { offset: { x: 0, y: 0, z: -0.03 } }),
            fallbackPreset("single-bed", "Pascal Single Bed", "pascal-furniture", { x: 1.5, y: 0.7, z: 2.5 }, "fabric", [
                "furniture",
                "bedroom",
                "bed",
            ]),
            fallbackPreset("bedside-table", "Pascal Bedside Table", "pascal-furniture", { x: 0.5, y: 0.5, z: 0.5 }, "wood", [
                "furniture",
                "storage",
                "bedroom",
            ], { offset: { x: 0, y: 0, z: -0.01 } }),
            fallbackPreset("dresser", "Pascal Dresser", "pascal-furniture", { x: 1.5, y: 0.8, z: 1 }, "wood", [
                "furniture",
                "storage",
                "bedroom",
            ]),
            fallbackPreset("dining-table", "Pascal Dining Table", "pascal-furniture", { x: 2.5, y: 0.8, z: 1 }, "wood", [
                "furniture",
                "table",
                "dining",
            ], { offset: { x: 0, y: 0, z: -0.01 } }),
            fallbackPreset("dining-chair", "Pascal Dining Chair", "pascal-furniture", { x: 0.5, y: 1, z: 0.5 }, "wood", [
                "furniture",
                "seating",
                "dining",
            ]),
        ],
    },
    {
        id: "pascal-kitchen",
        label: "Pascal Kitchen",
        presets: [
            fallbackPreset("kitchen-counter", "Pascal Kitchen Counter", "pascal-kitchen", { x: 2, y: 0.8, z: 1 }, "wood", [
                "kitchen",
                "casework",
                "storage",
            ]),
            fallbackPreset("stove", "Pascal Stove", "pascal-kitchen", { x: 1, y: 1, z: 1 }, "metal", [
                "kitchen",
                "appliance",
            ], { offset: { x: 0, y: 0, z: -0.05 } }),
            fallbackPreset("fridge", "Pascal Fridge", "pascal-kitchen", { x: 1, y: 2, z: 1 }, "metal", [
                "kitchen",
                "appliance",
            ], { offset: { x: 0.01, y: 0, z: -0.05 } }),
        ],
    },
    {
        id: "pascal-bath",
        label: "Pascal Bath",
        presets: [
            fallbackPreset("toilet", "Pascal Toilet", "pascal-bath", { x: 1, y: 0.9, z: 1 }, "ceramic", [
                "bathroom",
                "plumbing",
            ], { offset: { x: 0, y: 0, z: -0.23 } }),
            fallbackPreset("bathroom-sink", "Pascal Bathroom Sink", "pascal-bath", { x: 2, y: 1, z: 1.5 }, "ceramic", [
                "bathroom",
                "plumbing",
                "sink",
            ], { offset: { x: 0.11, y: 0, z: 0.02 } }),
            fallbackPreset("shower-square", "Pascal Shower", "pascal-bath", { x: 1, y: 2, z: 1 }, "ceramic", [
                "bathroom",
                "plumbing",
                "shower",
            ], { offset: { x: 0.41, y: 0, z: -0.42 } }),
            fallbackPreset("bathtub", "Pascal Bathtub", "pascal-bath", { x: 2.5, y: 0.8, z: 1.5 }, "ceramic", [
                "bathroom",
                "plumbing",
                "tub",
            ], { offset: { x: 0, y: 0, z: 0.01 } }),
        ],
    },
];

export const PASCAL_PLAN_CAD_PART_CATALOGS = PASCAL_PLAN_CAD_FALLBACK_CATALOGS;

function getCatalogArraySource(source: string) {
    const start = source.indexOf("export const CATALOG_ITEMS");
    if (start < 0) return "";
    const assignmentStart = source.indexOf("=", start);
    if (assignmentStart < 0) return "";
    const arrayStart = source.indexOf("[", assignmentStart);
    if (arrayStart < 0) return "";

    let depth = 0;
    let quote: string | null = null;
    let escaping = false;
    for (let index = arrayStart; index < source.length; index += 1) {
        const char = source[index]!;
        if (quote) {
            if (escaping) {
                escaping = false;
            } else if (char === "\\") {
                escaping = true;
            } else if (char === quote) {
                quote = null;
            }
            continue;
        }
        if (char === "'" || char === "\"") {
            quote = char;
            continue;
        }
        if (char === "[") depth += 1;
        if (char === "]") {
            depth -= 1;
            if (depth === 0) return source.slice(arrayStart + 1, index);
        }
    }
    return "";
}

function splitObjectLiterals(source: string) {
    const objects: string[] = [];
    let depth = 0;
    let start = -1;
    let quote: string | null = null;
    let escaping = false;

    for (let index = 0; index < source.length; index += 1) {
        const char = source[index]!;
        if (quote) {
            if (escaping) {
                escaping = false;
            } else if (char === "\\") {
                escaping = true;
            } else if (char === quote) {
                quote = null;
            }
            continue;
        }
        if (char === "'" || char === "\"") {
            quote = char;
            continue;
        }
        if (char === "{") {
            if (depth === 0) start = index;
            depth += 1;
            continue;
        }
        if (char === "}") {
            depth -= 1;
            if (depth === 0 && start >= 0) {
                objects.push(source.slice(start, index + 1));
                start = -1;
            }
        }
    }

    return objects;
}

function getStringField(source: string, field: string) {
    const match = new RegExp(`${field}:\\s*(['"])([\\s\\S]*?)\\1`).exec(source);
    return match?.[2]?.replace(/\\'/g, "'").replace(/\\"/g, "\"") ?? null;
}

function getStringArrayField(source: string, field: string) {
    const match = new RegExp(`${field}:\\s*\\[([\\s\\S]*?)\\]`).exec(source);
    const body = match?.[1];
    if (!body) return [];
    return [...body.matchAll(/['"]([^'"]+)['"]/g)].map((item) => item[1]!).filter(Boolean);
}

function getNumberArrayField(source: string, field: string) {
    const match = new RegExp(`${field}:\\s*\\[([\\s\\S]*?)\\]`).exec(source);
    const body = match?.[1];
    if (!body) return null;
    return body
        .split(",")
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isFinite(item));
}

function parsePascalAsset(source: string): PascalAssetInput | null {
    const id = getStringField(source, "id");
    const category = getStringField(source, "category");
    const name = getStringField(source, "name");
    const thumbnail = getStringField(source, "thumbnail");
    const src = getStringField(source, "src");
    const dimensions = toPlanSize3(getNumberArrayField(source, "dimensions"));
    if (!id || !category || !name || !thumbnail || !src || !dimensions) return null;

    const offset = toPlanSize3(getNumberArrayField(source, "offset"), { allowNegative: true }) ?? undefined;
    const rotation = toPlanSize3(getNumberArrayField(source, "rotation"), { allowNegative: true }) ?? undefined;
    const scale = toPlanSize3(getNumberArrayField(source, "scale"), { allowNegative: true }) ?? undefined;
    const attachTo = getStringField(source, "attachTo") as PascalAssetInput["attachTo"] | null;

    return {
        id,
        category,
        name,
        thumbnail,
        src,
        dimensions,
        tags: getStringArrayField(source, "tags"),
        attachTo: attachTo ?? undefined,
        offset,
        rotation,
        scale,
    };
}

export function parsePascalPlanCadCatalogSource(source: string): PlanCadPartCategory[] {
    const assets = splitObjectLiterals(getCatalogArraySource(source))
        .map(parsePascalAsset)
        .filter((asset): asset is PascalAssetInput => !!asset);
    const categories = new Map<string, PlanCadPartPreset[]>();

    for (const asset of assets) {
        const categoryId = `pascal-${asset.category}`;
        const presets = categories.get(categoryId) ?? [];
        presets.push(assetToPreset(asset));
        categories.set(categoryId, presets);
    }

    return [...categories.entries()]
        .map(([id, presets]) => ({
            id,
            label: PASCAL_CATEGORY_LABELS[id.replace(/^pascal-/, "")] ?? `Pascal ${toTitleCase(id.replace(/^pascal-/, ""))}`,
            presets: presets.sort((a, b) => a.label.localeCompare(b.label)),
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

let pendingCatalogFetch: Promise<PlanCadPartCategory[]> | null = null;

export async function fetchPascalPlanCadPartCatalogs(
    fetcher: typeof fetch = fetch,
) {
    if (pendingCatalogFetch) return pendingCatalogFetch;

    pendingCatalogFetch = fetcher(PASCAL_CATALOG_SOURCE_URL)
        .then(async (response) => {
            if (!response.ok) {
                throw new Error(`Pascal catalog request failed: ${response.status}`);
            }
            const catalogs = parsePascalPlanCadCatalogSource(await response.text());
            if (!catalogs.length) throw new Error("Pascal catalog did not contain placeable assets");
            return catalogs;
        })
        .catch((error) => {
            pendingCatalogFetch = null;
            throw error;
        });

    return pendingCatalogFetch;
}
