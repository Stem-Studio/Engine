/**
 * Module: AddObjectCommand.js
 * Purpose: Contains logic for add object command.
 */

import {t} from "i18next";
import * as THREE from "three";

import Command from "./Command";
import global from "../global";

/**
 *
 * @author dforrer / https://github.com/dforrer
 * Developed as part of a project at University of Applied Sciences and Arts Northwestern Switzerland (www.fhnw.ch)
 *
 * @constructor
 */
class AddObjectCommand extends Command {
    constructor(object, parent, callback = null, noSelect = false, noFocus = false) {
        super();
        this.type = "AddObjectCommand";

        this.object = object;
        this.parent = parent;
        this.editor = global.app.editor;
        this.callback = callback;
        this.noSelect = noSelect;
        this.noFocus = noFocus;

        if (object !== undefined) {
            this.name = t("Add Object") + object.name;
        }
    }

    async execute() {
        await this.editor.addObject(this.object, this.parent);
        if (!this.noSelect) {
            this.editor.select?.(this.object, this.noFocus);
        }
        if (this.callback) {
            this.callback(this.object);
        }

        return {
            message: `AddObjectCommand: Object added (${this.object.name})`,
            status: "success",
        };
    }

    undo() {
        this.editor.removeObject(this.object);
        this.editor.deselect?.();

        return {
            message: `AddObjectCommand: Object removed (${this.object.name})`,
            status: "success",
        };
    }

    toJSON() {
        var output = Command.prototype.toJSON.call(this);
        output.object = this.object.toJSON();

        return output;
    }

    fromJSON(json) {
        Command.prototype.fromJSON.call(this, json);

        this.object = this.editor.objectByUuid(json.object.object.uuid);

        if (this.object === undefined) {
            var loader = new THREE.ObjectLoader();
            this.object = loader.parse(json.object);
        }
    }
}

export {AddObjectCommand};
