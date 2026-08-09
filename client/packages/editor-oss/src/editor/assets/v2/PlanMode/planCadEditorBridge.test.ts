import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

import History from "@stem/editor-oss/command/History";
import { RemoveObjectCommand } from "@stem/editor-oss/command/RemoveObjectCommand.js";
import global from "@stem/editor-oss/global";
import Converter from "@stem/editor-oss/serialization/Converter";
import { resolveSelectionTargetFromPickHit } from "@stem/editor-oss/event/picking/pickTargetUtils";
import { getNonSelectableReason } from "@stem/editor-oss/utils/SelectionUtils";
import {
  addPlanCadOpening,
  commitPlanCadSceneData,
  createDefaultPlanCadData,
  createPlanCadPart,
  createPlanCadRectangleSlab,
  createPlanCadRectangleZone,
  createPlanCadRootObject,
  createPlanCadWall,
  findPlanCadNodeObject,
  findPlanCadNodeObjectById,
  findPlanCadRoot,
  getPlanCadDataHash,
  getPlanCadNodeIdFromObject,
  getPlanCadSceneData,
  getUnsupportedPlanCadSchema,
  installPlanCadSceneSync,
  planCadDataToState,
  planCadStateToData,
  PLAN_CAD_ROOT_NAME,
  PLAN_CAD_SCENE_USER_DATA_KEY,
  rebuildPlanCadRootObject,
  setPlanCadSceneSelection,
  syncPlanCadScene,
  updatePlanCadNodeData,
} from "./planCadEditorBridge";
import { createPlanNode, insertPlanNode } from "./planCadCore";
import type {
  PlanItemNode,
  PlanLevelNode,
  PlanNode,
  PlanSlabNode,
  PlanWallNode,
  PlanZoneNode,
} from "./planCadCore";

function getNodeByType<T extends PlanNode>(
  data: { nodes: Record<string, PlanNode> },
  type: T["type"],
): T {
  const node = Object.values(data.nodes).find(
    (candidate) => candidate.type === type,
  );
  expect(node).toBeDefined();
  return node as T;
}

function getGeometrySignature(object: THREE.Object3D | null | undefined) {
  const geometryIds: string[] = [];
  object?.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) geometryIds.push(mesh.geometry.uuid);
  });
  return geometryIds.join("|");
}

function createEditorHarness() {
  const scene = new THREE.Scene();
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const calls: Array<{ event: string; args: unknown[] }> = [];
  const editor: any = {
    scene,
    selected: null,
    addObject: vi.fn(
      async (object: THREE.Object3D, parent?: THREE.Object3D) => {
        (parent ?? editor.scene).add(object);
        app.call("objectAdded", editor, object);
        app.call("sceneGraphChanged", editor);
      },
    ),
    removeObject: vi.fn((object: THREE.Object3D) => {
      object.parent?.remove(object);
      app.call("objectRemoved", editor, object);
      app.call("sceneGraphChanged", editor);
    }),
    select: vi.fn((object: THREE.Object3D | null) => {
      editor.selected = object;
      app.call("objectSelected", editor, object);
    }),
    deselect: vi.fn(() => {
      editor.selected = null;
      app.call("objectSelected", editor, null);
    }),
    objectByUuid: (uuid: string) => {
      let result: THREE.Object3D | undefined;
      scene.traverse((object) => {
        if (!result && object.uuid === uuid) result = object;
      });
      return result;
    },
  };
  const app: any = {
    editor,
    on: vi.fn(
      (eventName: string, handler: ((...args: unknown[]) => void) | null) => {
        if (handler) handlers.set(eventName, handler);
        else handlers.delete(eventName);
      },
    ),
    call: vi.fn((eventName: string, ...args: unknown[]) => {
      calls.push({ event: eventName, args });
      for (const [registeredName, handler] of handlers) {
        if (registeredName.split(".")[0] === eventName) handler(...args);
      }
    }),
  };
  editor.history = new History(editor);
  editor.execute = vi.fn((command: unknown, optionalName?: string) =>
    editor.history.execute(command, optionalName),
  );
  global.app = app;
  return { app, editor, scene, calls };
}

describe("planCadEditorBridge", () => {
  afterEach(() => {
    global.app = null;
    delete (window as any).logger;
    vi.restoreAllMocks();
  });

  it("stores Plan/CAD scene data on scene userData without hard-coded objects", () => {
    const scene = new THREE.Scene();
    const data = createDefaultPlanCadData();
    scene.userData[PLAN_CAD_SCENE_USER_DATA_KEY] = data;

    const loaded = getPlanCadSceneData(scene);

    expect(loaded?.schema).toBe("stem.planCad.v1");
    expect(loaded?.activeLevelId).toBe("level_ground");
    expect(Object.values(loaded?.nodes ?? {}).map((node) => node.type)).toEqual(
      ["site", "building", "level"],
    );
  });

  it("detects unsupported Plan/CAD schemas without coercing them", async () => {
    const scene = new THREE.Scene();
    const unsupportedData = {
      schema: "stem.planCad.v2",
      rootNodeIds: [],
      nodes: {},
      futureField: true,
    };
    scene.userData[PLAN_CAD_SCENE_USER_DATA_KEY] = unsupportedData;
    const editor = {
      scene,
      execute: vi.fn(),
    };

    expect(getPlanCadSceneData(scene)).toBeNull();
    expect(getUnsupportedPlanCadSchema(scene)).toBe("stem.planCad.v2");

    const didCommit = await commitPlanCadSceneData(
      editor,
      createDefaultPlanCadData(),
    );

    expect(didCommit).toBe(false);
    expect(editor.execute).not.toHaveBeenCalled();
    expect(scene.userData[PLAN_CAD_SCENE_USER_DATA_KEY]).toBe(unsupportedData);
  });

  it("creates a visible wall object and selects the new wall in scene data", () => {
    const data = createPlanCadWall(
      createDefaultPlanCadData(),
      { x: 0, z: 0 },
      { x: 4, z: 0 },
      {
        wallHeight: 3.2,
        wallThickness: 0.25,
      },
    );
    const wall = getNodeByType<PlanWallNode>(data, "wall");
    const root = createPlanCadRootObject(data);
    const wallObject = findPlanCadNodeObjectById(root, wall.id);

    expect(data.selectedNodeId).toBe(wall.id);
    expect(wall.height).toBe(3.2);
    expect(wall.thickness).toBe(0.25);
    expect(root.name).toBe(PLAN_CAD_ROOT_NAME);
    expect(root.children.map((child) => child.userData.planNodeType)).toEqual([
      "wall",
    ]);
    expect(findPlanCadNodeObjectById(root, data.activeLevelId)).toBeNull();
    expect(wallObject?.children.length).toBeGreaterThan(0);
    expect(wallObject?.userData.planCad.length).toBeCloseTo(4);
    expect(root.userData.isRuntimeOnly).toBe(true);
    expect(root.userData.isBatchable).toBe(false);
    expect(root.userData.isTransformLocked).toBeUndefined();
    expect(root.userData.planCad.dataHash).toBe(getPlanCadDataHash(data));
    expect(wallObject?.userData.isRuntimeOnly).toBe(true);
    expect(wallObject?.userData.isBatchable).toBe(false);
    expect(wallObject?.userData.isTransformLocked).toBeUndefined();
    expect(wallObject?.userData.managedBy).toBe("BIM Plan");
  });

  it("creates room slabs, zones, and floor parts with generated geometry", () => {
    let data = createDefaultPlanCadData();
    data = createPlanCadRectangleSlab(data, { x: 0, z: 0 }, { x: 4, z: 3 });
    data = createPlanCadRectangleZone(data, { x: 0.5, z: 0.5 }, { x: 2, z: 2 });
    data = createPlanCadPart(data, { x: 1, z: 1 }, { partPresetId: "sofa" });

    const slab = getNodeByType<PlanSlabNode>(data, "slab");
    const zone = getNodeByType<PlanZoneNode>(data, "zone");
    const item = getNodeByType<PlanItemNode>(data, "item");
    const root = createPlanCadRootObject(data);
    const slabObject = findPlanCadNodeObjectById(
      root,
      slab.id,
    ) as THREE.Mesh | null;
    const zoneObject = findPlanCadNodeObjectById(
      root,
      zone.id,
    ) as THREE.Mesh | null;
    const itemObject = findPlanCadNodeObjectById(root, item.id);

    expect(slab.points).toHaveLength(4);
    expect(zone.points).toHaveLength(4);
    expect(item.name).toBe("Sofa");
    expect(item.source).toMatchObject({
      type: "procedural",
      presetId: "sofa",
      modelKind: "sofa",
    });
    expect(
      (slabObject?.geometry as THREE.BufferGeometry).getAttribute("position")
        .count,
    ).toBeGreaterThan(0);
    expect(
      (zoneObject?.geometry as THREE.BufferGeometry).getAttribute("position")
        .count,
    ).toBeGreaterThan(0);
    expect(itemObject?.children.length).toBeGreaterThan(1);
    expect(itemObject?.children.map((child) => child.name)).toEqual([
      "seat",
      "back",
      "left arm",
      "right arm",
    ]);
    expect(itemObject?.position.toArray()).toEqual([1, 0, 1]);
    expect(itemObject?.userData.planCad.source).toMatchObject({
      type: "procedural",
      presetId: "sofa",
      modelKind: "sofa",
    });
  });

  it("creates Pascal library parts as external model-backed BIM items", () => {
    const data = createPlanCadPart(createDefaultPlanCadData(), { x: 1, z: 1 }, { partPresetId: "pascal-sofa" });
    const item = getNodeByType<PlanItemNode>(data, "item");
    const root = createPlanCadRootObject(data);
    const itemObject = findPlanCadNodeObjectById(root, item.id);

    expect(item.name).toBe("Pascal Sofa");
    expect(item.source).toMatchObject({
      type: "model",
      provider: "pascal",
      providerAssetId: "sofa",
      presetId: "pascal-sofa",
      format: "glb",
    });
    expect(item.source?.url).toContain("/items/system/sofa/model.glb");
    expect(itemObject?.children.map((child) => child.name)).toEqual(["model proxy"]);
    const proxy = itemObject?.children[0] as THREE.Mesh | undefined;
    const proxyMaterial = proxy?.material as THREE.MeshBasicMaterial | undefined;
    expect(proxy?.userData).toMatchObject({
      isPlanCadGeneratedChild: true,
      isPlanCadModelProxy: true,
      planCadOwnerNodeId: item.id,
      planCadOwnerNodeType: "item",
    });
    expect(proxyMaterial?.wireframe).toBe(true);
    expect(proxyMaterial?.depthWrite).toBe(false);
    expect(proxyMaterial?.transparent).toBe(true);
    expect(itemObject?.userData.planCadModel).toMatchObject({
      status: "placeholder",
      source: expect.objectContaining({ provider: "pascal" }),
    });
  });

  it("parents new plan nodes to the active level", () => {
    let data = createDefaultPlanCadData();
    const state = planCadDataToState(data);
    const upperLevel = createPlanNode("level", {
      parentId: "building_main",
      name: "Level 2",
      elevation: 3,
      height: 3,
      index: 1,
    }) as PlanLevelNode;
    insertPlanNode(state, upperLevel);
    data = {
      ...planCadStateToData(state, data),
      activeLevelId: upperLevel.id,
    };

    data = createPlanCadWall(data, { x: 0, z: 0 }, { x: 4, z: 0 });
    const wall = getNodeByType<PlanWallNode>(data, "wall");
    data = createPlanCadRectangleSlab(data, { x: 0, z: 0 }, { x: 4, z: 3 });
    const slab = getNodeByType<PlanSlabNode>(data, "slab");
    data = createPlanCadPart(data, { x: 1, z: 1 }, { partPresetId: "sofa" });
    const item = getNodeByType<PlanItemNode>(data, "item");

    expect(wall.parentId).toBe(upperLevel.id);
    expect(slab.parentId).toBe(upperLevel.id);
    expect(item.parentId).toBe(upperLevel.id);
  });

  it("adds door and window openings to the nearest wall", () => {
    let data = createPlanCadWall(
      createDefaultPlanCadData(),
      { x: 0, z: 0 },
      { x: 5, z: 0 },
    );
    const wall = getNodeByType<PlanWallNode>(data, "wall");
    data = addPlanCadOpening(data, { x: 2, z: 0.05 }, "door");
    data = addPlanCadOpening(data, { x: 4, z: 0.05 }, "window", wall.id);
    const updatedWall = data.nodes[wall.id] as PlanWallNode;
    const root = createPlanCadRootObject(data);
    const wallObject = findPlanCadNodeObjectById(root, wall.id);

    expect(updatedWall.openings.map((opening) => opening.kind)).toEqual([
      "door",
      "window",
    ]);
    expect(data.selectedNodeId).toBe(wall.id);
    expect(wallObject?.children.length).toBeGreaterThan(1);
    expect(wallObject?.userData.planCad.openingCount).toBe(2);
  });

  it("updates selected node data and rebuilds the regenerated object", () => {
    let data = createPlanCadWall(
      createDefaultPlanCadData(),
      { x: 0, z: 0 },
      { x: 3, z: 0 },
    );
    const wall = getNodeByType<PlanWallNode>(data, "wall");
    data = updatePlanCadNodeData(data, wall.id, {
      height: 4,
      thickness: 0.35,
    } as Partial<PlanWallNode>);
    const root = createPlanCadRootObject(data);
    rebuildPlanCadRootObject(root, data);
    const wallObject = findPlanCadNodeObjectById(root, wall.id);

    expect((data.nodes[wall.id] as PlanWallNode).height).toBe(4);
    expect((data.nodes[wall.id] as PlanWallNode).thickness).toBe(0.35);
    expect(findPlanCadNodeObject(wallObject)).toBe(wallObject);
  });

  it("allows generated BIM runtime wall objects to be selected", async () => {
    const { app, editor, scene } = createEditorHarness();
    const data = createPlanCadWall(
      createDefaultPlanCadData(),
      { x: 0, z: 0 },
      { x: 4, z: 0 },
    );
    const wallId = data.selectedNodeId!;
    await commitPlanCadSceneData(editor, data);
    const wallObject = findPlanCadNodeObjectById(findPlanCadRoot(scene), wallId);
    const wallMesh = wallObject?.children[0] ?? null;

    expect(wallObject?.userData.isRuntimeOnly).toBe(true);
    expect(wallObject?.userData.isPlanCadManaged).toBe(true);
    expect(wallMesh?.userData).toMatchObject({
      isBatchable: false,
      isPlanCadGeneratedChild: true,
      planCadOwnerNodeId: wallId,
      planCadOwnerNodeType: "wall",
    });
    expect(getNonSelectableReason(wallObject, app)).toBeNull();
    expect(resolveSelectionTargetFromPickHit(wallMesh)).toBe(wallObject);
    expect(getPlanCadNodeIdFromObject(wallMesh)).toBe(wallId);

    const detachedGeneratedMesh = new THREE.Mesh();
    detachedGeneratedMesh.userData = {
      isRuntimeOnly: true,
      isPlanCadGeneratedChild: true,
      planCadOwnerNodeId: wallId,
      planCadOwnerNodeType: "wall",
    };
    expect(getPlanCadNodeIdFromObject(detachedGeneratedMesh)).toBe(wallId);
  });

  it("finds an existing Plan/CAD root inside a scene", () => {
    const scene = new THREE.Scene();
    const root = createPlanCadRootObject(createDefaultPlanCadData());
    scene.add(root);

    expect(findPlanCadRoot(scene)).toBe(root);
  });

  it("finds deeply nested BIM roots and nodes without recursive Object3D traversal", () => {
    const scene = new THREE.Scene();
    const data = createPlanCadWall(
      createDefaultPlanCadData(),
      { x: 0, z: 0 },
      { x: 4, z: 0 },
    );
    const wallId = data.selectedNodeId!;
    const root = createPlanCadRootObject(data);
    let cursor: THREE.Object3D = scene;
    for (let index = 0; index < 12000; index++) {
      const child = new THREE.Group();
      cursor.add(child);
      cursor = child;
    }
    cursor.add(root);

    const traverseSpy = vi.spyOn(THREE.Object3D.prototype, "traverse");
    try {
      expect(findPlanCadRoot(scene)).toBe(root);
      expect(findPlanCadNodeObjectById(root, wallId)?.userData.planNodeId).toBe(
        wallId,
      );
      expect(traverseSpy).not.toHaveBeenCalled();
    } finally {
      traverseSpy.mockRestore();
    }
  });

  it("keeps generated geometry synced when plan creation is undone and redone through history", async () => {
    const { app, editor, scene } = createEditorHarness();
    const disposeSync = installPlanCadSceneSync(app);
    const data = createPlanCadWall(
      createDefaultPlanCadData(),
      { x: 0, z: 0 },
      { x: 4, z: 0 },
    );
    const wallId = data.selectedNodeId!;

    await commitPlanCadSceneData(editor, data);

    expect(getPlanCadSceneData(scene)?.nodes[wallId]).toBeDefined();
    expect(
      findPlanCadNodeObjectById(findPlanCadRoot(scene), wallId),
    ).toBeTruthy();

    await editor.history.undo();

    expect(getPlanCadSceneData(scene)).toBeNull();
    expect(findPlanCadRoot(scene)).toBeNull();

    await editor.history.redo();

    expect(getPlanCadSceneData(scene)?.nodes[wallId]).toBeDefined();
    expect(
      findPlanCadNodeObjectById(findPlanCadRoot(scene), wallId),
    ).toBeTruthy();
    disposeSync();
  });

  it("rebuilds the generated root to match node data when an edit is undone", async () => {
    const { app, editor, scene } = createEditorHarness();
    const disposeSync = installPlanCadSceneSync(app);
    let data = createPlanCadWall(
      createDefaultPlanCadData(),
      { x: 0, z: 0 },
      { x: 5, z: 0 },
    );
    const wallId = data.selectedNodeId!;
    await commitPlanCadSceneData(editor, data);
    data = addPlanCadOpening(data, { x: 2, z: 0 }, "door", wallId);
    await commitPlanCadSceneData(editor, data);

    expect(
      findPlanCadNodeObjectById(findPlanCadRoot(scene), wallId)?.userData
        .planCad.openingCount,
    ).toBe(1);

    await editor.history.undo();

    expect(
      (getPlanCadSceneData(scene)?.nodes[wallId] as PlanWallNode).openings,
    ).toHaveLength(0);
    expect(
      findPlanCadNodeObjectById(findPlanCadRoot(scene), wallId)?.userData
        .planCad.openingCount,
    ).toBe(0);
    disposeSync();
  });

  it("recreates managed BIM geometry when a generated child is removed directly", async () => {
    const { app, editor, scene } = createEditorHarness();
    const disposeSync = installPlanCadSceneSync(app);
    const data = createPlanCadWall(
      createDefaultPlanCadData(),
      { x: 0, z: 0 },
      { x: 5, z: 0 },
    );
    const wallId = data.selectedNodeId!;
    await commitPlanCadSceneData(editor, data);
    const wallObject = findPlanCadNodeObjectById(
      findPlanCadRoot(scene),
      wallId,
    );
    expect(wallObject).toBeTruthy();

    editor.removeObject(wallObject);
    await Promise.resolve();

    expect(getPlanCadSceneData(scene)?.nodes[wallId]).toBeDefined();
    expect(
      findPlanCadNodeObjectById(findPlanCadRoot(scene), wallId),
    ).toBeTruthy();
    disposeSync();
  });

  it("clears plan data when the managed BIM root is removed directly", async () => {
    const { app, editor, scene } = createEditorHarness();
    const disposeSync = installPlanCadSceneSync(app);
    const data = createPlanCadWall(
      createDefaultPlanCadData(),
      { x: 0, z: 0 },
      { x: 5, z: 0 },
    );
    await commitPlanCadSceneData(editor, data);
    const root = findPlanCadRoot(scene);
    expect(root).toBeTruthy();

    editor.removeObject(root);
    await Promise.resolve();
    await Promise.resolve();

    expect(getPlanCadSceneData(scene)).toBeNull();
    expect(findPlanCadRoot(scene)).toBeNull();
    disposeSync();
  });

  it("clears BIM scene data before history sync can recreate a deleted root", async () => {
    const { app, editor, scene } = createEditorHarness();
    const disposeSync = installPlanCadSceneSync(app);
    const data = createPlanCadWall(
      createDefaultPlanCadData(),
      { x: 0, z: 0 },
      { x: 5, z: 0 },
    );
    await commitPlanCadSceneData(editor, data);
    const root = findPlanCadRoot(scene);
    expect(root).toBeTruthy();

    editor.removeObject(root!);
    app.call("historyChanged", editor.history, { type: "RemoveObjectCommand" });

    expect(getPlanCadSceneData(scene)).toBeNull();
    await Promise.resolve();
    await Promise.resolve();
    expect(findPlanCadRoot(scene)).toBeNull();
    disposeSync();
  });

  it("clears BIM scene data before RemoveObjectCommand history can recreate the root", async () => {
    const { app, editor, scene } = createEditorHarness();
    const disposeSync = installPlanCadSceneSync(app);
    const data = createPlanCadPart(
      createDefaultPlanCadData(),
      { x: 1, z: 1 },
      { partPresetId: "pascal-sofa" },
    );
    await commitPlanCadSceneData(editor, data);
    const root = findPlanCadRoot(scene);
    expect(root).toBeTruthy();

    await editor.execute(new RemoveObjectCommand(root!));

    expect(getPlanCadSceneData(scene)).toBeNull();
    expect(findPlanCadRoot(scene)).toBeNull();

    await editor.history.undo();

    expect(getPlanCadSceneData(scene)?.selectedNodeId).toBe(data.selectedNodeId);
    expect(findPlanCadRoot(scene)).toBeTruthy();
    disposeSync();
  });

  it("syncs BIM selectedNodeId from editor selection without history", async () => {
    const { app, editor, scene } = createEditorHarness();
    const disposeSync = installPlanCadSceneSync(app);
    const data = {
      ...createPlanCadWall(
        createDefaultPlanCadData(),
        { x: 0, z: 0 },
        { x: 5, z: 0 },
      ),
      selectedNodeId: null,
    };
    const wall = getNodeByType<PlanWallNode>(data, "wall");
    await commitPlanCadSceneData(editor, data);
    const wallObject = findPlanCadNodeObjectById(findPlanCadRoot(scene), wall.id);
    const undoCount = editor.history.undos.length;

    editor.select(wallObject);

    expect(getPlanCadSceneData(scene)?.selectedNodeId).toBe(wall.id);
    expect(findPlanCadRoot(scene)?.userData.planCad.selectedNodeId).toBe(wall.id);

    editor.select(null);

    expect(getPlanCadSceneData(scene)?.selectedNodeId).toBeNull();
    expect(findPlanCadRoot(scene)?.userData.planCad.selectedNodeId).toBeNull();

    setPlanCadSceneSelection(editor, wall.id);

    expect(getPlanCadSceneData(scene)?.selectedNodeId).toBe(wall.id);
    expect(editor.history.undos).toHaveLength(undoCount);
    disposeSync();
  });

  it("logs plan commit failures without throwing unhandled errors", async () => {
    const { editor } = createEditorHarness();
    editor.execute = vi.fn(async () => {
      throw new Error("write denied");
    });
    const error = vi.fn();
    (window as any).logger = { error };

    const didCommit = await commitPlanCadSceneData(
      editor,
      createDefaultPlanCadData(),
    );

    expect(didCommit).toBe(false);
    expect(error).toHaveBeenCalledWith("[BIMCAD] Plan commit failed", {
      error: "write denied",
    });
  });

  it("allows direct transforms on managed BIM objects", async () => {
    const { app, editor, scene } = createEditorHarness();
    const disposeSync = installPlanCadSceneSync(app);
    const data = createPlanCadWall(
      createDefaultPlanCadData(),
      { x: 0, z: 0 },
      { x: 5, z: 0 },
    );
    const wallId = data.selectedNodeId!;
    await commitPlanCadSceneData(editor, data);

    const wallObject = findPlanCadNodeObjectById(
      findPlanCadRoot(scene),
      wallId,
    );
    expect(wallObject).toBeTruthy();

    wallObject!.position.set(99, 0, 99);
    app.call("objectChanged", editor, wallObject);
    await Promise.resolve();

    const resetWallObject = findPlanCadNodeObjectById(
      findPlanCadRoot(scene),
      wallId,
    );
    expect(resetWallObject?.position.toArray()).toEqual([99, 0, 99]);
    disposeSync();
  });

  it("serializes concurrent scene syncs so they create one BIM render root", async () => {
    const scene = new THREE.Scene();
    scene.userData[PLAN_CAD_SCENE_USER_DATA_KEY] = createPlanCadWall(
      createDefaultPlanCadData(),
      { x: 0, z: 0 },
      { x: 5, z: 0 },
    );
    let releaseAdd: (() => void) | undefined;
    const addGate = new Promise<void>((resolve) => {
      releaseAdd = resolve;
    });
    const editor: any = {
      scene,
      addObject: vi.fn(async (object: THREE.Object3D) => {
        await addGate;
        scene.add(object);
      }),
    };

    const first = syncPlanCadScene(editor);
    const second = syncPlanCadScene(editor);
    await Promise.resolve();
    releaseAdd?.();
    await Promise.all([first, second]);

    const roots = scene.children.filter(
      (object) => object.userData?.isPlanCadRoot === true,
    );
    expect(editor.addObject).toHaveBeenCalledTimes(1);
    expect(roots).toHaveLength(1);
  });

  it("removes duplicate BIM render roots left by an interrupted load", async () => {
    const { editor, scene } = createEditorHarness();
    const data = createPlanCadWall(
      createDefaultPlanCadData(),
      { x: 0, z: 0 },
      { x: 5, z: 0 },
    );
    scene.userData[PLAN_CAD_SCENE_USER_DATA_KEY] = data;
    scene.add(createPlanCadRootObject(data), createPlanCadRootObject(data));

    await syncPlanCadScene(editor);

    const roots = scene.children.filter(
      (object) => object.userData?.isPlanCadRoot === true,
    );
    expect(roots).toHaveLength(1);
    expect(editor.removeObject).not.toHaveBeenCalled();
    expect(getPlanCadSceneData(scene)).toEqual(data);
  });

  it("preserves managed BIM object identity during incremental node edits", async () => {
    const { editor, scene } = createEditorHarness();
    let data = createPlanCadWall(
      createDefaultPlanCadData(),
      { x: 0, z: 0 },
      { x: 5, z: 0 },
    );
    const firstWallId = data.selectedNodeId!;
    data = createPlanCadWall(data, { x: 0, z: 2 }, { x: 5, z: 2 });
    const secondWallId = data.selectedNodeId!;
    await commitPlanCadSceneData(editor, data);

    const root = findPlanCadRoot(scene);
    const firstWallObject = findPlanCadNodeObjectById(root, firstWallId);
    const secondWallObject = findPlanCadNodeObjectById(root, secondWallId);
    expect(firstWallObject).toBeTruthy();
    expect(secondWallObject).toBeTruthy();

    const updated = updatePlanCadNodeData(data, firstWallId, {
      height: 4,
    } as Partial<PlanWallNode>);
    await commitPlanCadSceneData(editor, updated);

    expect(findPlanCadNodeObjectById(findPlanCadRoot(scene), firstWallId)).toBe(
      firstWallObject,
    );
    expect(
      findPlanCadNodeObjectById(findPlanCadRoot(scene), secondWallId),
    ).toBe(secondWallObject);
  });

  it("keeps large plan edits incremental by reusing managed wall objects", async () => {
    const { app, editor, scene } = createEditorHarness();
    const disposeSync = installPlanCadSceneSync(app);
    let data = createDefaultPlanCadData();
    const wallIds: string[] = [];
    for (let index = 0; index < 200; index += 1) {
      data = createPlanCadWall(data, { x: 0, z: index }, { x: 5, z: index });
      wallIds.push(data.selectedNodeId!);
    }
    await commitPlanCadSceneData(editor, data);

    const objectsBefore = new Map(
      wallIds.map((id) => [
        id,
        findPlanCadNodeObjectById(findPlanCadRoot(scene), id),
      ]),
    );
    const geometryBefore = new Map(
      wallIds.map((id) => [id, getGeometrySignature(objectsBefore.get(id))]),
    );
    const updated = updatePlanCadNodeData(data, wallIds[37]!, {
      height: 4.2,
    } as Partial<PlanWallNode>);
    await commitPlanCadSceneData(editor, updated);

    const touchedGeometryIds: string[] = [];
    for (const id of wallIds) {
      const object = findPlanCadNodeObjectById(findPlanCadRoot(scene), id);
      expect(object).toBe(objectsBefore.get(id));
      if (getGeometrySignature(object) !== geometryBefore.get(id)) {
        touchedGeometryIds.push(id);
      }
    }
    expect(touchedGeometryIds).toEqual([wallIds[37]]);
    expect(touchedGeometryIds.length).toBeLessThan(5);
    disposeSync();
  });

  it("excludes generated BIM geometry from scene serialization and rebuilds from userData", async () => {
    const { editor, scene } = createEditorHarness();
    const data = createPlanCadRectangleSlab(
      createPlanCadWall(
        createDefaultPlanCadData(),
        { x: 0, z: 0 },
        { x: 5, z: 0 },
      ),
      { x: 0, z: 0 },
      { x: 5, z: 4 },
    );
    await commitPlanCadSceneData(editor, data);

    const json = new Converter().toJSON({
      scene,
      options: {},
      camera: new THREE.PerspectiveCamera(),
      scripts: [],
    });
    expect(JSON.stringify(json)).toContain(PLAN_CAD_SCENE_USER_DATA_KEY);
    expect(JSON.stringify(json)).not.toContain(PLAN_CAD_ROOT_NAME);
    expect(JSON.stringify(json)).not.toContain("selectedNodeId");

    const loadedScene = new THREE.Scene();
    loadedScene.userData[PLAN_CAD_SCENE_USER_DATA_KEY] = data;
    editor.scene = loadedScene;
    await syncPlanCadScene(editor, { force: true });

    expect(findPlanCadRoot(loadedScene)?.children.length).toBeGreaterThan(0);
  });
});
