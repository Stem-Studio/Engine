import * as acorn from "acorn";

import {assetRefKey} from "@stem/editor-oss/asset-management/AssetRef";
import {
    emptyAssetResolutionContext,
    type ReadonlyAssetResolutionContext,
} from "@stem/editor-oss/asset-management/AssetResolutionContext";
import {
    parseScriptImportsCached,
    resolveScriptImportDirective,
    type ScriptImportRevisionMap,
} from "./scriptImportCore";

type AcornNode = acorn.Node & Record<string, any>;
type ModuleFactory = (...args: unknown[]) => Readonly<Record<string, unknown>>;

const MODULE_FACTORY_CACHE_LIMIT = 256;
const moduleFactoryCache = new Map<string, ModuleFactory>();

const hashString = (value: string): string => {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
};

const getSourceCacheKey = (assetId: string, revisionId: string, source: string): string =>
    `${assetId}:${revisionId}:${source.length}:${hashString(source)}`;

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

const getCompiledModuleFactory = (
    assetId: string,
    revisionId: string,
    source: string,
    argNames: string[],
    moduleCode: string,
): ModuleFactory => {
    const key = `${getSourceCacheKey(assetId, revisionId, source)}:${argNames.join(",")}`;
    const cached = moduleFactoryCache.get(key);
    if (cached) {
        return cached;
    }

    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- intentional: script imports execute user-authored module code
    const factory = new Function(...argNames, moduleCode) as ModuleFactory;
    return rememberCacheEntry(moduleFactoryCache, key, factory, MODULE_FACTORY_CACHE_LIMIT);
};

const isAstNode = (value: unknown): value is AcornNode =>
    typeof value === "object" && value !== null && typeof (value as {type?: unknown}).type === "string";

const collectTopLevelFunctionExports = (source: string): string[] => {
    const ast = acorn.parse(source, {
        ecmaVersion: "latest",
        sourceType: "script",
        locations: false,
    }) as AcornNode;

    const names = new Set<string>();
    const body = Array.isArray(ast.body) ? ast.body : [];
    for (const node of body) {
        if (!isAstNode(node)) continue;

        if (node.type === "FunctionDeclaration" && node.id?.name) {
            names.add(node.id.name);
            continue;
        }

        if (node.type !== "VariableDeclaration" || !Array.isArray(node.declarations)) {
            continue;
        }

        for (const declaration of node.declarations) {
            if (!isAstNode(declaration) || declaration.id?.type !== "Identifier") {
                continue;
            }

            const init = declaration.init;
            if (!isAstNode(init)) {
                continue;
            }

            if (init.type === "FunctionExpression" || init.type === "ArrowFunctionExpression") {
                names.add(declaration.id.name);
            }
        }
    }

    return [...names];
};

const buildModuleWrapper = (source: string, exportNames: string[], sourceUrl: string): string => {
    const exportLines = exportNames
        .map(name => `if (typeof ${name} === "function") __module[${JSON.stringify(name)}] = ${name};`)
        .join("\n");

    return `
        "use strict";
        ${source}
        const __module = {};
        ${exportLines}
        return Object.freeze(__module);
        //# sourceURL=${sourceUrl}
    `;
};

export interface BuildScriptImportAliasOptions {
    source: string;
    context?: ReadonlyAssetResolutionContext;
    importRevisionMap?: ScriptImportRevisionMap;
    runtimeEndowments?: Record<string, unknown>;
    useCompartment?: boolean;
}

export const buildScriptImportAliases = ({
    source,
    context = emptyAssetResolutionContext,
    importRevisionMap = {},
    runtimeEndowments = {},
    useCompartment = false,
}: BuildScriptImportAliasOptions): Record<string, Readonly<Record<string, unknown>>> => {
    const parsed = parseScriptImportsCached(source);
    if (parsed.errors.length > 0) {
        throw new Error(parsed.errors[0]!.message);
    }

    const moduleCache = new Map<string, Readonly<Record<string, unknown>>>();
    const visitStack = new Set<string>();

    const buildModuleForRef = (assetId: string, revisionId: string): Readonly<Record<string, unknown>> => {
        const key = assetRefKey({assetId, revisionId});
        const cached = moduleCache.get(key);
        if (cached) {
            return cached;
        }
        if (visitStack.has(key)) {
            throw new Error(`Import cycle detected while loading ${key}`);
        }

        const entry = importRevisionMap[key];
        if (!entry) {
            throw new Error(`Missing import asset source for ${key}`);
        }

        visitStack.add(key);
        const childParsed = parseScriptImportsCached(entry.code);
        if (childParsed.errors.length > 0) {
            throw new Error(childParsed.errors[0]!.message);
        }

        const childAliases = childParsed.directives.reduce(
            (acc, directive) => {
                const dependency = resolveScriptImportDirective(directive, context);
                acc[directive.alias] = buildModuleForRef(dependency.assetId, dependency.revisionId);
                return acc;
            },
            {} as Record<string, Readonly<Record<string, unknown>>>,
        );

        const exportNames = collectTopLevelFunctionExports(childParsed.code);
        const sourceUrl = `import://${assetId}/${revisionId}`;
        const moduleCode = buildModuleWrapper(childParsed.code, exportNames, sourceUrl);
        const endowments = {...runtimeEndowments, ...childAliases};
        const argNames = Object.keys(endowments);
        const argValues = Object.values(endowments);

        let moduleObject: Readonly<Record<string, unknown>>;
        if (useCompartment) {
            const compartment = new Compartment(endowments);
            moduleObject = compartment.evaluate(`(() => { ${moduleCode} })()`);
        } else {
            moduleObject = getCompiledModuleFactory(
                entry.assetId,
                entry.revisionId,
                entry.code,
                argNames,
                moduleCode,
            )(...argValues);
        }

        visitStack.delete(key);
        moduleCache.set(key, moduleObject);
        return moduleObject;
    };

    return parsed.directives.reduce(
        (acc, directive) => {
            const dependency = resolveScriptImportDirective(directive, context);
            acc[directive.alias] = buildModuleForRef(dependency.assetId, dependency.revisionId);
            return acc;
        },
        {} as Record<string, Readonly<Record<string, unknown>>>,
    );
};
