import {describe, expect, it} from "vitest";

import {
    parseProviderStemscriptPlan,
    validateGeneratedStemscript,
    validateInspectionStemscript,
} from "./playgroundStemscriptPlan";

describe("playgroundStemscriptPlan", () => {
    it("parses the JSON contract returned by a provider", () => {
        const plan = parseProviderStemscriptPlan(JSON.stringify({
            reply: "Built a small obstacle course.",
            inspectionStemscript: "list objects",
            stemscript: "add group name=Course\nadd box name=Ground size=12,0.1,12 color=#334455",
            notes: ["used primitives only"],
        }));

        expect(plan.reply).toBe("Built a small obstacle course.");
        expect(plan.inspectionStemscript).toBe("list objects");
        expect(plan.stemscript).toContain("add group name=Course");
        expect(plan.notes).toEqual(["used primitives only"]);
    });

    it("accepts a fenced StemScript fallback", () => {
        const plan = parseProviderStemscriptPlan([
            "Here is the plan.",
            "```stemscript",
            "add sphere name=Pickup position=0,1,0 color=#ffcc00",
            "```",
        ].join("\n"));

        expect(plan.reply).toBe("Here is the plan.");
        expect(plan.stemscript).toBe("add sphere name=Pickup position=0,1,0 color=#ffcc00");
    });

    it("turns structured command arrays into script lines", () => {
        const plan = parseProviderStemscriptPlan(JSON.stringify({
            reply: "Added a platform.",
            commands: [
                {
                    command: "create_primitive",
                    params: {
                        type: "box",
                        name: "Platform A",
                        position: {x: 0, y: 0, z: 0},
                    },
                },
            ],
        }));

        expect(plan.stemscript).toContain("create_primitive");
        expect(plan.stemscript).toContain('name="Platform A"');
        expect(plan.stemscript).toContain('position={"x":0,"y":0,"z":0}');
    });

    it("parses phased plans with reusable artifacts", () => {
        const plan = parseProviderStemscriptPlan(JSON.stringify({
            reply: "Built a phased racing loop.",
            designBrief: {
                coreLoop: "Drive through checkpoints and finish laps.",
                controlsCamera: "Third-person kart camera.",
                goalsFailState: "Win at three laps, reset on missed checkpoint.",
                challengeCurve: "Add tighter turns each lap.",
                feedbackProgression: "HUD lap counter and boost VFX.",
                reusePlan: "Use trigger built-ins and one custom controller.",
                implementationStrategy: "Create track, then controller, then polish.",
            },
            assetRequests: [
                {
                    type: "model",
                    name: "Kart",
                    prompt: "small stylized kart",
                    essential: false,
                    reason: "would improve visuals",
                },
            ],
            artifacts: [
                {
                    type: "behavior",
                    name: "RaceHudController",
                    description: "Tracks HUD state.",
                    code: "this.update = function(dt) {}",
                },
            ],
            phases: [
                {
                    name: "Inspect",
                    inspectionCommands: [
                        {command: "list_lambdas", params: {filter: "race"}},
                    ],
                },
                {
                    title: "Mechanics",
                    goal: "Create checkpoints and attach controller.",
                    artifacts: [
                        {
                            kind: "import",
                            name: "race-math",
                            content: "export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));",
                            format: "js",
                            contentType: "text/javascript",
                        },
                    ],
                    commands: [
                        {command: "create_group", params: {name: "Checkpoints"}},
                    ],
                },
            ],
        }));

        expect(plan.artifacts).toEqual([
            expect.objectContaining({
                type: "behavior",
                name: "RaceHudController",
                code: "this.update = function(dt) {}",
            }),
        ]);
        expect(plan.designBrief?.coreLoop).toContain("checkpoints");
        expect(plan.assetRequests[0]).toEqual(expect.objectContaining({
            type: "model",
            name: "Kart",
            essential: false,
        }));
        expect(plan.phases).toHaveLength(2);
        expect(plan.phases[0]).toEqual(expect.objectContaining({
            name: "Inspect",
            inspectionStemscript: "list_lambdas filter=race",
            stemscript: "",
        }));
        expect(plan.phases[1]).toEqual(expect.objectContaining({
            name: "Mechanics",
            goal: "Create checkpoints and attach controller.",
            stemscript: "create_group name=Checkpoints",
        }));
        expect(plan.phases[1]?.artifacts[0]).toEqual(expect.objectContaining({
            type: "scriptImport",
            name: "race-math",
            content: "export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));",
            format: "js",
            contentType: "text/javascript",
        }));
    });

    it("validates primitive-only live scripts", () => {
        const result = validateGeneratedStemscript([
            "# Generated in browser",
            "add group name=Arena",
            "add box name=Ground size=10,0.1,10 color=#333333 parent=Arena",
        ].join("\n"));

        expect(result.executableCommands).toBe(2);
        expect(result.script).toContain("add box");
    });

    it("allows browser-executable behavior authoring commands", () => {
        const result = validateGeneratedStemscript([
            'behavior add name="ScoreController" code="this.update = function(dt) {}"',
            'behavior attach Player behaviorId="ScoreController" config={scorePerSecond:1}',
            'behavior config Player behaviorId="ScoreController" attributesData={scorePerSecond:2}',
            "behavior list filter=character",
            "behavior get behaviorId=character",
            "behavior detach Player behaviorId=character",
            "lambda list filter=motion",
            "lambda get lambdaId=motionController includeCode=true",
            'behavior update behaviorId="ScoreController" code="this.update = function(dt) {}"',
            'behavior remove behaviorId="ScoreController"',
        ].join("\n"));

        expect(result.executableCommands).toBe(10);
        expect(result.script).toContain("behavior add");
        expect(result.script).toContain("behavior attach Player");
        expect(result.script).toContain("behavior list");
        expect(result.script).toContain("behavior detach");
        expect(result.script).toContain("behavior update");
    });

    it("only allows read-only commands in inspection scripts", () => {
        const result = validateInspectionStemscript([
            "list objects filter=Player",
            "get Player",
            "get settings Player",
            "get behavior Player behaviorId=character",
            "behavior get behaviorId=character",
            "lambda list filter=motion",
            "lambda get lambdaId=motionController includeCode=true",
            "list assets type=models filter=kart",
            "list imports filter=helpers",
            "list files filter=level",
            "get asset assetId=model-1",
            "get import math-helpers",
            "get file level-data.json",
        ].join("\n"));

        expect(result.executableCommands).toBe(13);
        expect(result.script).toContain("lambda get");
        expect(result.script).toContain("list assets");
        expect(result.script).toContain("get import");
        expect(() => validateInspectionStemscript("update Player position=1,2,3")).toThrow(/not allowed in inspection/);
        expect(() => validateInspectionStemscript("behavior attach Player behaviorId=character")).toThrow(/not allowed in inspection/);
    });

    it("allows `list lights` and any engine read-only command in inspection", () => {
        // Regression: `list lights` previously aborted the whole request because
        // it was absent from a narrow hardcoded allowlist. It now resolves to a
        // real read-only command (get_scene_objects) and is permitted.
        const result = validateInspectionStemscript(
            ["list lights", "get light DirectionalLight", "get render settings"].join("\n"),
        );
        expect(result.executableCommands).toBe(3);
        expect(result.script).toContain("list lights");

        // Read-only-prefixed commands the playground globally disallows (external
        // search, library, project tasks) stay rejected even in inspection.
        expect(() => validateInspectionStemscript("search_external_assets")).toThrow(/not allowed in inspection/);
        expect(() => validateInspectionStemscript("list_project_tasks")).toThrow(/not allowed in inspection/);
    });

    it("rejects file and external-asset commands in playground mode", () => {
        expect(() => validateGeneratedStemscript("import model Tree filepath=models/tree.glb")).toThrow(/not allowed/);
        expect(() => validateGeneratedStemscript("generate model prompt=\"make a spaceship\"")).toThrow(/not allowed/);
        expect(() => validateGeneratedStemscript("search assets phrases=[tree] type=model")).toThrow(/not allowed/);
        expect(() => validateGeneratedStemscript("texture external Ground assetId=brick assetType=textures name=Brick provider=polyhaven")).toThrow(/not allowed/);
        expect(() => validateGeneratedStemscript("prefab add id=coin name=Coin")).toThrow(/not allowed/);
        expect(() => validateGeneratedStemscript("list_project_tasks")).toThrow(/not allowed/);
        expect(() => validateGeneratedStemscript('create_project_task title="Add player"')).toThrow(/not allowed/);
        expect(() => validateGeneratedStemscript("exec ./game.stemscript")).toThrow(/not allowed/);
    });
});
