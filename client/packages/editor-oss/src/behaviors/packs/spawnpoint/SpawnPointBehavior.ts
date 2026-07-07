import {Object3D, BoxGeometry, MeshBasicMaterial, Mesh, Vector3, Quaternion} from "three";

import SpawnPointMarker from "./SpawnPointMarker";
import Editor from "@stem/editor-oss/editor/Editor";
import { BehaviorBase } from "../../Behavior";
import GameManager from "../../game/GameManager";

type SpawnPointMetadata = {
    slot: number;
    type: "normal" | "team";
};

class SpawnPointBehavior extends BehaviorBase {

    private editorSelectObject?: Mesh;
    private editorPreviewObject?: Object3D;
    private editor?: Editor;
    private lastPreviewPosition = new Vector3();
    private lastPreviewQuaternion = new Quaternion();
    private hasSyncedEditorPreview = false;

    init(game: GameManager) {
        this.game = game;
    }

    update() {}

    onAdded(): void {
        this.updateSpawnPointMetadata();
    }

    onRemoved(): void {
        this.clearSpawnPointMetadata();
    }

    onReset() {}

    onEditorAdded(editor: Editor): void {
        this.updateSpawnPointMetadata();

        const target = this.target;
        this.editor = editor;

        this.editorPreviewObject = new SpawnPointMarker(target.position.clone(), target.rotation.clone());
        
        const geometry = new BoxGeometry(1, 1, 1);
        const material = new MeshBasicMaterial({ transparent: true, opacity: 0.0, depthWrite: false });
        this.editorSelectObject = new Mesh(geometry, material);

        target.add(this.editorSelectObject);
        editor.sceneHelpers.add(this.editorPreviewObject);
        this.syncEditorPreview(true);
    }

    onEditorRemoved(): void {
        this.clearSpawnPointMetadata();
        this.cleanupEditorObjects();
    }

    onEditorUpdate(): void {
        this.syncEditorPreview();
    }

    onEditorAttributesUpdated(): void {
        this.updateSpawnPointMetadata();
    }

    onEditorDispose(): void {
        this.cleanupEditorObjects();
    }

    private updateSpawnPointMetadata(): void {
        this.target.userData.isSpawnPoint = true;
        this.target.userData.spawnPoint = {
            slot: Number(this.attributes.slot ?? 0),
            type: this.attributes.spawnType === "team" ? "team" : "normal",
        } satisfies SpawnPointMetadata;
    }

    private clearSpawnPointMetadata(): void {
        delete this.target.userData.isSpawnPoint;
        delete this.target.userData.spawnPoint;
    }

    private syncEditorPreview(force = false): void {
        if (!this.editorPreviewObject) {
            return;
        }

        if (
            !force &&
            this.hasSyncedEditorPreview &&
            this.lastPreviewPosition.equals(this.target.position) &&
            this.lastPreviewQuaternion.equals(this.target.quaternion)
        ) {
            return;
        }

        this.editorPreviewObject.position.copy(this.target.position);
        this.editorPreviewObject.quaternion.copy(this.target.quaternion);
        this.lastPreviewPosition.copy(this.target.position);
        this.lastPreviewQuaternion.copy(this.target.quaternion);
        this.hasSyncedEditorPreview = true;
    }

    private cleanupEditorObjects(): void {
        if (this.editorSelectObject) {
            this.target.remove(this.editorSelectObject);
            this.editorSelectObject.geometry.dispose();
            this.editorSelectObject = undefined;
        }

        if (this.editorPreviewObject) {
            this.editor!.sceneHelpers.remove(this.editorPreviewObject);
            this.editorPreviewObject = undefined;
        }
        this.hasSyncedEditorPreview = false;
    }

}

export default SpawnPointBehavior;
