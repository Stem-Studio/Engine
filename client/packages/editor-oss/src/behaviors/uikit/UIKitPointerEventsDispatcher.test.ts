import {afterEach, describe, expect, it, vi} from "vitest";
import {Object3D, PerspectiveCamera, Raycaster, Vector2, Vector3, type Intersection} from "three";

import {UIKitPointerEventsDispatcher} from "./UIKitPointerEventsDispatcher";

function createCanvas(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.getBoundingClientRect = vi.fn(() => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 100,
        bottom: 100,
        width: 100,
        height: 100,
        toJSON: () => ({}),
    }) as DOMRect);
    document.body.appendChild(canvas);
    return canvas;
}

function makeIntersection(object: Object3D, distance = 1): Intersection<Object3D> {
    return {
        distance,
        point: new Vector3(),
        object,
    };
}

describe("UIKitPointerEventsDispatcher", () => {
    afterEach(() => {
        UIKitPointerEventsDispatcher.destroy();
        document.body.innerHTML = "";
        vi.restoreAllMocks();
    });

    it("reuses and clears the hover raycast target array", () => {
        const canvas = createCanvas();
        const camera = new PerspectiveCamera();
        const scene = new Object3D();
        const hitObject = new Object3D() as Object3D & {hover?: boolean};
        hitObject.hover = true;
        scene.add(hitObject);

        let firstTarget: Intersection<Object3D>[] | null = null;
        const intersectObjects = vi.spyOn(Raycaster.prototype, "intersectObjects").mockImplementation(
            (_objects: Object3D[], _recursive?: boolean, target?: Intersection<Object3D>[]) => {
                expect(target).toBeDefined();
                const targetHits = target!;
                if (!firstTarget) {
                    firstTarget = targetHits;
                } else {
                    expect(targetHits).toBe(firstTarget);
                }
                expect(targetHits).toHaveLength(0);
                targetHits.push(makeIntersection(hitObject));
                return targetHits;
            },
        );

        UIKitPointerEventsDispatcher.initialize({domElement: canvas} as never, camera, scene);
        UIKitPointerEventsDispatcher.update();
        UIKitPointerEventsDispatcher.update();

        expect(intersectObjects).toHaveBeenCalledTimes(2);
    });

    it("reuses and clears the click raycast target array", () => {
        const canvas = createCanvas();
        const camera = new PerspectiveCamera();
        const scene = new Object3D();
        const onClick = vi.fn();
        const hitObject = new Object3D() as Object3D & {onClick?: (event: PointerEvent) => void};
        hitObject.onClick = onClick;
        scene.add(hitObject);

        let firstTarget: Intersection<Object3D>[] | null = null;
        const distanceTo = vi.spyOn(Vector2.prototype, "distanceTo");
        const distanceToSquared = vi.spyOn(Vector2.prototype, "distanceToSquared");
        const intersectObjects = vi.spyOn(Raycaster.prototype, "intersectObjects").mockImplementation(
            (_objects: Object3D[], _recursive?: boolean, target?: Intersection<Object3D>[]) => {
                expect(target).toBeDefined();
                const targetHits = target!;
                if (!firstTarget) {
                    firstTarget = targetHits;
                } else {
                    expect(targetHits).toBe(firstTarget);
                }
                expect(targetHits).toHaveLength(0);
                targetHits.push(makeIntersection(hitObject));
                return targetHits;
            },
        );

        UIKitPointerEventsDispatcher.initialize({domElement: canvas} as never, camera, scene);
        canvas.dispatchEvent(new PointerEvent("pointerdown", {clientX: 50, clientY: 50, bubbles: true}));
        window.dispatchEvent(new PointerEvent("pointerup", {clientX: 50, clientY: 50, bubbles: true}));
        canvas.dispatchEvent(new PointerEvent("pointerdown", {clientX: 50, clientY: 50, bubbles: true}));
        window.dispatchEvent(new PointerEvent("pointerup", {clientX: 50, clientY: 50, bubbles: true}));

        expect(intersectObjects).toHaveBeenCalledTimes(2);
        expect(distanceToSquared).toHaveBeenCalledTimes(2);
        expect(distanceTo).not.toHaveBeenCalled();
        expect(onClick).toHaveBeenCalledTimes(2);
    });
});
