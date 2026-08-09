import {Object3D} from "three";
import BaseHelper from "./BaseHelper";
import EventBus from "../behaviors/event/EventBus";
import ObjectOutliner from "../editor/effects/ObjectOutliner";
import global from "../global";
import {isGaussianSplatObject} from "../model/gaussianSplats";
import {
    containsPlanCadSelectionMetadata,
    hasPlanCadSelectionMetadata,
} from "../utils/PlanCadSelectionMetadata";

/**
 * OutlinerHelper - Manages object outlining for both hovered and selected objects
 *
 * This helper listens to "objectOutlined" and "objectUnoutlined" events and manages
 * the visual outline effect. Objects can be outlined when they are hovered over or selected.
 * Selected objects should always have an outline regardless of hover state.
 */
class OutlinerHelper extends BaseHelper {
    private outlinedObjects: Set<Object3D>;
    private selectedObjects: Set<Object3D>;
    private hoveredObject: Object3D | null;
    private objectOutliner: ObjectOutliner | null;
    private app: any;
    private eventBusSubscriptionTokens: string[];

    constructor() {
        super();
        this.outlinedObjects = new Set();
        this.selectedObjects = new Set();
        this.hoveredObject = null;
        this.objectOutliner = null;
        this.app = global.app;
        this.eventBusSubscriptionTokens = [];

        // Bind methods
        this.onObjectOutlined = this.onObjectOutlined.bind(this);
        this.onObjectUnoutlined = this.onObjectUnoutlined.bind(this);
        this.onObjectSelected = this.onObjectSelected.bind(this);
        this.onObjectArraySelected = this.onObjectArraySelected.bind(this);
        this.onObjectRemoved = this.onObjectRemoved.bind(this);
        this.onSceneLoaded = this.onSceneLoaded.bind(this);
    }

    start() {
        this.unsubscribeEventBusSubscriptions();

        // Listen to outline events
        this.app.on(`objectOutlined.${this.id}`, this.onObjectOutlined);
        this.app.on(`objectUnoutlined.${this.id}`, this.onObjectUnoutlined);
        this.eventBusSubscriptionTokens = [
            EventBus.instance.subscribe(`objectOutlined`, (_, data: Object3D) => {
                this.onObjectOutlined(data);
            }),
            EventBus.instance.subscribe(`objectUnoutlined`, (_, data: Object3D) => {
                this.onObjectUnoutlined(data);
            }),
        ];

        // Listen to selection events to maintain outline on selected objects
        this.app.on(`objectSelected.${this.id}`, this.onObjectSelected);
        this.app.on(`objectArraySelected.${this.id}`, this.onObjectArraySelected);

        // Listen to object removal to clean up references
        this.app.on(`objectRemoved.${this.id}`, this.onObjectRemoved);
        // Listen to scene load to initialize the outliner
        this.app.on(`sceneLoaded.${this.id}`, this.onSceneLoaded);
    }

    stop() {
        this.app.on(`objectOutlined.${this.id}`, null);
        this.app.on(`objectUnoutlined.${this.id}`, null);
        this.unsubscribeEventBusSubscriptions();
        this.app.on(`objectSelected.${this.id}`, null);
        this.app.on(`objectArraySelected.${this.id}`, null);
        this.app.on(`objectRemoved.${this.id}`, null);
        this.app.on(`sceneLoaded.${this.id}`, null);

        // Clear all outlined objects
        this.clearAllOutlines();
        this.objectOutliner?.dispose();
        if (this.app.objectOutliner === this.objectOutliner) {
            this.app.objectOutliner = null;
        }
        this.objectOutliner = null;
    }

    onSceneLoaded() {
        this.objectOutliner?.dispose();
        this.objectOutliner = new ObjectOutliner(this.app.scene, this.app.camera, this.app.renderer);
        this.app.objectOutliner = this.objectOutliner;
    }

    onObjectOutlined(object: Object3D) {
        if (!object) return;
        if (this.shouldSkipOutline(object)) return;

        // Add to outlined objects (this could be from hover)
        this.outlinedObjects.add(object);

        // If it's not a selected object, it must be hovered
        if (!this.selectedObjects.has(object)) {
            this.hoveredObject = object;
        }

        this.updateOutline();
    }

    onObjectUnoutlined(object: Object3D) {
        if (!object) return;

        // Remove from outlined objects only if it's not selected
        if (!this.selectedObjects.has(object)) {
            this.outlinedObjects.delete(object);

            // Clear hovered object if it matches
            if (this.hoveredObject === object) {
                this.hoveredObject = null;
            }
        }

        this.updateOutline();
    }

    onObjectOutlinedById(objectId: string) {
        const object = this.app.scene.getObjectById(objectId);
        if (object) {
            this.onObjectOutlined(object);
        }
    }

    onObjectUnoutlinedById(objectId: string) {
        const object = this.app.scene.getObjectById(objectId);
        if (object) {
            this.onObjectUnoutlined(object);
        }
    }

    onObjectSelected(object: Object3D | null) {
        // Clear previous selected objects
        this.selectedObjects.clear();
        this.outlinedObjects.clear();

        if (object && !this.shouldSkipOutline(object)) {
            // Add to both selected and outlined objects
            this.selectedObjects.add(object);
            this.outlinedObjects.add(object);
        }

        this.updateOutline();
    }

    onObjectArraySelected(objects: Object3D[] | null) {
        // Clear previous selected objects
        this.selectedObjects.clear();
        this.outlinedObjects.clear();

        if (objects && objects.length > 0) {
            objects.forEach(object => {
                if (object && !this.shouldSkipOutline(object)) {
                    // Add to both selected and outlined objects
                    this.selectedObjects.add(object);
                    this.outlinedObjects.add(object);
                }
            });
        }

        this.updateOutline();
    }

    onObjectRemoved(object: Object3D) {
        // Clean up references to removed object
        this.outlinedObjects.delete(object);
        this.selectedObjects.delete(object);

        if (this.hoveredObject === object) {
            this.hoveredObject = null;
        }

        this.updateOutline();
    }

    private updateOutline() {
        const objectsToOutline = Array.from(this.outlinedObjects);
        this.app.call("outlineObjects", this, objectsToOutline);
    }

    private clearAllOutlines() {
        this.outlinedObjects.clear();
        this.selectedObjects.clear();
        this.hoveredObject = null;
        this.app.call("outlineObjects", this, []);
    }

    private unsubscribeEventBusSubscriptions() {
        this.eventBusSubscriptionTokens.forEach(token => EventBus.instance.unsubscribe(token));
        this.eventBusSubscriptionTokens = [];
    }

    private shouldSkipOutline(object: Object3D): boolean {
        return (
            isGaussianSplatObject(object) ||
            hasPlanCadSelectionMetadata(object) ||
            containsPlanCadSelectionMetadata(object)
        );
    }

    // Public methods for external use
    public getOutlinedObjects(): Object3D[] {
        return Array.from(this.outlinedObjects);
    }

    public getSelectedObjects(): Object3D[] {
        return Array.from(this.selectedObjects);
    }

    public getHoveredObject(): Object3D | null {
        return this.hoveredObject;
    }

    public isObjectOutlined(object: Object3D): boolean {
        return this.outlinedObjects.has(object);
    }

    public isObjectSelected(object: Object3D): boolean {
        return this.selectedObjects.has(object);
    }
}

export default OutlinerHelper;
