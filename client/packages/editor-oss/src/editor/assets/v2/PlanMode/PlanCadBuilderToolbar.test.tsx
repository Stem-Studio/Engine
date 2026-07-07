import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import * as THREE from "three";

import global from "@stem/editor-oss/global";
import { PlanCadToolbar } from "./PlanCadToolbar";

vi.mock("../common/Tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function installFakeApp() {
  const scene = new THREE.Scene();
  scene.userData.snapping = { grid: { enabled: true, increment: 1 } };
  const sceneHelpers = new THREE.Scene();
  const handlers = new Map<string, (...args: any[]) => void>();
  const app = {
    isPlaying: false,
    disableClickEvents: false,
    editor: {
      scene,
      sceneHelpers,
      selected: null,
      gpuPickNum: 0,
      computeIntersectPoint: vi.fn(() => new THREE.Vector3()),
      execute: vi.fn(async (command) => command.execute?.()),
      addObject: vi.fn((object: THREE.Object3D, parent?: THREE.Object3D) => {
        (parent ?? scene).add(object);
      }),
      select: vi.fn(),
    },
    on: vi.fn((key: string, handler: ((...args: any[]) => void) | null) => {
      if (handler) handlers.set(key, handler);
      else handlers.delete(key);
    }),
    emit: (key: string, ...args: any[]) => handlers.get(key)?.(...args),
    call: vi.fn(),
  };
  global.app = app as any;
  return app;
}

function activateGroupedTool(groupId: string, toolId: string) {
  fireEvent.click(screen.getByTestId(`plan-cad-group-${groupId}`));
  fireEvent.click(screen.getByTestId(`plan-cad-tool-${toolId}`));
}

describe("Plan/CAD builder toolbar", () => {
  afterEach(() => {
    cleanup();
    global.app = null;
  });

  it("renders Plan/CAD as labeled, meaningful tool actions", async () => {
    installFakeApp();

    render(<PlanCadToolbar />);

    for (const label of ["Select", "Structure", "Openings", "Objects"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    activateGroupedTool("structure", "wall");

    await waitFor(() => {
      expect(screen.getByTestId("plan-cad-tool-wall")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
  });

  it("lets Plan/CAD room drawing finish an arbitrary polygon", async () => {
    const app = installFakeApp();
    render(<PlanCadToolbar />);

    activateGroupedTool("structure", "room");
    await waitFor(() => {
      expect(screen.getByTestId("plan-cad-tool-room")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    await act(async () => {
      app.emit(
        "raycast.PlanCadToolbar",
        { point: new THREE.Vector3(0, 0, 0), object: null },
        { preventDefault: vi.fn(), planCadCommit: true },
      );
      app.emit(
        "raycast.PlanCadToolbar",
        { point: new THREE.Vector3(4, 0, 0), object: null },
        { preventDefault: vi.fn(), planCadCommit: true },
      );
      app.emit(
        "raycast.PlanCadToolbar",
        { point: new THREE.Vector3(4, 0, 3), object: null },
        { preventDefault: vi.fn(), planCadCommit: true },
      );
      app.emit(
        "raycast.PlanCadToolbar",
        { point: new THREE.Vector3(1, 0, 4), object: null },
        { preventDefault: vi.fn(), planCadCommit: true },
      );
    });

    expect(screen.getAllByText("Room 4 pts").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId("plan-cad-finish-polygon"));

    await waitFor(() => {
      const slabs = Object.values(
        app.editor.scene.userData.planCad.nodes,
      ).filter(
        (node: any): node is { type: "slab"; points: unknown[] } =>
          node.type === "slab",
      );
      expect(slabs[0]?.points).toHaveLength(4);
    });
    await act(async () => {
      await Promise.resolve();
    });
  });

  it("lets Backspace remove the last polygon draft point", async () => {
    const app = installFakeApp();
    render(<PlanCadToolbar />);

    activateGroupedTool("structure", "room");
    await waitFor(() => {
      expect(screen.getByTestId("plan-cad-tool-room")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    await act(async () => {
      app.emit(
        "raycast.PlanCadToolbar",
        { point: new THREE.Vector3(0, 0, 0), object: null },
        { preventDefault: vi.fn(), planCadCommit: true },
      );
      app.emit(
        "raycast.PlanCadToolbar",
        { point: new THREE.Vector3(4, 0, 0), object: null },
        { preventDefault: vi.fn(), planCadCommit: true },
      );
      app.emit(
        "raycast.PlanCadToolbar",
        { point: new THREE.Vector3(4, 0, 3), object: null },
        { preventDefault: vi.fn(), planCadCommit: true },
      );
    });

    expect(screen.getAllByText("Room 3 pts").length).toBeGreaterThan(0);
    expect(screen.getByTestId("plan-cad-measurement")).toHaveTextContent(
      "Backspace removes last point",
    );

    fireEvent.keyDown(window, { key: "Backspace" });

    await waitFor(() => {
      expect(screen.getAllByText("Room 2 pts").length).toBeGreaterThan(0);
    });
  });
});
