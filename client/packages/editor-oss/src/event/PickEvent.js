
/**
 * Module: PickEvent.js
 * Purpose: Contains logic for pick event.
 */

import {Raycaster, Vector2} from "three";

import BaseEvent from "./BaseEvent";
import global from "../global";
import {resolveSelectionTargetFromPickHit} from "./picking/pickTargetUtils";
import {getNonSelectableReason} from "../utils/SelectionUtils";
import {findTopVFXParent} from "../utils/vfxRuntime";

/**
 * Checks whether pick-event tracing is enabled.
 * @returns {boolean} True when debug tracing should be logged.
 */
function shouldTracePickEvent() {
    return !!globalThis?.__TRACE_PICK_EVENT__;
}

const CLICK_DISTANCE_TOLERANCE = 0.0025;

class PickEvent extends BaseEvent {
    constructor() {
        super();
        this.raycaster = new Raycaster();
        this.mouse = new Vector2();

        this.onDownPosition = new Vector2();
        this.onUpPosition = new Vector2();
        this.reusableIntersections = [];

        this.onAppStarted = this.onAppStarted.bind(this);
        this.onAppModeEntered = this.onAppModeEntered.bind(this);
        this.onRendererRestart = this.onRendererRestart.bind(this);
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        this.app = global.app;
        this.boundViewport = null;
    }

    start() {
        this.app.on(`appStarted.${this.id}`, this.onAppStarted);
        this.app.on(`appModeEntered.${this.id}`, this.onAppModeEntered);
        this.app.on(`restartRenderer.${this.id}`, this.onRendererRestart);
        this.bindViewportListener();
    }

    stop() {
        this.app.on(`appStarted.${this.id}`, null);
        this.app.on(`appModeEntered.${this.id}`, null);
        this.app.on(`restartRenderer.${this.id}`, null);
        this.unbindViewportListener();
        document.removeEventListener("mouseup", this.onMouseUp, false);
        this.app.editor.select(null);
    }

    reset() {
        this.app.editor.select(null);
    }

    onAppStarted() {
        if (shouldTracePickEvent()) {
            console.info("[PickEvent] onAppStarted -> bindViewportListener");
        }
        this.bindViewportListener();
    }

    onAppModeEntered(_app, mode) {
        if (mode === "edit" || mode === "sandbox") {
            if (shouldTracePickEvent()) {
                console.info(`[PickEvent] onAppModeEntered(${mode}) -> bindViewportListener`);
            }
            this.bindViewportListener();
        }
    }

    onRendererRestart() {
        if (shouldTracePickEvent()) {
            console.info("[PickEvent] onRendererRestart -> bindViewportListener");
        }
        this.bindViewportListener();
    }

    bindViewportListener() {
        const viewport = this.app.viewport;
        if (!viewport || viewport === this.boundViewport) {
            return;
        }

        this.unbindViewportListener();
        viewport.addEventListener("mousedown", this.onMouseDown, false);
        this.boundViewport = viewport;
        if (shouldTracePickEvent()) {
            console.info("[PickEvent] bound mousedown to viewport");
        }
    }

    unbindViewportListener() {
        if (!this.boundViewport) {
            return;
        }

        this.boundViewport.removeEventListener("mousedown", this.onMouseDown, false);
        this.boundViewport = null;
        if (shouldTracePickEvent()) {
            console.info("[PickEvent] unbound mousedown from viewport");
        }
    }

    onMouseDown(event) {
        if (shouldTracePickEvent()) {
            console.info("[PickEvent] onMouseDown", {
                button: event.button,
                disableClickEvents: this.app.disableClickEvents,
            });
        }
        if (this.app.disableClickEvents) {
            return;
        }
        if (event.button !== 0) {
            return;
        }

        // event.preventDefault();

        this.writeMousePosition(this.onDownPosition, this.app.viewport, event.clientX, event.clientY);

        document.addEventListener("mouseup", this.onMouseUp, false);
    }

    onMouseUp(event) {
        try {
            if (this.app.disableClickEvents) {
                return;
            }
            this.writeMousePosition(this.onUpPosition, this.app.viewport, event.clientX, event.clientY);

            if (shouldTracePickEvent()) {
                const distance = this.onDownPosition.distanceTo(this.onUpPosition);
                console.info("[PickEvent] onMouseUp", {
                    button: event.button,
                    distance,
                    withinClickTolerance: distance <= CLICK_DISTANCE_TOLERANCE,
                });
            }

            this.handleClick(event);
        } finally {
            document.removeEventListener("mouseup", this.onMouseUp, false);
        }
    }

    setRayFromPoint(point) {
        this.mouse.set(point.x * 2 - 1, -(point.y * 2) + 1);
        this.raycaster.setFromCamera(
            this.mouse,
            this.app.editor.view === "perspective" ? this.app.editor.camera : this.app.editor.orthCamera,
        );
    }

    intersectObjectsInto(objects, recursive = true, target = []) {
        return this.raycaster.intersectObjects(objects, recursive, target);
    }

    getIntersects(point, objects, recursive = true, target = []) {
        target.length = 0;
        this.setRayFromPoint(point);
        return this.intersectObjectsInto(objects, recursive, target);
    }

    writeMousePosition(target, dom, x, y) {
        let rect = dom.getBoundingClientRect();
        target.set((x - rect.left) / rect.width, (y - rect.top) / rect.height);
        return target;
    }

    getMousePosition(dom, x, y) {
        const rect = dom.getBoundingClientRect();
        return [(x - rect.left) / rect.width, (y - rect.top) / rect.height];
    }

    getClosestSelectableObject(objectsCollision) {
        let previousResolvedObject = null;

        for (let i = 0; i < objectsCollision.length; i++) {
            const hitObject = objectsCollision[i].object;
            const resolvedObject = resolveSelectionTargetFromPickHit(hitObject);
            if (resolvedObject && resolvedObject === previousResolvedObject) {
                continue;
            }
            previousResolvedObject = resolvedObject;

            const blockReason = this.getNonSelectableReason(resolvedObject);
            if (blockReason) {
                if (shouldTracePickEvent()) {
                    console.info("[PickEvent] reject intersected object", {
                        index: i,
                        distance: objectsCollision[i].distance,
                        reason: blockReason,
                        hitType: hitObject?.type,
                        hitName: hitObject?.name,
                        hitUuid: hitObject?.uuid,
                        targetType: resolvedObject?.type,
                        targetName: resolvedObject?.name,
                        targetUuid: resolvedObject?.uuid,
                        targetTag: resolvedObject?.tag,
                        isSelectable: resolvedObject?.userData?.isSelectable,
                    });
                }
                continue;
            }

            return resolvedObject;
        }

        return null;
    }

    getNonSelectableReason(object) {
        return getNonSelectableReason(object, this.app);
    }

    canSelectObject(object) {
        return !this.getNonSelectableReason(object);
    }

    getToggledMultiSelection(currentSelection) {
        const selected = this.app.editor.selected;
        const selectedObjects = Array.isArray(selected) ? selected : selected ? [selected] : [];
        const existingIndex = selectedObjects.indexOf(currentSelection);

        if (existingIndex === -1) {
            return [...selectedObjects, currentSelection];
        }

        const toggledSelection = new Array(selectedObjects.length - 1);
        for (let i = 0, j = 0; i < selectedObjects.length; i++) {
            if (i !== existingIndex) {
                toggledSelection[j++] = selectedObjects[i];
            }
        }
        return toggledSelection;
    }

    handleClick(e) {
        const isMultiselecting = e.shiftKey;
        const editor = this.app.editor;
        const objects = editor.scene.children;
        const selectionHelpers = editor.selectionHelpers;
        const clickDistance = this.onDownPosition.distanceTo(this.onUpPosition);

        if (clickDistance <= CLICK_DISTANCE_TOLERANCE) {
            if (editor.cadMode && editor.cadController) {
                if (!editor.cadEditedObject) {
                    editor.exitCADMode();
                    return;
                }

                const prevPointsThreshold = this.raycaster.params.Points.threshold;
                const prevLineThreshold = this.raycaster.params.Line.threshold;
                this.raycaster.params.Points.threshold = 0.45;
                this.raycaster.params.Line.threshold = 0.3;
                const cadIntersects = this.getIntersects(this.onUpPosition, editor.cadController.getPickableObjects(), true);
                this.raycaster.params.Points.threshold = prevPointsThreshold;
                this.raycaster.params.Line.threshold = prevLineThreshold;

                editor.cadController.handlePickIntersections(cadIntersects, isMultiselecting);
                return;
            }

            const allObjectsIntersects = this.reusableIntersections;
            allObjectsIntersects.length = 0;
            this.setRayFromPoint(this.onUpPosition);
            this.intersectObjectsInto(objects, true, allObjectsIntersects);
            const objectsIntersectsCount = allObjectsIntersects.length;
            this.intersectObjectsInto(selectionHelpers, false, allObjectsIntersects);
            const helpersIntersectsCount = allObjectsIntersects.length - objectsIntersectsCount;

            if (shouldTracePickEvent()) {
                console.info("[PickEvent] handleClick intersects", {
                    clickDistance,
                    objectsIntersects: objectsIntersectsCount,
                    helpersIntersects: helpersIntersectsCount,
                    totalIntersects: allObjectsIntersects.length,
                });
            }

            const currentSelection = this.getClosestSelectableObject(allObjectsIntersects);

            if (!currentSelection) {
                if (shouldTracePickEvent()) {
                    console.info("[PickEvent] handleClick no selectable object");
                }
                if (!isMultiselecting) {
                    editor.select(null);
                }
                return;
            }

            if (isMultiselecting) {
                editor.select(this.getToggledMultiSelection(currentSelection));
            } else {
                // check if selected object is part of VFX, if it is, select main parent container
                const vfxParent = findTopVFXParent(currentSelection, editor.scene);
                if (vfxParent && editor && currentSelection.uuid !== vfxParent.uuid) {
                    if (shouldTracePickEvent()) {
                        console.info("[PickEvent] selecting vfx parent", {name: vfxParent.name, uuid: vfxParent.uuid});
                    }
                    editor.select(vfxParent);
                    this.app.call("sceneTriggeredSelect", vfxParent, vfxParent);
                } else {
                    if (shouldTracePickEvent()) {
                        console.info("[PickEvent] selecting object", {
                            name: currentSelection.name,
                            uuid: currentSelection.uuid,
                            type: currentSelection.type,
                        });
                    }
                    editor.select(currentSelection);
                    this.app.call("sceneTriggeredSelect", currentSelection, currentSelection);
                }
            }
        } else if (shouldTracePickEvent()) {
            console.info("[PickEvent] handleClick ignored due to movement", {
                clickDistance,
                tolerance: CLICK_DISTANCE_TOLERANCE,
            });
        }
    }
}

export default PickEvent;
