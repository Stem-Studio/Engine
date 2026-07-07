import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as THREE from "three";

import global from "@stem/editor-oss/global";
import { PlanCadPropertiesSection } from "./PlanCadPropertiesSection";
import {
  createPlanCadRootObject,
  createPlanCadWall,
  PLAN_CAD_SCENE_USER_DATA_KEY,
} from "./planCadEditorBridge";
import type { PlanWallNode } from "./planCadCore";

type CommandLike = {
  execute?: () => Promise<unknown> | unknown;
};

const createExecuteSpy = () =>
  vi.fn(async (command: CommandLike) => command.execute?.());

const installTestApp = (
  scene: THREE.Scene,
  execute = createExecuteSpy(),
) => {
  global.app = {
    editor: {
      scene,
      execute,
    },
    on: vi.fn(),
    call: vi.fn(),
  } as unknown as NonNullable<typeof global.app>;
  return execute;
};

describe("PlanCadPropertiesSection", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    global.app = null;
  });

  it("shows the active BIM node when the Plan/CAD root is selected", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );

    const scene = new THREE.Scene();
    const data = createPlanCadWall(null, { x: 0, z: 0 }, { x: 5, z: 0 });
    scene.userData[PLAN_CAD_SCENE_USER_DATA_KEY] = data;
    const root = createPlanCadRootObject(data);
    scene.add(root);

    installTestApp(scene);

    render(<PlanCadPropertiesSection selectedObject={root} />);

    expect(screen.getByText("Wall")).toBeInTheDocument();
    expect(screen.getByTestId("plan-cad-breadcrumb")).toHaveTextContent(
      "Site > Building > Ground Floor > Wall",
    );
    expect(screen.getByText("Height")).toBeInTheDocument();
    expect(screen.getByText("Thickness")).toBeInTheDocument();
  });

  it("shows the active BIM node when editor drill-down selects the site container", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );

    const scene = new THREE.Scene();
    const data = createPlanCadWall(null, { x: 0, z: 0 }, { x: 5, z: 0 });
    scene.userData[PLAN_CAD_SCENE_USER_DATA_KEY] = data;
    const root = createPlanCadRootObject(data);
    scene.add(root);
    const site = root.children[0]!;

    installTestApp(scene);

    render(<PlanCadPropertiesSection selectedObject={site} />);

    expect(screen.getByText("Wall")).toBeInTheDocument();
    expect(screen.getByText("Height")).toBeInTheDocument();
    expect(screen.getByText("Thickness")).toBeInTheDocument();
  });

  it("deletes the selected editable BIM node through scene userData commands", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );

    const scene = new THREE.Scene();
    const data = createPlanCadWall(null, { x: 0, z: 0 }, { x: 5, z: 0 });
    const wallId = data.selectedNodeId!;
    scene.userData[PLAN_CAD_SCENE_USER_DATA_KEY] = data;
    const root = createPlanCadRootObject(data);
    scene.add(root);

    installTestApp(scene);

    render(<PlanCadPropertiesSection selectedObject={root} />);

    fireEvent.click(screen.getByTestId("plan-cad-delete-node"));
    expect(screen.getByTestId("plan-cad-delete-node")).toHaveTextContent(
      "Delete wall?",
    );
    fireEvent.click(screen.getByTestId("plan-cad-delete-node"));

    await waitFor(() => {
      expect(
        scene.userData[PLAN_CAD_SCENE_USER_DATA_KEY].nodes[wallId],
      ).toBeUndefined();
      expect(
        scene.userData[PLAN_CAD_SCENE_USER_DATA_KEY].selectedNodeId,
      ).toBeNull();
    });
  });

  it("selects and edits wall openings from the BIM properties panel", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );

    const scene = new THREE.Scene();
    const data = createPlanCadWall(null, { x: 0, z: 0 }, { x: 5, z: 0 });
    const wallId = data.selectedNodeId!;
    const wall = data.nodes[wallId] as PlanWallNode;
    wall.openings = [
      {
        id: "door_a",
        kind: "door",
        t: 0.25,
        width: 0.92,
        sillHeight: 0,
        height: 2.1,
      },
      {
        id: "window_b",
        kind: "window",
        t: 0.75,
        width: 1.2,
        sillHeight: 0.9,
        height: 1.1,
      },
    ];
    scene.userData[PLAN_CAD_SCENE_USER_DATA_KEY] = data;
    const root = createPlanCadRootObject(data);
    scene.add(root);

    installTestApp(scene);

    render(<PlanCadPropertiesSection selectedObject={root} />);

    expect(screen.getByText("2 openings")).toBeInTheDocument();
    fireEvent.click(screen.getByText("window 2"));
    fireEvent.change(screen.getByDisplayValue("1.2"), {
      target: { value: "1.5" },
    });

    await waitFor(() => {
      const nextWall = scene.userData[PLAN_CAD_SCENE_USER_DATA_KEY].nodes[
        wallId
      ] as PlanWallNode;
      expect(nextWall.openings[0]?.width).toBe(0.92);
      expect(nextWall.openings[1]?.width).toBe(1.5);
    });
  });

  it("coalesces rapid BIM property edits into one scene-data command", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );

    const scene = new THREE.Scene();
    const data = createPlanCadWall(null, { x: 0, z: 0 }, { x: 5, z: 0 });
    const wallId = data.selectedNodeId!;
    scene.userData[PLAN_CAD_SCENE_USER_DATA_KEY] = data;
    const root = createPlanCadRootObject(data);
    scene.add(root);
    const execute = createExecuteSpy();

    installTestApp(scene, execute);

    render(<PlanCadPropertiesSection selectedObject={root} />);

    fireEvent.change(screen.getByDisplayValue("3"), {
      target: { value: "3.1" },
    });
    fireEvent.change(screen.getByDisplayValue("0.2"), {
      target: { value: "0.4" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(219);
    });
    expect(execute).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(execute).toHaveBeenCalledTimes(1);
    const nextWall = scene.userData[PLAN_CAD_SCENE_USER_DATA_KEY].nodes[
      wallId
    ] as PlanWallNode;
    expect(nextWall.height).toBe(3.1);
    expect(nextWall.thickness).toBe(0.4);
  });

  it("flushes a pending BIM property edit before unmount", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );

    const scene = new THREE.Scene();
    const data = createPlanCadWall(null, { x: 0, z: 0 }, { x: 5, z: 0 });
    const wallId = data.selectedNodeId!;
    scene.userData[PLAN_CAD_SCENE_USER_DATA_KEY] = data;
    const root = createPlanCadRootObject(data);
    scene.add(root);
    const execute = createExecuteSpy();

    installTestApp(scene, execute);

    const { unmount } = render(<PlanCadPropertiesSection selectedObject={root} />);

    fireEvent.change(screen.getByDisplayValue("3"), {
      target: { value: "3.4" },
    });
    expect(execute).not.toHaveBeenCalled();

    unmount();
    await act(async () => {
      await Promise.resolve();
    });

    expect(execute).toHaveBeenCalledTimes(1);
    const nextWall = scene.userData[PLAN_CAD_SCENE_USER_DATA_KEY].nodes[
      wallId
    ] as PlanWallNode;
    expect(nextWall.height).toBe(3.4);
  });
});
