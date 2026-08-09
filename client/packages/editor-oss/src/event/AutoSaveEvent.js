
/**
 * Module: AutoSaveEvent.js
 * Purpose: Contains logic for auto save event.
 */


import BaseEvent from "./BaseEvent";
import {saveScene} from "@web-shared/api/scene";
import global from "../global";
import Converter from "../serialization/Converter";

class AutoSaveEvent extends BaseEvent {
    constructor() {
        super();

        this.autoSave = true;
        this.autoSaveTime = 10000;
        this.saveProcess = null;
        this.queryLoad = false;

        this.handleSave = this.handleSave.bind(this);
        this.handleLoad = this.handleLoad.bind(this);

        this.handleStorageChange = this.handleStorageChange.bind(this);
    }

    start() {
        this.autoSave = global.app.storage.autoSave;
        global.app.on(`storageChanged.${this.id}`, this.handleStorageChange);
        global.app.on(`queryLoadAutoSceneScene.${this.id}`, this.handleLoad);

        if (this.autoSave) {
            this.saveProcess = setTimeout(this.handleSave, this.autoSaveTime);
        }
    }

    stop() {
        global.app.on(`storageChanged.${this.id}`, null);
        global.app.on(`queryLoadAutoSceneScene.${this.id}`, null);
    }

    reset() {}

    handleSave() {
        if (this.saveProcess) {
            clearTimeout(this.saveProcess);
        }

        if (global.app.editor && global.app.editor.sceneID === null) return;

        if (this.queryLoad) {
            if (this.autoSave) {
                this.saveProcess = setTimeout(this.handleSave, this.autoSaveTime);
            }
            return;
        }

        const app = global.app;
        const obj = new Converter().toJSON({
            options: global.app.options,
            camera: app.camera,
            scripts: app.scripts,
            scene: app.scene,
        });

        // Single authoritative path: the active ProjectStore (in playground/local
        // that is the File System folder). The scene is large and scene-scoped,
        // so it must NOT also be mirrored into localStorage (5MB cap) — that was
        // pure redundancy that blew the quota. Recovery already lives in the
        // saved project itself.
        if (this.autoSave) {
            this.commitSaveScene(obj);
            this.saveProcess = setTimeout(this.handleSave, this.autoSaveTime);
        }
    }

    handleLoad() {
        // The localStorage autosave cache has been removed — the ProjectStore is
        // authoritative. Purge any legacy keys a previous build left behind so
        // they stop consuming the localStorage budget. No recovery prompt.
        try {
            window.localStorage.removeItem("autoSaveData");
            window.localStorage.removeItem("autoSaveTime");
            window.localStorage.removeItem("autoSaveSceneID");
            window.localStorage.removeItem("autoSaveSceneName");
            window.localStorage.removeItem("autoSaveSceneLockedItems");
        } catch { /* localStorage unavailable — nothing to purge */ }
    }

    handleStorageChange(name, value) {
        if (name !== "autoSave") {
            return;
        }
        this.autoSave = value;

        if (this.autoSave) {
            if (this.saveProcess) {
                clearTimeout(this.saveProcess);
            }
            this.saveProcess = setTimeout(this.handleSave, this.autoSaveTime);
        }
    }

    commitSaveScene(_experience) {
        const app = global.app;
        const editor = app.editor;

        if (editor.sceneName) {
            saveScene();
        }
    }
}

export default AutoSaveEvent;
