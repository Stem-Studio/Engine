import type {BufferGeometry} from "three";

type GeometryAttributeLike = {
    itemSize?: number;
    count?: number;
    normalized?: boolean;
    offset?: number;
    version?: number;
    gpuType?: number;
    array?: ArrayBufferView;
    data?: {
        array?: ArrayBufferView;
        stride?: number;
        version?: number;
    };
};

type AttributeRevision = {
    name: string;
    attribute: GeometryAttributeLike;
    version: number;
};

export type GeometryRevisionSnapshot = {
    index: GeometryAttributeLike | null;
    indexVersion: number;
    attributes: AttributeRevision[];
    morphAttributes: AttributeRevision[];
    morphTargetsRelative: boolean;
    drawRangeStart: number;
    drawRangeCount: number;
    groups: number[];
};

const attributeIds = new WeakMap<object, number>();
let nextAttributeId = 1;

function getAttributeId(attribute: object): number {
    let id = attributeIds.get(attribute);
    if (id === undefined) {
        id = nextAttributeId++;
        attributeIds.set(attribute, id);
    }
    return id;
}

function getAttributeArray(attribute: GeometryAttributeLike): ArrayBufferView | undefined {
    return attribute.array ?? attribute.data?.array;
}

function getAttributeVersion(attribute: GeometryAttributeLike): number {
    return attribute.version ?? attribute.data?.version ?? 0;
}

function getMorphAttributes(
    geometry: BufferGeometry,
): Record<string, readonly GeometryAttributeLike[] | undefined> {
    return geometry.morphAttributes as unknown as Record<
        string,
        readonly GeometryAttributeLike[] | undefined
    >;
}

function fnv1a(view: ArrayBufferView): string {
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    let hashA = 0x811c9dc5;
    let hashB = 0x9e3779b9;

    for (let i = 0; i < bytes.length; i++) {
        const byte = bytes[i]!;
        hashA ^= byte;
        hashA += (hashA << 1) + (hashA << 4) + (hashA << 7) + (hashA << 8) + (hashA << 24);
        hashB ^= byte;
        hashB += (hashB << 1) + (hashB << 4) + (hashB << 7) + (hashB << 8) + (hashB << 24);
    }

    return `${(hashA >>> 0).toString(16).padStart(8, "0")}${(hashB >>> 0).toString(16).padStart(8, "0")}`;
}

function hashParts(parts: string[]): string {
    let hashA = 0x811c9dc5;
    let hashB = 0x9e3779b9;
    for (const part of parts) {
        for (let i = 0; i < part.length; i++) {
            const code = part.charCodeAt(i);
            hashA ^= code;
            hashA += (hashA << 1) + (hashA << 4) + (hashA << 7) + (hashA << 8) + (hashA << 24);
            hashB ^= code;
            hashB += (hashB << 1) + (hashB << 4) + (hashB << 7) + (hashB << 8) + (hashB << 24);
        }
        hashA ^= 0xff;
        hashA += (hashA << 1) + (hashA << 4) + (hashA << 7) + (hashA << 8) + (hashA << 24);
        hashB ^= 0xff;
        hashB += (hashB << 1) + (hashB << 4) + (hashB << 7) + (hashB << 8) + (hashB << 24);
    }
    return `${(hashA >>> 0).toString(16).padStart(8, "0")}${(hashB >>> 0).toString(16).padStart(8, "0")}`;
}

function getAttributeDescriptor(
    name: string,
    attribute: GeometryAttributeLike,
    arrayHashes: Map<ArrayBufferView, string>,
): string {
    const array = getAttributeArray(attribute);
    let arrayHash = `identity-${getAttributeId(attribute)}`;
    if (array) {
        arrayHash = arrayHashes.get(array) ?? fnv1a(array);
        arrayHashes.set(array, arrayHash);
    }
    return [
        name,
        attribute.itemSize ?? 0,
        attribute.count ?? 0,
        attribute.normalized ? 1 : 0,
        attribute.offset ?? 0,
        attribute.data?.stride ?? 0,
        attribute.gpuType ?? 0,
        array?.constructor.name ?? "none",
        arrayHash,
    ].join(":");
}

function getAttributeRevisionDescriptor(name: string, attribute: GeometryAttributeLike): string {
    const array = getAttributeArray(attribute);
    return [
        name,
        getAttributeId(attribute),
        getAttributeVersion(attribute),
        attribute.itemSize ?? 0,
        attribute.count ?? 0,
        attribute.normalized ? 1 : 0,
        attribute.offset ?? 0,
        attribute.data?.stride ?? 0,
        attribute.gpuType ?? 0,
        array?.constructor.name ?? "none",
        array?.byteLength ?? 0,
    ].join(":");
}

function appendAttributes(
    parts: string[],
    prefix: string,
    attributes: Record<string, GeometryAttributeLike | undefined>,
    arrayHashes: Map<ArrayBufferView, string>,
): void {
    const names = Object.keys(attributes).sort();
    for (const name of names) {
        const attribute = attributes[name];
        if (attribute) parts.push(getAttributeDescriptor(`${prefix}${name}`, attribute, arrayHashes));
    }
}

function appendAttributeRevisions(
    parts: string[],
    prefix: string,
    attributes: Record<string, GeometryAttributeLike | undefined>,
): void {
    const names = Object.keys(attributes).sort();
    for (const name of names) {
        const attribute = attributes[name];
        if (attribute) parts.push(getAttributeRevisionDescriptor(`${prefix}${name}`, attribute));
    }
}

function appendMorphAttributes(
    parts: string[],
    geometry: BufferGeometry,
    arrayHashes?: Map<ArrayBufferView, string>,
): void {
    const morphAttributes = getMorphAttributes(geometry);
    const names = Object.keys(morphAttributes).sort();
    for (const name of names) {
        const attributes = morphAttributes[name] ?? [];
        for (let i = 0; i < attributes.length; i++) {
            const attribute = attributes[i] as GeometryAttributeLike | undefined;
            if (!attribute) continue;
            const key = `morph.${name}.${i}`;
            parts.push(
                arrayHashes ?
                    getAttributeDescriptor(key, attribute, arrayHashes) :
                    getAttributeRevisionDescriptor(key, attribute),
            );
        }
    }
}

function appendGeometryMetadata(parts: string[], geometry: BufferGeometry): void {
    parts.push(`morphRelative:${geometry.morphTargetsRelative ? 1 : 0}`);
    parts.push(`drawRange:${geometry.drawRange.start}:${geometry.drawRange.count}`);
    for (let i = 0; i < geometry.groups.length; i++) {
        const group = geometry.groups[i]!;
        parts.push(`group:${i}:${group.start}:${group.count}:${group.materialIndex ?? 0}`);
    }
}

function collectAttributeRevisions(
    attributes: Record<string, GeometryAttributeLike | undefined>,
    prefix = "",
): AttributeRevision[] {
    const revisions: AttributeRevision[] = [];
    for (const name in attributes) {
        const attribute = attributes[name];
        if (attribute) {
            revisions.push({name: `${prefix}${name}`, attribute, version: getAttributeVersion(attribute)});
        }
    }
    return revisions;
}

/**
 * Captures render-relevant attribute identities and revisions without copying buffer data.
 */
export function createGeometryRevisionSnapshot(geometry: BufferGeometry): GeometryRevisionSnapshot {
    const morphAttributes: AttributeRevision[] = [];
    const geometryMorphAttributes = getMorphAttributes(geometry);
    for (const name in geometryMorphAttributes) {
        const attributes = geometryMorphAttributes[name] ?? [];
        for (let i = 0; i < attributes.length; i++) {
            const attribute = attributes[i] as GeometryAttributeLike | undefined;
            if (attribute) {
                morphAttributes.push({
                    name: `${name}.${i}`,
                    attribute,
                    version: getAttributeVersion(attribute),
                });
            }
        }
    }

    const groups: number[] = [];
    for (const group of geometry.groups) {
        groups.push(group.start, group.count, group.materialIndex ?? 0);
    }
    const index = geometry.index as GeometryAttributeLike | null;
    return {
        index,
        indexVersion: index ? getAttributeVersion(index) : 0,
        attributes: collectAttributeRevisions(
            geometry.attributes as Record<string, GeometryAttributeLike>,
        ),
        morphAttributes,
        morphTargetsRelative: geometry.morphTargetsRelative,
        drawRangeStart: geometry.drawRange.start,
        drawRangeCount: geometry.drawRange.count,
        groups,
    };
}

/**
 * Checks a geometry against a previous revision snapshot without allocating hot-path storage.
 */
export function isGeometryRevisionCurrent(
    geometry: BufferGeometry,
    snapshot: GeometryRevisionSnapshot,
): boolean {
    const index = geometry.index as GeometryAttributeLike | null;
    if (index !== snapshot.index || (index ? getAttributeVersion(index) : 0) !== snapshot.indexVersion) return false;

    let attributeIndex = 0;
    for (const name in geometry.attributes) {
        const attribute = geometry.attributes[name] as GeometryAttributeLike | undefined;
        if (!attribute) continue;
        const previous = snapshot.attributes[attributeIndex++];
        if (
            !previous ||
            previous.name !== name ||
            previous.attribute !== attribute ||
            previous.version !== getAttributeVersion(attribute)
        ) return false;
    }
    if (attributeIndex !== snapshot.attributes.length) return false;

    let morphIndex = 0;
    const morphAttributes = getMorphAttributes(geometry);
    for (const name in morphAttributes) {
        const attributes = morphAttributes[name] ?? [];
        for (let i = 0; i < attributes.length; i++) {
            const attribute = attributes[i] as GeometryAttributeLike | undefined;
            if (!attribute) continue;
            const previous = snapshot.morphAttributes[morphIndex++];
            if (
                !previous ||
                previous.name !== `${name}.${i}` ||
                previous.attribute !== attribute ||
                previous.version !== getAttributeVersion(attribute)
            ) return false;
        }
    }
    if (morphIndex !== snapshot.morphAttributes.length) return false;

    if (
        geometry.morphTargetsRelative !== snapshot.morphTargetsRelative ||
        geometry.drawRange.start !== snapshot.drawRangeStart ||
        geometry.drawRange.count !== snapshot.drawRangeCount ||
        geometry.groups.length * 3 !== snapshot.groups.length
    ) return false;
    for (let i = 0; i < geometry.groups.length; i++) {
        const group = geometry.groups[i]!;
        const offset = i * 3;
        if (
            group.start !== snapshot.groups[offset] ||
            group.count !== snapshot.groups[offset + 1] ||
            (group.materialIndex ?? 0) !== snapshot.groups[offset + 2]
        ) return false;
    }
    return true;
}

/**
 * Returns a cheap identity/version signature used to invalidate cached full hashes.
 */
export function getGeometryHashSignature(geometry: BufferGeometry): string {
    const parts: string[] = [];
    const index = geometry.index as GeometryAttributeLike | null;
    if (index) parts.push(getAttributeRevisionDescriptor("index", index));
    appendAttributeRevisions(parts, "attribute.", geometry.attributes as Record<string, GeometryAttributeLike>);
    appendMorphAttributes(parts, geometry);
    appendGeometryMetadata(parts, geometry);
    return parts.join("|");
}

/**
 * Computes a deterministic hash from every render-relevant geometry attribute and layout field.
 */
export function hashGeometry(geometry: BufferGeometry): string {
    const parts: string[] = [];
    const arrayHashes = new Map<ArrayBufferView, string>();
    const index = geometry.index as GeometryAttributeLike | null;
    if (index) parts.push(getAttributeDescriptor("index", index, arrayHashes));
    appendAttributes(
        parts,
        "attribute.",
        geometry.attributes as Record<string, GeometryAttributeLike>,
        arrayHashes,
    );
    appendMorphAttributes(parts, geometry, arrayHashes);
    appendGeometryMetadata(parts, geometry);
    return hashParts(parts);
}
