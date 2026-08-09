import {afterEach, describe, expect, it, vi} from "vitest";
import * as THREE from "three";

import global from "../global";
import PickEvent from "./PickEvent";

function createRect(): DOMRect {
    return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 100,
        bottom: 100,
        width: 100,
        height: 100,
        toJSON: () => ({}),
    } as DOMRect;
}

function createApp() {
    const viewport = document.createElement("canvas");
    viewport.getBoundingClientRect = vi.fn(createRect);
    document.body.appendChild(viewport);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const orthCamera = new THREE.OrthographicCamera();

    const app = {
        disableClickEvents: false,
        viewport,
        editor: {
            view: "perspective",
            camera,
            orthCamera,
            scene,
            selectionHelpers: [],
            selected: null as THREE.Object3D | THREE.Object3D[] | null,
            select: vi.fn(),
        },
        on: vi.fn(),
        call: vi.fn(),
    };

    return app;
}

describe("PickEvent", () => {
    const previousApp = global.app;

    afterEach(() => {
        global.app = previousApp;
        document.body.innerHTML = "";
        vi.restoreAllMocks();
    });

    it("uses one camera ray setup when combining scene and helper intersections", () => {
        const app = createApp();
        global.app = app as unknown as typeof global.app;
        const event = new PickEvent();
        const setFromCamera = vi.spyOn(event.raycaster, "setFromCamera");

        event.onDownPosition.set(0.5, 0.5);
        event.onUpPosition.set(0.5, 0.5);
        event.handleClick({shiftKey: false});

        expect(setFromCamera).toHaveBeenCalledTimes(1);
        expect(app.editor.select).toHaveBeenCalledWith(null);
    });

    it("removes document mouseup listener even when click events are disabled before mouseup", () => {
        const app = createApp();
        global.app = app as unknown as typeof global.app;
        const event = new PickEvent();
        const addEventListener = vi.spyOn(document, "addEventListener");
        const removeEventListener = vi.spyOn(document, "removeEventListener");

        event.onMouseDown(new MouseEvent("mousedown", {button: 0, clientX: 10, clientY: 10}));
        app.disableClickEvents = true;
        event.onMouseUp(new MouseEvent("mouseup", {button: 0, clientX: 10, clientY: 10}));

        expect(addEventListener).toHaveBeenCalledWith("mouseup", event.onMouseUp, false);
        expect(removeEventListener).toHaveBeenCalledWith("mouseup", event.onMouseUp, false);
    });

    it("writes mouse positions into reusable vectors without changing the legacy array helper", () => {
        const app = createApp();
        global.app = app as unknown as typeof global.app;
        const event = new PickEvent();
        const target = new THREE.Vector2();

        expect(event.writeMousePosition(target, app.viewport, 25, 75)).toBe(target);
        expect(target.x).toBeCloseTo(0.25);
        expect(target.y).toBeCloseTo(0.75);
        expect(event.getMousePosition(app.viewport, 25, 75)).toEqual([0.25, 0.75]);
    });

    it("returns the first selectable hit from the raycaster-sorted intersections", () => {
        const app = createApp();
        global.app = app as unknown as typeof global.app;
        const event = new PickEvent();
        const blocked = new THREE.Object3D();
        const selectable = new THREE.Object3D();
        const fartherSelectable = new THREE.Object3D();
        const getNonSelectableReason = vi.spyOn(event, "getNonSelectableReason");
        (blocked as THREE.Object3D & {tag?: string}).tag = "helper";

        const selected = event.getClosestSelectableObject([
            {object: blocked, distance: 1},
            {object: selectable, distance: 2},
            {object: fartherSelectable, distance: 3},
        ]);

        expect(selected).toBe(selectable);
        expect(getNonSelectableReason).toHaveBeenCalledTimes(2);
        expect(getNonSelectableReason).toHaveBeenNthCalledWith(1, blocked);
        expect(getNonSelectableReason).toHaveBeenNthCalledWith(2, selectable);
    });

    it("does not re-run selectability checks for consecutive duplicate hits", () => {
        const app = createApp();
        global.app = app as unknown as typeof global.app;
        const event = new PickEvent();
        const blocked = new THREE.Object3D();
        const selectable = new THREE.Object3D();
        const getNonSelectableReason = vi.spyOn(event, "getNonSelectableReason").mockImplementation(object => {
            return object === blocked ? "tag-helper" : null;
        });

        const selected = event.getClosestSelectableObject([
            {object: blocked, distance: 1},
            {object: blocked, distance: 1.1},
            {object: selectable, distance: 2},
        ]);

        expect(selected).toBe(selectable);
        expect(getNonSelectableReason).toHaveBeenCalledTimes(2);
        expect(getNonSelectableReason).toHaveBeenNthCalledWith(1, blocked);
        expect(getNonSelectableReason).toHaveBeenNthCalledWith(2, selectable);
    });

    it("promotes generated BIM wall segment hits to the outliner wall group", () => {
        const app = createApp();
        global.app = app as unknown as typeof global.app;
        const event = new PickEvent();
        const wallGroup = new THREE.Group();
        wallGroup.name = "BIM Wall";
        wallGroup.userData = {
            isStemObject: true,
            isRuntimeOnly: true,
            isPlanCadManaged: true,
            planNodeId: "wall-1",
            planNodeType: "wall",
            managedBy: "BIM Plan",
        };
        const wallSegment = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        wallSegment.name = "generated wall segment";
        wallSegment.userData = {
            isRuntimeOnly: true,
            isPlanCadGeneratedChild: true,
            planCadOwnerNodeId: "wall-1",
            planCadOwnerNodeType: "wall",
        };
        wallGroup.add(wallSegment);
        app.editor.scene.add(wallGroup);

        const selected = event.getClosestSelectableObject([{object: wallSegment, distance: 1}]);

        expect(selected).toBe(wallGroup);
    });

    it("builds a clean multi-selection when shift-selecting from no selection", () => {
        const app = createApp();
        global.app = app as unknown as typeof global.app;
        const event = new PickEvent();
        const object = new THREE.Object3D();

        app.editor.selected = null;

        expect(event.getToggledMultiSelection(object)).toEqual([object]);
    });

    it("toggles an existing multi-selection without retaining null entries", () => {
        const app = createApp();
        global.app = app as unknown as typeof global.app;
        const event = new PickEvent();
        const first = new THREE.Object3D();
        const second = new THREE.Object3D();

        app.editor.selected = [first, second];

        expect(event.getToggledMultiSelection(first)).toEqual([second]);
        expect(event.getToggledMultiSelection(new THREE.Object3D())).toHaveLength(3);
    });
});
