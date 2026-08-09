import {afterEach, describe, expect, it, vi} from "vitest";

const hoisted = vi.hoisted(() => ({
    constructedAudios: [] as Array<any>,
    loadCalls: [] as Array<{
        url: string;
        onLoad: (buffer: unknown) => void;
        onProgress?: unknown;
        onError?: (error: Error) => void;
    }>,
}));

vi.mock("three", () => {
    class AudioListener {}

    class Audio {
        buffer: unknown = null;
        isPlaying = false;
        loop = false;
        volume = 1;
        disconnected = false;
        source = {disconnect: vi.fn()};

        constructor(_listener: AudioListener) {
            hoisted.constructedAudios.push(this);
        }

        setBuffer(buffer: unknown) {
            this.buffer = buffer;
        }

        setLoop(loop: boolean) {
            this.loop = loop;
        }

        setVolume(volume: number) {
            this.volume = volume;
        }

        play() {
            this.isPlaying = true;
        }

        stop() {
            this.isPlaying = false;
        }

        disconnect() {
            this.disconnected = true;
        }
    }

    class AudioLoader {
        load(
            url: string,
            onLoad: (buffer: unknown) => void,
            onProgress?: unknown,
            onError?: (error: Error) => void,
        ) {
            hoisted.loadCalls.push({url, onLoad, onProgress, onError});
        }
    }

    class Scene {}

    return {Audio, AudioListener, AudioLoader, Scene};
});

import {SoundManager} from "./SoundManager";

describe("SoundManager", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        hoisted.constructedAudios.length = 0;
        hoisted.loadCalls.length = 0;
    });

    it("ignores audio loads that resolve after sounds were cleared", () => {
        const manager = new SoundManager(null);

        manager.loadSounds([{id: "theme", url: "/theme.mp3", loop: true, volume: 1, soundType: "play-now"}]);
        const load = hoisted.loadCalls[0]!;
        manager.clearLoadedSounds();
        load.onLoad("stale-buffer");

        expect(manager.loadedSounds.theme).toBeUndefined();
        expect(hoisted.constructedAudios).toHaveLength(0);
    });

    it("loads only the last duplicate id in a batch", () => {
        const manager = new SoundManager(null);

        manager.loadSounds([
            {id: "hit", url: "/old-hit.mp3", loop: false, volume: 1, soundType: ""},
            {id: "hit", url: "/new-hit.mp3", loop: false, volume: 0.5, soundType: ""},
        ]);

        expect(hoisted.loadCalls.map(call => call.url)).toEqual(["/new-hit.mp3"]);
    });

    it("disposes a previously loaded sound before replacing it", () => {
        const manager = new SoundManager(null);

        manager.loadSounds([{id: "theme", url: "/theme.mp3", loop: true, volume: 1, soundType: "play-now"}]);
        hoisted.loadCalls[0]!.onLoad("first-buffer");
        const firstSound = hoisted.constructedAudios[0]!;
        expect(firstSound.isPlaying).toBe(true);

        manager.loadSounds([{id: "theme", url: "/theme-v2.mp3", loop: false, volume: 0.5, soundType: ""}]);

        expect(firstSound.isPlaying).toBe(false);
        expect(firstSound.disconnected).toBe(true);
        expect(manager.loadedSounds.theme).toBeUndefined();
    });

    it("tracks current loads and calls onAllSoundsLoaded after successful current loads finish", () => {
        const manager = new SoundManager(null);
        const onAllSoundsLoaded = vi.spyOn(manager, "onAllSoundsLoaded").mockImplementation(() => {});

        manager.loadSounds([
            {id: "a", url: "/a.mp3", loop: false, volume: 1, soundType: ""},
            {id: "b", url: "/b.mp3", loop: false, volume: 1, soundType: ""},
        ]);
        hoisted.loadCalls[0]!.onLoad("a-buffer");
        expect(onAllSoundsLoaded).not.toHaveBeenCalled();
        hoisted.loadCalls[1]!.onLoad("b-buffer");

        expect(onAllSoundsLoaded).toHaveBeenCalledOnce();
        expect(Object.keys(manager.loadedSounds)).toEqual(["a", "b"]);
    });
});
