/**
 * Module: History.js
 * Purpose: Contains logic for history.
 */

import Command from "./Command";
import global from "../global";

/**
 *
 * @author dforrer / https://github.com/dforrer
 * Developed as part of a project at University of Applied Sciences and Arts Northwestern Switzerland (www.fhnw.ch)
 *
 */
class History extends Command {
    constructor(editor) {
        super(editor);
        this.editor = editor;
        this.undos = [];
        this.redos = [];
        this.lastCmdTime = new Date();
        this.idCounter = 0;

        // Debounce variables
        this.saveTimeout = null;
        this.debounceDelay = 500; // Delay in milliseconds
    }

    async execute(cmd, optionalName) {
        var lastCmd = this.undos[this.undos.length - 1];
        var timeDifference = new Date().getTime() - this.lastCmdTime.getTime();

        var isUpdatableCmd =
            lastCmd &&
            lastCmd.updatable &&
            cmd.updatable &&
            lastCmd.object === cmd.object &&
            lastCmd.type === cmd.type &&
            lastCmd.script === cmd.script &&
            lastCmd.attributeName === cmd.attributeName;

        if (isUpdatableCmd && timeDifference < 500) {
            lastCmd.update(cmd);
            cmd = lastCmd;
        } else {
            // the command is not updatable and is added as a new part of the history

            this.undos.push(cmd);
            cmd.id = ++this.idCounter;
        }
        cmd.name = optionalName !== undefined ? optionalName : cmd.name;
        
        const result = await cmd.execute();

        cmd.inMemory = true;

        this.lastCmdTime = new Date();

        // clearing all the redo-commands

        this.redos = [];
        global.app.call("historyChanged", this, cmd);
        return result;
    }

    async undo() {
        var cmd = undefined;

        if (this.undos.length > 0) {
            cmd = this.undos.pop();

            if (cmd.inMemory === false) {
                cmd.fromJSON(cmd.json);
            }
        }

        if (cmd !== undefined) {
            await cmd.undo();
            this.redos.push(cmd);
            global.app.call("historyChanged", this, cmd);
        }

        return cmd;
    }

    async redo() {
        var cmd = undefined;
        let res = null;
        if (this.redos.length > 0) {
            cmd = this.redos.pop();

            if (cmd.inMemory === false) {
                cmd.fromJSON(cmd.json);
            }
        }

        if (cmd !== undefined) {
            res = await cmd.execute();
            this.undos.push(cmd);
            global.app.call("historyChanged", this, cmd);
        }

        return res;
    }

    toJSON() {
        var history = {};
        history.undos = [];
        history.redos = [];

        var i;

        // Append Undos to History
        for (i = 0; i < this.undos.length; i++) {
            if (Object.prototype.hasOwnProperty.call(this.undos[i], "json")) {
                history.undos.push(this.undos[i].json);
            }
        }

        // Append Redos to History
        for (i = 0; i < this.redos.length; i++) {
            if (Object.prototype.hasOwnProperty.call(this.redos[i], "json")) {
                history.redos.push(this.redos[i].json);
            }
        }

        return history;
    }

    fromJSON(json) {
        if (json === undefined) return;

        var i = 0,
            cmdJSON,
            cmd;

        for (i = 0; i < json.undos.length; i++) {
            cmdJSON = json.undos[i];
            cmd = new window[cmdJSON.type](); // creates a new object of type "json.type"
            cmd.json = cmdJSON;
            cmd.id = cmdJSON.id;
            cmd.name = cmdJSON.name;
            this.undos.push(cmd);
            this.idCounter = cmdJSON.id > this.idCounter ? cmdJSON.id : this.idCounter; // set last used idCounter
        }

        for (i = 0; i < json.redos.length; i++) {
            cmdJSON = json.redos[i];
            cmd = new window[cmdJSON.type](); // creates a new object of type "json.type"
            cmd.json = cmdJSON;
            cmd.id = cmdJSON.id;
            cmd.name = cmdJSON.name;
            this.redos.push(cmd);
            this.idCounter = cmdJSON.id > this.idCounter ? cmdJSON.id : this.idCounter; // set last used idCounter
        }

        // Select the last executed undo-command
        global.app.call("historyChanged", this, this.undos[this.undos.length - 1]);
    }

    clear() {
        this.undos = [];
        this.redos = [];
        this.idCounter = 0;

        global.app.call("historyChanged", this);
    }

    goToState(id) {
        var cmd = this.undos.length > 0 ? this.undos[this.undos.length - 1] : undefined; // next cmd to pop

        if (cmd === undefined || id > cmd.id) {
            cmd = this.redo();
            while (cmd !== undefined && id > cmd.id) {
                cmd = this.redo();
            }
        } else {
            while (true) {
                 
                cmd = this.undos[this.undos.length - 1]; // next cmd to pop
                if (cmd === undefined || id === cmd.id) {
                    break;
                }
                cmd = this.undo();
            }
        }

        global.app.call("historyChanged", this, cmd);
    }

    enableSerialization(id) {
        /**
         * because there might be commands in this.undos and this.redos
         * which have not been serialized with .toJSON() we go back
         * to the oldest command and redo one command after the other
         * while also calling .toJSON() on them.
         */

        this.goToState(-1);

        var cmd = this.redo();
        while (cmd !== undefined) {
            if (!Object.prototype.hasOwnProperty.call(cmd, "json")) {
                cmd.json = cmd.toJSON();
            }
            cmd = this.redo();
        }

        this.goToState(id);
    }
}

export default History;
