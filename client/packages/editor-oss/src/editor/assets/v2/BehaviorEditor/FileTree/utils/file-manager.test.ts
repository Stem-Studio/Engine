import {afterEach, describe, expect, it, vi} from "vitest";

import {buildFileTree, Type} from "./file-manager";
import type {Directory, File} from "./file-manager";

afterEach(() => {
    vi.restoreAllMocks();
});

describe("buildFileTree", () => {
    it("builds from cloned input without JSON.stringify or mutating source items", () => {
        const stringifySpy = vi.spyOn(JSON, "stringify");
        const dirs: Directory[] = [{
            id: "dir-1",
            type: Type.DIRECTORY,
            name: "scripts",
            parentId: "0",
            depth: 99,
            files: [],
            dirs: [],
        }];
        const files: File[] = [{
            id: "file-1",
            type: Type.FILE,
            name: "movement.ts",
            parentId: "dir-1",
            depth: 99,
            content: "export default {}",
            language: "typescript",
        }];

        const root = buildFileTree(files, dirs);

        expect(stringifySpy).not.toHaveBeenCalled();
        expect(root.dirs).toHaveLength(1);
        expect(root.dirs[0]?.name).toBe("scripts");
        expect(root.dirs[0]?.depth).toBe(1);
        expect(root.dirs[0]?.files[0]?.name).toBe("movement.ts");
        expect(root.dirs[0]?.files[0]?.depth).toBe(2);

        expect(dirs[0]?.depth).toBe(99);
        expect(dirs[0]?.files).toEqual([]);
        expect(files[0]?.depth).toBe(99);
    });
});
