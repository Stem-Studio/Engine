/**
 * Structural validation for behavior & lambda scripts.
 * Produces Monaco-compatible markers (squiggly underlines).
 */

import * as acorn from "acorn";

import {parseScriptImports} from "../../../../script-runtime/scriptImportCore";

export type ScriptType = "behavior" | "lambda";

export interface ValidateScriptOptions {
    /**
     * Set of specifiers that resolve to existing import assets in the current
     * scene. Should contain both raw asset IDs and lowercased asset names.
     * When provided, `@import "x" as y` directives whose specifier is not in
     * this set will produce an error marker.
     */
    availableImportSpecifiers?: ReadonlySet<string>;
}

interface ValidationMarker {
    severity: "Error" | "Warning" | "Info";
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
    message: string;
}

const BEHAVIOR_LIFECYCLE = [
    "init", "update", "dispose",
    "onStart", "onStop", "onReset",
    "onPaused", "onResumed",
    "onEvent", "onAttributesUpdated",
    "onAdded", "onRemoved",
];

const LAMBDA_LIFECYCLE = [
    "init", "update", "dispose",
    "onObjectAdded", "onObjectRemoved", "onEvent",
];

const DEPRECATED_BEHAVIOR: Record<string, string> = {
    onAdded: "Use 'onStart' instead of 'onAdded' (deprecated).",
    onRemoved: "Use 'onStop' instead of 'onRemoved' (deprecated).",
};

const BEHAVIOR_STARTUP_LIFECYCLE = new Set(["init", "onStart", "onAdded", "onReset"]);

const LAMBDA_INSTANCE_PROPS = ["_registeredObjects", "_game"];

// Known globals and built-in functions available in behavior/lambda scripts
const KNOWN_GLOBALS = new Set([
    // JavaScript built-ins
    "console", "Math", "JSON", "Object", "Array", "String", "Number", "Boolean",
    "Date", "RegExp", "Error", "Promise", "Map", "Set", "WeakMap", "WeakSet",
    "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURI", "decodeURI",
    "encodeURIComponent", "decodeURIComponent", "eval",
    // Timer functions
    "setTimeout", "setInterval", "clearTimeout", "clearInterval",
    "requestAnimationFrame", "cancelAnimationFrame",
    // THREE.js and engine globals
    "THREE", "Ammo", "EventBus", "CSS3DObject", "CSS3DSprite", "UIKit", "UIKitPointerEvents", "CesiumTool",
    // Control flow
    "if", "else", "for", "while", "do", "switch", "case", "break", "continue", "return",
    "try", "catch", "finally", "throw", "new", "typeof", "instanceof", "delete", "void",
    // Keywords that look like function calls
    "function", "class", "async", "await", "yield",
]);

// Methods available from BehaviorBase
const BEHAVIOR_BASE_METHODS = new Set([
    // Lifecycle (definitions, not calls)
    "init", "update", "dispose", "onStart", "onStop", "onReset",
    "onPaused", "onResumed", "onEvent", "onAttributesUpdated",
    "onAdded", "onRemoved", "onEditorAdded", "onEditorRemoved",
    // Instance methods that can be called
    "getAttribute", "setAttribute", "getConfig", "getConfigValue",
    "emit", "on", "off", "once",
]);

// Methods available from Lambda base
const LAMBDA_BASE_METHODS = new Set([
    // Lifecycle
    "init", "update", "dispose", "onObjectAdded", "onObjectRemoved", "onEvent",
    // Instance methods
    "apply", "registerObject", "unregisterObject",
    "getAttribute", "setAttribute", "getConfig",
]);

// Simple Levenshtein distance for typo detection
/**
 *
 * @param a
 * @param b
 */
function levenshtein(a: string, b: string): number {
    const m = a.length, n = b.length;
    const dp: number[][] = Array.from({length: m + 1}, (_, i) =>
        Array.from({length: n + 1}, (_, j) => i === 0 ? j : j === 0 ? i : 0),
    );
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i]![j] = a[i - 1] === b[j - 1]
                ? dp[i - 1]![j - 1]!
                : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
        }
    }
    return dp[m]![n]!;
}

function checkImportResolution(
    directive: {specifier: string; lineNumber: number},
    sourceLines: string[],
    available: ReadonlySet<string>,
): ValidationMarker | null {
    const specifier = directive.specifier.trim();
    if (!specifier) return null;
    if (available.has(specifier) || available.has(specifier.toLowerCase())) return null;
    const lineText = sourceLines[directive.lineNumber - 1] ?? "";
    const specifierIndex = lineText.indexOf(specifier);
    const startColumn = specifierIndex >= 0 ? specifierIndex + 1 : 1;
    return {
        severity: "Error",
        startLineNumber: directive.lineNumber,
        startColumn,
        endLineNumber: directive.lineNumber,
        endColumn: startColumn + specifier.length,
        message: `Import "${specifier}" was not found in this scene. Add an Import asset with this name or id.`,
    };
}

type AcornNode = acorn.Node & Record<string, any>;

const isAstNode = (value: unknown): value is AcornNode =>
    typeof value === "object" && value !== null && typeof (value as {type?: unknown}).type === "string";

const isFunctionNode = (node: unknown): node is AcornNode =>
    isAstNode(node) && (
        node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression"
    );

const isAsyncFunctionNode = (node: unknown): node is AcornNode =>
    isFunctionNode(node) && node.async === true;

const getThisMemberName = (node: unknown): string | null => {
    if (!isAstNode(node) || node.type !== "MemberExpression" || node.object?.type !== "ThisExpression") {
        return null;
    }

    if (node.computed === true) {
        return typeof node.property?.value === "string" ? node.property.value : null;
    }

    return typeof node.property?.name === "string" ? node.property.name : null;
};

const visitChildNodes = (node: AcornNode, visitor: (child: AcornNode) => void): void => {
    for (const [key, value] of Object.entries(node)) {
        if (
            key === "type" ||
            key === "start" ||
            key === "end" ||
            key === "loc" ||
            key === "range"
        ) {
            continue;
        }

        if (Array.isArray(value)) {
            for (const item of value) {
                if (isAstNode(item)) visitor(item);
            }
        } else if (isAstNode(value)) {
            visitor(value);
        }
    }
};

const walkAst = (
    node: AcornNode,
    enter: (node: AcornNode, parent: AcornNode | null) => void,
    parent: AcornNode | null = null,
): void => {
    enter(node, parent);
    visitChildNodes(node, child => walkAst(child, enter, node));
};

const walkStartupHookBody = (
    node: AcornNode,
    enter: (node: AcornNode, parent: AcornNode | null) => void,
    parent: AcornNode | null = null,
): void => {
    enter(node, parent);
    visitChildNodes(node, child => {
        if (isFunctionNode(child)) {
            return;
        }
        walkStartupHookBody(child, enter, node);
    });
};

const isStartupHookFunction = (node: AcornNode, parent: AcornNode | null): boolean => {
    if (node.type === "FunctionDeclaration") {
        return BEHAVIOR_STARTUP_LIFECYCLE.has(node.id?.name);
    }

    if (!isFunctionNode(node) || parent?.type !== "AssignmentExpression" || parent.right !== node) {
        return false;
    }

    const hookName = getThisMemberName(parent.left);
    return hookName !== null && BEHAVIOR_STARTUP_LIFECYCLE.has(hookName);
};

function collectStartupAsyncCallWarnings(code: string): ValidationMarker[] {
    let ast: AcornNode;
    try {
        ast = acorn.parse(code, {
            ecmaVersion: "latest",
            sourceType: "script",
            locations: true,
        }) as AcornNode;
    } catch {
        return [];
    }

    const asyncThisMethods = new Set<string>();
    walkAst(ast, node => {
        if (node.type !== "AssignmentExpression" || !isAsyncFunctionNode(node.right)) {
            return;
        }

        const name = getThisMemberName(node.left);
        if (name) asyncThisMethods.add(name);
    });

    if (asyncThisMethods.size === 0) {
        return [];
    }

    const markers: ValidationMarker[] = [];
    walkAst(ast, (node, parent) => {
        if (!isStartupHookFunction(node, parent)) {
            return;
        }

        const body = node.body;
        if (!isAstNode(body)) {
            return;
        }

        walkStartupHookBody(body, (child, childParent) => {
            if (
                child.type !== "CallExpression" ||
                childParent?.type !== "ExpressionStatement" ||
                childParent.expression !== child
            ) {
                return;
            }

            const calleeName = getThisMemberName(child.callee);
            if (!calleeName || !asyncThisMethods.has(calleeName) || !child.loc) {
                return;
            }

            markers.push({
                severity: "Warning",
                startLineNumber: child.loc.start.line,
                startColumn: child.loc.start.column + 1,
                endLineNumber: child.loc.end.line,
                endColumn: child.loc.end.column + 1,
                message: `Startup hook calls async this.${calleeName}() without await/return/void. Await or return the startup promise, or use this.erth.runtime.processInBatches(...) for heavy setup.`,
            });
        });
    });

    return markers;
}

/**
 * Lightweight live check that produces error markers for `@import` directives
 * whose specifier is not present in `availableImportSpecifiers`. Used for live
 * feedback on every content change — the heavier `validateScript` and
 * `runImporterValidation` only run when the user clicks the Validate button.
 * @param code
 * @param availableImportSpecifiers
 */
export function validateImportResolution(
    code: string,
    availableImportSpecifiers: ReadonlySet<string>,
): ValidationMarker[] {
    const parsed = parseScriptImports(code);
    const sourceLines = code.split("\n");
    const markers: ValidationMarker[] = [];
    for (const directive of parsed.directives) {
        const marker = checkImportResolution(directive, sourceLines, availableImportSpecifiers);
        if (marker) markers.push(marker);
    }
    return markers;
}

/**
 *
 * @param code
 * @param type
 * @param options
 */
export function validateScript(
    code: string,
    type: ScriptType,
    options: ValidateScriptOptions = {},
): ValidationMarker[] {
    const markers: ValidationMarker[] = [];
    const lifecycle = type === "behavior" ? BEHAVIOR_LIFECYCLE : LAMBDA_LIFECYCLE;
    const parsedImports = parseScriptImports(code);

    for (const error of parsedImports.errors) {
        markers.push({
            severity: "Error",
            startLineNumber: error.lineNumber,
            startColumn: error.column,
            endLineNumber: error.lineNumber,
            endColumn: error.column + 8,
            message: error.message,
        });
    }

    // Module-existence check: only produce a marker when the caller supplied
    // the set of available specifiers. Without that context we cannot know
    // whether a specifier is truly missing, so we stay silent.
    const available = options.availableImportSpecifiers;
    if (available) {
        const sourceLines = code.split("\n");
        for (const directive of parsedImports.directives) {
            const marker = checkImportResolution(directive, sourceLines, available);
            if (marker) markers.push(marker);
        }
    }

    if (parsedImports.errors.length > 0) {
        return markers;
    }

    // 1. Syntax check
    try {
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        new Function(parsedImports.code);
    } catch (e) {
        if (e instanceof SyntaxError) {
            // Try to extract line number from message (e.g. "(1:5)" or "line 1")
            const lineMatch = e.message.match(/\((\d+):(\d+)\)/) || e.message.match(/line\s+(\d+)/i);
            const line = lineMatch?.[1] ? parseInt(lineMatch[1], 10) : 1;
            const col = lineMatch?.[2] ? parseInt(lineMatch[2], 10) : 1;
            markers.push({
                severity: "Error",
                startLineNumber: line,
                startColumn: col,
                endLineNumber: line,
                endColumn: col + 1,
                message: `SyntaxError: ${e.message}`,
            });
        }
        return markers; // Don't continue checking if syntax is invalid
    }

    if (type === "behavior") {
        markers.push(...collectStartupAsyncCallWarnings(parsedImports.code));
    }

    // 2. Scan for function declarations (skip comments)
    const lines = code.split("\n");
    const funcRegex = /function\s+(\w+)\s*\(/g;
    let inBlockComment = false;

    for (let i = 0; i < lines.length; i++) {
        const lineStr = lines[i]!;

        // Track block comments across lines
        let scanLine = lineStr;
        if (inBlockComment) {
            const endIdx = scanLine.indexOf("*/");
            if (endIdx === -1) continue; // entire line is inside block comment
            scanLine = scanLine.substring(endIdx + 2);
            inBlockComment = false;
        }
        // Remove inline block comments (/* ... */ on same line)
        scanLine = scanLine.replace(/\/\*.*?\*\//g, "");
        // Check if a block comment starts and doesn't end on this line
        const blockStart = scanLine.indexOf("/*");
        if (blockStart !== -1) {
            scanLine = scanLine.substring(0, blockStart);
            inBlockComment = true;
        }
        // Remove single-line comments
        const lineCommentIdx = scanLine.indexOf("//");
        if (lineCommentIdx !== -1) {
            scanLine = scanLine.substring(0, lineCommentIdx);
        }

        let match;
        while ((match = funcRegex.exec(scanLine)) !== null) {
            const name = match[1]!;
            const lineNum = i + 1;
            const col = match.index + 1;

            if (lifecycle.includes(name)) {
                // Check deprecated (behavior only)
                const deprecatedMsg = DEPRECATED_BEHAVIOR[name];
                if (type === "behavior" && deprecatedMsg) {
                    markers.push({
                        severity: "Warning",
                        startLineNumber: lineNum,
                        startColumn: col,
                        endLineNumber: lineNum,
                        endColumn: col + match[0].length,
                        message: deprecatedMsg,
                    });
                }
            } else {
                // Only warn if the name looks like a misspelled lifecycle method
                for (const lc of lifecycle) {
                    if (levenshtein(name, lc) <= 2 && name !== lc) {
                        markers.push({
                            severity: "Warning",
                            startLineNumber: lineNum,
                            startColumn: col,
                            endLineNumber: lineNum,
                            endColumn: col + match[0].length,
                            message: `Did you mean '${lc}'? '${name}' won't be called by the engine.`,
                        });
                        break;
                    }
                }
            }
        }
    }

    // 3. Missing this. on instance props (lambda only, skip comments)
    if (type === "lambda") {
        let inBlock = false;
        for (let i = 0; i < lines.length; i++) {
            let scanLine = lines[i]!;

            if (inBlock) {
                const endIdx = scanLine.indexOf("*/");
                if (endIdx === -1) continue;
                scanLine = scanLine.substring(endIdx + 2);
                inBlock = false;
            }
            scanLine = scanLine.replace(/\/\*.*?\*\//g, "");
            const bs = scanLine.indexOf("/*");
            if (bs !== -1) {
                scanLine = scanLine.substring(0, bs);
                inBlock = true;
            }
            const lc = scanLine.indexOf("//");
            if (lc !== -1) {
                scanLine = scanLine.substring(0, lc);
            }

            for (const prop of LAMBDA_INSTANCE_PROPS) {
                const regex = new RegExp(`(?<!this\\.)\\b${prop}\\b`, "g");
                let match;
                while ((match = regex.exec(scanLine)) !== null) {
                    markers.push({
                        severity: "Warning",
                        startLineNumber: i + 1,
                        startColumn: match.index + 1,
                        endLineNumber: i + 1,
                        endColumn: match.index + 1 + prop.length,
                        message: `Use 'this.${prop}' instead of '${prop}'.`,
                    });
                }
            }
        }
    }

    // 4. Check for undefined function calls
    const availableFunctions = type === "behavior" ? BEHAVIOR_BASE_METHODS : LAMBDA_BASE_METHODS;
    const localFunctions = new Set<string>();

    // Find all function declarations in the code
    const funcDeclRegex = /function\s+(\w+)\s*\(/g;
    let declMatch;
    while ((declMatch = funcDeclRegex.exec(code)) !== null) {
        localFunctions.add(declMatch[1]!);
    }

    // Also find arrow function declarations: const/let/var name = ... =>
    const arrowDeclRegex = /(?:const|let|var)\s+(\w+)\s*=\s*(?:\([^)]*\)|[^=])\s*=>/g;
    while ((declMatch = arrowDeclRegex.exec(code)) !== null) {
        localFunctions.add(declMatch[1]!);
    }

    // Find all function calls and check if they're defined
    // Match: functionName( but NOT obj.method( or this.method(
    const funcCallRegex = /(?<![.\w])(\w+)\s*\(/g;
    let inBlockComment2 = false;

    for (let i = 0; i < lines.length; i++) {
        let scanLine = lines[i]!;

        // Skip comments
        if (inBlockComment2) {
            const endIdx = scanLine.indexOf("*/");
            if (endIdx === -1) continue;
            scanLine = scanLine.substring(endIdx + 2);
            inBlockComment2 = false;
        }
        scanLine = scanLine.replace(/\/\*.*?\*\//g, "");
        const bs = scanLine.indexOf("/*");
        if (bs !== -1) {
            scanLine = scanLine.substring(0, bs);
            inBlockComment2 = true;
        }
        const lc = scanLine.indexOf("//");
        if (lc !== -1) {
            scanLine = scanLine.substring(0, lc);
        }

        let callMatch;
        while ((callMatch = funcCallRegex.exec(scanLine)) !== null) {
            const funcName = callMatch[1]!;
            const lineNum = i + 1;
            const col = callMatch.index + 1;

            // Check if this function is defined
            const isDefined =
                localFunctions.has(funcName) ||
                availableFunctions.has(funcName) ||
                KNOWN_GLOBALS.has(funcName) ||
                lifecycle.includes(funcName);

            if (!isDefined) {
                markers.push({
                    severity: "Error",
                    startLineNumber: lineNum,
                    startColumn: col,
                    endLineNumber: lineNum,
                    endColumn: col + funcName.length,
                    message: `'${funcName}' is not defined. Did you forget to declare this function?`,
                });
            }
        }
    }

    return markers;
}
