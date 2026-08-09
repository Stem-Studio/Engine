import { Object3D } from 'three';

import { ApplicationMode } from '../../EngineRuntime';
import global from '../../global';
import BaseHelper from '../BaseHelper';
import HelperUtils from '../HelperUtils';

interface Helper extends Object3D {
  update(): void;
  dispose(): void;
}

export abstract class BaseLightHelpers<HelperT extends Helper> extends BaseHelper {
    private helperMap = new Map<string, HelperT>();

    constructor() {
        super();
    }

    /**
     * Subclasses should override this method and return a helper for the given
     * object.
     * 
     * @param object - The object to create a helper for
     * @returns A helper for the given object
     */
    protected abstract createHelper(object: Object3D): HelperT;

    /**
     * Subclasses should override this method and return true if the object
     * should have a helper; false otherwise.
     * 
     * @param object - The object to check
     * @returns True if the object should have a helper, false otherwise.
     */
    protected abstract shouldHaveHelper(object: Object3D): boolean;

    start() {
        global.app?.on(`objectAdded.${this.id}`, this.onObjectAdded.bind(this));
        global.app?.on(`objectRemoved.${this.id}`, this.onObjectRemoved.bind(this));
        global.app?.on(`collabObjectRemoved.${this.id}`, this.onObjectRemoved.bind(this));
        global.app?.on(`objectChanged.${this.id}`, this.onObjectChanged.bind(this));
        global.app?.on(`objectUpdated.${this.id}`, this.onObjectUpdated.bind(this));
        global.app?.on(`appModeEntered.${this.id}`, this.onAppModeEntered.bind(this));
    }

    stop() {
        global.app?.on(`objectAdded.${this.id}`, null);
        global.app?.on(`objectRemoved.${this.id}`, null);
        global.app?.on(`collabObjectRemoved.${this.id}`, null);
        global.app?.on(`objectChanged.${this.id}`, null);
        global.app?.on(`objectUpdated.${this.id}`, null);
        global.app?.on(`appModeEntered.${this.id}`, null);
        this.clearHelpers();
    }

    onObjectAdded(object: Object3D) {
        if (!object?.uuid || !this.shouldHaveHelper(object) || this.isInRuntimeOnlySubtree(object)) {
            return;
        }

        this.removeHelper(object.uuid);

        const helper = this.createHelper(object);
        this.helperMap.set(object.uuid, helper);

        if (!Object.prototype.hasOwnProperty.call(helper, 'updateMatrixWorld') && helper.update) {
            const originalUpdateMatrixWorld = helper.updateMatrixWorld.bind(helper);
            helper.updateMatrixWorld = function updateMatrixWorld(force) {
                helper.update();

                originalUpdateMatrixWorld(force);
            };
        }

        helper.visible = Boolean(global.app?.mode === ApplicationMode.EDIT);
        if (helper.visible) {
            global.app?.editor?.addSelectionHelper(helper);
        }
    }

    onObjectRemoved(object: Object3D) {
        if (!object?.uuid) {
            return;
        }

        this.removeHelper(object.uuid);
    }

    onObjectChanged(object: Object3D) {
        if (!object?.uuid) {
            return;
        }

        if (!this.shouldHaveHelper(object)) {
            this.removeHelper(object.uuid);
            return;
        }

        const helper = this.helperMap.get(object.uuid);
        if (!helper) {
            this.onObjectAdded(object);
            return;
        }

        helper.update();
    }

    onObjectUpdated(object: Object3D) {
        if (!object?.uuid) {
            return;
        }

        if (!this.shouldHaveHelper(object)) {
            this.removeHelper(object.uuid);
            return;
        }

        this.onObjectAdded(object);
    }

    onAppModeEntered(mode: ApplicationMode) {
        const isVisible = Boolean(mode === ApplicationMode.EDIT);

        this.helperMap.forEach(helper => {
            HelperUtils.updateEditorHelpers(helper, isVisible);
            helper.visible = isVisible;
        });
    }

    private isInRuntimeOnlySubtree(object: Object3D): boolean {
        let current: Object3D | null = object;
        while (current) {
            if (current.userData?.isRuntimeOnly === true) {
                return true;
            }
            current = current.parent;
        }
        return false;
    }

    private removeHelper(uuid: string) {
        const helper = this.helperMap.get(uuid);
        if (!helper) {
            return;
        }

        global.app?.editor?.removeSelectionHelper(helper);
        helper.dispose();
        this.helperMap.delete(uuid);
    }

    private clearHelpers() {
        for (const uuid of [...this.helperMap.keys()]) {
            this.removeHelper(uuid);
        }
    }
}
