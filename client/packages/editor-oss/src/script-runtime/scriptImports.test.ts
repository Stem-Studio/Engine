import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {
    buildNameAwareScriptImportContext,
    buildScriptImportAliases,
    getScriptImportDependencies,
    loadScriptImportRevisionMap,
    loadReferencedScriptImportRevisionMap,
    parseScriptImports,
    remapScriptImportSpecifiers,
} from "./scriptImports";

const mockGetImportRevisionData = vi.fn();
const mockGetSceneAssets = vi.fn();

vi.mock("@stem/network/api/asset", () => ({
    AssetType: {
        Script: "script",
    },
    getSceneAssets: (...args: unknown[]) => mockGetSceneAssets(...args),
}));

vi.mock("@stem/network/api/script", () => ({
    getScriptRevisionData: (...args: unknown[]) => mockGetImportRevisionData(...args),
}));

vi.mock("../utils/featureFlags", () => ({
    isScriptsEnabled: () => true,
}));

describe("scriptImports", () => {
    const context = {
        assetIdToRevisionId: {
            helperAsset: "helperRev",
            nestedAsset: "nestedRev",
        },
        logicalIdToAssetId: {
            helper: "helperAsset",
            nested: "nestedAsset",
        },
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockGetSceneAssets.mockResolvedValue({assets: []});
    });

    afterEach(() => {
        delete (globalThis as Record<string, unknown>).Compartment;
    });

    it("parses valid directives and preserves code line offsets", () => {
        const parsed = parseScriptImports('@import "helper" as math\nfunction run() {\n  return math.clamp();\n}');

        expect(parsed.errors).toEqual([]);
        expect(parsed.directives).toEqual([
            expect.objectContaining({
                specifier: "helper",
                alias: "math",
                lineNumber: 1,
            }),
        ]);
        expect(parsed.code).toBe('\nfunction run() {\n  return math.clamp();\n}');
    });

    it("rejects malformed directives and duplicate aliases", () => {
        const malformed = parseScriptImports('@import "helper"\n');
        expect(malformed.errors[0]?.message).toContain('Invalid @import directive');

        const duplicate = parseScriptImports('@import "helper" as utils\n@import "nested" as utils');
        expect(duplicate.errors[0]?.message).toContain('Duplicate import alias "utils"');
    });

    it("resolves logical ids into asset dependencies", () => {
        expect(getScriptImportDependencies('@import "helper" as math', context)).toEqual([
            {
                assetId: "helperAsset",
                revisionId: "helperRev",
                specifier: "helper",
                alias: "math",
            },
        ]);
    });

    it("resolves import-module names from the scene context, case-insensitively", async () => {
        mockGetSceneAssets.mockResolvedValue({
            assets: [
                {
                    id: "helperAsset",
                    name: "Maths",
                },
            ],
        });

        const nameAwareContext = await buildNameAwareScriptImportContext("scene-1", {
            assetIdToRevisionId: {
                helperAsset: "helperRev",
            },
        });

        expect(getScriptImportDependencies('@import "maths" as math', nameAwareContext)).toEqual([
            {
                assetId: "helperAsset",
                revisionId: "helperRev",
                specifier: "maths",
                alias: "math",
            },
        ]);
    });

    it("remaps only concrete asset-id specifiers", () => {
        const source = [
            '@import "0123456789abcdef01234567" as byId',
            '@import "helper" as logical',
        ].join("\n");

        expect(
            remapScriptImportSpecifiers(source, assetId =>
                assetId === "0123456789abcdef01234567" ? "fedcba987654321001234567" : assetId,
            ),
        ).toBe(['@import "fedcba987654321001234567" as byId', '@import "helper" as logical'].join("\n"));
    });

    it("loads transitive import revisions and rejects cycles", async () => {
        mockGetImportRevisionData.mockImplementation((assetId: string, revisionId: string) => {
            if (assetId === "helperAsset" && revisionId === "helperRev") {
                return {code: '@import "nested" as nested\nfunction clamp(v) { return nested.scale(v); }'};
            }
            if (assetId === "nestedAsset" && revisionId === "nestedRev") {
                return {code: "function scale(v) { return v * 2; }"};
            }

            throw new Error(`unexpected import fetch: ${assetId}:${revisionId}`);
        });

        const revisionMap = await loadScriptImportRevisionMap('@import "helper" as math', context);
        expect(revisionMap).toMatchObject({
            "helperAsset:helperRev": {
                assetId: "helperAsset",
                revisionId: "helperRev",
            },
            "nestedAsset:nestedRev": {
                assetId: "nestedAsset",
                revisionId: "nestedRev",
            },
        });

        mockGetImportRevisionData.mockImplementation((assetId: string) => {
            if (assetId === "helperAsset") {
                return {code: '@import "nested" as nested\nfunction clamp(v) { return nested.scale(v); }'};
            }
            if (assetId === "nestedAsset") {
                return {code: '@import "helper" as helper\nfunction scale(v) { return helper.clamp(v); }'};
            }

            throw new Error(`unexpected import fetch: ${assetId}`);
        });

        await expect(loadScriptImportRevisionMap('@import "helper" as math', context)).rejects.toThrow(
            "Import cycle detected",
        );
    });

    it("returns only revisions reachable from the source when an existing bundle map is provided", async () => {
        const existing = {
            "helperAsset:helperRev": {
                assetId: "helperAsset",
                revisionId: "helperRev",
                code: '@import "nested" as nested\nfunction clamp(v) { return nested.scale(v); }',
            },
            "nestedAsset:nestedRev": {
                assetId: "nestedAsset",
                revisionId: "nestedRev",
                code: "function scale(v) { return v * 2; }",
            },
            "unusedAsset:unusedRev": {
                assetId: "unusedAsset",
                revisionId: "unusedRev",
                code: "function unused() { return true; }",
            },
        };

        const revisionMap = await loadReferencedScriptImportRevisionMap('@import "helper" as math', context, existing);

        expect(Object.keys(revisionMap).sort()).toEqual(["helperAsset:helperRev", "nestedAsset:nestedRev"]);
        expect(mockGetImportRevisionData).not.toHaveBeenCalled();
    });

    it("fetches missing transitive revisions while still returning a compact reachable map", async () => {
        mockGetImportRevisionData.mockResolvedValue({
            code: "function scale(v) { return v * 2; }",
        });
        const existing = {
            "helperAsset:helperRev": {
                assetId: "helperAsset",
                revisionId: "helperRev",
                code: '@import "nested" as nested\nfunction clamp(v) { return nested.scale(v); }',
            },
            "unusedAsset:unusedRev": {
                assetId: "unusedAsset",
                revisionId: "unusedRev",
                code: "function unused() { return true; }",
            },
        };

        const revisionMap = await loadReferencedScriptImportRevisionMap('@import "helper" as math', context, existing);

        expect(Object.keys(revisionMap).sort()).toEqual(["helperAsset:helperRev", "nestedAsset:nestedRev"]);
        expect(mockGetImportRevisionData).toHaveBeenCalledWith("nestedAsset", "nestedRev");
    });

    it("builds alias-scoped module objects without leaking non-function values", () => {
        const aliases = buildScriptImportAliases({
            source: '@import "helper" as math',
            context,
            importRevisionMap: {
                "helperAsset:helperRev": {
                    assetId: "helperAsset",
                    revisionId: "helperRev",
                    code: "const hidden = 1;\nfunction clamp(v) { return Math.max(0, v); }",
                },
            },
            runtimeEndowments: {Math},
        });

        expect(Object.keys(aliases.math ?? {})).toEqual(["clamp"]);
        expect((aliases.math?.clamp as (value: number) => number)(-4)).toBe(0);
        expect((aliases.math as Record<string, unknown>).hidden).toBeUndefined();
    });

    it("keeps imported module state scoped to each alias build when factories are cached", () => {
        const importRevisionMap = {
            "helperAsset:helperRev": {
                assetId: "helperAsset",
                revisionId: "helperRev",
                code: "let count = 0;\nfunction next() { count += 1; return count; }",
            },
        };

        const first = buildScriptImportAliases({
            source: '@import "helper" as helper',
            context,
            importRevisionMap,
        });
        const second = buildScriptImportAliases({
            source: '@import "helper" as helper',
            context,
            importRevisionMap,
        });

        expect((first.helper?.next as () => number)()).toBe(1);
        expect((first.helper?.next as () => number)()).toBe(2);
        expect((second.helper?.next as () => number)()).toBe(1);
    });

    it("supports Compartment-backed import modules", () => {
        class TestCompartment {
            constructor(private readonly endowments: Record<string, unknown>) {}

            evaluate(code: string) {
                // eslint-disable-next-line @typescript-eslint/no-implied-eval -- test stub mimics SES Compartment evaluation
                return new Function(...Object.keys(this.endowments), `return ${code};`)(
                    ...Object.values(this.endowments),
                );
            }
        }

        (globalThis as Record<string, unknown>).Compartment = TestCompartment;

        const aliases = buildScriptImportAliases({
            source: '@import "helper" as math',
            context,
            importRevisionMap: {
                "helperAsset:helperRev": {
                    assetId: "helperAsset",
                    revisionId: "helperRev",
                    code: "function clamp(v) { return Math.max(0, v); }",
                },
            },
            runtimeEndowments: {Math},
            useCompartment: true,
        });

        expect((aliases.math?.clamp as (value: number) => number)(3)).toBe(3);
    });
});
