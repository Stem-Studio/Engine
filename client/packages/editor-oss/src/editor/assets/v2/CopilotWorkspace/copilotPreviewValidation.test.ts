import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import type EngineRuntime from "@stem/editor-oss/EngineRuntime";
import {
  runCopilotPreviewValidation,
  summarizeCopilotPreviewImpact,
} from "./copilotPreviewValidation";
import type { CopilotPreviewSession } from "./copilotPreviewSession";

const makeScene = () => {
  const scene = new THREE.Scene();
  scene.userData.game = { enabled: true };
  const player = new THREE.Object3D();
  player.name = "Player";
  scene.add(player);
  return scene;
};

const makeApp = ({
  scene = makeScene(),
  camera = new THREE.PerspectiveCamera(),
  scripts = {},
  isPlaying = false,
  physics = null,
  game = isPlaying ? {} : null,
  isMultiplayer = false,
}: {
  scene?: THREE.Scene;
  camera?: THREE.Camera | null;
  scripts?: Record<string, string>;
  isPlaying?: boolean;
  physics?: unknown;
  game?: unknown;
  isMultiplayer?: boolean;
} = {}): EngineRuntime =>
  ({
    scene,
    camera,
    isPlaying,
    physics,
    game,
    editor: {
      isMultiplayer,
      behaviorScriptRegistry: {
        getScripts: () => scripts,
      },
    },
  }) as unknown as EngineRuntime;

const byId = (results: ReturnType<typeof runCopilotPreviewValidation>) =>
  new Map(results.map((result) => [result.id, result]));

describe("runCopilotPreviewValidation", () => {
  it("passes basic structural checks for a playable scene", () => {
    const results = byId(
      runCopilotPreviewValidation(
        makeApp({
          isPlaying: true,
          physics: {},
        }),
      ),
    );

    expect(results.get("scene-loads")?.status).toBe("pass");
    expect(results.get("player-spawn")?.status).toBe("pass");
    expect(results.get("main-camera")?.status).toBe("pass");
    expect(results.get("game-enabled")?.status).toBe("pass");
    expect(results.get("runtime-errors")?.status).toBe("pass");
    expect(results.get("physics-init")?.status).toBe("pass");
  });

  it("warns when player/game settings need playtest attention", () => {
    const scene = new THREE.Scene();
    scene.userData.game = { enabled: false };
    const physicsObject = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial(),
    );
    physicsObject.userData.physics = { enabled: true };
    scene.add(physicsObject);

    const results = byId(runCopilotPreviewValidation(makeApp({ scene })));

    expect(results.get("player-spawn")?.status).toBe("warn");
    expect(results.get("game-enabled")?.status).toBe("warn");
    expect(results.get("physics-init")?.status).toBe("pending");
  });

  it("fails generated behavior code with static validation errors", () => {
    const badBehavior = `
var speed = 5;
this.update = function() {
  this.erth.physics.addBody(this.target);
};
`;
    const results = byId(
      runCopilotPreviewValidation(
        makeApp({
          scripts: { badBehavior },
        }),
      ),
    );

    expect(results.get("generated-code-static")?.status).toBe("fail");
  });

  it("warns on generated lambda script static issues", () => {
    const results = byId(
      runCopilotPreviewValidation(
        makeApp({
          game: {
            lambdaScripts: {
              badLambda: "this.erth.store.get('score');",
            },
          },
        }),
      ),
    );

    expect(results.get("generated-lambda-static")?.status).toBe("warn");
  });

  it("validates deep generated scenes in one iterative hierarchy pass", () => {
    const traverseSpy = vi.spyOn(THREE.Object3D.prototype, "traverse");
    const scene = new THREE.Scene();
    scene.userData.game = { enabled: true };
    let parent: THREE.Object3D = scene;
    for (let i = 0; i < 12_000; i++) {
      const child = new THREE.Object3D();
      if (i === 6_000) child.userData.physics = { enabled: true };
      parent.add(child);
      parent = child;
    }
    parent.name = "Player";

    const results = byId(runCopilotPreviewValidation(makeApp({ scene })));

    expect(results.get("scene-loads")?.detail).toContain("12000 scene objects");
    expect(results.get("player-spawn")?.status).toBe("pass");
    expect(results.get("physics-init")?.status).toBe("pending");
    expect(results.get("performance-budget")?.status).toBe("warn");
    expect(traverseSpy).not.toHaveBeenCalled();
  });

  it("summarizes before and after preview impact from the captured snapshot", () => {
    const scene = makeScene();
    scene.add(new THREE.Object3D());
    const session = {
      snapshot: {
        sceneJson: [
          {
            uuid: "scene",
            type: "Scene",
            userData: { game: { enabled: true } },
          },
          { uuid: "player", type: "Group" },
          { id: "script-1", source: "this.update = function() {};" },
        ],
        assetResolutionContext: {
          logicalIdToAssetId: {},
          assetIdToRevisionId: {},
          nameToAssetId: {},
        },
      },
      validationResults: [],
    } as unknown as CopilotPreviewSession;

    const summary = summarizeCopilotPreviewImpact(makeApp({ scene }), session);

    expect(summary.beforeAfterHighlights[0]).toContain("Objects: 1 -> 2");
    expect(summary.beforeAfterHighlights[1]).toContain(
      "Behavior scripts: 1 -> 0",
    );
    expect(summary.estimatedImpact).toContain("Low");
  });
});
