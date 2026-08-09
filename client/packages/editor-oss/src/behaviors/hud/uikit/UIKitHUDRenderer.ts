/**
 * UIKit HUD Renderer - State machine managing HUD screen transitions.
 * Replaces HUDView.tsx state logic.
 *
 * States: START_MENU -> PLAYING -> PAUSED -> GAME_OVER -> START_MENU
 */
import {clearFontCache, Fullscreen, type RendererLike} from "@ni2khanna/uikit";
import * as THREE from "three";


import {HUD_UIKIT_FONT_FAMILIES} from "./fonts";
import {UIKitGameHUD} from "./screens/UIKitGameHUD";
import {UIKitInGameMenu} from "./screens/UIKitInGameMenu";
import {UIKitStartMenu} from "./screens/UIKitStartMenu";
import EngineRuntime from "@stem/editor-oss/EngineRuntime";
import {GameDataType} from "@stem/editor-oss/context/HUDGameContext";
import {InGameMenuDataType, StartGameMenuDataType} from "@stem/editor-oss/editor/assets/v2/HUD/HUDEditView/types";
import {getSoundsFromUI} from "@stem/editor-oss/editor/assets/v2/HUD/HUDView/getGameSounds";
import {InGameData} from "@stem/editor-oss/editor/assets/v2/HUD/HUDView/types";
import global from "@stem/editor-oss/global";
import EventBus from "../../event/EventBus";
import GameManager from "../../game/GameManager";
import UIKitPointerEvents from "../../uikit/UIKitPointerEvents";

function isCameraLike(value: unknown): value is THREE.Camera {
    if (!value || typeof value !== "object") {
        return false;
    }
    const camera = value as THREE.Camera & {
        isPerspectiveCamera?: boolean;
        isOrthographicCamera?: boolean;
    };
    return camera.isPerspectiveCamera === true || camera.isOrthographicCamera === true;
}

function isFullscreenCameraError(error: unknown): boolean {
    const message =
        error && typeof error === "object" && "message" in error
            ? String((error as {message?: unknown}).message)
            : String(error);
    return message.includes("fullscreen can only be added to a camera");
}

enum HUDState {
    START_MENU = "START_MENU",
    PLAYING = "PLAYING",
    PAUSED = "PAUSED",
    GAME_OVER = "GAME_OVER",
}

export class UIKitHUDRenderer {
    private fullscreen: Fullscreen;
    private state: HUDState = HUDState.START_MENU;
    private startMenu?: UIKitStartMenu;
    private inGameMenu?: UIKitInGameMenu;
    private gameHUD?: UIKitGameHUD;
    private app: EngineRuntime;
    private scene: THREE.Scene;
    private game: GameManager;
    private noPauseMenu = false;
    private gameData: InGameData = {
        score: 0,
        maxScore: 0,
        health: 100,
        initialHealth: 100,
        currentLives: 0,
        totalLives: 0,
        isWinner: false,
        timeRemaining: "00:00:00",
        playerWeapons: [],
        pickedWeaponOrItem: undefined,
    };
    private keydownHandler?: (e: KeyboardEvent) => void;
    private gameOverTimeout?: ReturnType<typeof setTimeout>;
    private soundsLoadToken = 0;

    constructor(scene: THREE.Scene, game: GameManager) {
        this.scene = scene;
        this.game = game;
        this.app = global.app as EngineRuntime;

        // Create fullscreen UI root
        const renderer = game.renderer as unknown as RendererLike;
        this.fullscreen = new Fullscreen(renderer, {
            flexDirection: "column",
            pointerEvents: "auto",
            fontFamilies: HUD_UIKIT_FONT_FAMILIES,
        });
        // UIKit Fullscreen components must always live under a camera.
        const hudCamera = this.resolveHUDCamera();
        if (hudCamera) {
            hudCamera.add(this.fullscreen);
        } else {
            console.warn("[UIKitHUDRenderer] constructor: no camera for fullscreen root; will attach lazily");
        }

        // Initialize pointer events
        UIKitPointerEvents.initialize(game);
        UIKitPointerEvents.registerRoot(this.fullscreen);

        // Bind application events
        this.bindEvents();
    }

    private resolveHUDCamera(): THREE.Camera | undefined {
        return [this.game.uiCamera, this.game.camera, this.app.camera].find(isCameraLike);
    }

    private ensureFullscreenCamera(): boolean {
        if (isCameraLike(this.fullscreen.parent)) {
            return true;
        }

        const hudCamera = this.resolveHUDCamera();
        if (!isCameraLike(hudCamera)) {
            return false;
        }

        hudCamera.add(this.fullscreen);
        return true;
    }

    show(emptyHUD = false) {
        if (emptyHUD) return;

        // In sandbox or when HUD is hidden, skip menu screens and auto-start gameplay.
        if (this.app.editor?.isSandbox || !this.app.editor?.showHUD) {
            this.noPauseMenu = true;
            this.transitionTo(HUDState.PLAYING);
            setTimeout(() => {
                EventBus.instance.send("game.start");
                EventBus.instance.send("game.clear_sounds");
            }, 500);
            return;
        }

        this.transitionTo(HUDState.START_MENU);
    }

    private bindEvents() {
        // Game lifecycle events
        this.app.on("gameCreated.UIKitHUD", (game: GameManager) => {
            this.updateGameDataValues(game);
        });

        this.app.on("gameStarted.UIKitHUD", (game: GameManager) => {
            this.updateGameDataValues(game);
            this.transitionTo(HUDState.PLAYING);
        });

        this.app.on("gameUpdated.UIKitHUD", (game: GameManager) => {
            this.onGameUpdated(game);
        });

        this.app.on("gameTimerUpdate.UIKitHUD", (game: GameManager) => {
            this.updateGameDataValues(game);
        });

        this.app.on("pauseGame.UIKitHUD", (game: GameManager) => {
            if (game?.isGameOver()) {
                this.transitionTo(HUDState.GAME_OVER);
                // Return to start menu after 5 seconds
                this.gameOverTimeout = setTimeout(() => {
                    this.transitionTo(HUDState.START_MENU);
                }, 5000);
                return;
            }

            if (!this.noPauseMenu) {
                this.transitionTo(HUDState.PAUSED);
            } else {
                EventBus.instance.send("game.resume");
            }
        });

        // Escape key handler
        if (!this.app.editor?.isSandbox) {
            this.keydownHandler = (event: KeyboardEvent) => {
                if (event.key === "Escape" && !this.noPauseMenu) {
                    EventBus.instance.send("game.pause");
                    this.transitionTo(HUDState.PAUSED);
                }
            };
            window.addEventListener("keydown", this.keydownHandler);
        }
    }

    private unbindEvents() {
        this.app.on("gameCreated.UIKitHUD", null);
        this.app.on("gameStarted.UIKitHUD", null);
        this.app.on("gameUpdated.UIKitHUD", null);
        this.app.on("gameTimerUpdate.UIKitHUD", null);
        this.app.on("pauseGame.UIKitHUD", null);

        if (this.keydownHandler) {
            window.removeEventListener("keydown", this.keydownHandler);
            this.keydownHandler = undefined;
        }

        if (this.gameOverTimeout) {
            clearTimeout(this.gameOverTimeout);
            this.gameOverTimeout = undefined;
        }
    }

    private updateGameDataValues(game: GameManager) {
        this.gameData = {
            score: game.score,
            maxScore: game.maxScore,
            health: game.health,
            initialHealth: game.initialHealth,
            currentLives: game.lives,
            totalLives: game.initialLives,
            isWinner: game.isWinner(),
            timeRemaining: game.time_remaining || "00:00:00",
            playerWeapons: game.playerWeapons,
            pickedWeaponOrItem: game.pickedWeaponOrItem ?? undefined,
        };
    }

    private onGameUpdated(game: GameManager) {
        this.updateGameDataValues(game);

        // Forward to active game HUD
        if (this.state === HUDState.PLAYING && this.gameHUD) {
            this.gameHUD.update(this.gameData);
        }
    }

    private transitionTo(newState: HUDState) {
        if (this.state === newState && this.hasActiveScreen()) return;

        // Dispose current screen
        this.disposeCurrentScreen();

        this.state = newState;

        // Always set fullscreen properties for the new state first, even if
        // the screen content fails to create (e.g., missing gameUI data).
        const isOverlay = newState === HUDState.START_MENU || newState === HUDState.PAUSED;
        this.fullscreen.setProperties({
            backgroundColor: 0x000000,
            opacity: isOverlay ? "75%" : 0,
            pointerEvents: isOverlay ? "auto" : "none",
        });

        // Create new screen
        switch (newState) {
            case HUDState.START_MENU:
                this.showStartMenu();
                break;
            case HUDState.PLAYING:
                this.showGameHUD();
                break;
            case HUDState.PAUSED:
                this.showInGameMenu();
                break;
            case HUDState.GAME_OVER:
                this.showGameOver();
                break;
        }
    }

    private hasActiveScreen(): boolean {
        return !!(this.startMenu || this.inGameMenu || this.gameHUD);
    }

    private showStartMenu() {
        const startMenuData = this.scene.userData?.gameUI?.gameStartMenu as StartGameMenuDataType | undefined;
        if (!startMenuData) {
            console.warn("UIKitHUDRenderer: no startMenuData in scene.userData.gameUI");
            return;
        }

        void this.loadMenuSounds(startMenuData, true);

        this.startMenu = new UIKitStartMenu(startMenuData);
        this.fullscreen.add(this.startMenu.container);
    }

    private showGameHUD() {
        const gameHUDData = this.scene.userData?.gameUI?.gameHUD as GameDataType | undefined;
        if (!gameHUDData) {
            console.warn("UIKitHUDRenderer: no gameHUD data in scene.userData.gameUI");
            return;
        }

        this.gameHUD = new UIKitGameHUD(gameHUDData);
        this.fullscreen.add(this.gameHUD.container);

        // Apply current game data
        this.gameHUD.update(this.gameData);

        // Notify app we're playing
        this.app.call("playingGame");
    }

    private showInGameMenu() {
        const inGameData = this.scene.userData?.gameUI?.inGameMenu as InGameMenuDataType | undefined;
        if (!inGameData) {
            console.warn("UIKitHUDRenderer: no inGameMenu data in scene.userData.gameUI");
            return;
        }

        void this.loadMenuSounds(inGameData, false);

        this.inGameMenu = new UIKitInGameMenu(inGameData, () => {
            this.transitionTo(HUDState.PLAYING);
        });
        this.fullscreen.add(this.inGameMenu.container);

        // Notify app we stopped playing
        this.app.call("stoppedPlayingGame");
    }

    private async loadMenuSounds(gameUI: StartGameMenuDataType | InGameMenuDataType, isStartMenu: boolean) {
        const token = ++this.soundsLoadToken;
        EventBus.instance.send("game.clear_sounds");
        try {
            const sounds = await getSoundsFromUI(gameUI, isStartMenu, !isStartMenu);
            if (token !== this.soundsLoadToken || !sounds?.length) return;
            EventBus.instance.send("game.loadSounds", sounds);
        } catch (error) {
            console.warn("UIKitHUDRenderer: failed to load menu sounds", error);
        }
    }

    private showGameOver() {
        // Show the game HUD with banner visible
        const gameHUDData = this.scene.userData?.gameUI?.gameHUD as GameDataType | undefined;
        if (!gameHUDData) return;

        this.gameHUD = new UIKitGameHUD(gameHUDData);
        this.fullscreen.add(this.gameHUD.container);
        this.gameHUD.update(this.gameData);

        // Show banner
        const bannerText = this.gameData.isWinner ? "You Won!" : "You Lose";
        this.gameHUD.showBanner(bannerText);
    }

    private disposeCurrentScreen() {
        if (this.startMenu) {
            this.fullscreen.remove(this.startMenu.container);
            this.startMenu.dispose();
            this.startMenu = undefined;
        }
        if (this.inGameMenu) {
            this.fullscreen.remove(this.inGameMenu.container);
            this.inGameMenu.dispose();
            this.inGameMenu = undefined;
        }
        if (this.gameHUD) {
            this.fullscreen.remove(this.gameHUD.container);
            this.gameHUD.dispose();
            this.gameHUD = undefined;
        }
    }

    update(delta: number) {
        // Fullscreen.update() throws if its parent is not a camera.
        // Lazily attach to the HUD camera if it wasn't available at construction time.
        if (!this.ensureFullscreenCamera()) {
            return;
        }

        // Drive UIKit's internal layout/animation/dirty-flag system. Without
        // this, layout only updates on event boundaries and containers visibly
        // jump between passes. Matches what `UIKitHUDPreview` does.
        try {
            this.fullscreen.update(delta);
        } catch (error) {
            if (isFullscreenCameraError(error)) {
                this.ensureFullscreenCamera();
                return;
            }
            throw error;
        }
        UIKitPointerEvents.update(delta);
    }

    dispose() {
        this.unbindEvents();
        this.disposeCurrentScreen();

        UIKitPointerEvents.unregisterRoot(this.fullscreen);
        this.fullscreen.removeFromParent();
        this.fullscreen.dispose();
        UIKitPointerEvents.deinitialize();

        // Clear global font cache so next play session loads fresh font textures
        clearFontCache();
    }
}
