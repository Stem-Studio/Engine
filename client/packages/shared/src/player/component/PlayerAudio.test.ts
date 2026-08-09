import {afterEach, describe, expect, it, vi} from "vitest";

const hoisted = vi.hoisted(() => ({
    loadCalls: [] as Array<{
        url: string | undefined;
        onLoad: (buffer: unknown) => void;
        onProgress?: unknown;
        onError?: () => void;
    }>,
}));

vi.mock("three", () => {
    class Audio {
        userData: Record<string, unknown> = {};
        autoplay = false;
        isPlaying = false;
        buffer: unknown = null;

        setBuffer(buffer: unknown) {
            this.buffer = buffer;
        }

        play() {
            this.isPlaying = true;
        }

        stop() {
            this.isPlaying = false;
        }
    }

    class AudioLoader {
        load(url: string | undefined, onLoad: (buffer: unknown) => void, onProgress?: unknown, onError?: () => void) {
            hoisted.loadCalls.push({url, onLoad, onProgress, onError});
        }
    }

    return {Audio, AudioLoader};
});

vi.mock("../../utils/UrlUtils", () => ({
    backendUrlFromPath: (path: string | undefined) => (path ? `resolved:${path}` : undefined),
}));

import {Audio} from "three";

import PlayerAudio from "./PlayerAudio";

function createScene(objects: unknown[]) {
    return {
        traverse: (visit: (object: unknown) => void) => {
            objects.forEach(visit);
        },
    };
}

function createAudio(url: string, autoplay = false): any {
    const TestAudio = Audio as unknown as {new (): any};
    const audio = new TestAudio();
    audio.userData = {Url: url, autoplay};
    return audio;
}

describe("PlayerAudio", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        hoisted.loadCalls.length = 0;
    });

    it("ignores loader callbacks that resolve after dispose while resolving create()", async () => {
        const playerAudio = new PlayerAudio({});
        const audio = createAudio("/music.mp3", true);

        const createPromise = playerAudio.create(createScene([audio]));
        await Promise.resolve();
        const load = hoisted.loadCalls[0]!;
        playerAudio.dispose();
        load.onLoad("stale-buffer");
        await expect(createPromise).resolves.toEqual([undefined]);

        expect(audio.buffer).toBeNull();
        expect(audio.isPlaying).toBe(false);
    });

    it("recreate invalidates pending loads from the previous scene", async () => {
        const playerAudio = new PlayerAudio({});
        const oldAudio = createAudio("/old.mp3", true);
        const newAudio = createAudio("/new.mp3", true);

        const oldPromise = playerAudio.create(createScene([oldAudio]));
        await Promise.resolve();
        const oldLoad = hoisted.loadCalls[0]!;
        const newPromise = playerAudio.create(createScene([newAudio]));
        await Promise.resolve();
        const newLoad = hoisted.loadCalls[1]!;

        oldLoad.onLoad("old-buffer");
        newLoad.onLoad("new-buffer");
        await Promise.all([oldPromise, newPromise]);

        expect(oldAudio.buffer).toBeNull();
        expect(oldAudio.isPlaying).toBe(false);
        expect(newAudio.buffer).toBe("new-buffer");
        expect(newAudio.isPlaying).toBe(true);
    });

    it("stops currently tracked audio on recreate and dispose", async () => {
        const playerAudio = new PlayerAudio({});
        const firstAudio = createAudio("/first.mp3", true);
        firstAudio.isPlaying = true;
        const secondAudio = createAudio("/second.mp3", false);

        const firstPromise = playerAudio.create(createScene([firstAudio]));
        await Promise.resolve();
        hoisted.loadCalls[0]!.onLoad("first-buffer");
        await firstPromise;
        expect(firstAudio.isPlaying).toBe(true);

        playerAudio.create(createScene([secondAudio]));
        expect(firstAudio.isPlaying).toBe(false);

        secondAudio.isPlaying = true;
        playerAudio.dispose();
        expect(secondAudio.isPlaying).toBe(false);
    });

    it("passes resolved backend URLs to AudioLoader", async () => {
        const playerAudio = new PlayerAudio({});
        const audio = createAudio("/sfx.mp3");

        void playerAudio.create(createScene([audio]));
        await Promise.resolve();

        expect(hoisted.loadCalls[0]!.url).toBe("resolved:/sfx.mp3");
    });

    it("tracks audio objects and schedules loads during the scene traversal", async () => {
        const playerAudio = new PlayerAudio({});
        const firstAudio = createAudio("/first.mp3");
        const nonAudio = {};
        const secondAudio = createAudio("/second.mp3");
        const loadAudio = vi.spyOn(playerAudio as any, "loadAudio").mockResolvedValue(undefined);

        await playerAudio.create(createScene([firstAudio, nonAudio, secondAudio]));

        expect((playerAudio as any).audios).toEqual([firstAudio, secondAudio]);
        expect(loadAudio).toHaveBeenCalledTimes(2);
        expect(loadAudio).toHaveBeenNthCalledWith(1, firstAudio, 1);
        expect(loadAudio).toHaveBeenNthCalledWith(2, secondAudio, 1);
    });
});
