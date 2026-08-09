// DirectCopilotProvider — a browser-only copilot for the playground.
//
// This provider calls the visitor's chosen LLM provider directly from the
// browser, asks for a constrained StemScript plan, then applies that script
// through the same CommandsRegistry used by the terminal.

import type {RequestPermissionResponse} from "@agentclientprotocol/sdk";
import {AssetType, type Asset} from "@stem/network/api/asset";
import {queryClient} from "@web-shared/queryClient";

import {CommandsExecutor, type CommandExecutionResult} from "../agent/CommandsExecutor";
import {CommandsRegistry} from "../agent/CommandsRegistry";
import {runScriptCheck, type ScriptCheckReport} from "../agent/script-tool/checkScript";
import {ScriptExecutor} from "../agent/script-tool/ScriptExecutor";
import type {ACPEvent, ACPEventType, InteractiveResult, InteractiveSelectionResolution} from "../agent/types/ACPTypes";
import {ConnectionState} from "../agent/types/ACPTypes";
import {getAssetResolutionContext, setAssetRevision} from "../asset-management/AssetResolutionContext";
import {
    buildBehaviorRegistrySummary,
    buildLambdaRegistrySummary,
    buildStructuredSceneSummary,
} from "../editor/assets/v2/AiCopilot/utils/prompt";
import {createAsset, createAssetRevision, seedAssetRevisionData} from "../editor/asset-management/hooks/assets";
import {updateSceneLambdaRevision} from "../editor/lambdas/util";
import {updateSceneScriptRevision} from "../editor/scripts/util";
import global from "../global";
import type {LambdaConfig} from "../lambdas/Lambda";
import {buildNameAwareScriptImportContext, getScriptImportDependencyMap} from "../script-runtime/scriptImportCore";
import type {CopilotEventHandler, ICopilotProvider} from "./ICopilotProvider";
import {
    resolveCopilotChatKeyChoice,
    type CopilotChatKey,
    type CopilotChatKeyChoice,
} from "./playgroundCopilotKeys";
import {
    createPlaygroundLLMClient,
    getPlaygroundMaxOutputTokens,
    PLAYGROUND_PROMPT_CACHE_KEY,
    type PlaygroundLLMClient,
    type PlaygroundLLMStreamProgress,
} from "./playgroundLLMClient";
import {selectPlaygroundKnowledgeCards} from "./playgroundKnowledgeCards";
import {
    parseProviderStemscriptPlan,
    validateGeneratedStemscript,
    validateInspectionStemscript,
    type PlaygroundPlanArtifact,
    type PlaygroundPlanPhase,
    type PlaygroundStemscriptPlan,
} from "./playgroundStemscriptPlan";

const MAX_INSPECTION_ROUNDS = 2;

const NO_KEY_MESSAGE =
    "No AI provider key is configured. Click the **Keys** button above to add " +
    "an Anthropic, OpenAI/Codex, or Gemini key. It is stored locally in this " +
    "browser and used only for direct provider calls.";

const MULTIPLE_KEYS_MESSAGE =
    "Multiple AI provider keys are configured. Click the **Keys** button above " +
    "and choose the copilot model to use before running this request.";

const SYSTEM_PROMPT = `
You are the StemStudio playground copilot. You run inside a browser-based 3D editor.

Your job:
- Convert the user's request into live StemScript commands that create or edit the current scene.
- Use the cached StemScript/API knowledge base and dynamically selected prompt cards when choosing scale, physics, cameras, VFX, behaviors, game rules, and scene structure.
- Build complete playable changes, not static mockups. When a request implies gameplay, set a project title, attach/configure behaviors, physics, camera, game settings, triggers, feedback, and any needed custom controller behavior in the same script.
- For full games, first produce a designBrief with coreLoop, controlsCamera, goalsFailState, challengeCurve, feedbackProgression, reusePlan, and implementationStrategy. Then execute a compact playable MVP in phases.
- Prefer existing built-in behavior components and behavior IDs from the available behavior registry before writing custom behavior code.
- Use the available lambda registry when debugging or extending ECS-style runtime systems. Query lambda metadata with lambda list/lambda get before assuming schema.
- Query imported scene assets before referencing models, behavior/lambda packs, script imports, generic files, media, VFX assets, or prefabs. Use list assets/list imports/list files/list models/list behavior packs/list lambda packs and get asset/get import/get file. Use names, descriptions, tags, and formats from those results to decide which existing asset can be reused.
- Prefer commands that can execute immediately in the browser. If the user asks for local file imports, explain the exact import StemScript they can run in the terminal instead of emitting direct import commands here.
- External prompt-to-image/model/audio generation requires user approval. If generated assets are essential, set assetRequests and ask before any mutation. If optional, build a playable primitive/code fallback first and mention the optional upgrade after execution.
- Return only JSON with this exact shape:
  {"reply":"short user-facing summary","designBrief":{"title":"game title","coreLoop":"what the player repeats","controlsCamera":"input and camera plan","goalsFailState":"win/lose/reset plan","challengeCurve":"how difficulty ramps","feedbackProgression":"HUD, VFX, scoring, unlocks","reusePlan":"built-ins/assets/lambdas/imports reused","implementationStrategy":"phase and code strategy"},"assetRequests":[{"type":"image|model|audio","name":"optional asset name","prompt":"generation prompt","essential":true,"reason":"why primitives cannot satisfy this","fallback":"primitive/code fallback if optional"}],"inspectionStemscript":"optional read-only query commands","stemscript":"multi-line mutation commands","phases":[{"name":"optional phase name","goal":"optional goal","inspectionStemscript":"optional read-only phase query commands","artifacts":[{"type":"behavior|lambda|scriptImport|file","name":"ReusableName","description":"why it exists and where it attaches","code":"source code or text","content":"file text when not code","config":{"id":"machine-id","name":"Display Name","version":"1.0.0","main":"index.js","attributes":{},"componentSchema":{}},"format":"js|json|txt","contentType":"text/javascript|application/json|text/plain","metadata":{}}],"stemscript":"multi-line phase mutation commands"}],"artifacts":[{"type":"behavior|lambda|scriptImport|file","name":"ReusableName","description":"why it exists and where it attaches","code":"source code or text","content":"file text when not code","config":{},"format":"js|json|txt","contentType":"...","metadata":{}}],"notes":["optional note"]}

When the user asks a question or does not want a mutation, set "stemscript" to "" and answer in "reply".
When you need more scene context before editing, set "inspectionStemscript" to read-only query commands and leave "stemscript" empty. The editor will run those queries and call you again with the results.
Use phases for full games, ports, or complex repairs so environment, player/camera, mechanics, and polish can execute independently. Use artifacts for generated reusable behavior/lambda/script/file code; attach or use created artifacts in a later phase stemscript after the artifact is created.

Allowed live patterns:
- add group name="Arena"
- add box|sphere|cylinder|cone|plane|torus|torusKnot|triangle|capsule|icosahedron|octahedron|dodecahedron|ring name="Object" position=x,y,z size=x,y,z color=#rrggbb parent="Group"
- update "Object" position=x,y,z rotation=x,y,z scale=x,y,z color=#rrggbb tag=Tag
- material "Object" color=#rrggbb roughness=0.5 metalness=0.1 opacity=1
- light "Directional" intensity=0.8 castShadow=true
- scene background type=Color color=#rrggbb
- scene lighting ambient={color:"#ffffff",intensity:0.5}
- scene fog type=linear color=#rrggbb near=20 far=80
- render settings useShadows=true shadowMapType=2
- physics enable "Object"; physics set "Object" config={shape:"box",mass:0,ctype:"Static"}
- camera "DefaultCamera" cameraType=THIRD_PERSON defaultDistance=6
- project title "Arena Runner"
- game settings isGame=true lives=3 maxScore=10 showHUD=true
- vfx add name="Effect" position=x,y,z config={...}
- list objects filter=Player; get Player; get settings Player; get material Ground; get physics Player; get camera DefaultCamera; get game settings
- behavior list filter=character; behavior get behaviorId=character
- get behavior Player behaviorId=character
- lambda list filter=motion; lambda get lambdaId=motionController includeCode=true
- list assets type=models|imports|files|behaviors|lambdas|packs|media filter=* limit=80; get asset assetId=asset-id; list imports; list files; list models; get import "math-helpers"; get file "level-data.json"
- behavior attach Player behaviorId=character config={isDefault:true,walkSpeed:3,runSpeed:8,jumpHeight:1.2}
- behavior attach Pickup behaviorId=consumable config={pointAmount:1,disposable:true}
- behavior attach Door behaviorId=tween config={startOnTrigger:true,move:{x:0,y:3,z:0},speed:1,loopMode:"Once"}
- behavior attach TriggerZone behaviorId=trigger config={if_condition:[{conditionType:"player_touches"}],if_operator:"and",then_steps:[{thenType:"activate",delay:0}]}
- behavior add name="GameController" description="Copilot generated for: arena scoring loop; uses Player, Coin, and Goal objects" code="this.init = function(game) {...}"
- behavior update behaviorId=GameController description="Copilot revised for: faster pickups and win condition" code="this.init = function(game) {...}"
- behavior attach Player behaviorId=GameController config={speed:6}
- behavior config Player behaviorId=GameController attributesData={speed:8}
- behavior detach Target behaviorId=BehaviorId
- navmesh add target="Default Scene" autoGenerate=true
- waypoint path add name=PatrolPath loop=true; waypoint add path=PatrolPath position=0,0,0 order=0

Rules:
- Do not use exec, export, save, require, add_model_to_scene, search_external_assets, search_local_assets, get_library_asset, or generate_3d_model.
- Do not create local folders, bundles, YAML files, or external asset dependencies. Browser artifact objects may create behavior, lambda, scriptImport, and file assets when they are explicitly included in JSON artifacts.
- Behavior code is allowed when built-ins are insufficient. Before adding or updating custom behavior code, inspect existing behavior/lambda registries or packs when relevant; if a listed asset fits, reuse it. If you add or update custom behavior code, include a description summarizing the user request, runtime purpose, inspected/reused assets, and expected attachment target, then attach it to the right scene object in the same stemscript.
- Existing behavior IDs are exact and case-sensitive. Use behaviorId=character, behaviorId=trigger, etc.; do not invent behavior IDs when a listed behavior fits.
- Inspection commands must be read-only: list/get objects, settings, materials, physics, lights, camera, scene settings, behavior settings/code, VFX, prefabs, lambdas, and scene assets/imports/files/models. Never put mutating commands in "inspectionStemscript".
- Prefer richer primitive compositions over single-shape placeholders: combine supported primitives, materials, VFX, lights, labels/markers, waypoints, navmesh, and runtime behaviors to communicate gameplay.
- Keep most plans between 5 and 40 commands. Name important objects and group related objects.
- Use "size" for primitive dimensions. Use "parent" to organize children.
- For floors and walls, mark static colliders with physics commands when relevant.
- Keep JSON valid. Do not wrap the JSON in markdown.
`.trim();

type ChatMessage = {role: "user" | "assistant"; content: string};

type DirectExecutor = Pick<
    CommandsExecutor,
    | "executeCommand"
    | "hasPendingInteractiveResults"
    | "getPendingInteractiveResults"
    | "handleUserSelectionResult"
    | "on"
>;

export interface DirectCopilotProviderOptions {
    fetchImpl?: typeof fetch;
    resolveKey?: () => Promise<CopilotChatKey | null>;
    resolveKeyChoice?: () => Promise<CopilotChatKeyChoice>;
    createExecutor?: () => DirectExecutor;
    llmClient?: PlaygroundLLMClient;
}

type CommandEventMeta = {
    index?: number;
    total?: number;
};

type InspectionRound = {
    script: string;
    results: InspectionCommandResult[];
};

type InspectionCommandResult = {
    lineNumber: number;
    command: string;
    success: boolean;
    message?: string;
    data?: unknown;
    error?: string;
};

type StemscriptExecution = Awaited<ReturnType<typeof ScriptExecutor.execute>>;

type MutationValidationFailure = {
    script: string;
    error: string;
};

type VerifiedStemscriptExecution = {
    script: string;
    execution: StemscriptExecution;
    verification?: ScriptCheckReport;
};

type ArtifactExecutionSummary = {
    artifact: PlaygroundPlanArtifact;
    success: boolean;
    message?: string;
    error?: string;
};

type PhaseExecutionSummary = {
    phase: PlaygroundPlanPhase;
    label: string;
    artifacts: ArtifactExecutionSummary[];
    inspections: InspectionCommandResult[];
    script: string;
    validationFailure?: MutationValidationFailure;
    execution?: StemscriptExecution;
    verification?: ScriptCheckReport;
    skippedReason?: string;
};

type StructuredPlanExecutionSummary = {
    artifacts: ArtifactExecutionSummary[];
    phases: PhaseExecutionSummary[];
    executedCommands: number;
    successCount: number;
    failureCount: number;
    artifactSuccessCount: number;
    artifactFailureCount: number;
    verificationProbes: number;
    verificationPassed: number;
    verificationFailed: number;
};

type PlanRunResult = {
    message: string;
    mutated: boolean;
    needsRepair: boolean;
    repairContext?: Record<string, unknown>;
};

export class DirectCopilotProvider implements ICopilotProvider {
    readonly isSuppressingSessionUpdates = false;

    private connected = false;
    private connectionState: ConnectionState = ConnectionState.DISCONNECTED;
    private sessionId: string | null = null;
    private history: ChatMessage[] = [];
    private readonly handlers = new Map<ACPEventType, Set<CopilotEventHandler>>();
    private abortController: AbortController | null = null;
    private executor: DirectExecutor | null = null;
    private readonly resolveKeyChoice: () => Promise<CopilotChatKeyChoice>;
    private readonly createExecutor: () => DirectExecutor;
    private readonly llmClient: PlaygroundLLMClient;

    constructor(options: DirectCopilotProviderOptions = {}) {
        const fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
        this.resolveKeyChoice =
            options.resolveKeyChoice ??
            (options.resolveKey
                ? async () => {
                    const key = await options.resolveKey!();
                    return key ? {kind: "ready", key, keys: [key]} : {kind: "none", keys: []};
                }
                : resolveCopilotChatKeyChoice);
        this.createExecutor =
            options.createExecutor ??
            (() => new CommandsExecutor(new CommandsRegistry({getSessionId: () => this.sessionId})));
        this.llmClient = options.llmClient ?? createPlaygroundLLMClient(fetchImpl);
    }

    private emit(type: ACPEventType, data?: ACPEvent["data"]): void {
        const set = this.handlers.get(type);
        if (!set) return;
        for (const handler of set) {
            try {
                handler({type, data});
            } catch (err) {
                console.error(`[DirectCopilotProvider] handler for "${type}" threw`, err);
            }
        }
    }

    private getExecutor(): DirectExecutor {
        if (!this.executor) {
            this.executor = this.createExecutor();
            this.executor.on("interactiveResult", (interactive: InteractiveResult) => {
                this.emit("interactiveResult", interactive);
            });
        }
        return this.executor;
    }

    on(eventType: ACPEventType, handler: CopilotEventHandler): void {
        let set = this.handlers.get(eventType);
        if (!set) {
            set = new Set();
            this.handlers.set(eventType, set);
        }
        set.add(handler);
    }

    async connect(): Promise<void> {
        this.connected = true;
        this.connectionState = ConnectionState.CONNECTED;
        this.emit("connected");
    }

    disconnect(): void {
        this.cancel();
        this.connected = false;
        this.connectionState = ConnectionState.DISCONNECTED;
        this.emit("disconnected");
    }

    isConnected(): boolean {
        return this.connected;
    }

    getConnectionState(): ConnectionState {
        return this.connectionState;
    }

    private cancel(): void {
        this.abortController?.abort();
        this.abortController = null;
    }

    async cancelCurrentTask(): Promise<void> {
        this.cancel();
        this.emit("taskCancelled");
    }

    async createSession(): Promise<string> {
        this.sessionId =
            typeof crypto !== "undefined" && crypto.randomUUID
                ? crypto.randomUUID()
                : `direct-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        this.history = [];
        this.emit("sessionCreated", {sessionId: this.sessionId});
        return this.sessionId;
    }

    async loadSession(sessionId: string): Promise<void> {
        this.sessionId = sessionId;
    }

    getCurrentSessionId(): string | null {
        return this.sessionId;
    }

    getSessionId(): string | null {
        return this.sessionId;
    }

    async prompt(promptText: string, context: Record<string, unknown> = {}): Promise<string> {
        this.emit("promptStarted", {prompt: promptText});

        const keyChoice = await this.resolveKeyChoice();
        if (keyChoice.kind === "none") {
            this.emit("agentMessage", {message: NO_KEY_MESSAGE, replayStartNewMessage: true});
            this.emit("promptCompleted");
            return NO_KEY_MESSAGE;
        }
        if (keyChoice.kind === "needs-selection") {
            const message = [
                MULTIPLE_KEYS_MESSAGE,
                "",
                "Available models:",
                ...keyChoice.keys.map(key => `- ${key.provider}: ${key.model}`),
            ].join("\n");
            this.emit("agentMessage", {message, replayStartNewMessage: true});
            this.emit("promptCompleted");
            return message;
        }

        const {key} = keyChoice;

        const controller = new AbortController();
        this.abortController = controller;

        try {
            this.emit("agentThinking", {message: "Generating StemScript for the live scene..."});

            let providerPrompt = this.buildProviderPrompt(promptText, context);
            let knowledgePrompt = this.buildKnowledgePrompt(promptText, context);
            let rawPlan = await this.requestPlan(key, providerPrompt, knowledgePrompt, controller.signal);
            let plan = parseProviderStemscriptPlan(rawPlan);
            const inspections: InspectionRound[] = [];

            for (let round = 0; round < MAX_INSPECTION_ROUNDS && plan.inspectionStemscript.trim(); round++) {
                const validatedInspection = validateInspectionStemscript(plan.inspectionStemscript);
                if (validatedInspection.executableCommands > 0) {
                    this.emit("toolCall", {toolCall: {title: "Inspect scene"}});
                    const results = await this.executeInspectionStemscript(validatedInspection.script, controller.signal);
                    inspections.push({script: validatedInspection.script, results});
                }

                this.emit("agentThinking", {message: "Planning changes from scene inspection..."});
                providerPrompt = this.buildProviderPrompt(promptText, context, {
                    inspections,
                    previousPlan: plan,
                });
                knowledgePrompt = this.buildKnowledgePrompt(promptText, context, {
                    inspections,
                    previousPlan: plan,
                });
                rawPlan = await this.requestPlan(key, providerPrompt, knowledgePrompt, controller.signal);
                plan = parseProviderStemscriptPlan(rawPlan);
            }

            let runResult = await this.runPlan(plan, controller.signal);
            let finalMessage = runResult.message;

            if (runResult.needsRepair) {
                this.emit("agentThinking", {message: "Repairing generated scene changes..."});
                const repairPrompt = this.buildRepairPrompt(promptText, context, plan, runResult.repairContext);
                const repairKnowledge = this.buildKnowledgePrompt(promptText, {
                    ...context,
                    repair: runResult.repairContext,
                });
                const repairRawPlan = await this.requestPlan(key, repairPrompt, repairKnowledge, controller.signal);
                const repairPlan = parseProviderStemscriptPlan(repairRawPlan);
                const repairResult = await this.runPlan(repairPlan, controller.signal, {isRepair: true});
                finalMessage = this.formatRepairSummary(finalMessage, repairResult.message);
                runResult = {
                    ...repairResult,
                    mutated: runResult.mutated || repairResult.mutated,
                    needsRepair: false,
                };
            }

            if (runResult.mutated) {
                finalMessage = this.appendSatisfactionPrompt(finalMessage);
            }

            this.emit("agentMessage", {message: finalMessage, replayStartNewMessage: true});
            this.history.push({role: "user", content: promptText});
            this.history.push({role: "assistant", content: finalMessage});
            this.history = this.history.slice(-8);
            return finalMessage;
        } catch (err) {
            const message =
                err instanceof DOMException && err.name === "AbortError"
                    ? "(cancelled)"
                    : `Copilot request failed: ${err instanceof Error ? err.message : String(err)}`;
            this.emit("agentMessage", {message, replayStartNewMessage: true});
            return message;
        } finally {
            this.abortController = null;
            this.emit("promptCompleted");
        }
    }

    private buildProviderPrompt(
        promptText: string,
        context: Record<string, unknown>,
        inspectionContext?: {inspections: InspectionRound[]; previousPlan: PlaygroundStemscriptPlan},
    ): string {
        const sceneSummary = buildStructuredSceneSummary();
        const behaviorRegistry = buildBehaviorRegistrySummary();
        const lambdaRegistry = buildLambdaRegistrySummary();
        const recentHistory = this.history.slice(-6);

        return [
            "User request:",
            promptText,
            "",
            "Current scene summary JSON:",
            JSON.stringify(sceneSummary ?? {}, null, 2),
            "",
            behaviorRegistry.length > 0 ? "Available behavior registry JSON:" : "",
            behaviorRegistry.length > 0 ? JSON.stringify(behaviorRegistry, null, 2) : "",
            behaviorRegistry.length > 0 ? "Use these exact behaviorId values for existing behavior attachments." : "",
            behaviorRegistry.length > 0 ? "" : "",
            lambdaRegistry.length > 0 ? "Available lambda registry JSON:" : "",
            lambdaRegistry.length > 0 ? JSON.stringify(lambdaRegistry, null, 2) : "",
            lambdaRegistry.length > 0 ? "Use these exact lambdaId values for lambda inspection and references." : "",
            lambdaRegistry.length > 0 ? "" : "",
            inspectionContext ? "Previous provider plan JSON:" : "",
            inspectionContext ? JSON.stringify({
                inspectionStemscript: inspectionContext.previousPlan.inspectionStemscript,
                reply: inspectionContext.previousPlan.reply,
                designBrief: inspectionContext.previousPlan.designBrief,
                assetRequests: inspectionContext.previousPlan.assetRequests,
                notes: inspectionContext.previousPlan.notes,
            }, null, 2) : "",
            inspectionContext ? "" : "",
            inspectionContext ? "Inspection results JSON:" : "",
            inspectionContext ? JSON.stringify(inspectionContext.inspections, null, 2) : "",
            inspectionContext ? "" : "",
            "Attached/request context JSON:",
            JSON.stringify(context ?? {}, null, 2),
            "",
            recentHistory.length > 0 ? "Recent conversation JSON:" : "",
            recentHistory.length > 0 ? JSON.stringify(recentHistory, null, 2) : "",
            "",
            inspectionContext
                ? "Return final JSON only. You may request another inspectionStemscript only if the results are still insufficient; otherwise produce the mutation stemscript."
                : "Return JSON only. Use inspectionStemscript for read-only scene queries before edits. Use an empty stemscript string if no scene change should be applied.",
        ].filter(part => part !== "").join("\n");
    }

    private buildKnowledgePrompt(
        promptText: string,
        context: Record<string, unknown>,
        inspectionContext?: {inspections: InspectionRound[]; previousPlan: PlaygroundStemscriptPlan},
    ): string {
        return selectPlaygroundKnowledgeCards({
            promptText,
            context,
            inspectionText: inspectionContext ? safeJsonStringify({
                inspections: inspectionContext.inspections,
                previousPlan: {
                    reply: inspectionContext.previousPlan.reply,
                    designBrief: inspectionContext.previousPlan.designBrief,
                    assetRequests: inspectionContext.previousPlan.assetRequests,
                    notes: inspectionContext.previousPlan.notes,
                    phases: inspectionContext.previousPlan.phases.map(phase => ({
                        name: phase.name,
                        goal: phase.goal,
                        artifacts: phase.artifacts.map(artifact => ({
                            type: artifact.type,
                            name: artifact.name,
                            description: artifact.description,
                        })),
                    })),
                },
            }) : undefined,
        }).prompt;
    }

    private async requestPlan(
        key: CopilotChatKey,
        prompt: string,
        knowledgePrompt: string,
        signal: AbortSignal,
    ): Promise<string> {
        const streamReporter = this.createStreamProgressReporter(key);
        try {
            const text = await this.llmClient.generateText({
                key,
                prompt,
                signal,
                systemPrompt: SYSTEM_PROMPT,
                knowledgePrompt,
                promptCacheKey: PLAYGROUND_PROMPT_CACHE_KEY,
                maxOutputTokens: getPlaygroundMaxOutputTokens(key),
                onStreamProgress: streamReporter?.onProgress,
            });
            streamReporter?.finish();
            return text;
        } catch (error) {
            streamReporter?.finish({failed: true});
            throw error;
        }
    }

    private createStreamProgressReporter(key: CopilotChatKey): {
        onProgress: (progress: PlaygroundLLMStreamProgress) => void;
        finish: (options?: {failed?: boolean}) => void;
    } | null {
        if (key.provider !== "openai") return null;

        let textChars = 0;
        let rawTextChars = 0;
        let reasoningChars = 0;
        let rawEvents = 0;
        let lastEmitAt = 0;
        let lastTextChars = 0;
        let emitted = false;

        this.emit("toolCall", {toolCall: {title: "Stream OpenAI response"}});

        const effectiveTextChars = () => Math.max(textChars, rawTextChars);
        const describe = () => [
            `text=${formatCount(effectiveTextChars())} chars`,
            rawTextChars > 0 && textChars === 0 ? "from raw event stream" : "",
            reasoningChars > 0 ? `reasoning=${formatCount(reasoningChars)} chars` : "",
            rawEvents > 0 ? `events=${rawEvents}` : "",
        ].filter(Boolean).join(", ");

        const emitProgress = (force = false) => {
            const now = Date.now();
            const currentTextChars = effectiveTextChars();
            if (!force && emitted && now - lastEmitAt < 1500 && currentTextChars - lastTextChars < 2048) {
                return;
            }

            emitted = true;
            lastEmitAt = now;
            lastTextChars = currentTextChars;
            this.emit("toolCallUpdate", {
                line: `OpenAI stream active (${describe() || "waiting for first chunk"})`,
            });
        };

        return {
            onProgress: progress => {
                const textCharsBefore = effectiveTextChars();
                if (progress.type === "text") {
                    if (progress.source === "openai-raw") {
                        rawTextChars += progress.delta.length;
                    } else {
                        textChars += progress.delta.length;
                    }
                } else if (progress.type === "reasoning") {
                    reasoningChars += progress.delta.length;
                } else {
                    rawEvents += 1;
                }
                const hasFirstText = textCharsBefore === 0 && effectiveTextChars() > 0;
                emitProgress(hasFirstText || (rawEvents === 1 && effectiveTextChars() === 0 && reasoningChars === 0));
            },
            finish: options => {
                if (!emitted && effectiveTextChars() === 0 && reasoningChars === 0 && rawEvents === 0) return;
                this.emit("toolCallUpdate", {
                    line: options?.failed
                        ? `OpenAI stream ended before a usable plan was received (${describe() || "no chunks"})`
                        : `OpenAI stream complete (${describe()}); parsing plan`,
                });
            },
        };
    }

    private async runPlan(
        plan: PlaygroundStemscriptPlan,
        signal: AbortSignal,
        options: {isRepair?: boolean} = {},
    ): Promise<PlanRunResult> {
        const reply = plan.reply || (options.isRepair ? "Repair attempted." : "Done.");

        if (this.hasEssentialAssetRequests(plan)) {
            return {
                message: this.formatAssetRequestMessage(reply, plan),
                mutated: false,
                needsRepair: false,
            };
        }

        if (this.hasStructuredPlan(plan)) {
            const execution = await this.executeStructuredPlan(plan, signal);
            const message = this.formatStructuredPlanSummary(reply, execution, plan);
            return {
                message,
                mutated: this.structuredPlanMutated(execution),
                needsRepair: this.structuredPlanNeedsRepair(execution),
                repairContext: this.buildStructuredRepairContext(plan, execution),
            };
        }

        if (plan.stemscript.trim()) {
            const validation = this.validateMutationStemscript(plan.stemscript);
            if (validation.failure) {
                const message = this.formatValidationFailureSummary(reply, validation.failure);
                return {
                    message,
                    mutated: false,
                    needsRepair: true,
                    repairContext: {
                        kind: "validation",
                        failure: validation.failure,
                        plan: this.compactPlanForPrompt(plan),
                    },
                };
            }

            const validated = validation.validated;
            if (!validated || validated.executableCommands <= 0) {
                const failure: MutationValidationFailure = {
                    script: plan.stemscript,
                    error: "Generated StemScript was non-empty but contained no executable commands.",
                };
                return {
                    message: this.formatValidationFailureSummary(reply, failure),
                    mutated: false,
                    needsRepair: true,
                    repairContext: {
                        kind: "empty-generation",
                        failure,
                        plan: this.compactPlanForPrompt(plan),
                    },
                };
            }

            this.emit("toolCall", {toolCall: {title: options.isRepair ? "Apply repair StemScript commands" : "Apply StemScript commands"}});
            const execution = await this.executeAndVerifyStemscript(validated.script, signal);
            const message = this.formatExecutionSummary(reply, execution.script, execution.execution, execution.verification, plan);
            return {
                message,
                mutated: execution.execution.executedCommands > 0,
                needsRepair: execution.execution.failCount > 0 || (execution.verification?.failed ?? 0) > 0,
                repairContext: this.buildSimpleRepairContext(plan, execution),
            };
        }

        return {
            message: this.formatNoMutationSummary(reply, plan),
            mutated: false,
            needsRepair: false,
        };
    }

    private hasStructuredPlan(plan: PlaygroundStemscriptPlan): boolean {
        return plan.artifacts.length > 0 || plan.phases.length > 0;
    }

    private hasEssentialAssetRequests(plan: PlaygroundStemscriptPlan): boolean {
        return plan.assetRequests.some(request => request.essential === true);
    }

    private validateMutationStemscript(script: string): {
        validated?: ReturnType<typeof validateGeneratedStemscript>;
        failure?: MutationValidationFailure;
    } {
        try {
            return {validated: validateGeneratedStemscript(script)};
        } catch (error) {
            return {
                failure: {
                    script,
                    error: error instanceof Error ? error.message : String(error),
                },
            };
        }
    }

    private structuredPlanMutated(execution: StructuredPlanExecutionSummary): boolean {
        return execution.executedCommands > 0 || execution.artifactSuccessCount > 0;
    }

    private structuredPlanNeedsRepair(execution: StructuredPlanExecutionSummary): boolean {
        return (
            execution.artifactFailureCount > 0 ||
            execution.failureCount > 0 ||
            execution.verificationFailed > 0 ||
            execution.phases.some(phase => Boolean(phase.validationFailure))
        );
    }

    private async executeStructuredPlan(
        plan: PlaygroundStemscriptPlan,
        signal: AbortSignal,
    ): Promise<StructuredPlanExecutionSummary> {
        const summary: StructuredPlanExecutionSummary = {
            artifacts: [],
            phases: [],
            executedCommands: 0,
            successCount: 0,
            failureCount: 0,
            artifactSuccessCount: 0,
            artifactFailureCount: 0,
            verificationProbes: 0,
            verificationPassed: 0,
            verificationFailed: 0,
        };

        if (plan.artifacts.length > 0) {
            this.emit("toolCall", {toolCall: {title: "Create reusable copilot artifacts"}});
            const artifacts = await this.materializeArtifacts(plan.artifacts, signal);
            summary.artifacts.push(...artifacts);
            this.countArtifacts(summary, artifacts);
            if (artifacts.some(result => !result.success)) return summary;
        }

        const phases: PlaygroundPlanPhase[] = [];
        if (plan.stemscript.trim()) {
            phases.push({
                name: "StemScript",
                goal: "Apply top-level mutation script",
                inspectionStemscript: "",
                stemscript: plan.stemscript,
                artifacts: [],
            });
        }
        phases.push(...plan.phases);

        for (let i = 0; i < phases.length; i++) {
            const phase = phases[i]!;
            const label = phase.name || phase.id || phase.goal || `Phase ${i + 1}`;
            this.emit("toolCall", {toolCall: {title: `Apply ${label}`}});
            const phaseSummary = await this.executePlanPhase(phase, label, signal);
            summary.phases.push(phaseSummary);
            this.countArtifacts(summary, phaseSummary.artifacts);

            if (phaseSummary.execution) {
                summary.executedCommands += phaseSummary.execution.executedCommands;
                summary.successCount += phaseSummary.execution.successCount;
                summary.failureCount += phaseSummary.execution.failCount;
            }
            if (phaseSummary.verification) {
                summary.verificationProbes += phaseSummary.verification.probes;
                summary.verificationPassed += phaseSummary.verification.passed;
                summary.verificationFailed += phaseSummary.verification.failed;
            }

            const phaseFailed =
                phaseSummary.artifacts.some(result => !result.success) ||
                Boolean(phaseSummary.validationFailure) ||
                (phaseSummary.execution?.failCount ?? 0) > 0 ||
                (phaseSummary.verification?.failed ?? 0) > 0;
            if (phaseFailed) break;
        }

        return summary;
    }

    private async executePlanPhase(
        phase: PlaygroundPlanPhase,
        label: string,
        signal: AbortSignal,
    ): Promise<PhaseExecutionSummary> {
        const artifacts = await this.materializeArtifacts(phase.artifacts, signal);
        if (artifacts.some(result => !result.success)) {
            return {
                phase,
                label,
                artifacts,
                inspections: [],
                script: phase.stemscript,
                skippedReason: "Skipped phase commands because a required reusable artifact could not be created.",
            };
        }

        let inspections: InspectionCommandResult[] = [];
        if (phase.inspectionStemscript.trim()) {
            const validatedInspection = validateInspectionStemscript(phase.inspectionStemscript);
            if (validatedInspection.executableCommands > 0) {
                inspections = await this.executeInspectionStemscript(validatedInspection.script, signal);
            }
        }
        if (inspections.some(result => !result.success)) {
            return {
                phase,
                label,
                artifacts,
                inspections,
                script: phase.stemscript,
                skippedReason: "Skipped phase commands because a read-only phase inspection failed.",
            };
        }

        const validation = this.validateMutationStemscript(phase.stemscript);
        if (validation.failure) {
            return {
                phase,
                label,
                artifacts,
                inspections,
                script: phase.stemscript,
                validationFailure: validation.failure,
            };
        }

        const validated = validation.validated;
        if (!validated || validated.executableCommands <= 0) {
            if (phase.stemscript.trim()) {
                return {
                    phase,
                    label,
                    artifacts,
                    inspections,
                    script: validated?.script ?? "",
                    validationFailure: {
                        script: phase.stemscript,
                        error: "Generated StemScript was non-empty but contained no executable commands.",
                    },
                };
            }
            return {
                phase,
                label,
                artifacts,
                inspections,
                script: validated?.script ?? "",
            };
        }

        const execution = await this.executeAndVerifyStemscript(validated.script, signal);
        return {
            phase,
            label,
            artifacts,
            inspections,
            script: validated.script,
            execution: execution.execution,
            verification: execution.verification,
        };
    }

    private async materializeArtifacts(
        artifacts: PlaygroundPlanArtifact[],
        signal: AbortSignal,
    ): Promise<ArtifactExecutionSummary[]> {
        const results: ArtifactExecutionSummary[] = [];
        for (let i = 0; i < artifacts.length; i++) {
            if (signal.aborted) {
                throw new DOMException("Aborted", "AbortError");
            }
            const artifact = artifacts[i]!;
            this.emit("toolCallUpdate", {
                line: `${artifact.type} artifact ${artifact.name}`,
                index: i,
                total: artifacts.length,
            });
            results.push(await this.materializeArtifact(artifact, {index: i, total: artifacts.length}));
        }
        return results;
    }

    private async materializeArtifact(
        artifact: PlaygroundPlanArtifact,
        meta: CommandEventMeta = {},
    ): Promise<ArtifactExecutionSummary> {
        try {
            if (artifact.type === "behavior") {
                return await this.materializeBehaviorArtifact(artifact, meta);
            }
            if (artifact.type === "lambda") {
                return await this.materializeLambdaArtifact(artifact);
            }
            if (artifact.type === "scriptImport") {
                return await this.materializeScriptImportArtifact(artifact);
            }
            if (artifact.type === "file") {
                return await this.materializeFileArtifact(artifact);
            }
            return {
                artifact,
                success: false,
                error: `Unsupported artifact type "${artifact.type}".`,
            };
        } catch (error) {
            return {
                artifact,
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    private async materializeBehaviorArtifact(
        artifact: PlaygroundPlanArtifact,
        meta: CommandEventMeta = {},
    ): Promise<ArtifactExecutionSummary> {
        if (!artifact.code?.trim()) {
            return {
                artifact,
                success: false,
                error: `Behavior artifact "${artifact.name}" is missing code.`,
            };
        }

        const params = removeUndefined({
            name: artifact.name,
            code: artifact.code,
            description: artifact.description,
            metadata: artifact.metadata,
            version: artifact.version,
            author: artifact.author,
        });
        const result = await this.executeRegistryCommand("add_behavior", params, meta);
        return {
            artifact,
            success: result.success,
            message: stringifyForPrompt(result.result?.message, 800),
            error: result.error,
        };
    }

    private async materializeLambdaArtifact(artifact: PlaygroundPlanArtifact): Promise<ArtifactExecutionSummary> {
        const code = artifact.code?.trim();
        if (!code) {
            return {
                artifact,
                success: false,
                error: `Lambda artifact "${artifact.name}" is missing code.`,
            };
        }

        const config = this.buildLambdaConfig(artifact);
        const configStr = JSON.stringify(config);
        const data = JSON.stringify({config: configStr, code});
        const asset = await this.createOrUpdateArtifactAsset(artifact, {
            type: AssetType.Lambda,
            data,
            format: artifact.format || "json",
            contentType: artifact.contentType || "application/json",
            dependencies: await this.getScriptDependencies(code),
        });

        seedAssetRevisionData(queryClient, asset.assetId, asset.revisionId, "json", {config: configStr, code});
        this.pinAssetRevision(asset.assetId, asset.revisionId);
        await updateSceneLambdaRevision({
            assetId: asset.assetId,
            revisionId: asset.revisionId,
            code,
            configStr,
        });

        return {
            artifact,
            success: true,
            message: `${asset.created ? "Created" : "Updated"} lambda ${artifact.name} (${asset.assetId}).`,
        };
    }

    private async materializeScriptImportArtifact(artifact: PlaygroundPlanArtifact): Promise<ArtifactExecutionSummary> {
        const code = (artifact.code ?? artifact.content)?.trim();
        if (!code) {
            return {
                artifact,
                success: false,
                error: `Script import artifact "${artifact.name}" is missing code.`,
            };
        }

        const data = JSON.stringify({code});
        const asset = await this.createOrUpdateArtifactAsset(artifact, {
            type: AssetType.Script,
            data,
            format: artifact.format || "json",
            contentType: artifact.contentType || "application/json",
            dependencies: await this.getScriptDependencies(code),
        });

        seedAssetRevisionData(queryClient, asset.assetId, asset.revisionId, "json", {code});
        this.pinAssetRevision(asset.assetId, asset.revisionId);
        await updateSceneScriptRevision({
            assetId: asset.assetId,
            revisionId: asset.revisionId,
            code,
        });

        return {
            artifact,
            success: true,
            message: `${asset.created ? "Created" : "Updated"} script import ${artifact.name} (${asset.assetId}).`,
        };
    }

    private async materializeFileArtifact(artifact: PlaygroundPlanArtifact): Promise<ArtifactExecutionSummary> {
        const content = artifact.content ?? artifact.code;
        if (content === undefined) {
            return {
                artifact,
                success: false,
                error: `File artifact "${artifact.name}" is missing content.`,
            };
        }

        const format = artifact.format || inferFileFormat(artifact.name);
        const asset = await this.createOrUpdateArtifactAsset(artifact, {
            type: AssetType.File,
            data: content,
            format,
            contentType: artifact.contentType || contentTypeForFormat(format),
        });

        this.pinAssetRevision(asset.assetId, asset.revisionId);

        return {
            artifact,
            success: true,
            message: `${asset.created ? "Created" : "Updated"} file ${artifact.name} (${asset.assetId}).`,
        };
    }

    private async createOrUpdateArtifactAsset(
        artifact: PlaygroundPlanArtifact,
        params: {
            type: typeof AssetType[keyof typeof AssetType];
            data: string | ArrayBuffer | Blob | ReadableStream;
            format: string;
            contentType: string;
            dependencies?: Record<string, string>;
        },
    ): Promise<{assetId: string; revisionId: string; created: boolean}> {
        const assetSource = global.app?.editor?.assetSource;
        if (!assetSource) {
            throw new Error(`${artifact.type} artifact "${artifact.name}" requires an active scene asset source.`);
        }

        const existing = await this.findExistingArtifactAsset(artifact, params.type);
        const options = removeUndefined({
            description: artifact.description,
            metadata: artifact.metadata,
            dependencies: params.dependencies && Object.keys(params.dependencies).length > 0
                ? params.dependencies
                : undefined,
        }) as {description?: string; metadata?: Record<string, unknown>; dependencies?: Record<string, string>};

        if (existing) {
            const parentRevisionId = existing.headRevisionId || existing.revisionId;
            if (!parentRevisionId) {
                throw new Error(`Existing asset "${existing.name}" has no revision to update.`);
            }
            const revision = await createAssetRevision({
                assetId: existing.id,
                parentRevisionId,
                data: params.data,
                format: params.format,
                contentType: params.contentType,
                options,
            });
            return {assetId: existing.id, revisionId: revision.id, created: false};
        }

        const asset = await createAsset({
            assetSource,
            type: params.type,
            name: artifact.name,
            data: params.data,
            format: params.format,
            contentType: params.contentType,
            options,
        });
        return {assetId: asset.id, revisionId: asset.headRevisionId, created: true};
    }

    private async findExistingArtifactAsset(
        artifact: PlaygroundPlanArtifact,
        type: typeof AssetType[keyof typeof AssetType],
    ): Promise<Asset | undefined> {
        const assetSource = global.app?.editor?.assetSource;
        if (!assetSource) return undefined;
        const {assets} = await assetSource.getAssets({types: [type]});
        const targetId = artifact.assetId?.trim();
        const normalizedName = artifact.name.trim().toLowerCase();
        return assets.find(asset =>
            (targetId && asset.id === targetId) ||
            asset.name === artifact.name ||
            asset.name?.trim().toLowerCase() === normalizedName);
    }

    private async getScriptDependencies(code: string): Promise<Record<string, string>> {
        try {
            const scene = global.app?.scene;
            const editor = global.app?.editor;
            const sceneContext = scene ? getAssetResolutionContext(scene) || undefined : undefined;
            const importContext = await buildNameAwareScriptImportContext(editor?.sceneID, sceneContext);
            return getScriptImportDependencyMap(code, importContext);
        } catch (error) {
            console.warn("[DirectCopilotProvider] Failed to resolve script dependencies for artifact:", error);
            return {};
        }
    }

    private pinAssetRevision(assetId: string, revisionId: string): void {
        const app = global.app;
        const scene = app?.scene;
        if (!app || !scene) return;
        setAssetRevision(scene, assetId, revisionId);
        app.call("objectChanged", null, scene);
    }

    private buildLambdaConfig(artifact: PlaygroundPlanArtifact): LambdaConfig {
        const parsedConfig = typeof artifact.config === "string"
            ? tryParseJsonObject(artifact.config)
            : artifact.config;
        const configRecord = parsedConfig && typeof parsedConfig === "object" && !Array.isArray(parsedConfig)
            ? parsedConfig as Partial<LambdaConfig>
            : {};
        const metadataConfig = artifact.metadata?.config;
        const metadataRecord = metadataConfig && typeof metadataConfig === "object" && !Array.isArray(metadataConfig)
            ? metadataConfig as Partial<LambdaConfig>
            : {};
        const merged = {...metadataRecord, ...configRecord};

        return {
            id: typeof merged.id === "string" && merged.id.trim() ? merged.id.trim() : slugifyArtifactName(artifact.name),
            name: typeof merged.name === "string" && merged.name.trim() ? merged.name.trim() : artifact.name,
            description: typeof merged.description === "string" ? merged.description : artifact.description || "",
            author: typeof merged.author === "string" ? merged.author : artifact.author || "",
            version: typeof merged.version === "string" && merged.version.trim() ? merged.version.trim() : artifact.version || "1.0.0",
            main: typeof merged.main === "string" && merged.main.trim() ? merged.main.trim() : "index.js",
            tags: Array.isArray(merged.tags) ? merged.tags.filter((tag): tag is string => typeof tag === "string") : [],
            attributes: isRecord(merged.attributes) ? merged.attributes as LambdaConfig["attributes"] : {},
            componentSchema: isRecord(merged.componentSchema) ? merged.componentSchema as LambdaConfig["componentSchema"] : {},
            ...(typeof merged.isCritical === "boolean" ? {isCritical: merged.isCritical} : {}),
            ...(Array.isArray(merged.readComponents) ? {readComponents: merged.readComponents.filter((item): item is string => typeof item === "string")} : {}),
            ...(Array.isArray(merged.writeComponents) ? {writeComponents: merged.writeComponents.filter((item): item is string => typeof item === "string")} : {}),
        };
    }

    private countArtifacts(
        summary: StructuredPlanExecutionSummary,
        artifacts: ArtifactExecutionSummary[],
    ): void {
        for (const artifact of artifacts) {
            if (artifact.success) {
                summary.artifactSuccessCount++;
            } else {
                summary.artifactFailureCount++;
            }
        }
    }

    private async executeInspectionStemscript(
        script: string,
        signal: AbortSignal,
    ): Promise<InspectionCommandResult[]> {
        const lines = ScriptExecutor.parseScript(script).filter(line => !line.isComment && !line.isEmpty && line.parsed);
        const results: InspectionCommandResult[] = [];

        for (let i = 0; i < lines.length; i++) {
            if (signal.aborted) {
                throw new DOMException("Aborted", "AbortError");
            }
            const line = lines[i]!;
            const parsed = line.parsed!;
            this.emit("toolCallUpdate", {line: parsed.raw, index: i, total: lines.length});

            try {
                const result = await this.executeRegistryCommand(parsed.command, parsed.params, {
                    index: i,
                    total: lines.length,
                });
                results.push({
                    lineNumber: line.lineNumber,
                    command: parsed.raw,
                    success: result.success,
                    message: stringifyForPrompt(result.result?.message, 800),
                    data: compactForPrompt(result.result?.data),
                    error: result.error,
                });
            } catch (err) {
                results.push({
                    lineNumber: line.lineNumber,
                    command: parsed.raw,
                    success: false,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }

        return results;
    }

    private async executeStemscript(
        script: string,
        signal: AbortSignal,
    ): Promise<ReturnType<typeof ScriptExecutor.execute> extends Promise<infer T> ? T : never> {
        let currentIndex = 0;
        let total = 0;

        return ScriptExecutor.execute(
            script,
            async (command, params) => {
                if (signal.aborted) {
                    throw new DOMException("Aborted", "AbortError");
                }
                const result = await this.executeRegistryCommand(command, params, {
                    index: currentIndex,
                    total,
                });
                return {
                    success: result.success,
                    message: result.result?.message,
                    error: result.error,
                };
            },
            (current, nextTotal, line) => {
                currentIndex = current - 1;
                total = nextTotal;
                this.emit("toolCallUpdate", {line, index: currentIndex, total});
            },
        );
    }

    private async executeAndVerifyStemscript(
        script: string,
        signal: AbortSignal,
    ): Promise<VerifiedStemscriptExecution> {
        const execution = await this.executeStemscript(script, signal);
        const verification = await this.verifyStemscript(script, signal);
        return {script, execution, verification};
    }

    private async verifyStemscript(
        script: string,
        signal: AbortSignal,
    ): Promise<ScriptCheckReport> {
        this.emit("toolCall", {toolCall: {title: "Verify scene updates"}});
        return runScriptCheck(script, async (command, params) => {
            if (signal.aborted) {
                throw new DOMException("Aborted", "AbortError");
            }
            const result = await this.executeRegistryCommand(command, params);
            return {
                success: result.success,
                data: result.result?.data,
                message: stringifyForPrompt(result.result?.message, 800),
                error: result.error || (!result.success ? stringifyForPrompt(result.result?.message, 800) : undefined),
            };
        });
    }

    private async executeRegistryCommand(
        command: string,
        params: Record<string, unknown>,
        meta: CommandEventMeta = {},
    ): Promise<CommandExecutionResult> {
        this.emit("commandWillExecute", {command, parameters: params, ...meta});
        const rawResult = await this.getExecutor().executeCommand(command, params);
        const commandStatus = rawResult.result?.status;
        const success = rawResult.success && commandStatus !== "failed" && commandStatus !== "error";
        const result: CommandExecutionResult = success
            ? rawResult
            : {
                ...rawResult,
                success: false,
                error: rawResult.error || stringifyForPrompt(rawResult.result?.message, 800) || "Command failed",
            };
        if (success) {
            this.emit("commandExecuted", {command, parameters: params, result: rawResult.result, ...meta});
        } else {
            this.emit("commandExecutionFailed", {command, parameters: params, error: result.error, ...meta});
        }
        return result;
    }

    private formatExecutionSummary(
        reply: string,
        script: string,
        execution: Awaited<ReturnType<typeof ScriptExecutor.execute>>,
        verification?: ScriptCheckReport,
        plan?: PlaygroundStemscriptPlan,
    ): string {
        const failures = execution.results.filter(result => !result.success);
        const lines = [
            reply,
            ...this.formatDesignBriefLines(plan),
            "",
            "```stemscript",
            script,
            "```",
            "",
            `Applied ${execution.successCount}/${execution.executedCommands} command(s).`,
        ];
        this.appendVerificationLines(lines, verification);
        this.appendOptionalAssetRequestLines(lines, plan);

        if (failures.length > 0) {
            lines.push("");
            lines.push("Some commands failed:");
            for (const failure of failures.slice(0, 5)) {
                lines.push(`- Line ${failure.lineNumber}: ${failure.error || "Unknown error"}`);
            }
        }

        return lines.join("\n").trim();
    }

    private formatValidationFailureSummary(reply: string, failure: MutationValidationFailure): string {
        return [
            reply,
            "",
            "The generated StemScript could not be applied.",
            `Validation: ${failure.error}`,
        ].join("\n").trim();
    }

    private formatNoMutationSummary(reply: string, plan: PlaygroundStemscriptPlan): string {
        const lines = [reply, ...this.formatDesignBriefLines(plan)];
        this.appendOptionalAssetRequestLines(lines, plan);
        return lines.join("\n").trim();
    }

    private formatAssetRequestMessage(reply: string, plan: PlaygroundStemscriptPlan): string {
        const lines = [reply || "I need approval before generating external assets.", ...this.formatDesignBriefLines(plan)];
        const essentialRequests = plan.assetRequests.filter(request => request.essential === true);
        if (essentialRequests.length > 0) {
            lines.push("");
            lines.push("Asset generation approval needed:");
            for (const request of essentialRequests.slice(0, 5)) {
                lines.push(`- ${request.name || request.type || "Asset"}: ${request.reason || request.prompt || "required for this request"}`);
            }
        }
        lines.push("");
        lines.push("Should I generate these assets, or build a primitive/code fallback instead?");
        return lines.join("\n").trim();
    }

    private formatRepairSummary(initialMessage: string, repairMessage: string): string {
        return [
            initialMessage,
            "",
            "Repair pass:",
            repairMessage,
        ].join("\n").trim();
    }

    private appendSatisfactionPrompt(message: string): string {
        return [
            message,
            "",
            "Are you satisfied with this, or what would you like changed next?",
        ].join("\n").trim();
    }

    private appendVerificationLines(lines: string[], verification?: ScriptCheckReport): void {
        if (!verification) return;
        lines.push(`Verified ${verification.passed}/${verification.probes} readback probe(s).`);
        if (verification.failed > 0) {
            const failed = verification.results.filter(result => !result.success);
            lines.push("");
            lines.push("Verification failed:");
            for (const result of failed.slice(0, 5)) {
                const mismatch = result.mismatches[0];
                lines.push(`- Line ${mismatch?.lineNumber ?? result.probe.lineNumber}: ${mismatch?.path || "(getter)"} ${mismatch?.reason || "readback mismatch"}`);
            }
        }
    }

    private appendOptionalAssetRequestLines(lines: string[], plan?: PlaygroundStemscriptPlan): void {
        const optionalRequests = plan?.assetRequests.filter(request => request.essential !== true) ?? [];
        if (optionalRequests.length === 0) return;
        lines.push("");
        lines.push("Optional asset upgrade available:");
        for (const request of optionalRequests.slice(0, 3)) {
            lines.push(`- ${request.name || request.type || "Asset"}: ${request.reason || request.prompt || "generate a richer asset"}`);
        }
    }

    private formatDesignBriefLines(plan?: PlaygroundStemscriptPlan): string[] {
        const brief = plan?.designBrief;
        if (!brief) return [];
        const parts = [
            brief.coreLoop ? `core loop: ${brief.coreLoop}` : "",
            brief.controlsCamera ? `controls/camera: ${brief.controlsCamera}` : "",
            brief.goalsFailState ? `goals/fail: ${brief.goalsFailState}` : "",
            brief.challengeCurve ? `challenge: ${brief.challengeCurve}` : "",
            brief.feedbackProgression ? `feedback: ${brief.feedbackProgression}` : "",
            brief.reusePlan ? `reuse: ${brief.reusePlan}` : "",
            brief.implementationStrategy ? `implementation: ${brief.implementationStrategy}` : "",
        ].filter(Boolean);
        if (parts.length === 0) return [];
        return ["", `Design brief: ${parts.join("; ")}`];
    }

    private buildSimpleRepairContext(
        plan: PlaygroundStemscriptPlan,
        execution: VerifiedStemscriptExecution,
    ): Record<string, unknown> {
        return {
            kind: "stemscript",
            plan: this.compactPlanForPrompt(plan),
            script: execution.script,
            commandFailures: execution.execution.results
                .filter(result => !result.success)
                .map(result => ({
                    lineNumber: result.lineNumber,
                    command: result.command,
                    error: result.error,
                })),
            verification: this.compactVerificationForPrompt(execution.verification),
        };
    }

    private buildStructuredRepairContext(
        plan: PlaygroundStemscriptPlan,
        execution: StructuredPlanExecutionSummary,
    ): Record<string, unknown> {
        return {
            kind: "structured",
            plan: this.compactPlanForPrompt(plan),
            artifacts: [...execution.artifacts, ...execution.phases.flatMap(phase => phase.artifacts)]
                .filter(result => !result.success)
                .map(result => ({
                    type: result.artifact.type,
                    name: result.artifact.name,
                    error: result.error,
                })),
            phases: execution.phases.map(phase => ({
                label: phase.label,
                skippedReason: phase.skippedReason,
                validationFailure: phase.validationFailure,
                commandFailures: phase.execution?.results
                    .filter(result => !result.success)
                    .map(result => ({
                        lineNumber: result.lineNumber,
                        command: result.command,
                        error: result.error,
                    })) ?? [],
                verification: this.compactVerificationForPrompt(phase.verification),
            })),
        };
    }

    private compactVerificationForPrompt(verification?: ScriptCheckReport): Record<string, unknown> | undefined {
        if (!verification) return undefined;
        return {
            probes: verification.probes,
            passed: verification.passed,
            failed: verification.failed,
            mismatches: verification.results
                .filter(result => !result.success)
                .flatMap(result => result.mismatches)
                .slice(0, 12),
            skipped: verification.skipped.slice(0, 12),
        };
    }

    private compactPlanForPrompt(plan: PlaygroundStemscriptPlan): Record<string, unknown> {
        return {
            reply: plan.reply,
            designBrief: plan.designBrief,
            assetRequests: plan.assetRequests,
            inspectionStemscript: plan.inspectionStemscript,
            stemscript: plan.stemscript,
            notes: plan.notes,
            artifacts: plan.artifacts.map(artifact => ({
                type: artifact.type,
                name: artifact.name,
                description: artifact.description,
            })),
            phases: plan.phases.map(phase => ({
                name: phase.name,
                goal: phase.goal,
                inspectionStemscript: phase.inspectionStemscript,
                stemscript: phase.stemscript,
                artifacts: phase.artifacts.map(artifact => ({
                    type: artifact.type,
                    name: artifact.name,
                    description: artifact.description,
                })),
            })),
        };
    }

    private buildRepairPrompt(
        promptText: string,
        context: Record<string, unknown>,
        previousPlan: PlaygroundStemscriptPlan,
        repairContext: Record<string, unknown> | undefined,
    ): string {
        return [
            this.buildProviderPrompt(promptText, context),
            "",
            "Repair pass required.",
            "Return JSON only. Do not request another inspectionStemscript. Produce the smallest repair artifacts/stemscript needed to fix the failed lines or readback mismatches. Stop after this repair.",
            "",
            "Previous plan JSON:",
            safeJsonStringify(this.compactPlanForPrompt(previousPlan)),
            "",
            "Failure and verification context JSON:",
            safeJsonStringify(repairContext ?? {}),
        ].join("\n");
    }

    private formatStructuredPlanSummary(
        reply: string,
        execution: StructuredPlanExecutionSummary,
        plan?: PlaygroundStemscriptPlan,
    ): string {
        const lines = [reply, ...this.formatDesignBriefLines(plan)];
        const artifactTotal = execution.artifactSuccessCount + execution.artifactFailureCount;
        const phasesWithCommands = execution.phases.filter(phase => (phase.execution?.executedCommands ?? 0) > 0);

        if (artifactTotal > 0) {
            lines.push("");
            lines.push(`Materialized ${execution.artifactSuccessCount}/${artifactTotal} reusable artifact(s).`);
        }

        if (execution.executedCommands > 0) {
            lines.push(`Applied ${execution.successCount}/${execution.executedCommands} command(s) across ${phasesWithCommands.length} phase(s).`);
        }
        if (execution.verificationProbes > 0) {
            lines.push(`Verified ${execution.verificationPassed}/${execution.verificationProbes} readback probe(s).`);
        }
        this.appendOptionalAssetRequestLines(lines, plan);

        if (execution.phases.length > 0) {
            lines.push("");
            lines.push("Phase results:");
            for (const phase of execution.phases) {
                const commandText = phase.execution
                    ? `${phase.execution.successCount}/${phase.execution.executedCommands} command(s)`
                    : "no mutation commands";
                const artifactText = phase.artifacts.length > 0
                    ? `, artifacts ${phase.artifacts.filter(result => result.success).length}/${phase.artifacts.length}`
                    : "";
                const verificationText = phase.verification && phase.verification.probes > 0
                    ? `, verified ${phase.verification.passed}/${phase.verification.probes}`
                    : "";
                lines.push(`- ${phase.label}: ${commandText}${artifactText}${verificationText}`);
                if (phase.skippedReason) {
                    lines.push(`  ${phase.skippedReason}`);
                }
                if (phase.validationFailure) {
                    lines.push(`  Validation failed: ${phase.validationFailure.error}`);
                }
            }
        }

        const artifactFailures = [...execution.artifacts, ...execution.phases.flatMap(phase => phase.artifacts)]
            .filter(result => !result.success);
        const commandFailures = execution.phases
            .flatMap(phase => phase.execution?.results ?? [])
            .filter(result => !result.success);
        const inspectionFailures = execution.phases
            .flatMap(phase => phase.inspections)
            .filter(result => !result.success);
        const verificationFailures = execution.phases
            .flatMap(phase => phase.verification?.results ?? [])
            .filter(result => !result.success);

        if (artifactFailures.length > 0 || commandFailures.length > 0 || inspectionFailures.length > 0 || verificationFailures.length > 0) {
            lines.push("");
            lines.push("Some steps failed:");
            for (const failure of artifactFailures.slice(0, 5)) {
                lines.push(`- ${failure.artifact.type} ${failure.artifact.name}: ${failure.error || "Unknown error"}`);
            }
            const remainingSlotsAfterArtifacts = Math.max(0, 5 - artifactFailures.length);
            for (const failure of inspectionFailures.slice(0, remainingSlotsAfterArtifacts)) {
                lines.push(`- Inspection line ${failure.lineNumber}: ${failure.error || "Unknown error"}`);
            }
            const remainingSlots = Math.max(0, remainingSlotsAfterArtifacts - inspectionFailures.length);
            for (const failure of commandFailures.slice(0, remainingSlots)) {
                lines.push(`- Line ${failure.lineNumber}: ${failure.error || "Unknown error"}`);
            }
            const verificationSlots = Math.max(0, 5 - artifactFailures.length - inspectionFailures.length - commandFailures.length);
            for (const failure of verificationFailures.slice(0, verificationSlots)) {
                const mismatch = failure.mismatches[0];
                lines.push(`- Verification line ${mismatch?.lineNumber ?? failure.probe.lineNumber}: ${mismatch?.reason || "readback mismatch"}`);
            }
        }

        return lines.join("\n").trim();
    }

    async executeCommand(method: string, params: Record<string, unknown>): Promise<CommandExecutionResult> {
        return this.executeRegistryCommand(method, params);
    }

    respondToPermissionRequest(_requestId: string, _response: RequestPermissionResponse): void {
        // Direct browser plans do not request host permissions.
    }

    hasPendingInteractiveResults(): boolean {
        return this.getExecutor().hasPendingInteractiveResults();
    }

    submitInteractiveSelectionResolution(resolution: InteractiveSelectionResolution): boolean {
        return this.getExecutor().handleUserSelectionResult(
            resolution.interactiveResult.id,
            resolution.results,
        );
    }

    checkPendingInteractiveResult(id: string): boolean {
        return this.getExecutor().getPendingInteractiveResults().some(result => result.id === id);
    }
}

function stringifyForPrompt(value: unknown, maxChars: number): string | undefined {
    if (value === undefined || value === null) return undefined;
    const text = typeof value === "string" ? value : safeJsonStringify(value);
    if (!text) return undefined;
    return text.length > maxChars ? `${text.slice(0, maxChars - 24)}... [truncated ${text.length} chars]` : text;
}

function formatCount(value: number): string {
    if (value < 1000) return String(value);
    return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
}

function compactForPrompt(value: unknown, maxChars = 6000): unknown {
    if (value === undefined || value === null) return undefined;
    const text = safeJsonStringify(value);
    if (!text || text.length <= maxChars) return value;
    return `${text.slice(0, maxChars - 24)}... [truncated ${text.length} chars]`;
}

function removeUndefined(value: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function tryParseJsonObject(value: string): unknown | null {
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function slugifyArtifactName(value: string): string {
    const slug = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return slug || "copilot-artifact";
}

function inferFileFormat(name: string): string {
    const ext = name.trim().split(".").pop()?.toLowerCase();
    return ext && ext !== name.toLowerCase() ? ext : "txt";
}

function contentTypeForFormat(format: string): string {
    const normalized = format.toLowerCase();
    const map: Record<string, string> = {
        cjs: "text/javascript",
        css: "text/css",
        frag: "text/plain",
        glsl: "text/plain",
        html: "text/html",
        js: "text/javascript",
        json: "application/json",
        jsx: "text/javascript",
        md: "text/markdown",
        mjs: "text/javascript",
        sh: "text/x-shellscript",
        svg: "image/svg+xml",
        ts: "text/typescript",
        tsx: "text/typescript",
        txt: "text/plain",
        vert: "text/plain",
        xml: "application/xml",
        yaml: "text/yaml",
        yml: "text/yaml",
    };
    return map[normalized] || "text/plain";
}

function safeJsonStringify(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}
