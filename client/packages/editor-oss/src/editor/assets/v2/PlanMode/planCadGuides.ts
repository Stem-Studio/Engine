import type {PlanCadSceneData, PlanCadToolId} from "./planCadEditorBridge";
import type {PlanItemNode, PlanPoint2, PlanSlabNode, PlanWallNode, PlanZoneNode} from "./planCadCore";
import {UNIT_LABELS, UNITS} from "@stem/editor-oss/units/constants";
import type {UnitsSettings} from "@stem/editor-oss/units/constants";

export type PlanCadSnapKind = "endpoint" | "midpoint" | "vertex" | "center";

export interface PlanCadSnapCandidate {
    point: PlanPoint2;
    kind: PlanCadSnapKind;
    label: string;
    nodeId: string;
}

export interface PlanCadSnapResult {
    point: PlanPoint2;
    snap: (PlanCadSnapCandidate & {distance: number}) | null;
}

export interface PlanCadMeasurement {
    primary: string;
    secondary?: string;
    snapLabel?: string;
}

export interface PlanCadOpeningPlacement {
    wallId: string;
    point: PlanPoint2;
    t: number;
    distance: number;
    offset: number;
    wallLength: number;
    angleRadians: number;
}

export interface PlanCadMeasurementInput {
    tool: PlanCadToolId;
    anchorPoint?: PlanPoint2 | null;
    polygonPoints?: PlanPoint2[];
    currentPoint?: PlanPoint2 | null;
    snap?: PlanCadSnapResult["snap"];
    openingPlacement?: PlanCadOpeningPlacement | null;
    unitsSettings?: UnitsSettings;
}

export function planPointDistanceSq(a: PlanPoint2, b: PlanPoint2) {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return dx * dx + dz * dz;
}

function planPointDistance(a: PlanPoint2, b: PlanPoint2) {
    return Math.sqrt(planPointDistanceSq(a, b));
}

function polygonArea(points: PlanPoint2[]) {
    if (points.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const current = points[i]!;
        const next = points[(i + 1) % points.length]!;
        area += current.x * next.z - next.x * current.z;
    }
    return Math.abs(area) / 2;
}

function polygonPerimeter(points: PlanPoint2[]) {
    if (points.length < 2) return 0;
    let perimeter = 0;
    for (let i = 0; i < points.length; i++) {
        const nextIndex = i === points.length - 1 ? 0 : i + 1;
        perimeter += planPointDistance(points[i]!, points[nextIndex]!);
    }
    return perimeter;
}

function draftPathLength(points: PlanPoint2[]) {
    if (points.length < 2) return 0;
    let length = 0;
    for (let i = 1; i < points.length; i++) {
        length += planPointDistance(points[i - 1]!, points[i]!);
    }
    return length;
}

function formatNumber(value: number, digits = 2) {
    return value.toFixed(digits);
}

function displayLength(valueInMeters: number, unitsSettings?: UnitsSettings) {
    if (!unitsSettings?.enabled) return {value: valueInMeters, label: "m", factor: 1};
    const factor = UNITS[unitsSettings.currentUnit] ?? 1;
    return {
        value: valueInMeters / factor,
        label: UNIT_LABELS[unitsSettings.currentUnit] ?? "m",
        factor,
    };
}

export function formatPlanMeters(value: number, unitsSettings?: UnitsSettings) {
    const display = displayLength(value, unitsSettings);
    return `${formatNumber(display.value, Math.abs(display.value) >= 10 ? 1 : 2)} ${display.label}`;
}

export function formatPlanArea(value: number, unitsSettings?: UnitsSettings) {
    const length = displayLength(1, unitsSettings);
    const area = value / (length.factor * length.factor);
    return `${formatNumber(area, Math.abs(area) >= 10 ? 1 : 2)} sq ${length.label}`;
}

function formatPlanAngleRadians(value: number) {
    const normalized = Math.round((value * 180) / Math.PI);
    return `${normalized} deg`;
}

function midpoint(start: PlanPoint2, end: PlanPoint2): PlanPoint2 {
    return {x: (start.x + end.x) / 2, z: (start.z + end.z) / 2};
}

function segmentProjectionT(point: PlanPoint2, wall: PlanWallNode) {
    const dx = wall.end.x - wall.start.x;
    const dz = wall.end.z - wall.start.z;
    const lengthSq = dx * dx + dz * dz || 0.000001;
    return Math.max(0, Math.min(1, ((point.x - wall.start.x) * dx + (point.z - wall.start.z) * dz) / lengthSq));
}

function wallLength(wall: PlanWallNode) {
    return planPointDistance(wall.start, wall.end);
}

function wallAngle(wall: PlanWallNode) {
    return Math.atan2(wall.end.z - wall.start.z, wall.end.x - wall.start.x);
}

function wallPointAt(wall: PlanWallNode, t: number): PlanPoint2 {
    return {
        x: wall.start.x + (wall.end.x - wall.start.x) * t,
        z: wall.start.z + (wall.end.z - wall.start.z) * t,
    };
}

function centroid(points: PlanPoint2[]): PlanPoint2 | null {
    if (points.length === 0) return null;
    const total = points.reduce(
        (sum, point) => ({x: sum.x + point.x, z: sum.z + point.z}),
        {x: 0, z: 0},
    );
    return {x: total.x / points.length, z: total.z / points.length};
}

function nodeIsOnActiveLevel(data: PlanCadSceneData, parentId: string | null) {
    return !data.activeLevelId || parentId === data.activeLevelId;
}

function addWallSnapCandidates(candidates: PlanCadSnapCandidate[], wall: PlanWallNode) {
    candidates.push(
        {point: wall.start, kind: "endpoint", label: "Wall endpoint", nodeId: wall.id},
        {point: wall.end, kind: "endpoint", label: "Wall endpoint", nodeId: wall.id},
        {point: midpoint(wall.start, wall.end), kind: "midpoint", label: "Wall midpoint", nodeId: wall.id},
    );
}

function addPolygonSnapCandidates(
    candidates: PlanCadSnapCandidate[],
    node: PlanSlabNode | PlanZoneNode,
    labelPrefix: "Room" | "Zone",
) {
    for (const point of node.points) {
        candidates.push({point, kind: "vertex", label: `${labelPrefix} vertex`, nodeId: node.id});
    }
    const center = centroid(node.points);
    if (center) {
        candidates.push({point: center, kind: "center", label: `${labelPrefix} center`, nodeId: node.id});
    }
}

function addItemSnapCandidate(candidates: PlanCadSnapCandidate[], node: PlanItemNode) {
    candidates.push({
        point: {x: node.position.x, z: node.position.z},
        kind: "center",
        label: "Object center",
        nodeId: node.id,
    });
}

export function collectPlanCadSnapCandidates(data: PlanCadSceneData | null | undefined) {
    const candidates: PlanCadSnapCandidate[] = [];
    if (!data) return candidates;

    for (const node of Object.values(data.nodes)) {
        if (!nodeIsOnActiveLevel(data, node.parentId)) continue;
        if (node.type === "wall") addWallSnapCandidates(candidates, node);
        if (node.type === "slab") addPolygonSnapCandidates(candidates, node, "Room");
        if (node.type === "zone") addPolygonSnapCandidates(candidates, node, "Zone");
        if (node.type === "item") addItemSnapCandidate(candidates, node);
    }

    return candidates;
}

export function snapPlanPointToGuides(
    data: PlanCadSceneData | null | undefined,
    point: PlanPoint2,
    threshold = 0.2,
): PlanCadSnapResult {
    const thresholdSq = threshold * threshold;
    let best: (PlanCadSnapCandidate & {distance: number}) | null = null;

    for (const candidate of collectPlanCadSnapCandidates(data)) {
        const distanceSq = planPointDistanceSq(point, candidate.point);
        if (distanceSq > thresholdSq) continue;
        const distance = Math.sqrt(distanceSq);
        if (!best || distance < best.distance) {
            best = {...candidate, point: {...candidate.point}, distance};
        }
    }

    return best ? {point: {...best.point}, snap: best} : {point: {...point}, snap: null};
}

export function getPlanCadOpeningPlacement(
    data: PlanCadSceneData | null | undefined,
    point: PlanPoint2,
    explicitWallId?: string,
    maxDistance = 0.5,
): PlanCadOpeningPlacement | null {
    if (!data) return null;
    const walls = Object.values(data.nodes).filter(
        (node): node is PlanWallNode =>
            node.type === "wall" && nodeIsOnActiveLevel(data, node.parentId),
    );
    if (walls.length === 0) return null;

    const wallCandidates = explicitWallId
        ? walls.filter(wall => wall.id === explicitWallId)
        : walls;

    let best: PlanCadOpeningPlacement | null = null;
    for (const wall of wallCandidates) {
        const t = segmentProjectionT(point, wall);
        const projected = wallPointAt(wall, t);
        const distance = planPointDistance(point, projected);
        if (!explicitWallId && distance > maxDistance) continue;

        const length = wallLength(wall);
        const placement = {
            wallId: wall.id,
            point: projected,
            t,
            distance,
            offset: length * t,
            wallLength: length,
            angleRadians: wallAngle(wall),
        };
        if (!best || placement.distance < best.distance) best = placement;
    }

    return best;
}

export function measurePlanSegment(start: PlanPoint2, end: PlanPoint2) {
    const length = planPointDistance(start, end);
    return {
        length,
        angleRadians: Math.atan2(end.z - start.z, end.x - start.x),
    };
}

export function measurePlanPolygon(points: PlanPoint2[]) {
    return {
        area: polygonArea(points),
        perimeter: polygonPerimeter(points),
        draftLength: draftPathLength(points),
    };
}

function coordinateLabel(point: PlanPoint2, unitsSettings?: UnitsSettings) {
    return `X ${formatPlanMeters(point.x, unitsSettings)} / Z ${formatPlanMeters(point.z, unitsSettings)}`;
}

export function getPlanCadToolMeasurement(input: PlanCadMeasurementInput): PlanCadMeasurement | null {
    const current = input.currentPoint;
    if (!current) return null;

    const snapLabel = input.snap?.label;
    const unitsSettings = input.unitsSettings;
    if (input.tool === "wall" && input.anchorPoint) {
        const segment = measurePlanSegment(input.anchorPoint, current);
        if (segment.length <= 0.001) {
            return {primary: "Start point", secondary: coordinateLabel(current, unitsSettings), snapLabel};
        }
        return {
            primary: `Length ${formatPlanMeters(segment.length, unitsSettings)}`,
            secondary: `Angle ${formatPlanAngleRadians(segment.angleRadians)}`,
            snapLabel,
        };
    }

    if ((input.tool === "room" || input.tool === "zone") && input.polygonPoints?.length) {
        const points = [...input.polygonPoints, current];
        if (points.length >= 3) {
            const polygon = measurePlanPolygon(points);
            return {
                primary: `Area ${formatPlanArea(polygon.area, unitsSettings)}`,
                secondary: `Perimeter ${formatPlanMeters(polygon.perimeter, unitsSettings)}`,
                snapLabel,
            };
        }
        const segment = measurePlanSegment(points[0]!, current);
        return {
            primary: `Edge ${formatPlanMeters(segment.length, unitsSettings)}`,
            secondary: `${points.length} points`,
            snapLabel,
        };
    }

    if (input.tool === "door" || input.tool === "window") {
        if (input.openingPlacement) {
            return {
                primary: input.tool === "door" ? "Door on wall" : "Window on wall",
                secondary: `${formatPlanMeters(input.openingPlacement.offset, unitsSettings)} from start`,
                snapLabel,
            };
        }
        return {
            primary: input.tool === "door" ? "Door needs wall" : "Window needs wall",
            secondary: "No wall near cursor",
            snapLabel,
        };
    }

    if (input.tool === "part") {
        return {
            primary: "Object placement",
            secondary: coordinateLabel(current, unitsSettings),
            snapLabel,
        };
    }

    return null;
}
