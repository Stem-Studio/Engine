import {Box3, Color, Light, Sphere, Vector3} from "three";
import BaseHelper from "./BaseHelper";
import {isAabbMode} from "./boundingBoxMode";
import {OrientedBoxHelper} from "./OrientedBoxHelper";
import {computeOrientedBox, createOrientedBoxResult} from "./orientedBox";
import {isInputActive} from "../editor/assets/v2/utils/isInputActive";
import global from "../global";
import {traverseObjectDepthFirst} from "../utils/SceneTraverser";

const hasOwnExplicitGaussianSplatSelectionMarker = object => (
    object?.userData?.__isGaussianSplat === true ||
    object?.userData?.gaussianSplatFormat ||
    object?.type === "SplatMesh"
);

/**
 * SelectHelper - Manages object selection and visual indication
 *
 * This helper creates visual indicators around selected objects,
 * including selection boxes and outline effects to help users
 * identify which objects are currently selected.
 */
class SelectHelper extends BaseHelper {
    constructor() {
        super();
        this.hideObjects = [];
        this.sceneHelperGrid = null;
        this.sceneHelpers = null;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.composer = null;
        this.animate = false;
        this.hasDisabledCameraCollision = false;
        this.boundMouseDown = this.onMouseDown.bind(this);
        this.boundMouseUp = this.onMouseUp.bind(this);
        this.boundKeyDown = this.onKeyDown.bind(this);

        this.selectionBoxes = [];

        this.selectedObject = null;
        this.selectedObjects = null;
        this.controls = null;

        this.lastClickTime = null;
        this.doubleClickThreshold = 300;
        this.app = global.app;

        this.userSelectionColors = {};
        this.otherUserSelectionBoxes = {};
        this.selectionColorPalette = COLORS.map(color => new Color(color));
        this.nextColorIndex = 0;
        this.userColorIndexes = {};
        this.freeColorIndexes = Array.from({length: this.selectionColorPalette.length}, (_, i) => i);

        this.updateOtherUserSelectionsTimer = null;

        this.multiSelectionBoxScratch = new Box3();
        this.selectionBoxScratch = new Box3();
        this.selectionBoxScratch2 = new Box3();
        this.selectionPointScratch = new Vector3();
        this.selectionWorldPositionScratch = new Vector3();
        this.selectionOrientedBoundsScratch = createOrientedBoxResult();
        this.selectionOrientedBoundsOptions = {
            shouldAbort: hasOwnExplicitGaussianSplatSelectionMarker,
        };
        this.selectionBoundsDirty = true;
        this.selectionMatrixCache = new Map();
        this.selectionMatrixSeen = new Set();
    }

    start() {
        global.app.on(`objectSelected.${this.id}`, this.onObjectSelected.bind(this));
        global.app.on(`objectArraySelected.${this.id}`, this.onObjectArraySelected.bind(this));
        global.app.on(`objectRemoved.${this.id}`, this.onObjectRemoved.bind(this));
        global.app.on(`storageChanged.${this.id}`, this.onStorageChanged.bind(this));
        global.app.on(`sceneLoaded.${this.id}`, this.onSceneLoaded.bind(this));
        global.app.on(`sceneSaveStart.${this.id}`, this.deleteSelectionBoxes.bind(this));
        global.app.on(`animate.${this.id}`, this.onAnimate.bind(this));
        global.app.on(`objectChanged.${this.id}`, this.onObjectChanged.bind(this));
        global.app.on(`objectUpdated.${this.id}`, this.onObjectUpdated.bind(this));
        global.app.on(`sceneUpdated.${this.id}`, this.updateOtherUserSelections.bind(this));
        global.app.on(`playerStarted.${this.id}`, this.removeOtherUserSelections.bind(this));
        global.app.on(`boundingBoxModeChanged.${this.id}`, this.onBoundingBoxModeChanged.bind(this));
        global.app.on(`unitsSettingsChanged.${this.id}`, this.onBoundingBoxModeChanged.bind(this));

        //document.addEventListener("mousemove", this.onMouseMove.bind(this));
        document.addEventListener("mouseup", this.boundMouseUp);
        document.addEventListener("keydown", this.boundKeyDown);
    }

    stop() {
        global.app.on(`objectSelected.${this.id}`, null);
        global.app.on(`objectArraySelected.${this.id}`, null);
        global.app.on(`objectRemoved.${this.id}`, null);
        global.app.on(`storageChanged.${this.id}`, null);
        global.app.on(`sceneLoaded.${this.id}`, null);
        global.app.on(`sceneSaveStart.${this.id}`, null);
        global.app.on(`sceneSaved.${this.id}`, null);
        global.app.on(`sceneSaveFailed.${this.id}`, null);
        global.app.on(`animate.${this.id}`, null);
        global.app.on(`objectChanged.${this.id}`, null);
        global.app.on(`objectUpdated.${this.id}`, null);
        global.app.on(`sceneUpdated.${this.id}`, null);
        global.app.on(`playerStarted.${this.id}`, null);
        global.app.on(`boundingBoxModeChanged.${this.id}`, null);
        global.app.on(`unitsSettingsChanged.${this.id}`, null);

        //document.removeEventListener("mousemove", this.onMouseMove);
        document.removeEventListener("mouseup", this.boundMouseUp);
        document.removeEventListener("keydown", this.boundKeyDown);

        if (this.updateOtherUserSelectionsTimer) {
            clearTimeout(this.updateOtherUserSelectionsTimer);
            this.updateOtherUserSelectionsTimer = null;
        }

        this.unselect();
    }

    onSceneLoaded() {
        const {editor} = global.app;
        editor.composer = null;
        editor.renderPass = null;
        editor.outlinePass = null;
        editor.fxaaPass = null;

        this.sceneHelpers = editor.sceneHelpers;

        this.scene = editor.scene;
        this.camera = editor.camera;
        this.renderer = editor.renderer;

        this.controls = this.scene.userData.controls;
        this.markSelectionBoundsDirty();
        this.updateOtherUserSelections();
    }

    onMouseDown(event) {
        if (event.button === 0) {
            this.refreshSelectedBounds({force: true});
        }
    }

    onAnimate() {
        this.refreshSelectedBounds();
        // Update label size/opacity for all active selection boxes.
        if (this.camera) {
            for (const helper of this.selectionBoxes) {
                if (typeof helper.updateLabelPresentation === "function") {
                    helper.updateLabelPresentation(this.camera);
                }
            }
        }
    }

    onMouseUp() {
        this.refreshSelectedBounds({force: true});
    }

    onKeyDown(event) {
        if ((event.key === "f" || event.key === "F") && !isInputActive()) {
            if (this.selectedObjects?.length > 1) {
                this.focusCameraOnObjects(this.camera, this.selectedObjects);
            } else if (this.selectedObject) {
                this.focusCameraOnObject(this.camera, this.selectedObject);
            }
        }
    }

    focusCameraOnObjects(camera, selectedObjects) {
        if (!camera) {
            console.warn("SelectHelper: camera not initialized yet, skipping focus");
            return;
        }

        if (!selectedObjects?.length) return;

        const controls = global.app.editor.controls;
        const orbitControls = controls?.current?.controls;
        if (!orbitControls) return;

        const validObjects = selectedObjects.filter(obj => obj && !obj.name.toLowerCase().includes("sky"));

        if (!validObjects.length) return;

        const combinedBox = this.multiSelectionBoxScratch.makeEmpty();

        validObjects.forEach(obj => {
            const box = this.getSelectionBox(obj, true, this.selectionBoxScratch);
            if (!box) {
                this.selectionBoxScratch.setFromObject(obj);
            }

            combinedBox.union(box || this.selectionBoxScratch);
        });

        if (combinedBox.isEmpty()) return;

        const center = new Vector3();
        combinedBox.getCenter(center);

        const sphere = new Sphere();
        combinedBox.getBoundingSphere(sphere);

        let radius = sphere.radius > 0 ? sphere.radius : 1;

        const fovMargin = 10;
        const fov = (camera.fov - fovMargin) * (Math.PI / 180);
        const distance = radius / Math.sin(fov / 2);

        const viewDir = new Vector3();
        camera.getWorldDirection(viewDir);
        viewDir.normalize();

        const newCameraPos = center.clone().sub(viewDir.multiplyScalar(distance));

        camera.position.copy(newCameraPos);
        orbitControls.target.copy(center);
        orbitControls.update();
    }

    onObjectArraySelected(objects) {
        if (this.app?.disableClickEvents) {
            return;
        }

        if (!objects || objects.length === 0) {
            this.unselect();
            return;
        }

        this.unselect({preserveTransformControls: true});

        // Store selected objects array
        this.selectedObjects = objects;

        objects.forEach(object => {
            // Emit outlined event for each selected object
            global.app.call("objectOutlined", this, object);
        });

        this.createSelectionBox();
        this.updateSelectionBoxes(objects);
        this.rememberSelectionMatrices(objects);
        this.selectionBoundsDirty = false;
    }

    onObjectChanged(object) {
        // Update selection boxes when object changes (during transformations)
        if (!object) {
            return;
        }

        if (this.isSelectionAffectedByObject(object)) {
            const selectedObjects = this.getSelectedBoundsObjects();
            if (selectedObjects.length > 1) {
                this.updateSelectionBoxes(selectedObjects);
                this.rememberSelectionMatrices(selectedObjects);
            } else {
                this.updateSelectionBoxes(selectedObjects[0]);
                this.rememberSelectionMatrices(selectedObjects);
            }
            this.selectionBoundsDirty = false;
        }
    }

    isSelectionAffectedByObject(object) {
        return this.getSelectedBoundsObjects().some(selected =>
            this.isSameOrAncestor(selected, object) || this.isSameOrAncestor(object, selected),
        );
    }

    isSameOrAncestor(candidate, object) {
        let current = object;
        while (current) {
            if (current === candidate) {
                return true;
            }
            current = current.parent;
        }
        return false;
    }

    onObjectSelected(object, noFocus = false) {
        if (this.app?.disableClickEvents) {
            return;
        }
        if (!object) {
            this.unselect();
            return;
        }

        this.deleteSelectionBoxes();

        //unselect the currently selected object
        if ((this.selectedObject || this.selectedObjects?.length > 0) && !noFocus) {
            this.unselect({preserveTransformControls: true});
        }

        this.selectedObject = object;

        // TODO: this method should not have been called if the object is
        // not selectable. This logic probably belongs elsewhere.
        if (
            this.selectedObject &&
            global.app.editor.isSandbox &&
            global.app.isPlaying &&
            this.selectedObject.userData.isSelectable
        ) {
            // Emit outline event for selected object instead of directly manipulating outliner
            global.app.call("objectOutlined", this, this.selectedObject);
        }

        this.createSelectionBox();
        this.updateSelectionBox(object, 0);
        this.rememberSelectionMatrices([object]);
        this.selectionBoundsDirty = false;

        const currentTime = Date.now();
        const isDoubleClick = currentTime - this.lastClickTime < this.doubleClickThreshold;
        this.lastClickTime = currentTime;

        if (this.selectedObject && isDoubleClick && !noFocus) {
            this.focusCameraOnObject(this.camera, this.selectedObject);
        }

        if (global.app.editor.isSandbox) {
            traverseObjectDepthFirst(this.selectedObject, child => {
                child.userData.tempDisableCameraCollision = true;
            });
        }
    }

    onObjectUpdated(object) {
        if (this.selectedObject?.uuid !== object?.uuid) {
            return;
        }
        this.onObjectSelected(object, true);
    }

    onObjectDeselected(object) {
        if (global.app.editor.isSandbox) {
            traverseObjectDepthFirst(object, child => {
                delete child.userData.tempDisableCameraCollision;
            });
        }
    }

    updateInsertionPoint(camera) {
        camera.updateMatrixWorld();

        const origin = new Vector3().setFromMatrixPosition(camera.matrixWorld);
        const direction = new Vector3().copy(camera.getWorldDirection(new Vector3()));

        const planeNormal = new Vector3(0, 1, 0);
        const planePoint = new Vector3(0, 0, 0);

        const planeD = -planeNormal.dot(planePoint);
        const denominator = planeNormal.dot(direction);

        if (Math.abs(denominator) > 1e-6) {
            const t = -(planeNormal.dot(origin) + planeD) / denominator;

            if (t >= 0) {
                const intersectionPoint = origin.clone().add(direction.clone().multiplyScalar(t));
                return [
                    {
                        point: intersectionPoint,
                        distance: origin.distanceTo(intersectionPoint),
                    },
                ];
            }
        }

        return [];
    }

    updateSelectionBoxes(object) {
        if (Array.isArray(object)) {
            if (object.length === 1) {
                this.updateSelectionBox(object[0], 0);
                return;
            }

            this.updateMultiSelectionBox(object);
        } else {
            this.updateSelectionBox(object, 0);
        }
    }

    refreshSelectedBounds({force = false} = {}) {
        const objects = this.getSelectedBoundsObjects();
        if (objects.length === 0) {
            this.resetSelectionBoundsTracking();
            return false;
        }

        const shouldRefresh =
            force ||
            this.selectionBoundsDirty ||
            global.app?.isPlaying ||
            global.app?.transformControls?.dragging ||
            this.haveSelectionMatricesChanged(objects);

        if (!shouldRefresh) {
            return false;
        }

        this.updateSelectionBoxes(objects.length === 1 ? objects[0] : objects);
        this.rememberSelectionMatrices(objects);
        this.selectionBoundsDirty = false;
        return true;
    }

    getSelectedBoundsObjects() {
        if (this.selectedObjects?.length > 0) {
            return this.selectedObjects.filter(Boolean);
        }
        return this.selectedObject ? [this.selectedObject] : [];
    }

    markSelectionBoundsDirty() {
        this.selectionBoundsDirty = true;
    }

    resetSelectionBoundsTracking() {
        this.selectionBoundsDirty = true;
        this.selectionMatrixCache.clear();
        this.selectionMatrixSeen.clear();
    }

    haveSelectionMatricesChanged(objects) {
        const seen = this.selectionMatrixSeen;
        seen.clear();
        let changed = this.selectionMatrixCache.size !== objects.length;

        for (const object of objects) {
            if (!object?.uuid) {
                changed = true;
                continue;
            }

            this.updateTrackedWorldMatrix(object);
            seen.add(object.uuid);

            const cached = this.selectionMatrixCache.get(object.uuid);
            if (!cached) {
                changed = true;
                continue;
            }

            const elements = object.matrixWorld.elements;
            for (let i = 0; i < 16; i++) {
                if (cached[i] !== elements[i]) {
                    changed = true;
                    break;
                }
            }
        }

        for (const uuid of this.selectionMatrixCache.keys()) {
            if (!seen.has(uuid)) {
                changed = true;
                break;
            }
        }

        return changed;
    }

    rememberSelectionMatrices(objects) {
        const seen = this.selectionMatrixSeen;
        seen.clear();

        for (const object of objects) {
            if (!object?.uuid) {
                continue;
            }

            this.updateTrackedWorldMatrix(object);
            seen.add(object.uuid);

            let cached = this.selectionMatrixCache.get(object.uuid);
            if (!cached) {
                cached = new Array(16);
                this.selectionMatrixCache.set(object.uuid, cached);
            }

            const elements = object.matrixWorld.elements;
            for (let i = 0; i < 16; i++) {
                cached[i] = elements[i];
            }
        }

        for (const uuid of Array.from(this.selectionMatrixCache.keys())) {
            if (!seen.has(uuid)) {
                this.selectionMatrixCache.delete(uuid);
            }
        }
    }

    updateTrackedWorldMatrix(object) {
        if (object.matrixAutoUpdate) {
            object.updateMatrix();
        }
        object.updateWorldMatrix(true, false);
    }

    updateMultiSelectionBox(objects) {
        const selectionBox = this.selectionBoxes[0];
        if (!selectionBox) {
            return;
        }

        const combinedBox = this.multiSelectionBoxScratch.makeEmpty();
        let hasBounds = false;

        objects.forEach(object => {
            const objectBox = this.getSelectionBox(object, true, this.selectionBoxScratch);
            if (!objectBox) {
                return;
            }

            combinedBox.union(objectBox);
            hasBounds = true;
        });

        if (!hasBounds || combinedBox.isEmpty()) {
            selectionBox.visible = false;
            return;
        }

        selectionBox.setFromWorldBox(combinedBox);
        selectionBox.visible = true;
    }

    updateSelectionBox(object, index) {
        const selectionBox = this.selectionBoxes[index];
        if (!selectionBox) {
            return;
        }

        const billboardBox = this.getBillboardSelectionBox(object, this.selectionBoxScratch);
        if (billboardBox) {
            selectionBox.visible = true;
            selectionBox.setFromWorldBox(billboardBox);
            return;
        }

        if (isAabbMode()) {
            const box = this.getSelectionBox(object, false, this.selectionBoxScratch);
            if (!box || box.isEmpty()) {
                selectionBox.visible = false;
                return;
            }

            selectionBox.setFromWorldBox(box);
            selectionBox.visible = true;
            return;
        }

        selectionBox.visible = this.applyObbToHelper(object, selectionBox, false);
    }

    updateOtherUserSelections() {
        if (this.updateOtherUserSelectionsTimer) {
            clearTimeout(this.updateOtherUserSelectionsTimer);
        }

        this.updateOtherUserSelectionsTimer = setTimeout(() => {
            if (!this.scene) return;
            this.removeOtherUserSelections();
            traverseObjectDepthFirst(this.scene, obj => {
                if (obj.userData && obj.userData.selectedBy && obj.userData.selectedBy !== this.app.userId) {
                    const color = this.getColorForUser(obj.userData.selectedBy);
                    const selectionBox = new OrientedBoxHelper({color, showLabels: false});
                    if (!this.applyObbToHelper(obj, selectionBox, true)) return;

                    selectionBox.material.depthTest = false;
                    selectionBox.material.depthWrite = false;
                    selectionBox.frustumCulled = false;
                    selectionBox.renderOrder = 9999;
                    selectionBox.material.transparent = true;
                    selectionBox.material.opacity = 1;
                    selectionBox.setLabelsVisible(false);
                    selectionBox.name = `SelectionBox_${obj.userData.selectedBy}`;
                    this.otherUserSelectionBoxes[obj.uuid] = selectionBox;
                    this.sceneHelpers?.add(selectionBox);
                }
            });
        }, 100);
    }

    removeOtherUserSelections() {
        Object.values(this.otherUserSelectionBoxes).forEach(box => {
            this.sceneHelpers?.remove(box);
            box.dispose?.();
        });
        this.otherUserSelectionBoxes = {};
    }

    focusCameraOnObject(camera, selectedObject) {
        if (!camera) {
            console.warn("SelectHelper: camera not initialized yet, skipping focus");
            return;
        }
        if (!selectedObject || selectedObject.name.toLowerCase().includes("sky")) return;

        const controls = global.app.editor.controls;
        const orbitControls = controls?.current?.controls;
        if (!orbitControls) return;

        const box = this.getSelectionBox(selectedObject, true, this.selectionBoxScratch) ||
            this.selectionBoxScratch.setFromObject(selectedObject);
        const sphere = new Sphere();
        box.getBoundingSphere(sphere);
        const focusPosition = sphere.center;
        let radius = sphere.radius > 0 ? sphere.radius : 1;
        const fovMargin = 10;
        const fov = (camera.fov - fovMargin) * (Math.PI / 180);
        const distance = radius / Math.sin(fov / 2);

        const viewDir = new Vector3();
        camera.getWorldDirection(viewDir);
        viewDir.normalize();

        const newCameraPos = new Vector3().copy(focusPosition).sub(viewDir.multiplyScalar(distance));

        camera.position.copy(newCameraPos);
        orbitControls.target.copy(focusPosition);
        orbitControls.update();
    }

    getSelectionBox(object, allowFallback = false, target = new Box3()) {
        const billboardBox = this.getBillboardSelectionBox(object, target);
        if (billboardBox) {
            return billboardBox;
        }

        const box = this.getObjectWorldSelectionBox(object, target);
        if (box) {
            return box;
        }

        if (!allowFallback) {
            return null;
        }

        return this.createFallbackSelectionBox(object, target);
    }

    getObjectWorldSelectionBox(object, target = new Box3()) {
        const orientedBounds = computeOrientedBox(
            object,
            this.selectionOrientedBoundsScratch,
            this.selectionOrientedBoundsOptions,
        );
        if (!orientedBounds.hasGeometry || orientedBounds.box.isEmpty()) {
            return null;
        }

        const worldBox = target.makeEmpty();
        const point = this.selectionPointScratch;
        const {min, max} = orientedBounds.box;

        for (let i = 0; i < 8; i++) {
            point.set(
                i & 1 ? max.x : min.x,
                i & 2 ? max.y : min.y,
                i & 4 ? max.z : min.z,
            ).applyMatrix4(orientedBounds.basis);
            worldBox.expandByPoint(point);
        }

        return worldBox.isEmpty() ? null : worldBox;
    }

    getBillboardSelectionBox(object, target = new Box3()) {
        const bounds = object?.userData?.billboardSelectionBounds;
        if (!object?.userData?.isBillboard || !this.hasValidBillboardSelectionBounds(bounds)) {
            return null;
        }

        object.updateMatrixWorld(true);

        const halfWidth = bounds.width / 2;
        const halfHeight = bounds.height / 2;
        const halfDepth = Math.max(bounds.depth, 0.001) / 2;
        const box = target.makeEmpty();
        const point = this.selectionPointScratch;

        for (let i = 0; i < 8; i++) {
            point.set(
                i & 1 ? halfWidth : -halfWidth,
                i & 2 ? halfHeight : -halfHeight,
                i & 4 ? halfDepth : -halfDepth,
            ).applyMatrix4(object.matrixWorld);
            box.expandByPoint(point);
        }

        return box;
    }

    hasValidBillboardSelectionBounds(bounds) {
        return (
            bounds && Number.isFinite(bounds.width) && Number.isFinite(bounds.height) && Number.isFinite(bounds.depth)
        );
    }

    createFallbackSelectionBox(object, target = new Box3()) {
        const worldPos = this.selectionWorldPositionScratch;
        object.getWorldPosition(worldPos);
        const halfSize = 0.5;
        target.min.copy(worldPos).subScalar(halfSize);
        target.max.copy(worldPos).addScalar(halfSize);
        return target;
    }

    onObjectRemoved(object) {
        if (object?.uuid === this.selectedObject?.uuid) {
            this.unselect();
            return;
        }

        if (this.selectedObjects?.some(selected => selected?.uuid === object?.uuid)) {
            global.app.call("objectUnoutlined", this, object);
            this.selectedObjects = this.selectedObjects.filter(selected => selected?.uuid !== object?.uuid);

            if (this.selectedObjects.length === 0) {
                this.unselect();
                return;
            }

            this.updateSelectionBoxes(this.selectedObjects);
            this.rememberSelectionMatrices(this.selectedObjects);
            this.selectionBoundsDirty = false;
        }
    }

    unselect({preserveTransformControls = false} = {}) {
        if (!preserveTransformControls) {
            global.app.transformControls?.detach();
        }
        this.resetSelectionBoundsTracking();
        this.cancelSelectionAnimation();

        if (global.app.editor.outlinePass) {
            global.app.editor.outlinePass.selectedObjects = [];
        }

        if (global.app.transformControls && !preserveTransformControls) {
            global.app.transformControls.visible = false;
        }

        if (this.selectedObject) {
            // Emit unoutlined event for the object being deselected
            global.app.call("objectUnoutlined", this, this.selectedObject);
            this.onObjectDeselected(this.selectedObject);
            this.selectedObject = null;
        }

        // Clear selected objects array and emit unoutlined events
        if (this.selectedObjects && this.selectedObjects.length > 0) {
            this.selectedObjects.forEach(obj => {
                global.app.call("objectUnoutlined", this, obj);
            });
        }
        this.selectedObjects = null;

        this.deleteSelectionBoxes();
    }

    hideNonSelectedObjects(obj, selected, root) {
        const revealSelectedPath = () => {
            let current = selected?.parent;
            while (current && current !== root) {
                const index = this.hideObjects.indexOf(current);
                if (index !== -1) {
                    this.hideObjects.splice(index, 1);
                }
                if (Object.prototype.hasOwnProperty.call(current.userData, "oldVisible")) {
                    current.visible = current.userData.oldVisible;
                    delete current.userData.oldVisible;
                }
                current = current.parent;
            }
        };

        const stack = [obj];
        while (stack.length > 0) {
            const current = stack.pop();
            if (!current || current instanceof Light) continue;

            if (current === selected) {
                revealSelectedPath();
                continue;
            }

            if (current !== root) {
                current.userData.oldVisible = current.visible;
                current.visible = false;
                this.hideObjects.push(current);
            }

            for (let i = current.children.length - 1; i >= 0; i--) {
                const child = current.children[i];
                if (child) stack.push(child);
            }
        }
    }

    showNonSelectedObjects() {
        this.hideObjects.forEach(n => {
            n.visible = n.userData.oldVisible;
            delete n.userData.oldVisible;
        });
    }

    onStorageChanged(name, value) {
        if (!this.edgeMaterial) {
            return;
        }
        if (name === "selectedColor") {
            this.edgeMaterial.uniforms.color.value.set(value);
        } else if (name === "selectedThickness") {
            this.edgeMaterial.uniforms.thickness.value = value;
        }
    }

    onBoundingBoxModeChanged() {
        if (this.selectedObject) {
            this.updateSelectionBoxes(this.selectedObject);
            this.rememberSelectionMatrices([this.selectedObject]);
        }
        if (Array.isArray(this.selectedObjects)) {
            this.updateSelectionBoxes(this.selectedObjects);
            this.rememberSelectionMatrices(this.selectedObjects);
        }
        this.selectionBoundsDirty = false;
        this.updateOtherUserSelections();
    }

    cancelSelectionAnimation() {
        if (global.app.editor?.animationId) {
            cancelAnimationFrame(global.app.editor.animationId);
            global.app.editor.animationId = null;
        }
    }
    createSelectionBox() {
        if (!this.sceneHelpers) {
            console.warn("SelectHelper: sceneHelpers not initialized yet, skipping selection box creation");
            return null;
        }
        const selectionBox = new OrientedBoxHelper();
        selectionBox.material.depthTest = false;
        selectionBox.material.depthWrite = false;
        selectionBox.frustumCulled = false;
        selectionBox.renderOrder = 9999;
        selectionBox.material.transparent = true;
        selectionBox.material.opacity = global.app.isPlaying ? 0 : 1;
        selectionBox.setLabelsVisible(!global.app.isPlaying);
        selectionBox.name = "SelectionBox";
        selectionBox.visible = false;
        this.selectionBoxes.push(selectionBox);
        this.sceneHelpers.add(selectionBox);
        return selectionBox;
    }

    applyObbToHelper(object, helper, allowFallback = false) {
        const billboardBox = this.getBillboardSelectionBox(object, this.selectionBoxScratch2);
        if (billboardBox) {
            helper.setFromWorldBox(billboardBox);
            return true;
        }

        const orientedBounds = computeOrientedBox(
            object,
            this.selectionOrientedBoundsScratch,
            this.selectionOrientedBoundsOptions,
        );
        if (helper.setFromOrientedBox(orientedBounds)) {
            return true;
        }

        if (!allowFallback) return false;

        helper.setFromWorldBox(this.createFallbackSelectionBox(object, this.selectionBoxScratch2));
        return true;
    }

    deleteSelectionBoxes() {
        if (this.selectionBoxes.length > 0) {
            this.selectionBoxes.forEach(selectionBox => {
                if (this.sceneHelpers) {
                    this.sceneHelpers.remove(selectionBox);
                }
                selectionBox.dispose?.();
            });
            this.selectionBoxes = [];
        }
        this.resetSelectionBoundsTracking();
    }

    getColorForUser(userToken) {
        if (!this.userSelectionColors[userToken]) {
            let colorIndex = this.freeColorIndexes.length > 0 ? this.freeColorIndexes.shift() : 0;
            this.userSelectionColors[userToken] = this.selectionColorPalette[colorIndex];
            if (!this.userColorIndexes) this.userColorIndexes = {};
            this.userColorIndexes[userToken] = colorIndex;
        }
        return this.userSelectionColors[userToken];
    }

    cleanUserSelectionColors(data) {
        const userToken = data?.userToken;
        if (userToken && this.userSelectionColors[userToken]) {
            if (this.userColorIndexes && this.userColorIndexes[userToken] !== undefined) {
                this.freeColorIndexes.push(this.userColorIndexes[userToken]);
                delete this.userColorIndexes[userToken];
            }
            delete this.userSelectionColors[userToken];
        }
    }

    dispose() {
        if (!this.scene) return;
        this.scene.children = this.scene.children.filter(child => {
            if (child.userData && child.userData.isInfiniteGrid) {
                this.scene.remove(child);
                return false;
            }
            return true;
        });
    }
}

export default SelectHelper;

const COLORS = [
    "#e6194b",
    "#3cb44b",
    "#ffe119",
    "#4363d8",
    "#f58231",
    "#911eb4",
    "#46f0f0",
    "#f032e6",
    "#bcf60c",
    "#fabebe",
    "#008080",
    "#e6beff",
    "#9a6324",
    "#fffac8",
    "#800000",
    "#aaffc3",
    "#808000",
    "#ffd8b1",
    "#000075",
    "#808080",
    "#ffffff",
    "#000000",
    "#a9a9a9",
    "#ff4500",
    "#2e8b57",
    "#1e90ff",
    "#ff69b4",
    "#8a2be2",
    "#00ced1",
    "#deb887",
    "#b22222",
    "#7fff00",
    "#d2691e",
    "#6495ed",
    "#ffb6c1",
    "#20b2aa",
    "#ff6347",
    "#4682b4",
    "#daa520",
    "#adff2f",
    "#ff00ff",
    "#00ff00",
    "#ff1493",
    "#00bfff",
    "#ff8c00",
    "#bdb76b",
    "#c71585",
    "#7cfc00",
    "#dc143c",
    "#00fa9a",
];
