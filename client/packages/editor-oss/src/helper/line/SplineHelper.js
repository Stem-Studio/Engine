/**
 * Module: SplineHelper.js
 * Purpose: Contains logic for spline helper.
 */

import {BoxGeometry, Mesh, MeshBasicMaterial} from "three";
import global from "../../global";
import BaseHelper from "../BaseHelper";

class SplineHelper extends BaseHelper {
    constructor() {
        super();
        this.box = [];
    }

    start() {
        global.app.on(`objectSelected.${this.id}`, this.onObjectSelected.bind(this));
        global.app.on(`objectChanged.${this.id}`, this.onObjectChanged.bind(this));
    }

    stop() {
        global.app.on(`objectSelected.${this.id}`, null);
        global.app.on(`objectChanged.${this.id}`, null);
        this.onCancelSelectLine();
    }

    onObjectSelected(object) {
        if (object === null) {
            this.onCancelSelectLine();
        } else if (
            object.userData &&
            (object.userData.type === "LineCurve" ||
                object.userData.type === "CatmullRomCurve" ||
                object.userData.type === "QuadraticBezierCurve" ||
                object.userData.type === "CubicBezierCurve")
        ) {
            this.onSelectLine(object);
        }
    }

    onObjectChanged(obj) {
        if (this.box.length === 0) {
            return;
        }

        var scene = global.app.editor.sceneHelpers;
        var line = this.box[0].userData.object;

        if (obj === line) {

            line.userData.points.forEach((n, i) => {
                if (this.box[i]) {
                    this.box[i].position.copy(line.position).add(n);
                } else {
                    var mesh = new Mesh(this.box[0].geometry, this.box[0].material);

                    mesh.position.copy(line.position).add(n);

                    Object.assign(mesh.userData, {
                        type: "helper",
                        object: line,
                    });

                    scene.add(mesh);
                    this.box.push(mesh);
                }
            });

            if (this.box.length > line.userData.points.length) {
                this.removeBoxes(this.box.splice(line.userData.points.length, this.box.length - line.userData.points.length));
            }
        } else if (obj.userData && obj.userData.type === "helper") {

            var object = obj.userData.object;

            var index = this.box.indexOf(obj);

            if (index > -1) {
                object.userData.points[index].copy(object.position).multiplyScalar(-1).add(obj.position);
                object.update();
            }
        }
    }

    onSelectLine(object) {
        var scene = global.app.editor.sceneHelpers;

        this.onCancelSelectLine();

        var geometry = new BoxGeometry(0.4, 0.4, 0.4);
        var material = new MeshBasicMaterial({
            color: 0xff0000,
        });

        object.userData.points.forEach(n => {
            var mesh = new Mesh(geometry, material);

            mesh.position.copy(object.position).add(n);

            Object.assign(mesh.userData, {
                type: "helper",
                object: object,
            });

            scene.add(mesh);
            this.box.push(mesh);
        });
    }

    onCancelSelectLine() {
        const boxes = this.box.splice(0);
        this.removeBoxes(boxes);
        this.disposeBoxResources(boxes);
    }

    removeBoxes(boxes) {
        var scene = global.app.editor.sceneHelpers;
        boxes.forEach(n => {
            scene.remove(n);
            delete n.userData.object;
        });
    }

    disposeBoxResources(boxes) {
        const geometries = new Set();
        const materials = new Set();
        boxes.forEach(n => {
            if (n.geometry) {
                geometries.add(n.geometry);
            }
            const material = n.material;
            if (Array.isArray(material)) {
                material.forEach(item => materials.add(item));
            } else if (material) {
                materials.add(material);
            }
        });
        geometries.forEach(geometry => geometry.dispose());
        materials.forEach(material => material.dispose());
    }
}

export default SplineHelper;
