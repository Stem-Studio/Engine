import type {CommandResult} from "./AddObjectCommand";

export interface EditorCommand {
    execute: () => CommandResult | CommandResult[] | Promise<CommandResult | CommandResult[]>;
    undo: () => CommandResult | CommandResult[];
    toJSON?: () => unknown;
    fromJSON?: (json: unknown) => void;
}

export class MultiCmdsCommand {
    constructor(cmdArray?: EditorCommand[]);
    execute: () => Promise<Array<CommandResult | CommandResult[]>>;
    undo: () => Array<CommandResult | CommandResult[]>;
    toJSON: () => unknown;
    fromJSON: (json: unknown) => void;
}
