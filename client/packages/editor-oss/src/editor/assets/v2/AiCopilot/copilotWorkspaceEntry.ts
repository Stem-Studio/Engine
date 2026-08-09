import {
    writePendingProjectAdvancedModePreference,
    writeProjectAdvancedModePreference,
} from "@stem/editor-oss/context/advancedModeStorage";
import {
    clearDashboardCopilotBootstrap,
    type DashboardCopilotBootstrap,
    writeDashboardCopilotBootstrap,
} from "./dashboardCopilotBootstrap";

export type CopilotEntrySceneLike = {
    ID?: string;
    id?: string;
    Name?: string;
    name?: string;
    Username?: string;
    username?: string;
    CreatorName?: string;
    creatorName?: string;
    AuthorName?: string;
    userName?: string;
    UserID?: string;
    userId?: string;
};

export type CopilotEntrySceneSummary = {
    id?: string;
    name?: string;
    creatorName?: string;
};

export type CopilotEntryPromptContext = {
    copilotEntry: {
        entryMode: DashboardCopilotBootstrap["entryMode"];
        promptStrategy?: "mvp_first";
    };
    promptDirectives?: string[];
};

export const getCopilotEntrySceneSummary = (
    scene: CopilotEntrySceneLike | null | undefined,
): CopilotEntrySceneSummary => {
    if (!scene) return {};

    return {
        id: scene.ID || scene.id,
        name: scene.Name || scene.name,
        creatorName:
            scene.Username ||
            scene.username ||
            scene.CreatorName ||
            scene.creatorName ||
            scene.AuthorName ||
            scene.userName,
    };
};

export const prepareCreateFromPromptCopilotEntry = (input: {
    prompt: string;
    placeholderThumbnail?: string;
}) => {
    writePendingProjectAdvancedModePreference(false);
    writeDashboardCopilotBootstrap({
        entryMode: "create_from_prompt",
        prompt: input.prompt,
        autoSubmit: true,
        placeholderThumbnail: input.placeholderThumbnail,
    });
};

export const prepareBlankCopilotWorkspaceEntry = () => {
    // "Start from scratch" lands in advanced mode by contract (see
    // CLAUDE.md open-source UX invariants). The prompt-driven flow handled by
    // prepareCreateFromPromptCopilotEntry keeps the simpler workspace.
    writePendingProjectAdvancedModePreference(true);
    clearDashboardCopilotBootstrap();
};

export const prepareRemixCopilotEntry = (input: {
    newSceneId: string;
    sourceScene?: CopilotEntrySceneLike | null;
    prompt?: string;
}) => {
    const source = getCopilotEntrySceneSummary(input.sourceScene);
    const prompt = input.prompt?.trim();

    writeProjectAdvancedModePreference(input.newSceneId, false);
    writeDashboardCopilotBootstrap({
        entryMode: "remix_existing_game",
        prompt: prompt || undefined,
        autoSubmit: Boolean(prompt),
        sourceSceneId: source.id,
        sourceSceneName: source.name,
        sourceCreatorName: source.creatorName,
    });
};

export const prepareEditCurrentGameCopilotEntry = (scene: CopilotEntrySceneLike) => {
    const source = getCopilotEntrySceneSummary(scene);
    if (!source.id) return;

    writeProjectAdvancedModePreference(source.id, false);
    writeDashboardCopilotBootstrap({
        entryMode: "edit_current_game",
        autoSubmit: false,
        sourceSceneId: source.id,
        sourceSceneName: source.name,
        sourceCreatorName: source.creatorName,
    });
};

export const buildCopilotEntryGreeting = (
    bootstrap: DashboardCopilotBootstrap,
    detectedSystems: string[],
): string | null => {
    const systems = detectedSystems.length
        ? detectedSystems.join(", ")
        : "scene structure, camera setup, and gameplay settings";
    const sourceName = bootstrap.sourceSceneName || "this game";
    const creatorLine = bootstrap.sourceCreatorName
        ? `Creator: ${bootstrap.sourceCreatorName}`
        : null;

    if (bootstrap.entryMode === "remix_existing_game") {
        return [
            "I opened this remix in the Copilot workspace.",
            `Original game: ${sourceName}`,
            creatorLine,
            `Detected context: ${systems}.`,
            [
                "Detailed remix directions to try:",
                "- Keep the core loop, add one new objective, rebalance the first challenge, and apply it directly to the scene.",
                "- Add a new enemy or hazard that fits the existing level layout and explain the systems you touched.",
                "- Turn this into a short 2-6 player mode with clear spawn, scoring, and sync rules.",
            ].join("\n"),
            "I will apply requested changes directly to this remix.",
        ].filter(Boolean).join("\n\n");
    }

    if (bootstrap.entryMode === "edit_current_game") {
        return [
            "This game is open in the Copilot workspace.",
            `Current game: ${sourceName}`,
            `Detected context: ${systems}.`,
            "Ask for a concrete change and I will apply it directly to the scene.",
        ].join("\n\n");
    }

    return null;
};

export const buildCopilotEntryPromptContext = (
    bootstrap: DashboardCopilotBootstrap | null | undefined,
): CopilotEntryPromptContext | undefined => {
    if (!bootstrap?.entryMode) return undefined;

    if (bootstrap.entryMode === "create_from_prompt") {
        return {
            copilotEntry: {
                entryMode: "create_from_prompt",
                promptStrategy: "mvp_first",
            },
            promptDirectives: [
                "Treat this as the start of a new blank game experience.",
                "Create the smallest playable MVP first, not a full finished game.",
                "Prioritize a playable stage, player/camera/control setup, one core mechanic, one success or fail/reset condition, and only essential feedback.",
                "Use primitives, built-in behaviors, prefabs, or local assets before generated assets.",
                "Avoid broad worldbuilding, full content arcs, heavy polish, or large task plans until the MVP is playable.",
            ],
        };
    }

    return {
        copilotEntry: {
            entryMode: bootstrap.entryMode,
        },
    };
};
