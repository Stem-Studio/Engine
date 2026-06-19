import {isReadOnlyCommand} from "../agent/script-tool/checkScript";
import {ScriptExecutor} from "../agent/script-tool/ScriptExecutor";

export interface PlaygroundStemscriptPlan {
    designBrief?: PlaygroundDesignBrief;
    assetRequests: PlaygroundAssetRequest[];
    inspectionStemscript: string;
    reply: string;
    stemscript: string;
    notes: string[];
    phases: PlaygroundPlanPhase[];
    artifacts: PlaygroundPlanArtifact[];
}

export type PlaygroundPlanArtifactType = "behavior" | "lambda" | "scriptImport" | "file";

export interface PlaygroundPlanArtifact {
    type: PlaygroundPlanArtifactType;
    name: string;
    assetId?: string;
    description?: string;
    code?: string;
    content?: string;
    format?: string;
    contentType?: string;
    config?: Record<string, unknown> | string;
    metadata?: Record<string, unknown>;
    version?: string;
    author?: string;
}

export interface PlaygroundDesignBrief {
    title?: string;
    coreLoop?: string;
    controlsCamera?: string;
    goalsFailState?: string;
    challengeCurve?: string;
    feedbackProgression?: string;
    reusePlan?: string;
    implementationStrategy?: string;
    notes?: string[];
}

export type PlaygroundAssetRequest = {
    type?: string;
    name?: string;
    prompt?: string;
    essential?: boolean;
    reason?: string;
    fallback?: string;
};

export interface PlaygroundPlanPhase {
    id?: string;
    name?: string;
    goal?: string;
    inspectionStemscript: string;
    stemscript: string;
    artifacts: PlaygroundPlanArtifact[];
}

export interface ValidatedStemscript {
    script: string;
    executableCommands: number;
}

const STEMSCRIPT_FENCE_RE = /```(?:stemscript|text|txt)?\s*([\s\S]*?)```/i;
const DISALLOWED_COMMANDS = new Set([
    "add_prefab_to_scene",
    "create_prefab",
    "exec",
    "export",
    "generate_3d_model",
    "get_library_asset",
    "import",
    "list_project_tasks",
    "create_project_task",
    "update_project_task",
    "delete_project_task",
    "require",
    "save",
    "search_external_assets",
    "search_local_assets",
    "add_model_to_scene",
    "set_external_texture",
]);
// Inspection allows any command the engine classifies as read-only
// (get_/list_/search_ + player/select via isReadOnlyCommand), so the copilot
// can inspect the full scene and every asset type — except commands the
// playground globally disallows (external search, library, project tasks).
const isAllowedInspectionCommand = (command: string): boolean =>
    isReadOnlyCommand(command) && !DISALLOWED_COMMANDS.has(command);

const stripCodeFence = (value: string): string => {
    const trimmed = value.trim();
    const match = trimmed.match(STEMSCRIPT_FENCE_RE);
    return (match?.[1] ?? trimmed).trim();
};

const tryParseJsonObject = (value: string): unknown | null => {
    const trimmed = stripCodeFence(value);
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return null;

    try {
        return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
        return null;
    }
};

const stringArray = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
};

const objectArray = (value: unknown): Record<string, unknown>[] => {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
};

const objectRecord = (value: unknown): Record<string, unknown> | undefined => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    return value as Record<string, unknown>;
};

const commandArrayToScript = (value: unknown): string => {
    if (!Array.isArray(value)) return "";
    return value
        .map(item => {
            if (typeof item === "string") return item;
            if (!item || typeof item !== "object") return "";
            const record = item as Record<string, unknown>;
            const command = typeof record.command === "string" ? record.command.trim() : "";
            const params = record.params && typeof record.params === "object"
                ? Object.entries(record.params as Record<string, unknown>)
                    .map(([key, param]) => `${key}=${formatParamValue(param)}`)
                    .join(" ")
                : "";
            return [command, params].filter(Boolean).join(" ");
        })
        .filter(line => line.trim().length > 0)
        .join("\n");
};

const formatParamValue = (value: unknown): string => {
    if (typeof value === "string") {
        if (/^[A-Za-z0-9_.:#/-]+$/.test(value)) return value;
        return JSON.stringify(value);
    }
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return JSON.stringify(value);
};

const parseArtifactType = (value: unknown): PlaygroundPlanArtifactType | null => {
    if (typeof value !== "string") return null;
    switch (value.trim().toLowerCase()) {
        case "behavior":
        case "behaviour":
            return "behavior";
        case "lambda":
            return "lambda";
        case "scriptimport":
        case "script-import":
        case "script_import":
        case "import":
            return "scriptImport";
        case "file":
            return "file";
        default:
            return null;
    }
};

const parseStringField = (record: Record<string, unknown>, ...keys: string[]): string | undefined => {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return undefined;
};

const parseBooleanField = (record: Record<string, unknown>, ...keys: string[]): boolean | undefined => {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === "boolean") return value;
        if (typeof value === "string") {
            const normalized = value.trim().toLowerCase();
            if (["true", "yes", "required", "essential"].includes(normalized)) return true;
            if (["false", "no", "optional"].includes(normalized)) return false;
        }
    }
    return undefined;
};

const parseDesignBrief = (value: unknown): PlaygroundDesignBrief | undefined => {
    if (typeof value === "string" && value.trim()) return {notes: [value.trim()]};
    const record = objectRecord(value);
    if (!record) return undefined;

    const brief: PlaygroundDesignBrief = {};
    const fields: Array<[keyof PlaygroundDesignBrief, string[]]> = [
        ["title", ["title", "name"]],
        ["coreLoop", ["coreLoop", "core_loop", "loop"]],
        ["controlsCamera", ["controlsCamera", "controls_camera", "controls", "camera"]],
        ["goalsFailState", ["goalsFailState", "goals_fail_state", "goals", "failState", "fail_state"]],
        ["challengeCurve", ["challengeCurve", "challenge_curve", "challenge"]],
        ["feedbackProgression", ["feedbackProgression", "feedback_progression", "feedback", "progression"]],
        ["reusePlan", ["reusePlan", "reuse_plan", "reuse"]],
        ["implementationStrategy", ["implementationStrategy", "implementation_strategy", "implementation"]],
    ];

    for (const [field, keys] of fields) {
        const parsed = parseStringField(record, ...keys);
        if (parsed) {
            (brief[field] as string | undefined) = parsed;
        }
    }

    const notes = stringArray(record.notes);
    if (notes.length > 0) brief.notes = notes;

    return Object.keys(brief).length > 0 ? brief : undefined;
};

const parseAssetRequests = (value: unknown): PlaygroundAssetRequest[] =>
    objectArray(value)
        .map(record => {
            const request: PlaygroundAssetRequest = {};
            const type = parseStringField(record, "type", "kind");
            const name = parseStringField(record, "name", "id");
            const prompt = parseStringField(record, "prompt", "description");
            const reason = parseStringField(record, "reason", "why");
            const fallback = parseStringField(record, "fallback", "fallbackPlan", "fallback_plan");
            const essential = parseBooleanField(record, "essential", "required");

            if (type) request.type = type;
            if (name) request.name = name;
            if (prompt) request.prompt = prompt;
            if (reason) request.reason = reason;
            if (fallback) request.fallback = fallback;
            if (essential !== undefined) request.essential = essential;

            return Object.keys(request).length > 0 ? request : null;
        })
        .filter((request): request is PlaygroundAssetRequest => Boolean(request));

const parseArtifacts = (value: unknown): PlaygroundPlanArtifact[] =>
    objectArray(value)
        .map(record => {
            const type = parseArtifactType(record.type ?? record.kind);
            const name = parseStringField(record, "name", "id", "behaviorId", "lambdaId", "importName", "fileName");
            if (!type || !name) return null;

            const artifact: PlaygroundPlanArtifact = {
                type,
                name,
            };
            const assetId = parseStringField(record, "assetId", "id");
            const description = parseStringField(record, "description", "summary");
            const code = parseStringField(record, "code", "source");
            const content = parseStringField(record, "content", "text", "data");
            const format = parseStringField(record, "format", "extension");
            const contentType = parseStringField(record, "contentType", "mimeType", "mime");
            const config = objectRecord(record.config) ?? parseStringField(record, "config");
            const metadata = objectRecord(record.metadata);
            const version = parseStringField(record, "version");
            const author = parseStringField(record, "author");

            if (assetId && assetId !== name) artifact.assetId = assetId;
            if (description) artifact.description = description;
            if (code) artifact.code = code;
            if (content) artifact.content = content;
            if (format) artifact.format = format;
            if (contentType) artifact.contentType = contentType;
            if (config) artifact.config = config;
            if (metadata) artifact.metadata = metadata;
            if (version) artifact.version = version;
            if (author) artifact.author = author;
            return artifact;
        })
        .filter((artifact): artifact is PlaygroundPlanArtifact => Boolean(artifact));

const parseInspectionScript = (record: Record<string, unknown>): string => {
    const inspectionStemscript =
        typeof record.inspectionStemscript === "string"
            ? record.inspectionStemscript
            : typeof record.inspectionScript === "string"
              ? record.inspectionScript
              : typeof record.inspectStemscript === "string"
                ? record.inspectStemscript
                : commandArrayToScript(record.inspectionCommands ?? record.queries);
    return stripCodeFence(inspectionStemscript || "");
};

const parseMutationScript = (record: Record<string, unknown>): string => {
    const commands = commandArrayToScript(record.commands);
    const stemscript =
        typeof record.stemscript === "string"
            ? record.stemscript
            : typeof record.script === "string"
              ? record.script
              : commands;
    return stripCodeFence(stemscript || "");
};

const parsePhases = (value: unknown): PlaygroundPlanPhase[] =>
    objectArray(value)
        .map(record => {
            const phase: PlaygroundPlanPhase = {
                inspectionStemscript: parseInspectionScript(record),
                stemscript: parseMutationScript(record),
                artifacts: parseArtifacts(record.artifacts),
            };
            const id = parseStringField(record, "id");
            const name = parseStringField(record, "name", "title");
            const goal = parseStringField(record, "goal", "description");

            if (id) phase.id = id;
            if (name) phase.name = name;
            if (goal) phase.goal = goal;
            if (!phase.id && !phase.name && !phase.goal && !phase.inspectionStemscript && !phase.stemscript && phase.artifacts.length === 0) {
                return null;
            }
            return phase;
        })
        .filter((phase): phase is PlaygroundPlanPhase => Boolean(phase));

export function parseProviderStemscriptPlan(rawText: string): PlaygroundStemscriptPlan {
    const parsed = tryParseJsonObject(rawText);
    if (parsed && typeof parsed === "object") {
        const record = parsed as Record<string, unknown>;

        return {
            designBrief: parseDesignBrief(record.designBrief ?? record.design_brief ?? record.brief),
            assetRequests: parseAssetRequests(record.assetRequests ?? record.asset_requests),
            inspectionStemscript: parseInspectionScript(record),
            reply: typeof record.reply === "string" ? record.reply.trim() : "",
            stemscript: parseMutationScript(record),
            notes: stringArray(record.notes),
            phases: parsePhases(record.phases),
            artifacts: parseArtifacts(record.artifacts),
        };
    }

    const fenced = rawText.match(STEMSCRIPT_FENCE_RE);
    if (fenced?.[1]) {
        return {
            designBrief: undefined,
            assetRequests: [],
            inspectionStemscript: "",
            reply: rawText.replace(fenced[0], "").trim(),
            stemscript: stripCodeFence(fenced[1]),
            notes: [],
            phases: [],
            artifacts: [],
        };
    }

    return {
        designBrief: undefined,
        assetRequests: [],
        inspectionStemscript: "",
        reply: rawText.trim(),
        stemscript: "",
        notes: [],
        phases: [],
        artifacts: [],
    };
}

export function validateGeneratedStemscript(script: string): ValidatedStemscript {
    return validateStemscript(script, command => DISALLOWED_COMMANDS.has(command));
}

export function validateInspectionStemscript(script: string): ValidatedStemscript {
    return validateStemscript(script, command => !isAllowedInspectionCommand(command), "inspection");
}

function validateStemscript(
    script: string,
    isDisallowedCommand: (command: string) => boolean,
    label = "playground copilot mode",
): ValidatedStemscript {
    const normalized = stripCodeFence(script)
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join("\n");

    if (!normalized) {
        return {script: "", executableCommands: 0};
    }

    const lines = ScriptExecutor.parseScript(normalized);
    const disallowed: string[] = [];
    let executableCommands = 0;

    for (const line of lines) {
        const parsed = line.parsed;
        if (!parsed || line.isComment || line.isEmpty) continue;

        executableCommands++;
        if (parsed.isBuiltin || isDisallowedCommand(parsed.command)) {
            disallowed.push(`line ${line.lineNumber}: ${parsed.raw}`);
        }
    }

    if (disallowed.length > 0) {
        throw new Error(
            `Generated StemScript used commands that are not allowed in ${label}: ${disallowed.join("; ")}`,
        );
    }

    return {script: normalized, executableCommands};
}
