
/**
 * Module: RaycastEvent.js
 * Purpose: Contains logic for raycast event.
 */


import {Plane, Raycaster, Vector2, Vector3} from "three";

import BaseEvent from "./BaseEvent";
import global from "../global";

class RaycastEvent extends BaseEvent {
    constructor() {
        super();
        this.mouse = new Vector2();
        this.raycaster = new Raycaster();
        this.intersections = [];
        this.groundPoint = new Vector3();
        this.groundPlane = new Plane().setFromNormalAndCoplanarPoint(new Vector3(0, 1, 0), new Vector3());
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
    }

    start() {
        global.app.on(`mousedown.${this.id}`, this.onMouseDown);
        global.app.on(`mouseup.${this.id}`, this.onMouseUp);
    }

    stop() {
        global.app.on(`mousedown.${this.id}`, null);
        global.app.on(`mouseup.${this.id}`, null);
    }

    reset() {}

    onMouseDown(event) {
        if (!global.app.editor) {
            return;
        }
        if (event.target !== global.app.editor.renderer.domElement) {
            return;
        }

        this.isDown = true;
        this.x = event.offsetX;
        this.y = event.offsetY;
    }

    onMouseUp(event) {
        const app = global.app;
        const editor = app.editor;
        if (!editor) {
            return;
        }
        if (event.target !== editor.renderer.domElement) {
            this.isDown = false;
            return;
        }

        if (!this.isDown || this.x !== event.offsetX || this.y !== event.offsetY) {
            this.isDown = false;
            return;
        }
        this.isDown = false;

        let domElement = editor.renderer.domElement;

        this.mouse.x = event.offsetX / domElement.clientWidth * 2 - 1;
        this.mouse.y = -event.offsetY / domElement.clientHeight * 2 + 1;

        this.raycaster.setFromCamera(
            this.mouse,
            editor.view === "perspective" ? editor.camera : editor.orthCamera,
        );

        const intersects = this.intersections;
        intersects.length = 0;
        this.raycaster.intersectObjects(editor.scene.children, true, intersects);

        if (intersects.length > 0) {
            app.call("raycast", this, intersects[0], event);
            app.call("intersect", this, intersects[0], event, intersects);
        } else {
            const target = this.groundPoint;
            target.set(0, 0, 0);
            this.raycaster.ray.intersectPlane(this.groundPlane, target);

            app.call(
                "raycast",
                this,
                {
                    point: target,
                    distance: this.raycaster.ray.distanceSqToPoint(target),
                    object: null,
                },
                event,
            );
        }
    }
}

export default RaycastEvent;
