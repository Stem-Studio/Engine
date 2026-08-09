export type TransformVectorState = {
    x: number;
    y: number;
    z: number;
};

const serializeNumber = (value: number): string => Number.isFinite(value) ? String(value) : "null";
const parseNumber = (value: unknown): number => typeof value === "number" ? value : 0;

export function serializeTransformVectorState(value: TransformVectorState): string {
    return `{"x":${serializeNumber(value.x)},"y":${serializeNumber(value.y)},"z":${serializeNumber(value.z)}}`;
}

export function parseTransformVectorState(value: string): TransformVectorState {
    const parsed = JSON.parse(value) as Partial<TransformVectorState> & {
        _x?: unknown;
        _y?: unknown;
        _z?: unknown;
    };

    return {
        x: parseNumber(parsed.x ?? parsed._x),
        y: parseNumber(parsed.y ?? parsed._y),
        z: parseNumber(parsed.z ?? parsed._z),
    };
}
