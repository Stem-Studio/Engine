import {t} from "i18next";

import Command from "./Command";
import global from "../global";

class SetMaterialRangeCommand extends Command {
    /**
     * @param {THREE.Object3D|null} [object=null]
     * @param {string} [attributeName='']
     * @param {number} [newMinValue=-Infinity]
     * @param {number} [newMaxValue=Infinity]
     * @param {number} [materialSlot=-1]
     * @constructor
     */
    constructor(object = null, attributeName = "", newMinValue = -Infinity, newMaxValue = Infinity, materialSlot = -1) {
        super();
        this.editor = global.app.editor;
        this.type = "SetMaterialRangeCommand";
        this.name = t("Set Material Range");
        this.updatable = true;

        this.object = object;
        this.materialSlot = materialSlot;

        const material = object !== null ? this.editor.getObjectMaterial(object, materialSlot) : null;

        this.oldRange =
            material !== null && material[attributeName] !== undefined ? [...material[attributeName]] : null;
        this.newRange = [newMinValue, newMaxValue];

        this.attributeName = attributeName;
    }

    execute() {
        const material = this.editor.getObjectMaterial(this.object, this.materialSlot);

        material[this.attributeName] = [...this.newRange];
        material.needsUpdate = true;

        this.editor.signals.objectChanged.dispatch(this.object);
        this.editor.signals.materialChanged.dispatch(this.object, this.materialSlot);

        return {
            message: `SetMaterialRangeCommand: Material range changed (${this.object.name})`,
            status: "success",
        };
    }

    undo() {
        const material = this.editor.getObjectMaterial(this.object, this.materialSlot);

        material[this.attributeName] = [...this.oldRange];
        material.needsUpdate = true;

        this.editor.signals.objectChanged.dispatch(this.object);
        this.editor.signals.materialChanged.dispatch(this.object, this.materialSlot);
        return {
            message: `SetMaterialRangeCommand: Material range reverted (${this.object.name})`,
            status: "success",
        };
    }

    update(cmd) {
        this.newRange = [...cmd.newRange];
    }

    toJSON() {
        const output = super.toJSON(this);

        output.objectUuid = this.object.uuid;
        output.attributeName = this.attributeName;
        output.oldRange = [...this.oldRange];
        output.newRange = [...this.newRange];
        output.materialSlot = this.materialSlot;

        return output;
    }

    fromJSON(json) {
        super.fromJSON(json);

        this.attributeName = json.attributeName;
        this.oldRange = [...json.oldRange];
        this.newRange = [...json.newRange];
        this.object = this.editor.objectByUuid(json.objectUuid);
        this.materialSlot = json.materialSlot;
    }
}

export {SetMaterialRangeCommand};
