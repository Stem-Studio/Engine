import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import * as THREE from "three";

import global from "@stem/editor-oss/global";
import { ActionBar, getEditorDocsUrl } from "./ActionBar";

let mockIsAdmin = false;

vi.mock("@stem/editor-oss/context", () => ({
  useAuthorizationContext: () => ({ isAdmin: mockIsAdmin }),
}));

vi.mock("./useCollaborationStatus", () => ({
  useCollaborationStatus: () => null,
}));

vi.mock("../common/Tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("./CADActionBarControls", () => ({
  CADActionBarControls: ({
    forceVisible,
    onClose,
  }: {
    forceVisible?: boolean;
    allowAutoVisible?: boolean;
    onClose?: () => void;
  }) =>
    forceVisible ? (
      <div data-testid="mesh-cad-toolbar">
        <button type="button" data-testid="mesh-cad-close" onClick={onClose}>
          Close
        </button>
      </div>
    ) : null,
}));

vi.mock("../QuickBuild/QuickBuildToolbar", () => ({
  QuickBuildToolbar: ({ onClose }: { onClose?: () => void }) => (
    <div data-testid="quick-build-toolbar">
      <button type="button" data-testid="quick-build-close" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));

vi.mock("../PlanMode/PlanCadToolbar", () => ({
  PlanCadToolbar: ({ onClose }: { onClose?: () => void }) => (
    <div data-testid="plan-cad-toolbar">
      <button type="button" data-testid="plan-cad-close" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));

vi.mock("./CameraOrientationPanel", () => ({
  CameraOrientationPanel: () => null,
}));

vi.mock("./SnapConfigPanel", () => ({
  SnapConfigPanel: () => null,
}));

vi.mock("../BehaviorEditor/KeybindingsPanel", () => ({
  EDITOR_KEYBINDINGS: [],
  KeybindingsPanel: () => null,
}));

vi.mock("../GameDebugPanel/GameDebugPanel", () => ({
  GameDebugPanel: () => null,
}));

function installFakeApp(options: { cadToolsEnabled?: boolean } = {}) {
  const scene = new THREE.Scene();
  scene.userData.cadTools = { enabled: options.cadToolsEnabled ?? true };
  scene.userData.snapping = { grid: { enabled: false, increment: 1 } };
  const handlers = new Map<string, (...args: any[]) => void>();
  const app = {
    editor: {
      scene,
      component: {
        state: { showAiCopilot: false },
        props: { setActiveRightPanel: vi.fn() },
        toggleAiCopilot: vi.fn(),
        openAiCopilotTerminal: vi.fn(),
      },
      controls: { current: { controls: null } },
      cadMode: false,
      exitCADMode: vi.fn(() => {
        app.editor.cadMode = false;
      }),
    },
    on: vi.fn((key: string, handler: ((...args: any[]) => void) | null) => {
      if (handler) handlers.set(key, handler);
      else handlers.delete(key);
    }),
    call: vi.fn(),
    emit: (key: string, ...args: any[]) => handlers.get(key)?.(...args),
  };
  global.app = app as any;
  return app;
}

describe("ActionBar builder modes", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    mockIsAdmin = false;
    global.app = null;
    window.history.pushState({}, "", "/");
    window.localStorage.clear();
  });

  it("keeps Mesh CAD and BIM Plan as explicit CAD menu choices", async () => {
    installFakeApp();

    render(<ActionBar />);

    fireEvent.click(screen.getByTestId("actionbar-cad-tools"));
    fireEvent.click(await screen.findByTestId("actionbar-mesh-cad"));

    expect(screen.getByTestId("mesh-cad-toolbar")).toBeInTheDocument();
    expect(screen.queryByTestId("plan-cad-toolbar")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mesh-cad-close"));
    expect(screen.queryByTestId("mesh-cad-toolbar")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("actionbar-cad-tools"));
    fireEvent.click(await screen.findByTestId("actionbar-mesh-cad"));
    expect(screen.getByTestId("mesh-cad-toolbar")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("actionbar-cad-tools"));
    fireEvent.click(await screen.findByTestId("actionbar-mesh-cad"));
    expect(screen.queryByTestId("mesh-cad-toolbar")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("actionbar-cad-tools"));
    fireEvent.click(await screen.findByTestId("actionbar-plan-cad"));

    expect(screen.queryByTestId("mesh-cad-toolbar")).not.toBeInTheDocument();
    expect(screen.getByTestId("plan-cad-toolbar")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("plan-cad-close"));
    expect(screen.queryByTestId("plan-cad-toolbar")).not.toBeInTheDocument();
  });

  it("exits active mesh edit mode when switching to BIM Plan or Quick Build", async () => {
    const app = installFakeApp();
    app.editor.cadMode = true;

    render(<ActionBar />);

    fireEvent.click(screen.getByTestId("actionbar-cad-tools"));
    fireEvent.click(await screen.findByTestId("actionbar-plan-cad"));

    expect(app.editor.exitCADMode).toHaveBeenCalledTimes(1);

    app.editor.cadMode = true;
    fireEvent.click(screen.getByTestId("actionbar-quick-build"));

    expect(app.editor.exitCADMode).toHaveBeenCalledTimes(2);
  });

  it("keeps builder modes mutually exclusive across quick, plan, and mesh transitions", async () => {
    installFakeApp();

    render(<ActionBar />);

    fireEvent.click(screen.getByTestId("actionbar-quick-build"));
    expect(screen.getByTestId("quick-build-toolbar")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("actionbar-cad-tools"));
    fireEvent.click(await screen.findByTestId("actionbar-plan-cad"));

    expect(screen.queryByTestId("quick-build-toolbar")).not.toBeInTheDocument();
    expect(screen.getByTestId("plan-cad-toolbar")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("actionbar-cad-tools"));
    fireEvent.click(await screen.findByTestId("actionbar-mesh-cad"));

    expect(screen.queryByTestId("plan-cad-toolbar")).not.toBeInTheDocument();
    expect(screen.getByTestId("mesh-cad-toolbar")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("actionbar-quick-build"));

    expect(screen.getByTestId("quick-build-toolbar")).toBeInTheDocument();
    expect(screen.queryByTestId("mesh-cad-toolbar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("plan-cad-toolbar")).not.toBeInTheDocument();
  });

  it("keeps CAD tools discoverable when disabled and routes users to project settings", async () => {
    const app = installFakeApp({ cadToolsEnabled: false });

    render(<ActionBar />);

    fireEvent.click(screen.getByTestId("actionbar-cad-tools"));
    expect(await screen.findByTestId("actionbar-mesh-cad")).toBeDisabled();
    expect(screen.getByTestId("actionbar-plan-cad")).toBeDisabled();
    fireEvent.click(screen.getByTestId("actionbar-enable-cad-tools"));

    expect(app.editor.component.props.setActiveRightPanel).toHaveBeenCalled();
    expect(app.call).toHaveBeenCalledWith(
      "focusProjectSettingsSection",
      app.editor,
      "cadTools",
    );
  });

  it("focuses the build menu and returns focus to its trigger on Escape", async () => {
    installFakeApp();

    render(<ActionBar />);

    const menuTrigger = screen.getByTestId("actionbar-cad-tools");
    fireEvent.click(menuTrigger);
    const quickItem = await screen.findByTestId("actionbar-build-quick");

    await waitFor(() => {
      expect(quickItem).toHaveFocus();
    });

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(menuTrigger).toHaveFocus();
    });
    expect(screen.queryByRole("menu", { name: "Build tools" })).toBeNull();
  });

  it("focuses the Copilot admin menu and returns focus to its trigger on Escape", async () => {
    mockIsAdmin = true;
    installFakeApp();

    render(<ActionBar />);

    const copilotTrigger = screen.getByTestId("actionbar-copilot");
    fireEvent.pointerDown(copilotTrigger);

    const scriptTool = await screen.findByRole("menuitem", {
      name: "Script Tool",
    });
    await waitFor(() => {
      expect(scriptTool).toHaveFocus();
    });

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(copilotTrigger).toHaveFocus();
    });
    expect(screen.queryByRole("menu", { name: "AI Copilot tools" })).toBeNull();
  });

  it("routes builder=cad to Mesh CAD instead of BIM Plan", async () => {
    window.history.pushState({}, "", "/?builder=cad");
    installFakeApp();

    render(<ActionBar />);

    await waitFor(() => {
      expect(screen.getByTestId("mesh-cad-toolbar")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("plan-cad-toolbar")).not.toBeInTheDocument();
  });

  it("routes builder=bim to BIM Plan", async () => {
    window.history.pushState({}, "", "/?builder=bim");
    installFakeApp();

    render(<ActionBar />);

    await waitFor(() => {
      expect(screen.getByTestId("plan-cad-toolbar")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("mesh-cad-toolbar")).not.toBeInTheDocument();
  });

  it("restores the last active builder mode for the current scene", async () => {
    const app = installFakeApp();
    window.localStorage.setItem(
      `stem:builderMode:${app.editor.scene.uuid}`,
      "quick",
    );

    render(<ActionBar />);

    await waitFor(() => {
      expect(screen.getByTestId("quick-build-toolbar")).toBeInTheDocument();
    });
  });

  it("opens the local docs route from Help by default", () => {
    installFakeApp();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    render(<ActionBar />);

    fireEvent.click(screen.getByLabelText("Open help documentation"));

    expect(openSpy).toHaveBeenCalledWith("/docs", "_blank");
  });

  it("supports an explicit docs URL override", () => {
    expect(getEditorDocsUrl("https://docs.example.test/create")).toBe(
      "https://docs.example.test/create",
    );
    expect(getEditorDocsUrl("  ")).toBe("/docs");
  });
});
