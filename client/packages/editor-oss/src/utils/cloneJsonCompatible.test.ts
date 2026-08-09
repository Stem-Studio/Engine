import {afterEach, describe, expect, it, vi} from "vitest";

import {cloneJsonCompatible, jsonCompatibleEquals} from "./cloneJsonCompatible";

describe("cloneJsonCompatible", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("deep clones JSON-compatible data without stringifying", () => {
        const stringify = vi.spyOn(JSON, "stringify");
        const source = {
            name: "metadata",
            nested: {count: 2},
            list: [{enabled: true}],
        };

        const clone = cloneJsonCompatible(source);

        expect(stringify).not.toHaveBeenCalled();
        expect(clone).toEqual(source);
        expect(clone).not.toBe(source);
        expect(clone.nested).not.toBe(source.nested);
        expect(clone.list).not.toBe(source.list);
        expect(clone.list[0]).not.toBe(source.list[0]);
    });

    it("keeps JSON clone semantics for unsupported values", () => {
        const source = {
            keep: "value",
            dropUndefined: undefined,
            dropFunction: () => "ignored",
            dropSymbol: Symbol("ignored"),
            invalidNumbers: [Number.NaN, Infinity, -Infinity],
            arrayUnsupported: [undefined, () => "ignored", Symbol("ignored")],
        };

        expect(cloneJsonCompatible(source)).toEqual({
            keep: "value",
            invalidNumbers: [null, null, null],
            arrayUnsupported: [null, null, null],
        });
    });

    it("uses toJSON hooks such as Date serialization", () => {
        const date = new Date("2026-07-09T12:00:00.000Z");

        expect(cloneJsonCompatible({date})).toEqual({
            date: "2026-07-09T12:00:00.000Z",
        });
    });

    it("throws on circular structures like JSON.stringify", () => {
        const source: Record<string, unknown> = {};
        source.self = source;

        expect(() => cloneJsonCompatible(source)).toThrow("Converting circular structure to JSON");
    });

    it("compares JSON-compatible values without stringifying", () => {
        const stringify = vi.spyOn(JSON, "stringify");
        const date = new Date("2026-07-09T12:00:00.000Z");

        expect(jsonCompatibleEquals({assetId: "a", revisionId: "r"}, {assetId: "a", revisionId: "r"})).toBe(true);
        expect(jsonCompatibleEquals(["px", {assetId: "a"}], ["px", {assetId: "a"}])).toBe(true);
        expect(jsonCompatibleEquals(["px", {assetId: "a"}], ["px", {assetId: "b"}])).toBe(false);
        expect(jsonCompatibleEquals({ignored: undefined}, {})).toBe(true);
        expect(jsonCompatibleEquals({}, {ignored: undefined})).toBe(true);
        expect(jsonCompatibleEquals({ignored: undefined}, {ignored: "kept"})).toBe(false);
        expect(jsonCompatibleEquals([undefined, Number.NaN], [null, null])).toBe(true);
        expect(jsonCompatibleEquals({date}, {date: "2026-07-09T12:00:00.000Z"})).toBe(true);
        expect(jsonCompatibleEquals(Number.NaN, null)).toBe(true);
        expect(stringify).not.toHaveBeenCalled();
    });

    it("throws on circular equality inputs like JSON.stringify", () => {
        const left: Record<string, unknown> = {};
        const right: Record<string, unknown> = {};
        left.self = left;
        right.self = right;

        expect(() => jsonCompatibleEquals(left, right)).toThrow("Converting circular structure to JSON");
        expect(() => jsonCompatibleEquals(left, left)).toThrow("Converting circular structure to JSON");
    });
});
