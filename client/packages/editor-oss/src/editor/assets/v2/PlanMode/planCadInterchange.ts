import {
    createDefaultPlanCadData,
    createPlanCadPart,
    createPlanCadPolygonSlab,
    createPlanCadPolygonZone,
    createPlanCadWall,
    planCadDataToState,
    planCadStateToData,
    updatePlanCadNodeData,
} from "./planCadEditorBridge";
import type {PlanCadSceneData} from "./planCadEditorBridge";
import type {PlanItemNode, PlanNode, PlanPoint2, PlanSlabNode, PlanWallNode, PlanZoneNode} from "./planCadCore";

const EMBEDDED_PAYLOAD_PREFIX = "STEM_PLAN_CAD_JSON ";

export const PLAN_CAD_DXF_LAYERS = {
    wall: "STEM_WALL",
    slab: "STEM_SLAB",
    zone: "STEM_ZONE",
    item: "STEM_ITEM",
    opening: "STEM_OPENING",
} as const;

export const PLAN_CAD_IFC_TYPES = {
    wall: "IFCWALLSTANDARDCASE",
    slab: "IFCSLAB",
    zone: "IFCSPACE",
    item: "IFCFURNISHINGELEMENT",
} as const;

export const PLAN_CAD_INTERCHANGE_UNITS = {
    length: "METRE",
    dxfInsUnits: 6,
} as const;

function encodeEmbeddedPayload(data: PlanCadSceneData) {
    return `${EMBEDDED_PAYLOAD_PREFIX}${encodeURIComponent(JSON.stringify(data))}`;
}

function decodeEmbeddedPayload(text: string) {
    const markerIndex = text.indexOf(EMBEDDED_PAYLOAD_PREFIX);
    if (markerIndex < 0) return null;
    const start = markerIndex + EMBEDDED_PAYLOAD_PREFIX.length;
    const encoded = text.slice(start).split(/\r?\n| \*\/|$/)[0]?.trim();
    if (!encoded) return null;
    try {
        return normalizePlanCadData(JSON.parse(decodeURIComponent(encoded)));
    } catch (error) {
        const cause = error instanceof Error ? error.message : String(error);
        throw new Error(`Plan/CAD import has a malformed embedded payload: ${cause}`);
    }
}

function normalizePlanCadData(raw: PlanCadSceneData): PlanCadSceneData {
    const state = planCadDataToState(raw);
    return {
        ...planCadStateToData(state, raw),
        activeLevelId: raw.activeLevelId,
        selectedNodeId: raw.selectedNodeId ?? null,
        displayMode: raw.displayMode ?? "stacked",
    };
}

function getNodes<T extends PlanNode>(data: PlanCadSceneData, type: T["type"]) {
    return Object.values(data.nodes).filter((node): node is T => node.type === type);
}

function dxfPair(code: number, value: string | number) {
    return [`${code}`, `${value}`];
}

function dxfLayer(name: string, color: number) {
    return [
        ...dxfPair(0, "LAYER"),
        ...dxfPair(2, name),
        ...dxfPair(70, 0),
        ...dxfPair(62, color),
        ...dxfPair(6, "CONTINUOUS"),
    ];
}

function dxfPolyline(layer: string, points: PlanPoint2[]) {
    return [
        ...dxfPair(0, "LWPOLYLINE"),
        ...dxfPair(8, layer),
        ...dxfPair(90, points.length),
        ...dxfPair(70, 1),
        ...points.flatMap(point => [
            ...dxfPair(10, point.x),
            ...dxfPair(20, point.z),
        ]),
    ];
}

function itemFootprint(item: PlanItemNode) {
    const halfX = item.dimensions.x / 2;
    const halfZ = item.dimensions.z / 2;
    return [
        {x: item.position.x - halfX, z: item.position.z - halfZ},
        {x: item.position.x + halfX, z: item.position.z - halfZ},
        {x: item.position.x + halfX, z: item.position.z + halfZ},
        {x: item.position.x - halfX, z: item.position.z + halfZ},
    ];
}

export function exportPlanCadDxf(data: PlanCadSceneData) {
    const lines = [
        ...dxfPair(0, "SECTION"),
        ...dxfPair(2, "HEADER"),
        ...dxfPair(9, "$INSUNITS"),
        ...dxfPair(70, PLAN_CAD_INTERCHANGE_UNITS.dxfInsUnits),
        ...dxfPair(0, "ENDSEC"),
        ...dxfPair(0, "SECTION"),
        ...dxfPair(2, "TABLES"),
        ...dxfPair(0, "TABLE"),
        ...dxfPair(2, "LAYER"),
        ...dxfPair(70, 5),
        ...dxfLayer(PLAN_CAD_DXF_LAYERS.wall, 7),
        ...dxfLayer(PLAN_CAD_DXF_LAYERS.slab, 8),
        ...dxfLayer(PLAN_CAD_DXF_LAYERS.zone, 4),
        ...dxfLayer(PLAN_CAD_DXF_LAYERS.item, 3),
        ...dxfLayer(PLAN_CAD_DXF_LAYERS.opening, 1),
        ...dxfPair(0, "ENDTAB"),
        ...dxfPair(0, "ENDSEC"),
        ...dxfPair(0, "SECTION"),
        ...dxfPair(2, "ENTITIES"),
        ...dxfPair(999, encodeEmbeddedPayload(data)),
    ];

    for (const wall of getNodes<PlanWallNode>(data, "wall")) {
        lines.push(
            ...dxfPair(0, "LINE"),
            ...dxfPair(8, PLAN_CAD_DXF_LAYERS.wall),
            ...dxfPair(10, wall.start.x),
            ...dxfPair(20, wall.start.z),
            ...dxfPair(30, wall.elevation),
            ...dxfPair(11, wall.end.x),
            ...dxfPair(21, wall.end.z),
            ...dxfPair(31, wall.elevation),
        );
        for (const opening of wall.openings) {
            const x = wall.start.x + (wall.end.x - wall.start.x) * opening.t;
            const z = wall.start.z + (wall.end.z - wall.start.z) * opening.t;
            lines.push(
                ...dxfPair(0, "POINT"),
                ...dxfPair(8, PLAN_CAD_DXF_LAYERS.opening),
                ...dxfPair(10, x),
                ...dxfPair(20, z),
                ...dxfPair(30, opening.sillHeight),
            );
        }
    }

    for (const slab of getNodes<PlanSlabNode>(data, "slab")) {
        lines.push(...dxfPolyline(PLAN_CAD_DXF_LAYERS.slab, slab.points));
    }
    for (const zone of getNodes<PlanZoneNode>(data, "zone")) {
        lines.push(...dxfPolyline(PLAN_CAD_DXF_LAYERS.zone, zone.points));
    }
    for (const item of getNodes<PlanItemNode>(data, "item")) {
        lines.push(...dxfPolyline(PLAN_CAD_DXF_LAYERS.item, itemFootprint(item)));
    }

    lines.push(...dxfPair(0, "ENDSEC"), ...dxfPair(0, "EOF"));
    return `${lines.join("\n")}\n`;
}

type DxfGroup = {code: number; value: string};

function parseDxfGroups(dxf: string): DxfGroup[] {
    const rows = dxf.split(/\r?\n/);
    const groups: DxfGroup[] = [];
    for (let i = 0; i + 1 < rows.length; i += 2) {
        const code = Number(rows[i]!.trim());
        if (!Number.isFinite(code)) continue;
        groups.push({code, value: rows[i + 1]!.trim()});
    }
    return groups;
}

function readDxfEntity(groups: DxfGroup[], startIndex: number) {
    const type = groups[startIndex]?.value;
    const values: Record<number, string[]> = {};
    let index = startIndex + 1;
    while (index < groups.length && groups[index]!.code !== 0) {
        const group = groups[index]!;
        values[group.code] = [...(values[group.code] ?? []), group.value];
        index++;
    }
    return {type, values, nextIndex: index};
}

function dxfNumbers(values: Record<number, string[]>, code: number) {
    return (values[code] ?? []).map(Number).filter(Number.isFinite);
}

export function importPlanCadDxf(dxf: string): PlanCadSceneData {
    const embedded = decodeEmbeddedPayload(dxf);
    if (embedded) return embedded;

    let data = createDefaultPlanCadData();
    const groups = parseDxfGroups(dxf);
    let importedEntityCount = 0;
    for (let i = 0; i < groups.length;) {
        const group = groups[i]!;
        if (group.code !== 0) {
            i++;
            continue;
        }
        const entity = readDxfEntity(groups, i);
        const layer = entity.values[8]?.[0];
        if (entity.type === "LINE" && layer === PLAN_CAD_DXF_LAYERS.wall) {
            const x = dxfNumbers(entity.values, 10)[0];
            const z = dxfNumbers(entity.values, 20)[0];
            const x2 = dxfNumbers(entity.values, 11)[0];
            const z2 = dxfNumbers(entity.values, 21)[0];
            if ([x, z, x2, z2].every(value => value !== undefined)) {
                data = createPlanCadWall(data, {x: x!, z: z!}, {x: x2!, z: z2!});
                importedEntityCount++;
            }
        }
        if (entity.type === "LWPOLYLINE") {
            const xs = dxfNumbers(entity.values, 10);
            const zs = dxfNumbers(entity.values, 20);
            const points = xs.map((x, index) => ({x, z: zs[index]!})).filter(point => Number.isFinite(point.z));
            if (points.length >= 3 && layer === PLAN_CAD_DXF_LAYERS.slab) {
                data = createPlanCadPolygonSlab(data, points);
                importedEntityCount++;
            }
            if (points.length >= 3 && layer === PLAN_CAD_DXF_LAYERS.zone) {
                data = createPlanCadPolygonZone(data, points);
                importedEntityCount++;
            }
        }
        i = entity.nextIndex;
    }
    if (importedEntityCount === 0) {
        throw new Error("DXF import found no supported wall, slab, or zone entities.");
    }
    return data;
}

function ifcString(value: string) {
    return `'${value.replace(/'/g, "''")}'`;
}

function ifcGuid(seed: string) {
    return seed.replace(/[^A-Za-z0-9_$]/g, "").slice(0, 22).padEnd(22, "0");
}

function splitIfcArguments(args: string) {
    const parts: string[] = [];
    let current = "";
    let inString = false;

    for (let index = 0; index < args.length; index++) {
        const char = args[index]!;
        const next = args[index + 1];
        if (char === "'") {
            current += char;
            if (inString && next === "'") {
                current += next;
                index++;
                continue;
            }
            inString = !inString;
            continue;
        }
        if (char === "," && !inString) {
            parts.push(current.trim());
            current = "";
            continue;
        }
        current += char;
    }

    if (current.trim() || args.endsWith(",")) {
        parts.push(current.trim());
    }
    return parts;
}

function parseIfcStringLiteral(value: string | undefined, fallback: string) {
    const trimmed = value?.trim();
    if (!trimmed || trimmed === "$" || trimmed === "*") return fallback;
    if (!trimmed.startsWith("'")) return trimmed;
    const inner = trimmed.slice(1, trimmed.endsWith("'") ? -1 : undefined);
    return inner.replace(/''/g, "'") || fallback;
}

function collectIfcEntityNames(ifc: string, types: string[], fallbackLabel: string) {
    const names: string[] = [];
    for (const type of types) {
        const pattern = new RegExp(`#\\d+\\s*=\\s*${type}\\s*\\(([^;]*)\\);`, "gi");
        for (const match of ifc.matchAll(pattern)) {
            const args = splitIfcArguments(match[1] ?? "");
            names.push(parseIfcStringLiteral(args[2], `${fallbackLabel} ${names.length + 1}`));
        }
    }
    return names;
}

function updateSelectedPlanNodeName(data: PlanCadSceneData, name: string) {
    return data.selectedNodeId
        ? updatePlanCadNodeData(data, data.selectedNodeId, {name} as Partial<PlanNode>)
        : data;
}

export function exportPlanCadIfc(data: PlanCadSceneData) {
    const body: string[] = [`/* ${encodeEmbeddedPayload(data)} */`];
    let id = 1;
    body.push(`#${id++}=IFCPROJECT(${ifcString(ifcGuid("stem_project"))},$,'StemStudio Plan/CAD',$,$,$,$,$,$);`);
    body.push(`#${id++}=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);`);

    for (const wall of getNodes<PlanWallNode>(data, "wall")) {
        body.push(`#${id++}=${PLAN_CAD_IFC_TYPES.wall}(${ifcString(ifcGuid(wall.id))},$,${ifcString(wall.name ?? wall.id)},$,$,$,$,$,$);`);
    }
    for (const slab of getNodes<PlanSlabNode>(data, "slab")) {
        body.push(`#${id++}=${PLAN_CAD_IFC_TYPES.slab}(${ifcString(ifcGuid(slab.id))},$,${ifcString(slab.name ?? slab.id)},$,$,$,$,$,.FLOOR.);`);
    }
    for (const zone of getNodes<PlanZoneNode>(data, "zone")) {
        body.push(`#${id++}=${PLAN_CAD_IFC_TYPES.zone}(${ifcString(ifcGuid(zone.id))},$,${ifcString(zone.name ?? zone.id)},$,$,$,$,$,$,$);`);
    }
    for (const item of getNodes<PlanItemNode>(data, "item")) {
        body.push(`#${id++}=${PLAN_CAD_IFC_TYPES.item}(${ifcString(ifcGuid(item.id))},$,${ifcString(item.name ?? item.id)},$,$,$,$,$);`);
    }

    return [
        "ISO-10303-21;",
        "HEADER;",
        "FILE_DESCRIPTION(('StemStudio Plan/CAD export'),'2;1');",
        `FILE_NAME('stem-plan-cad.ifc','${new Date(0).toISOString()}',('StemStudio'),('StemStudio'),'StemStudio','StemStudio','');`,
        "FILE_SCHEMA(('IFC4'));",
        "ENDSEC;",
        "DATA;",
        ...body,
        "ENDSEC;",
        "END-ISO-10303-21;",
        "",
    ].join("\n");
}

export function importPlanCadIfc(ifc: string): PlanCadSceneData {
    const embedded = decodeEmbeddedPayload(ifc);
    if (embedded) return embedded;

    let data = createDefaultPlanCadData();
    const wallNames = collectIfcEntityNames(ifc, ["IFCWALLSTANDARDCASE", "IFCWALL"], "IFC Wall");
    const slabNames = collectIfcEntityNames(ifc, ["IFCSLAB"], "IFC Slab");
    const zoneNames = collectIfcEntityNames(ifc, ["IFCSPACE"], "IFC Space");
    const itemNames = collectIfcEntityNames(ifc, ["IFCFURNISHINGELEMENT", "IFCBUILDINGELEMENTPROXY"], "IFC Item");

    wallNames.forEach((name, index) => {
        const z = index * 0.45;
        data = createPlanCadWall(data, {x: 0, z}, {x: 4, z});
        data = updateSelectedPlanNodeName(data, name);
    });

    slabNames.forEach((name, index) => {
        const offset = index * 0.35;
        data = createPlanCadPolygonSlab(data, [
            {x: offset, z: 1.2 + offset},
            {x: 4 + offset, z: 1.2 + offset},
            {x: 4 + offset, z: 4.2 + offset},
            {x: offset, z: 4.2 + offset},
        ]);
        data = updateSelectedPlanNodeName(data, name);
    });

    zoneNames.forEach((name, index) => {
        const offset = index * 0.3;
        data = createPlanCadPolygonZone(data, [
            {x: 0.4 + offset, z: 1.6 + offset},
            {x: 2.4 + offset, z: 1.6 + offset},
            {x: 2.4 + offset, z: 3.2 + offset},
            {x: 0.4 + offset, z: 3.2 + offset},
        ]);
        data = updateSelectedPlanNodeName(data, name);
    });

    itemNames.forEach((name, index) => {
        data = createPlanCadPart(data, {x: 0.8 + (index % 4) * 0.8, z: 4.8 + Math.floor(index / 4) * 0.8});
        if (data.selectedNodeId) {
            data = updatePlanCadNodeData(data, data.selectedNodeId, {
                name,
                tags: ["ifc", "imported"],
            } as Partial<PlanItemNode>);
        }
    });

    if (wallNames.length + slabNames.length + zoneNames.length + itemNames.length === 0) {
        throw new Error("IFC import found no supported wall, slab, space, or furnishing entities.");
    }

    return data;
}
