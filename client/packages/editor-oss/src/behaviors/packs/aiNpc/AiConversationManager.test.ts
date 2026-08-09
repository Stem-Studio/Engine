import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import global from "@stem/editor-oss/global";
import AIConversationManager from "./AiConversationManager";

const hoisted = vi.hoisted(() => ({
    voiceRecorderInit: vi.fn(),
    voiceRecorderDispose: vi.fn(),
}));

vi.mock("@web-shared/player/component/AiConversationView", () => ({
    default: class MockAiConversationView {
        show = vi.fn();
        dispose = vi.fn();
    },
}));

vi.mock("@stem/editor-oss/utils/VoiceRecorder", () => ({
    default: class MockVoiceRecorder {
        init = hoisted.voiceRecorderInit;
        dispose = hoisted.voiceRecorderDispose;
    },
}));

const createManager = () => {
    const app = {
        on: vi.fn(),
        call: vi.fn(),
    };
    global.app = app as never;

    const game = {
        engine: {},
        player: {uuid: "player"},
        behaviorManager: {
            getBehaviorsById: vi.fn(() => []),
        },
    };

    return {
        app,
        manager: new AIConversationManager(game as never),
    };
};

const createAgent = (id: string, activeInVoiceChat = false) => ({
    id,
    isBusy: false,
    isPlaying: false,
    behavior: {
        attributes: {
            active_in_voice_chat: activeInVoiceChat,
            name: id,
        },
    },
});

describe("AIConversationManager", () => {
    const previousApp = global.app;

    beforeEach(() => {
        hoisted.voiceRecorderInit.mockClear();
        hoisted.voiceRecorderDispose.mockClear();
    });

    afterEach(() => {
        global.app = previousApp;
        vi.restoreAllMocks();
    });

    it("updates existing range entries in place", () => {
        const {manager} = createManager();

        manager.updateRangeData({agentId: "agent-a", distanceFromPlayer: 12, isInRange: true});
        const ranges = (manager as never as {ranges: Array<{distanceFromPlayer: number; isInRange: boolean}>}).ranges;

        manager.updateRangeData({agentId: "agent-a", distanceFromPlayer: 4, isInRange: false});

        expect((manager as never as {ranges: unknown[]}).ranges).toBe(ranges);
        expect(ranges).toEqual([
            {
                agentId: "agent-a",
                distanceFromPlayer: 4,
                isInRange: false,
            },
        ]);
    });

    it("finds the closest registered in-range agent without stale unregistered ranges", () => {
        const {manager} = createManager();
        const closeAgent = createAgent("close");
        const farAgent = createAgent("far");

        manager.registerAiAgent(closeAgent as never);
        manager.registerAiAgent(farAgent as never);
        manager.updateRangeData({agentId: "close", distanceFromPlayer: 2, isInRange: true});
        manager.updateRangeData({agentId: "far", distanceFromPlayer: 8, isInRange: true});

        expect(manager.getClosestAiAgent(true)).toBe(closeAgent);

        manager.unregisterAiAgent(closeAgent as never);

        expect(manager.getClosestAiAgent(true)).toBe(farAgent);
        expect((manager as never as {ranges: Array<{agentId: string}>}).ranges).toEqual([
            expect.objectContaining({agentId: "far"}),
        ]);
    });

    it("skips out-of-range agents when requested", () => {
        const {manager} = createManager();
        const closeOutOfRange = createAgent("close-out");
        const farInRange = createAgent("far-in");

        manager.registerAiAgent(closeOutOfRange as never);
        manager.registerAiAgent(farInRange as never);
        manager.updateRangeData({agentId: "close-out", distanceFromPlayer: 1, isInRange: false});
        manager.updateRangeData({agentId: "far-in", distanceFromPlayer: 5, isInRange: true});

        expect(manager.getClosestAiAgent()).toBe(closeOutOfRange);
        expect(manager.getClosestAiAgent(true)).toBe(farInRange);
    });
});
