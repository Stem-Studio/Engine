import * as THREE from "three";

import { TransformControls } from "../assets/js/controls/TransformControls";
import global from "../global";
import BoundingBoxUtil from "../utils/BoundingBoxUtil";
import { GeometricSnapHelper } from "../utils/GeometricSnapHelper";
import { TransformUtils } from "../utils/TransformUtils";
import { MultiCmdsCommand } from "./../command/MultiCmdsCommand";
import { SetPositionCommand } from "./../command/SetPositionCommand";
import { SetRotationCommand } from "./../command/SetRotationCommand";
import { SetScaleCommand } from "./../command/SetScaleCommand";
import BaseEvent from "./BaseEvent";
import { isInputActive } from "../editor/assets/v2/utils/isInputActive";

const TRANSFORM_MODES = {
  ALL: "all",
  TRANSLATE: "translate",
  ROTATE: "rotate",
  SCALE: "scale",
};

const TRANSFORM_STATES = {
  IDLE: "idle",
  DISABLED: "disabled",
  TRANSFORMING: "transforming",
};

class TransformControlsEvent extends BaseEvent {
  constructor() {
    super();
    this.state = TRANSFORM_STATES.DISABLED;
    this.mode = TRANSFORM_MODES.ALL;

    this.activeTransforms = [];
    this.selectedObjects = null;

    this.transformHelperInitialState = null;
    this.transformHelper = null; // helper object for all transformations (single or multiple)

    this.isCmdOrControlClicked = false;
    this.app = global.app;
  }

  start() {
    this.app.on(`editorStarted.${this.id}`, this.onEditorStarted.bind(this));
  }

  stop() {
    if (this.state !== TRANSFORM_STATES.DISABLED) {
      this.disableTransformation();
    }

    this.unlistenAppEvents();
    this.unlistenTransformControlsEvents();
    this.unlistenKeyboardEvents();

    // Cleanup geometric snap helper if exists
    if (this.geometricSnapHelper) {
      this.geometricSnapHelper.dispose();
      this.geometricSnapHelper = null;
    }

    this.app.on(`appStarted.${this.id}`, null);
  }

  reset() {
    if (this.state !== TRANSFORM_STATES.DISABLED) {
      this.disableTransformation();
    }
  }

  onEditorStarted() {
    this.transformControls = new TransformControls(
      this.app.camera,
      this.app.viewport,
    );
    // this.transformControls.setMode("all");
    this.transformControls.setSpace("world");
    this.app.transformControls = this.transformControls;

    // TODO: clean up, this looks weird
    let controlHelper = this.transformControls;
    if (this.transformControls.getHelper) {
      controlHelper = this.transformControls.getHelper();
    }

    // recursively add tag "gizmo" to all children to disable ability to select them
    controlHelper.traverse((n) => {
      n.tag = "gizmo";
    });
    this.app.sceneHelpers.add(controlHelper);

    this.listenTransformControlEvents();
    this.listenAppEvents();
    this.listenKeyboardEvents();

    // Re-apply snapping settings if they exist from previous session
    const snappingSettings = this.app?.editor?.scene?.userData?.snapping;
    if (snappingSettings) {
      this.onSnappingSettingsChanged(snappingSettings);
    }

    const angleUnitsSettings = this.app?.editor?.scene?.userData?.angleUnits;
    if (angleUnitsSettings) {
      this.onAngleUnitsSettingsChanged(angleUnitsSettings);
    }
  }

  listenTransformControlEvents() {
    // Store bound methods for proper cleanup
    this.boundOnMouseDown = this.onMouseDown.bind(this);
    this.boundOnMouseUp = this.onMouseUp.bind(this);
    this.boundOnTransformChange = this.onTransformChange.bind(this);

    this.transformControls.addEventListener("mouseDown", this.boundOnMouseDown);
    this.transformControls.addEventListener("mouseUp", this.boundOnMouseUp);
    this.transformControls.addEventListener(
      "objectChange",
      this.boundOnTransformChange,
    );
  }

  unlistenTransformControlsEvents() {
    if (this.transformControls && this.boundOnMouseDown) {
      this.transformControls.removeEventListener(
        "mouseDown",
        this.boundOnMouseDown,
      );
      this.transformControls.removeEventListener(
        "mouseUp",
        this.boundOnMouseUp,
      );
      this.transformControls.removeEventListener(
        "objectChange",
        this.boundOnTransformChange,
      );
    }
  }

  listenAppEvents() {
    this.app.on(`objectSelected.${this.id}`, this.onObjectSelected.bind(this));
    this.app.on(
      `objectArraySelected.${this.id}`,
      this.onObjectArraySelected.bind(this),
    );
    this.app.on(`objectLocked.${this.id}`, this.onObjectLocked.bind(this));
    this.app.on(`objectChanged.${this.id}`, this.onObjectChanged.bind(this));
    this.app.on(`objectUpdated.${this.id}`, this.onObjectUpdated.bind(this));
    this.app.on(`cadModeChanged.${this.id}`, this.onCADModeChanged.bind(this));
    this.app.on(`undo.${this.id}`, this.onUndo.bind(this));
    this.app.on(`redo.${this.id}`, this.onRedo.bind(this));
    this.app.on(`changeMode.${this.id}`, this.onChangeMode.bind(this));
    this.app.on(`snapChanged.${this.id}`, this.onSnapChanged.bind(this));
    this.app.on(
      `snappingSettingsChanged.${this.id}`,
      this.onSnappingSettingsChanged.bind(this),
    );
    this.app.on(
      `angleUnitsSettingsChanged.${this.id}`,
      this.onAngleUnitsSettingsChanged.bind(this),
    );
    this.app.on(`spaceChanged.${this.id}`, this.onSpaceChanged.bind(this));
  }

  unlistenAppEvents() {
    this.app.on(`objectSelected.${this.id}`, null);
    this.app.on(`objectArraySelected.${this.id}`, null);
    this.app.on(`objectLocked.${this.id}`, null);
    this.app.on(`objectChanged.${this.id}`, null);
    this.app.on(`objectUpdated.${this.id}`, null);
    this.app.on(`cadModeChanged.${this.id}`, null);
    this.app.on(`undo.${this.id}`, null);
    this.app.on(`redo.${this.id}`, null);
    this.app.on(`changeMode.${this.id}`, null);
    this.app.on(`snapChanged.${this.id}`, null);
    this.app.on(`snappingSettingsChanged.${this.id}`, null);
    this.app.on(`angleUnitsSettingsChanged.${this.id}`, null);
    this.app.on(`spaceChanged.${this.id}`, null);
  }

  listenKeyboardEvents() {
    this.boundOnKeyDown = this.onKeyDown.bind(this);
    this.boundOnKeyUp = this.onKeyUp.bind(this);

    document.addEventListener("keydown", this.boundOnKeyDown);
    document.addEventListener("keyup", this.boundOnKeyUp);
  }

  unlistenKeyboardEvents() {
    if (this.boundOnKeyDown) {
      document.removeEventListener("keydown", this.boundOnKeyDown);
      document.removeEventListener("keyup", this.boundOnKeyUp);
    }
  }

  onKeyDown(e) {
    this.isCmdOrControlClicked = !!(e.ctrlKey || e.metaKey);
    if (e.key === "Tab") {
      if (!isInputActive()) {
        e.preventDefault();
        this.cycleTransformMode();
      }
    }
  }

  onKeyUp() {
    this.isCmdOrControlClicked = false;
  }

  onMouseDown() {
    if (this.state !== TRANSFORM_STATES.IDLE) {
      return;
    }

    void this.beginTransformation();
  }

  onMouseUp() {
    if (this.state !== TRANSFORM_STATES.TRANSFORMING) {
      return;
    }

    this.endTransformation();
  }

  onObjectArraySelected(objects) {
    this.objectsSelected(objects);
  }

  onObjectSelected(object) {
    this.objectsSelected(object ? [object] : null);
  }

  objectsSelected(objects) {
    if (this.state !== TRANSFORM_STATES.DISABLED) {
      this.disableTransformation();
    }

    objects = this.removeLockedObjects(objects);

    if (!this.canEnableTransformation(objects)) {
      return;
    }

    this.enableTransformation(objects);
  }

  onObjectChanged(object) {
    if (
      this.state !== TRANSFORM_STATES.IDLE ||
      !this.selectedObjects?.includes(object)
    ) {
      return;
    }

    const center = BoundingBoxUtil.calculateObjectsCenter(this.selectedObjects);
    this.transformHelper.position.copy(center);

    // Invalidate vertex cache for this object (geometric snapping)
    if (this.geometricSnapHelper && object) {
      this.geometricSnapHelper.invalidateObject(object);
    }
  }

  onObjectUpdated(object) {
    if (!object || !this.selectedObjects) {
      return;
    }
    const found = this.selectedObjects.find((obj) => obj.uuid === object.uuid);

    if (found) {
      const filteredObjects = this.selectedObjects.filter(
        (obj) => obj.uuid !== object.uuid,
      );
      this.selectedObjects = [...filteredObjects, object];
      if (!this.app.isPlaying) {
        this.updateGizmoPosition();
      }
    }
  }

  onCADModeChanged(state) {
    if (state?.enabled) {
      if (this.state !== TRANSFORM_STATES.DISABLED) {
        this.disableTransformation();
      }
      return;
    }

    const selected = this.app?.editor?.selected;
    if (Array.isArray(selected)) {
      this.objectsSelected(selected);
    } else {
      this.objectsSelected(selected ? [selected] : null);
    }
  }

  onTransformChange() {
    if (this.state !== TRANSFORM_STATES.TRANSFORMING) {
      return;
    }

    // Check for geometric snapping (vertex/edge/face)
    if (
      this.geometricSnapHelper &&
      this.snappingSettings?.geometric?.enabled &&
      this.mode === TRANSFORM_MODES.TRANSLATE
    ) {
      const snapResult = this.geometricSnapHelper.findSnapTarget(
        this.transformHelper.position,
        this.selectedObjects,
      );

      if (snapResult) {
        // Apply geometric snap
        this.transformHelper.position.copy(snapResult.position);

        // If priority is geometric-only, skip grid snap
        if (this.snappingSettings.priority === "geometric") {
          this.updateTransforms();
          return;
        }
      }
    }

    this.updateTransforms();
  }

  onObjectLocked(object) {
    if (
      this.state === TRANSFORM_STATES.DISABLED ||
      !this.selectedObjects?.includes(object)
    ) {
      return;
    }

    // If the locked object is currently selected, disable transformation for now
    // TODO: handle locked objects in a better way
    this.disableTransformation();
  }

  onUndo() {
    if (this.state === TRANSFORM_STATES.DISABLED) {
      return;
    }

    this.updateGizmoPosition();
  }

  onRedo() {
    if (this.state === TRANSFORM_STATES.DISABLED) {
      return;
    }
    this.updateGizmoPosition();
  }

  onChangeMode(mode) {
    this.mode = mode;

    if (!this.transformControls) {
      return;
    }

    if (this.mode === TRANSFORM_MODES.ALL && this.selectedObjects?.length > 1) {
      this.transformControls.showScale = false;
    } else {
      this.transformControls.showScale = true;
    }

    if (this.isValidTransformMode(mode)) {
      this.transformControls?.setMode(mode);
    } else {
      this.transformControls?.detach();
    }
  }

  onSnapChanged(dist) {
    this.transformControls?.setTranslationSnap(dist);
  }

  onAngleUnitsSettingsChanged(settings) {
    if (!this.transformControls || !settings) {
      return;
    }

    this.transformControls.setRotationDisplayUnit(
      settings.currentUnit || "degrees",
    );
  }

  /**
   * Set world or local coordinate system
   * @param {*} space Parameter
   */
  onSpaceChanged(space) {
    if (!this.transformControls) {
      return;
    }

    if (this.selectedObjects && this.selectedObjects.length > 1) {
      space = "world";
    }

    this.transformControls.setSpace(space);
  }

  /**
   * Handle snapping settings change
   * @param {*} settings Snapping settings object
   *
   * Note: Event system passes data parameters only (sender is filtered out)
   */
  onSnappingSettingsChanged(settings) {
    if (!this.transformControls) {
      console.warn(
        "[TransformControls] No TransformControls instance when trying to apply snapping settings",
      );
      return;
    }

    // Safety check: ensure settings is defined
    if (!settings) {
      console.warn("[TransformControls] Settings is undefined:", settings);
      return;
    }

    // Store settings for later use
    this.snappingSettings = settings;

    // Update TransformControls snap properties
    // Grid snapping
    const translationSnap = settings.grid.enabled
      ? settings.grid.increment
      : null;
    this.transformControls.setTranslationSnap(translationSnap);
    console.log(
      "[TransformControls] Grid snapping:",
      settings.grid.enabled ? `${settings.grid.increment} units` : "disabled",
    );
    console.log(
      "[TransformControls] Verified translationSnap value:",
      this.transformControls.translationSnap,
    );

    // Rotation snapping (convert degrees to radians)
    const rotationSnap = settings.rotation.enabled
      ? (settings.rotation.angleDegrees * Math.PI) / 180
      : null;
    this.transformControls.setRotationSnap(rotationSnap);
    console.log(
      "[TransformControls] Rotation snapping:",
      settings.rotation.enabled
        ? `${settings.rotation.angleDegrees}°`
        : "disabled",
    );

    // Scale snapping
    const scaleSnap = settings.scale.enabled ? settings.scale.increment : null;
    this.transformControls.setScaleSnap(scaleSnap);
    console.log(
      "[TransformControls] Scale snapping:",
      settings.scale.enabled ? `${settings.scale.increment}` : "disabled",
    );

    // Geometric snapping — wired up 2026-04-22.
    // Vertex snapping is fully implemented in GeometricSnapHelper.
    // Edge and face snapping are scoped to a follow-up (see the helper's
    // commented-out Phase 5 blocks). Until those ship, edge/face toggles
    // in the SnappingSection UI are visible but no-op; vertex toggles
    // are the only ones that affect runtime behavior.
    if (settings.geometric.enabled && !this.geometricSnapHelper) {
      this.geometricSnapHelper = new GeometricSnapHelper(
        this.app.scene,
        this.app.sceneHelpers,
        settings.geometric,
      );
    } else if (!settings.geometric.enabled && this.geometricSnapHelper) {
      this.geometricSnapHelper.dispose();
      this.geometricSnapHelper = null;
    } else if (this.geometricSnapHelper) {
      this.geometricSnapHelper.updateSettings(settings.geometric);
    }
  }

  enableTransformation(selected) {
    this.state = TRANSFORM_STATES.IDLE;

    this.selectedObjects = selected;

    if (this.selectedObjects.length > 1) {
      this.transformControls.setSpace("world");
    }

    this.createTransformHelper(this.selectedObjects);
    this.transformControls.attach(this.transformHelper);
    this.transformControls.visible = true;

    if (this.mode === TRANSFORM_MODES.ALL && this.selectedObjects.length > 1) {
      this.transformControls.showScale = false;
    } else {
      this.transformControls.showScale = true;
    }

    this.selectedObjects.forEach((obj) => {
      if (this.app.game?.player === obj || !obj.userData?.isSelectable) {
        return; // Skip player and non-selectable objects
      }
      this.app.editor?.pauseObject(obj);
    });
  }

  disableTransformation() {
    if (this.state === TRANSFORM_STATES.TRANSFORMING) {
      this.endTransformation();
    }

    this.state = TRANSFORM_STATES.DISABLED;

    this.selectedObjects.forEach((obj) => {
      if (this.app.game?.player === obj) {
        return; // Skip player object
      }
      this.app.editor.retargetObjectBehaviors(obj.uuid, obj);
      this.app.editor?.resumeObject(obj);
    });

    this.transformControls.visible = false;
    this.transformControls?.detach();
    this.disposeTransformHelper();

    this.selectedObjects = null;
    this.clearTransforms();
  }

  async beginTransformation() {
    this.app.isCameraLocked = true;
    this.app.editor.controls?.disable();
    this.state = TRANSFORM_STATES.TRANSFORMING;
    if (window.event?.altKey && this.selectedObjects?.length > 0) {
      for (const obj of this.selectedObjects) {
        await this.app.editor.cloneObjectByUuid(
          obj.uuid,
          obj,
          undefined,
          undefined,
          true,
        );
      }
    }

    this.initializeTransforms(this.selectedObjects);
  }

  endTransformation() {
    this.app.isCameraLocked = false;
    this.state = TRANSFORM_STATES.IDLE;
    this.app.editor.controls?.enable();

    this.createTransformCommands();
    this.clearTransforms();
  }

  initializeTransforms(objects) {
    objects.forEach((obj) => {
      if (!obj) return;

      const worldTransform = TransformUtils.getWorldTransform(obj);

      this.activeTransforms.push({
        object: obj,
        initialTransform: TransformUtils.cloneTransform(worldTransform),
        // Keep local coordinates for command creation
        initialLocalPosition: obj.position.clone(),
        initialLocalQuaternion: obj.quaternion.clone(),
        initialLocalScale: obj.scale.clone(),
      });
    });

    this.transformHelperInitialState = TransformUtils.getWorldTransform(
      this.transformHelper,
    );
  }

  updateTransforms() {
    let mode = this.transformControls.getMode();
    if (mode === "all" && this.transformControls.subMode) {
      mode = this.transformControls.subMode;
    }

    if (mode === "scale" && this.transformControls.space === "world") {
      const worldScaleFeatures = this.transformHelper.scale;
      const initialHelperScale = this.transformHelperInitialState.scale;

      const wrx = worldScaleFeatures.x / initialHelperScale.x;
      const wry = worldScaleFeatures.y / initialHelperScale.y;
      const wrz = worldScaleFeatures.z / initialHelperScale.z;

      if (!this._worldScaleTempV1) {
        this._worldScaleTempV1 = new THREE.Vector3();
        this._worldScaleTempV2 = new THREE.Vector3();
        this._worldScaleTempV3 = new THREE.Vector3();
      }
      const _v1 = this._worldScaleTempV1;
      const _v2 = this._worldScaleTempV2;
      const _v3 = this._worldScaleTempV3;

      this.activeTransforms.forEach((transformData) => {
        const object = transformData.object;
        const startQuat = transformData.initialTransform.quaternion;
        const startScale = transformData.initialLocalScale;

        _v1.set(1, 0, 0).applyQuaternion(startQuat);
        _v2.set(0, 1, 0).applyQuaternion(startQuat);
        _v3.set(0, 0, 1).applyQuaternion(startQuat);

        const sx = Math.sqrt(
          Math.pow(_v1.x * wrx, 2) +
            Math.pow(_v1.y * wry, 2) +
            Math.pow(_v1.z * wrz, 2),
        );

        const sy = Math.sqrt(
          Math.pow(_v2.x * wrx, 2) +
            Math.pow(_v2.y * wry, 2) +
            Math.pow(_v2.z * wrz, 2),
        );

        const sz = Math.sqrt(
          Math.pow(_v3.x * wrx, 2) +
            Math.pow(_v3.y * wry, 2) +
            Math.pow(_v3.z * wrz, 2),
        );

        object.scale.copy(startScale);
        object.scale.x *= sx;
        object.scale.y *= sy;
        object.scale.z *= sz;

        object.updateMatrixWorld(true);
      });
      return;
    }

    const currentHelperTransform = TransformUtils.getWorldTransform(
      this.transformHelper,
    );

    const deltaMatrix = TransformUtils.calculateDeltaMatrix(
      this.transformHelperInitialState,
      currentHelperTransform,
    );

    const newWorldMatrix = new THREE.Matrix4();

    this.activeTransforms.forEach((transformData) => {
      const init = transformData.initialTransform;
      newWorldMatrix.compose(init.position, init.quaternion, init.scale);
      newWorldMatrix.premultiply(deltaMatrix);

      TransformUtils.setWorldTransform(transformData.object, newWorldMatrix);
      transformData.object.updateMatrixWorld(true);
    });
  }

  createTransformCommands() {
    if (!this.hasTransformsChanged()) {
      return;
    }

    const commands = [];
    const editor = this.app.editor;

    this.activeTransforms.forEach((transformData) => {
      const objectCommands = this.createCommandsForObject(transformData);
      commands.push(...objectCommands);
    });

    if (commands.length > 0) {
      const multiCommand = new MultiCmdsCommand(commands);
      void editor.execute(multiCommand);
    }
  }

  createCommandsForObject(transformData) {
    const commands = [];
    const object = transformData.object;

    if (!object.position.equals(transformData.initialLocalPosition)) {
      commands.push(
        new SetPositionCommand(
          object,
          object.position.clone(),
          transformData.initialLocalPosition,
        ),
      );
    }

    if (!object.quaternion.equals(transformData.initialLocalQuaternion)) {
      const currentRotation = TransformUtils.quaternionToEuler(
        object.quaternion,
      );
      const initialRotation = TransformUtils.quaternionToEuler(
        transformData.initialLocalQuaternion,
      );
      commands.push(
        new SetRotationCommand(object, currentRotation, initialRotation),
      );
    }

    if (!object.scale.equals(transformData.initialLocalScale)) {
      commands.push(
        new SetScaleCommand(
          object,
          object.scale.clone(),
          transformData.initialLocalScale,
        ),
      );
    }

    return commands;
  }

  hasTransformsChanged() {
    return this.activeTransforms.some((transformData) => {
      const obj = transformData.object;

      // Compare local transforms instead of world transforms for more reliable detection
      const positionChanged = !obj.position.equals(
        transformData.initialLocalPosition,
      );
      const rotationChanged = !obj.quaternion.equals(
        transformData.initialLocalQuaternion,
      );
      const scaleChanged = !obj.scale.equals(transformData.initialLocalScale);

      return positionChanged || rotationChanged || scaleChanged;
    });
  }

  clearTransforms() {
    this.activeTransforms = [];
    this.transformHelperInitialState = null;
  }

  cycleTransformMode() {
    const modes = [
      TRANSFORM_MODES.ALL,
      TRANSFORM_MODES.TRANSLATE,
      TRANSFORM_MODES.ROTATE,
      TRANSFORM_MODES.SCALE,
    ];
    const currentIndex = modes.indexOf(this.mode);
    const nextIndex = (currentIndex + 1) % modes.length;
    this.onChangeMode(modes[nextIndex]);
  }

  createTransformHelper(objects) {
    let center;
    if (objects.length === 1) {
      center = new THREE.Vector3();
      objects[0].getWorldPosition(center);
    } else {
      center = BoundingBoxUtil.calculateObjectsCenter(objects);
    }

    this.transformHelper = new THREE.Object3D();
    this.transformHelper.userData.controlledObjects = objects;
    this.transformHelper.position.copy(center);

    if (objects.length === 1 && this.transformControls.space === "local") {
      const tempQuat = new THREE.Quaternion();
      objects[0].getWorldQuaternion(tempQuat);
      this.transformHelper.quaternion.copy(tempQuat);
      this.transformHelper.scale.copy(objects[0].scale);
    }

    this.transformHelper.updateMatrixWorld = (force) => {
      if (this.state === TRANSFORM_STATES.IDLE && objects.length === 1) {
        const obj = objects[0];
        obj.getWorldPosition(this.transformHelper.position);

        if (this.transformControls.space === "local") {
          obj.getWorldQuaternion(this.transformHelper.quaternion);
          this.transformHelper.scale.copy(obj.scale);
        }
      }
      THREE.Object3D.prototype.updateMatrixWorld.call(
        this.transformHelper,
        force,
      );
    };

    this.transformHelper.name = "TransformHelper";
    this.transformHelper.tag = "gizmo";

    this.app.sceneHelpers.add(this.transformHelper);

    return this.transformHelper;
  }

  updateGizmoPosition() {
    const currentObjects = this.selectedObjects;
    this.disableTransformation();
    this.enableTransformation(currentObjects);
  }

  disposeTransformHelper() {
    this.app.sceneHelpers.remove(this.transformHelper);
    this.transformHelper = null;
  }

  canEnableTransformation(objects) {
    // Don't show gizmo when the scene root is selected
    if (objects?.length === 1 && objects[0] === this.app.editor.scene) {
      return false;
    }
    if (this.app?.editor?.cadMode) {
      return false;
    }
    return (
      objects &&
      objects.length > 0 &&
      !this.app.disableClickEvents &&
      this.isValidTransformMode(this.mode) &&
      this.transformControls
    );
  }

  removeLockedObjects(objects) {
    return objects?.filter((obj) => {
      // Skip locked objects
      if (this.app.editor.sceneLockedItems?.includes(obj?.uuid)) {
        return false;
      }
      if (obj?.userData?.isTransformLocked || obj?.userData?.isPlanCadManaged) {
        return false;
      }
      return true;
    });
  }

  isValidTransformMode(mode) {
    return Object.values(TRANSFORM_MODES).includes(mode);
  }
}

export default TransformControlsEvent;
