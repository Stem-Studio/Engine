/**
 * Adapter between the importer's shared validation library and
 * the Monaco-compatible ValidationMarker interface used by the editor.
 *
 * The underlying module is CJS (`module.exports = { validateCode }`).
 * Vite's dev server cannot resolve CJS exports as static ESM imports,
 * so we lazy-load via dynamic `import()` on first use.
 */

export type ScriptType = "behavior" | "lambda";

interface ValidationMarker {
    severity: "Error" | "Warning" | "Info";
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
    message: string;
}

const SEVERITY_MAP: Record<string, "Error" | "Warning" | "Info"> = {
    error: "Error",
    warning: "Warning",
    info: "Info",
};

type ImporterDiagnostic = {
    severity: string;
    message: string;
    ruleId: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
};

let _validateCode: ((code: string, type: string) => ImporterDiagnostic[]) | null = null;
let _loadAttempted = false;

async function loadValidator(): Promise<void> {
    if (_loadAttempted) return;
    _loadAttempted = true;

    // The importer's `validate-code.js` is CommonJS and transitively
    // requires Node-only modules (`fs`, `path`, `acorn`, …) via
    // `require()`. None of that runs in the browser, so attempting the
    // dynamic import always throws `ReferenceError: require is not
    // defined`. Skip the load in non-Node environments to keep the
    // console clean — Monaco's built-in TS service still handles syntax
    // squigglies; only the importer's pattern checks are unavailable in
    // the editor.
    const isNode =
        typeof process !== "undefined" &&
        typeof (process as {versions?: {node?: string}}).versions?.node === "string";
    if (!isNode) return;

    try {
        // @ts-expect-error — CJS module resolved via Vite alias, no .d.ts.
        // @vite-ignore so Vite doesn't fail builds where the alias target is
        // absent (the open-source build excludes stemstudio-importer).
        // eslint-disable-next-line import/no-unresolved
        const mod = await import(/* @vite-ignore */ "@stemstudio/validators");
        _validateCode = mod.validateCode ?? mod.default?.validateCode ?? null;
    } catch (err) {
        console.warn("[importerValidation] @stemstudio/validators unavailable, skipping importer pattern checks", err);
    }
}

// Kick off loading immediately but don't block module evaluation.
void loadValidator();

/**
 * Run the importer's full validation suite on raw JS code and return
 * Monaco-compatible markers for squiggly underlines.
 */
export function runImporterValidation(code: string, type: ScriptType): ValidationMarker[] {
    if (typeof _validateCode !== "function") return [];
    try {
        const diagnostics: ImporterDiagnostic[] = _validateCode(code, type);

        const markers = diagnostics.map((d) => ({
            severity: SEVERITY_MAP[d.severity] || "Warning",
            startLineNumber: d.startLine,
            startColumn: d.startColumn,
            endLineNumber: d.endLine,
            endColumn: d.endColumn,
            message: `[${d.ruleId}] ${d.message}`,
        }));
        console.debug("[importerValidation] result:", markers.length, "markers", markers);
        return markers;
    } catch (err) {
        console.debug("[importerValidation] validateCode threw:", err);
        return [];
    }
}
