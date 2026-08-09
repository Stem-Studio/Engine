import {Object3D} from "three";
import {describe, expect, it, vi} from "vitest";

import {CharacterSwap} from "./CharacterSwap";

type MockRangeDetector = {
    distanceThreshold: number;
    isTargetInRange: boolean;
    setText: ReturnType<typeof vi.fn>;
    setTarget: ReturnType<typeof vi.fn>;
    setPlayer: ReturnType<typeof vi.fn>;
    setActive: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    isInRange: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
};

type TestableCharacterSwap = {
    update(deltaTime: number): void;
    rangeDetector: MockRangeDetector;
    swapActivated: boolean;
    swapCooldown: number;
};

function createSwapHarness(isTargetInRange: boolean) {
    const owner = new Object3D();
    const player = new Object3D();
    player.userData.pressE = true;
    const rangeDetector = {
        distanceThreshold: 0,
        isTargetInRange,
        setText: vi.fn(),
        setTarget: vi.fn(),
        setPlayer: vi.fn(),
        setActive: vi.fn(),
        update: vi.fn(),
        isInRange: vi.fn(),
        dispose: vi.fn(),
    };
    const game = {
        player,
        isMultiplayer: false,
        behaviorManager: {
            sendEventToObjectBehaviors: vi.fn(),
        },
    };
    const swap = new CharacterSwap(owner, game as never) as unknown as TestableCharacterSwap;
    swap.rangeDetector = rangeDetector;
    swap.swapActivated = true;
    swap.swapCooldown = 0;

    return {swap, owner, player, game, rangeDetector};
}

describe("CharacterSwap", () => {
    it("uses the current RangeDetector update result instead of rechecking range", () => {
        const {swap, owner, player, game, rangeDetector} = createSwapHarness(true);

        swap.update(1 / 60);

        expect(rangeDetector.setTarget).toHaveBeenCalledWith(owner);
        expect(rangeDetector.setPlayer).toHaveBeenCalledWith(player);
        expect(rangeDetector.update).toHaveBeenCalledOnce();
        expect(rangeDetector.isInRange).not.toHaveBeenCalled();
        expect(game.behaviorManager.sendEventToObjectBehaviors).toHaveBeenCalledWith(player, "character:deactivate");
        expect(game.behaviorManager.sendEventToObjectBehaviors).toHaveBeenCalledWith(owner, "character:activate");
    });

    it("does not swap when the updated detector reports out of range", () => {
        const {swap, game, rangeDetector} = createSwapHarness(false);

        swap.update(1 / 60);

        expect(rangeDetector.update).toHaveBeenCalledOnce();
        expect(rangeDetector.isInRange).not.toHaveBeenCalled();
        expect(game.behaviorManager.sendEventToObjectBehaviors).not.toHaveBeenCalled();
    });
});
