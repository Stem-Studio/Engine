export interface PlaygroundKnowledgeCard {
    id: string;
    title: string;
    tags: string[];
    always?: boolean;
    body: string;
}

export interface PlaygroundKnowledgeSelection {
    prompt: string;
    selectedCards: PlaygroundKnowledgeCard[];
}

export interface PlaygroundKnowledgeSelectionOptions {
    promptText: string;
    context?: Record<string, unknown>;
    inspectionText?: string;
    maxChars?: number;
}

const DEFAULT_MAX_CHARS = 18000;

const CARDS: PlaygroundKnowledgeCard[] = [
    {
        id: "core.browser-contract",
        title: "Browser Direct Contract",
        tags: ["core", "browser", "stemscript", "commands"],
        always: true,
        body: [
            "Work live in the browser editor. Use StemScript commands, behavior assets, scene settings, physics, cameras, VFX, game settings, navmesh/waypoints, and existing registries.",
            "Do not use filesystem-only commands, external search/generation, bundled file creation, or server-only workflows in direct playground mode.",
            "Prompt-to-image/model/audio generation is never automatic. If generated assets are essential, ask first with assetRequests. If optional, build a playable fallback and propose the upgrade after execution.",
            "Keep plans compact and executable. Use inspectionStemscript for read-only queries before risky edits.",
        ].join("\n"),
    },
    {
        id: "core.scale-and-scene",
        title: "Scale, Scene, and Object Rules",
        tags: ["core", "objects", "scene", "scale", "physics"],
        always: true,
        body: [
            "Scale: 1 unit = 1 meter. A human player is usually a capsule around size=0.5,1.8,0.5 at position=0,0.9,0.",
            "Use size for primitive dimensions. Floors can be boxes such as size=50,0.1,50 at position=0,-0.05,0.",
            "Name important objects and group related children. Use parent=Group during creation instead of flat scene roots.",
            "Use richer primitive compositions for gameplay readability: combine primitives with materials, lights, VFX, signs/markers, gates, hazards, collectibles, and camera framing instead of leaving a static single-shape mockup.",
            "Player-controlled objects must be tagged with tag=Player for character, camera, trigger, and touch systems.",
        ].join("\n"),
    },
    {
        id: "commands.live-patterns",
        title: "Live StemScript Command Patterns",
        tags: ["core", "commands", "stemscript", "objects"],
        always: true,
        body: [
            'Examples: add group name="Arena"; add box name="Ground" position=0,-0.05,0 size=30,0.1,30 color=#334455 parent="Arena".',
            'Use update "Object" position=x,y,z rotation=x,y,z scale=x,y,z color=#rrggbb tag=Player.',
            'Use material "Object" color=#rrggbb roughness=0.5 metalness=0.1 opacity=1.',
            'Use scene background, scene lighting, scene fog, scene tonemapping, scene postprocessing, light, render settings, camera "DefaultCamera", project title, and game settings.',
        ].join("\n"),
    },
    {
        id: "inspection.assets-and-registries",
        title: "Dynamic Asset and Registry Inspection",
        tags: ["core", "inspect", "assets", "behaviors", "lambdas", "imports", "reuse"],
        always: true,
        body: [
            "Before referencing existing resources, inspect live project truth. Use list objects/get object, behavior list/behavior get, lambda list/lambda get, list assets/list imports/list files/list models/list behavior packs/list lambda packs, and get asset/get import/get file.",
            "Use exact behaviorId/lambdaId/asset names from live inspection. Do not invent IDs.",
            "Use names, descriptions, tags, formats, attributes, component schemas, and revision IDs from inspection results to choose reusable components.",
        ].join("\n"),
    },
    {
        id: "behaviors.built-in-first",
        title: "Built-In Behavior Catalog",
        tags: ["behavior", "behaviors", "reuse", "game", "port", "player", "pickup", "trigger", "ai", "audio", "mobile"],
        body: [
            "Prefer built-in behavior IDs before custom code. Existing IDs are exact and case-sensitive.",
            "Key built-ins: character, consumable, trigger, tween, platform, enemy, projectile, npc, aiNpc, follow, jumppad, teleport, objectInteractions, enableDisable, visualEffect, genericSound, cinematicCamera, animation, dayNightCycle, touchControls, spawnpoint, navmesh, navmesh-connection.",
            "Playable character recipe: add capsule Player; update Player tag=Player; behavior attach Player behaviorId=character config={isDefault:true,walkSpeed:3,runSpeed:8,jumpHeight:1.2}; camera DefaultCamera THIRD_PERSON; game settings isGame=true showHUD=true.",
        ].join("\n"),
    },
    {
        id: "behaviors.custom-code",
        title: "Custom Behavior Authoring",
        tags: ["behavior", "custom", "code", "controller", "gameplay", "repair"],
        body: [
            "Write custom behavior code only when built-ins cannot preserve the mechanic. Generated behavior descriptions must include request, runtime purpose, inspected/reused assets or behavior IDs, and expected attachment target.",
            "Lifecycle methods: init(game), onStart(), update(deltaTime), fixedUpdate(fixedDeltaTime), onStop(), dispose(), onEvent(msg,data).",
            "Use let/const, clamp deltaTime for motion integrators, guard missing objects/subsystems, and clean up listeners, timers, geometry, materials, textures, and runtime objects in dispose().",
            "Expose tunable values through metadata/config attributes when possible, including debugLogs default false for generated systems.",
        ].join("\n"),
    },
    {
        id: "lambdas.data-systems",
        title: "Lambda Data Systems",
        tags: ["lambda", "lambdas", "ecs", "data", "schema"],
        body: [
            "Lambdas are ECS-style systems for shared object data and batched logic. Use lambda list/lambda get before assuming schema or code.",
            "Use lambdas for per-object data such as health, velocity, team, inventory, tags, cooldowns, and state flags. Use behavior config for attached-system tuning.",
            "Direct browser chat can inspect and design lambda schemas. It should not claim lambda asset creation unless a browser command for that asset type is available.",
        ].join("\n"),
    },
    {
        id: "imports.script-helpers",
        title: "Script Imports and Shared Helpers",
        tags: ["import", "imports", "script", "helper", "reuse", "code"],
        body: [
            "Script import assets are reusable JavaScript modules consumed with @import \"name\" as alias; at the top of behavior or lambda code.",
            "Use imports for shared pure helpers reused across 2+ behaviors/lambdas when they reduce meaningful duplication. Helpers cannot touch this, this.erth, this.gameObject, or closed-over behavior state; pass state as arguments.",
            "In browser direct mode, inspect existing imports with list imports/get import. When returning a scriptImport artifact, include source code and use it from generated behavior/lambda code after the artifact is created.",
        ].join("\n"),
    },
    {
        id: "game.full-build-flow",
        title: "Full Game Build Flow",
        tags: ["game", "create", "build", "genre", "playable", "mvp"],
        body: [
            "For full games, include a designBrief before StemScript: core loop, controls/camera, goals/fail state, challenge curve, feedback/progression, reuse plan, and implementation strategy.",
            "Build an MVP loop, not a static mockup. Include project title, game settings, environment, player, camera, physics, win/lose/scoring rules, challenge objects, feedback, and a clear next tuning step.",
            "Recommended phases: environment -> player/camera -> core objects -> mechanics -> polish. Execute and verify in small phases rather than one giant script.",
            "Ask at most 1-2 questions only when missing details materially change camera/control feel, non-negotiable mechanics, or MVP boundary.",
        ].join("\n"),
    },
    {
        id: "game.porting",
        title: "Game Porting and Source Mapping",
        tags: ["port", "convert", "source", "paste", "github", "mapping", "fidelity"],
        body: [
            "For ports, preserve source gameplay first: entrypoint, 2D vs 3D, player object, input model, camera model, physics/collision, UI flow, audio/VFX, assets, progression, scale, and tuning values.",
            "Map source systems to Stem systems using built-ins first; write custom behaviors only for source-faithful movement, advanced camera, custom UI flow, procedural systems, or mechanics with no close built-in.",
            "If browser mode cannot ingest files or backend services directly, produce a playable local substitute and exact import/manual follow-up instructions.",
        ].join("\n"),
    },
    {
        id: "genre.platformer",
        title: "Platformer Recipe",
        tags: ["platformer", "jump", "side-scroller", "collectible", "goal"],
        body: [
            "A small platformer needs Player capsule, Ground, 3-5 platforms, hazards or gaps, collectibles, a goal trigger, physics, and SIDE_SCROLLER or THIRD_PERSON camera.",
            "Use character for movement when source feel is not custom. Use consumable for pickups and trigger/tween/platform for doors, lifts, and moving hazards.",
        ].join("\n"),
    },
    {
        id: "genre.racing",
        title: "Racing Recipe",
        tags: ["racing", "vehicle", "kart", "checkpoint", "lap", "boost"],
        body: [
            "A racing sketch needs a kart/player body, readable track pieces, 3 checkpoints, start/finish markers, THIRD_PERSON camera, game settings, and lap/checkpoint state.",
            "Built-ins cover touchControls, genericSound, triggers, and VFX. Source-faithful vehicle control usually needs a custom behavior with exposed maxSpeed, acceleration, steering, brake, boost, drag, and checkpoint tuning.",
        ].join("\n"),
    },
    {
        id: "genre.top-down-shooter",
        title: "Top-Down Shooter Recipe",
        tags: ["shooter", "top-down", "arena", "enemy", "projectile", "combat"],
        body: [
            "A top-down arena needs Player marker, boundaries, cover, enemies, projectiles, pickups, TOP_DOWN camera, health/score state, and feedback for fire/hit/collect events.",
            "Reuse projectile, enemy, consumable, visualEffect, and genericSound where possible. Use a thin custom game controller when score, waves, and win/lose state need orchestration.",
        ].join("\n"),
    },
    {
        id: "runtime.validation-repair",
        title: "Validation and Repair",
        tags: ["validate", "validation", "repair", "smoke", "errors"],
        body: [
            "Never assume success. After execution, inspect changed objects and react to command failures or codeValidation payloads.",
            "If a phase partially fails, stop after that phase, summarize failing lines, and produce a focused repair script rather than continuing with dependent phases.",
            "Readback verification should use deterministic getters such as get project, get game settings, get object/settings/material/physics/behavior, get camera, get vfx, and get scene settings.",
            "For behavior/lambda code, validation errors are blocking. Warnings about lifecycle, API use, async calls, and cleanup should be fixed unless clearly intentional.",
        ].join("\n"),
    },
];

const ALWAYS_IDS = new Set(CARDS.filter(card => card.always).map(card => card.id));

export function selectPlaygroundKnowledgeCards({
    promptText,
    context,
    inspectionText,
    maxChars = DEFAULT_MAX_CHARS,
}: PlaygroundKnowledgeSelectionOptions): PlaygroundKnowledgeSelection {
    const query = normalizeQuery([
        promptText,
        inspectionText,
        context ? safeJsonStringify(context) : "",
    ].join(" "));

    const scored = CARDS.filter(card => !ALWAYS_IDS.has(card.id)).map(card => ({
        card,
        score: scoreCard(card, query),
    })).sort((a, b) => b.score - a.score || a.card.id.localeCompare(b.card.id));

    const selected: PlaygroundKnowledgeCard[] = CARDS.filter(card => ALWAYS_IDS.has(card.id));
    let charCount = headerText().length + selected.reduce((total, card) => total + renderCard(card).length, 0);

    for (const {card, score} of scored) {
        if (score <= 0) continue;
        const rendered = renderCard(card);
        if (charCount + rendered.length > maxChars) continue;
        selected.push(card);
        charCount += rendered.length;
    }

    const deduped = selected.filter((card, index, array) => array.findIndex(item => item.id === card.id) === index);

    return {
        selectedCards: deduped,
        prompt: [
            headerText(),
            `Selected cards: ${deduped.map(card => card.id).join(", ")}`,
            "",
            ...deduped.map(renderCard),
        ].join("\n"),
    };
}

export function getAllPlaygroundKnowledgeCards(): PlaygroundKnowledgeCard[] {
    return CARDS.slice();
}

function headerText(): string {
    return "StemStudio playground knowledge base, dynamically selected from browser-safe API, behavior, lambda, import, genre, and validation cards.";
}

function renderCard(card: PlaygroundKnowledgeCard): string {
    return [`## ${card.title} (${card.id})`, card.body, ""].join("\n");
}

function scoreCard(card: PlaygroundKnowledgeCard, query: string): number {
    if (card.always) return Number.POSITIVE_INFINITY;
    let score = 0;
    for (const tag of card.tags) {
        const normalized = normalizeQuery(tag);
        if (query.includes(normalized)) score += 3;
    }
    for (const word of card.title.toLowerCase().split(/\W+/)) {
        if (word.length >= 4 && query.includes(word)) score += 1;
    }
    return score;
}

function normalizeQuery(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9_.-]+/g, " ").trim();
}

function safeJsonStringify(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return "";
    }
}
