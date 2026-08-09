import {AssetType, getSceneAssets} from "@stem/network/api/asset";
import {getScriptRevisionData} from "@stem/network/api/script";
import {assetRefKey} from "@stem/editor-oss/asset-management/AssetRef";
import {
    emptyAssetResolutionContext,
    resolveAssetId,
    resolveAssetRevisionId,
    type ReadonlyAssetResolutionContext,
} from "@stem/editor-oss/asset-management/AssetResolutionContext";
import {isScriptsEnabled} from "@stem/editor-oss/utils/featureFlags";

export interface ScriptImportDirective {
    specifier: string;
    alias: string;
    lineNumber: number;
    raw: string;
}

export interface ScriptImportParseError {
    lineNumber: number;
    column: number;
    message: string;
}

export interface ParsedScriptImports {
    code: string;
    directives: ScriptImportDirective[];
    errors: ScriptImportParseError[];
}

export interface ScriptImportDependency {
    assetId: string;
    revisionId: string;
    specifier: string;
    alias: string;
}

export interface ScriptImportRevisionData {
    assetId: string;
    revisionId: string;
    code: string;
}

export type ScriptImportRevisionMap = Record<string, ScriptImportRevisionData>;

const IMPORT_DIRECTIVE_RE = /^(\s*)@import\s+(['"])([^"']+)\2\s+as\s+([A-Za-z_$][\w$]*)\s*;?\s*$/;
const PARSED_SCRIPT_IMPORT_CACHE_LIMIT = 512;
const parsedScriptImportCache = new Map<string, ParsedScriptImports>();

const hashString = (value: string): string => {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
};

const rememberCacheEntry = <T>(cache: Map<string, T>, key: string, value: T, limit: number): T => {
    cache.set(key, value);
    if (cache.size > limit) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey !== undefined) {
            cache.delete(oldestKey);
        }
    }
    return value;
};

const buildDirectiveError = (lineNumber: number, line: string, message: string): ScriptImportParseError => ({
    lineNumber,
    column: Math.max(line.indexOf("@import"), 0) + 1,
    message,
});

export const parseScriptImports = (source: string): ParsedScriptImports => {
    const directives: ScriptImportDirective[] = [];
    const errors: ScriptImportParseError[] = [];
    const seenAliases = new Map<string, number>();
    const strippedLines = source.split("\n").map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith("@import")) {
            return line;
        }

        const match = line.match(IMPORT_DIRECTIVE_RE);
        if (!match) {
            errors.push(
                buildDirectiveError(
                    index + 1,
                    line,
                    'Invalid @import directive. Use: @import "asset-or-logical-id" as alias',
                ),
            );
            return "";
        }

        const specifier = match[3]!;
        const alias = match[4]!;
        const previousLine = seenAliases.get(alias);
        if (previousLine) {
            errors.push(
                buildDirectiveError(
                    index + 1,
                    line,
                    `Duplicate import alias "${alias}" (already declared on line ${previousLine})`,
                ),
            );
            return "";
        }

        seenAliases.set(alias, index + 1);
        directives.push({
            specifier,
            alias,
            lineNumber: index + 1,
            raw: line,
        });
        // Preserve line numbers for validation / breakpoints.
        return "";
    });

    return {
        code: strippedLines.join("\n"),
        directives,
        errors,
    };
};

export const parseScriptImportsCached = (source: string): ParsedScriptImports => {
    const key = `${source.length}:${hashString(source)}`;
    const cached = parsedScriptImportCache.get(key);
    if (cached) {
        return cached;
    }

    return rememberCacheEntry(
        parsedScriptImportCache,
        key,
        parseScriptImports(source),
        PARSED_SCRIPT_IMPORT_CACHE_LIMIT,
    );
};

export const resolveScriptImportDirective = (
    directive: ScriptImportDirective,
    context: ReadonlyAssetResolutionContext,
): ScriptImportDependency => {
    const assetId = resolveAssetId(directive.specifier, context);
    const revisionId = resolveAssetRevisionId(directive.specifier, context);
    if (!revisionId) {
        throw new Error(
            `Unable to resolve import "${directive.specifier}" as ${directive.alias} on line ${directive.lineNumber}`,
        );
    }

    return {
        assetId,
        revisionId,
        specifier: directive.specifier,
        alias: directive.alias,
    };
};

export const getScriptImportDependencies = (
    source: string,
    context: ReadonlyAssetResolutionContext = emptyAssetResolutionContext,
): ScriptImportDependency[] => {
    const parsed = parseScriptImportsCached(source);
    if (parsed.errors.length > 0) {
        throw new Error(parsed.errors[0]!.message);
    }

    return parsed.directives.map(directive => resolveScriptImportDirective(directive, context));
};

export const getScriptImportDependencyMap = (
    source: string,
    context: ReadonlyAssetResolutionContext = emptyAssetResolutionContext,
): Record<string, string> => {
    return getScriptImportDependencies(source, context).reduce(
        (acc, dep) => {
            acc[dep.assetId] = dep.revisionId;
            return acc;
        },
        {} as Record<string, string>,
    );
};

export const buildNameAwareScriptImportContext = async (
    sceneId: string | null | undefined,
    context: ReadonlyAssetResolutionContext = emptyAssetResolutionContext,
    options: {force?: boolean; allowFetchFailure?: boolean} = {},
): Promise<ReadonlyAssetResolutionContext> => {
    if (!sceneId || (!isScriptsEnabled() && !options.force)) {
        return context;
    }

    let assets: Awaited<ReturnType<typeof getSceneAssets>>["assets"];
    try {
        ({assets} = await getSceneAssets(sceneId, {
            types: [AssetType.Script],
        }));
    } catch (error) {
        if (options.allowFetchFailure) {
            console.warn("[ScriptImport] Failed to load scene script names; using bundled/context names only.", error);
            return context;
        }
        throw error;
    }

    if (assets.length === 0) {
        return context;
    }

    const nameToAssetId: Record<string, string> = {
        ...context.nameToAssetId,
    };

    for (const asset of assets) {
        const normalizedName = asset.name?.trim().toLowerCase();
        if (!normalizedName) {
            continue;
        }
        nameToAssetId[normalizedName] = asset.id;
    }

    return {
        ...context,
        nameToAssetId,
    };
};

export const remapScriptImportSpecifiers = (
    source: string,
    remapAssetId: (assetId: string) => string,
): string => {
    return source
        .split("\n")
        .map((line) => {
            const match = line.match(IMPORT_DIRECTIVE_RE);
            if (!match) {
                return line;
            }

            const originalSpecifier = match[3]!;
            // Only rewrite concrete asset IDs. Logical IDs remain stable.
            if (!/^[a-fA-F0-9]{24}$/.test(originalSpecifier)) {
                return line;
            }

            const remapped = remapAssetId(originalSpecifier);
            if (remapped === originalSpecifier) {
                return line;
            }

            return line.replace(originalSpecifier, remapped);
        })
        .join("\n");
};

export const loadScriptImportRevisionMap = async (
    source: string,
    context: ReadonlyAssetResolutionContext = emptyAssetResolutionContext,
    existing: ScriptImportRevisionMap = {},
): Promise<ScriptImportRevisionMap> => {
    const revisionMap = {...existing};
    const visiting = new Set<string>();

    const visitSource = async (currentSource: string) => {
        const dependencies = getScriptImportDependencies(currentSource, context);
        for (const dependency of dependencies) {
            const key = assetRefKey(dependency);
            if (visiting.has(key)) {
                throw new Error(`Import cycle detected while loading ${key}`);
            }
            if (revisionMap[key]) {
                continue;
            }

            visiting.add(key);
            const {code} = await getScriptRevisionData(dependency.assetId, dependency.revisionId);
            revisionMap[key] = {
                assetId: dependency.assetId,
                revisionId: dependency.revisionId,
                code,
            };
            await visitSource(code);
            visiting.delete(key);
        }
    };

    await visitSource(source);
    return revisionMap;
};

export const loadReferencedScriptImportRevisionMap = async (
    source: string,
    context: ReadonlyAssetResolutionContext = emptyAssetResolutionContext,
    existing: ScriptImportRevisionMap = {},
): Promise<ScriptImportRevisionMap> => {
    const revisionMap: ScriptImportRevisionMap = {};
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visitSource = async (currentSource: string) => {
        const dependencies = getScriptImportDependencies(currentSource, context);
        for (const dependency of dependencies) {
            const key = assetRefKey(dependency);
            if (visiting.has(key)) {
                throw new Error(`Import cycle detected while loading ${key}`);
            }
            if (visited.has(key)) {
                continue;
            }

            visiting.add(key);
            const existingEntry = existing[key];
            const entry = existingEntry ?? {
                assetId: dependency.assetId,
                revisionId: dependency.revisionId,
                code: (await getScriptRevisionData(dependency.assetId, dependency.revisionId)).code,
            };
            revisionMap[key] = entry;
            await visitSource(entry.code);
            visiting.delete(key);
            visited.add(key);
        }
    };

    await visitSource(source);
    return revisionMap;
};
