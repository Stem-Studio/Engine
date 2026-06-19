import {describe, expect, it} from "vitest";

import {selectPlaygroundKnowledgeCards} from "./playgroundKnowledgeCards";

describe("playgroundKnowledgeCards", () => {
    it("keeps simple scene edits focused on always-on browser knowledge", () => {
        const selection = selectPlaygroundKnowledgeCards({
            promptText: "make a red test box",
            context: {},
        });

        expect(selection.prompt).toContain("StemStudio playground knowledge base");
        expect(selection.selectedCards.map(card => card.id)).toEqual([
            "core.browser-contract",
            "core.scale-and-scene",
            "commands.live-patterns",
            "inspection.assets-and-registries",
        ]);
        expect(selection.prompt).not.toContain("Racing Recipe");
        expect(selection.prompt).not.toContain("Script Imports and Shared Helpers");
    });

    it("selects game, porting, genre, and behavior cards for full-game requests", () => {
        const selection = selectPlaygroundKnowledgeCards({
            promptText: "port a kart racing game with custom vehicle controls, checkpoints, boosts, and laps",
            context: {sourceKind: "paste"},
        });
        const ids = selection.selectedCards.map(card => card.id);

        expect(ids).toContain("game.full-build-flow");
        expect(ids).toContain("game.porting");
        expect(ids).toContain("genre.racing");
        expect(ids).toContain("behaviors.custom-code");
        expect(ids).toContain("behaviors.built-in-first");
    });

    it("selects lambda and import cards only when the prompt or context asks for them", () => {
        const selection = selectPlaygroundKnowledgeCards({
            promptText: "create reusable lambda schema and shared script imports for enemy wave math",
            context: {
                requestedArtifacts: ["lambda", "scriptImport"],
            },
        });
        const ids = selection.selectedCards.map(card => card.id);

        expect(ids).toContain("lambdas.data-systems");
        expect(ids).toContain("imports.script-helpers");
    });

    it("honors the character budget for optional cards", () => {
        const selection = selectPlaygroundKnowledgeCards({
            promptText: "racing platformer shooter import lambda behavior port game",
            maxChars: 1500,
        });

        expect(selection.selectedCards.every(card => card.always || ["game.full-build-flow", "game.porting", "genre.racing"].includes(card.id))).toBe(true);
    });
});
