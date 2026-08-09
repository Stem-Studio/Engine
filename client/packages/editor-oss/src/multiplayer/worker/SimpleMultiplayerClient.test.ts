import {Object3D} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import SimpleMultiplayerClient from "./SimpleMultiplayerClient";

vi.mock("./MultiplayerWorker.ts?worker", () => ({
    default: class MockMultiplayerWorker {
        onmessage: ((event: MessageEvent) => void) | null = null;
        onerror: ((event: ErrorEvent) => void) | null = null;
        onmessageerror: ((event: MessageEvent) => void) | null = null;

        postMessage(): void {}
        terminate(): void {}
    },
}));

vi.mock("@stem/editor-oss/global", () => ({
    default: {app: null},
}));

describe("SimpleMultiplayerClient", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("checks synchronized children in deep hierarchies without recursive traversal", () => {
        const root = new Object3D();
        root.userData.synchronizeChildren = ["deep-child"];
        let cursor = root;
        for (let i = 0; i < 12_000; i++) {
            const child = new Object3D();
            cursor.add(child);
            cursor = child;
        }
        cursor.name = "deep-child";
        const traverse = vi.spyOn(root, "traverse").mockImplementation(() => {
            throw new Error("recursive traversal should not be used");
        });

        const childStates = SimpleMultiplayerClient.checkChildren(root, true);

        expect(childStates).toHaveLength(1);
        expect(childStates[0]!.uuid).toBe(cursor.uuid);
        expect(childStates[0]!.index).toBe(0);
        expect(traverse).not.toHaveBeenCalled();
    });
});
