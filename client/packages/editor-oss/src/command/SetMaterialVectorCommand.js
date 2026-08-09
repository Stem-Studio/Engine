import {t} from "i18next";

import Command from "./Command";
import global from "../global";

class SetMaterialVectorCommand extends Command {
    /**
     *
     * @param {THREE.Object3D|null} [object=null]
     * @param {string} [attributeName='']
     * @param {THREE.Vector2|THREE.Vector3|THREE.Vector4|null} [newValue=null]
     * @param {number} [materialSlot=-1]
     * @constructor
     */
    constructor(object = null, attributeName = "", newValue = null, materialSlot = -1) {
        super();
        this.editor = global.app.editor;
        this.type = "SetMaterialVectorCommand";
        this.name = t("command/SetMaterialVector") + ": " + attributeName;
        this.updatable = true;

        this.object = object;
        this.materialSlot = materialSlot;

        const material = object !== null ? this.editor.getObjectMaterial(object, materialSlot) : null;

        this.oldValue = material !== null ? material[attributeName].toArray() : null;
        this.newValue = newValue;

        this.attributeName = attributeName;
    }

    execute() {
        const material = this.editor.getObjectMaterial(this.object, this.materialSlot);

        material[this.attributeName].fromArray(this.newValue);

        this.editor.signals.materialChanged.dispatch(this.object, this.materialSlot);

        return {
            message: `SetMaterialVectorCommand: Material vector changed (${this.object.name})`,
            status: "success",
        };
    }

    undo() {
        const material = this.editor.getObjectMaterial(this.object, this.materialSlot);

        material[this.attributeName].fromArray(this.oldValue);

        this.editor.signals.materialChanged.dispatch(this.object, this.materialSlot);

        return {
            message: `SetMaterialVectorCommand: Material vector reverted (${this.object.name})`,
            status: "success",
        };
    }

    update(cmd) {
        this.newValue = cmd.newValue;
    }

    toJSON() {
        const output = super.toJSON(this);

        output.objectUuid = this.object.uuid;
        output.attributeName = this.attributeName;
        output.oldValue = this.oldValue;
        output.newValue = this.newValue;
        output.materialSlot = this.materialSlot;

        return output;
    }

    fromJSON(json) {
        super.fromJSON(json);

        this.object = this.editor.objectByUuid(json.objectUuid);
        this.attributeName = json.attributeName;
        this.oldValue = json.oldValue;
        this.newValue = json.newValue;
        this.materialSlot = json.materialSlot;
    }
}

export {SetMaterialVectorCommand};
