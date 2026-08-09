/**
 * UIKit HUD Preview for the editor HUD designer panel.
 * Renders the same UIKit components used at runtime into a small canvas
 * embedded in the editor, providing a live preview of the HUD layout.
 */
import {Fullscreen} from "@ni2khanna/uikit";
import {forwardHtmlEvents} from "@pmndrs/pointer-events";
import * as THREE from "three";


import {GameDataType} from "@stem/editor-oss/context/HUDGameContext";
import {HUD_TABS, InGameMenuDataType, StartGameMenuDataType} from "@stem/editor-oss/editor/assets/v2/HUD/HUDEditView/types";
import {InGameData} from "@stem/editor-oss/editor/assets/v2/HUD/HUDView/types";
import {HUD_UIKIT_FONT_FAMILIES} from "../fonts";
import {ensureUIKitRuntimeInitialized} from "../../../uikit/UIKitInitialization";
import {UIKitGameHUD} from "../screens/UIKitGameHUD";
import {UIKitInGameMenu} from "../screens/UIKitInGameMenu";
import {UIKitStartMenu} from "../screens/UIKitStartMenu";

const PREVIEW_GAME_DATA: InGameData = {
    score: 125,
    maxScore: 500,
    health: 75,
    initialHealth: 100,
    currentLives: 3,
    totalLives: 4,
    isWinner: false,
    timeRemaining: "00:05:30",
    playerWeapons: [],
    pickedWeaponOrItem: undefined,
};

export class UIKitHUDPreview {
    private renderer: THREE.WebGLRenderer;
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private fullscreen?: Fullscreen;
    private activeScreen?: UIKitStartMenu | UIKitInGameMenu | UIKitGameHUD;
    private animFrameId?: number;
    private pointerEvents?: {update: () => void; destroy: () => void};
    private initialized = false;
    private pendingUpdate?: {
        tab: HUD_TABS;
        data: {
            startMenu?: StartGameMenuDataType;
            inGameMenu?: InGameMenuDataType;
            gameHUD?: GameDataType;
        };
    };

    constructor(private canvas: HTMLCanvasElement) {
        this.renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true});
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setClearColor(0x000000, 0);

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
        this.camera.position.set(0, 0, 5);
        this.scene.add(this.camera);

        void this.init();
    }

    private async init() {
        await ensureUIKitRuntimeInitialized();

        this.fullscreen = new Fullscreen(this.renderer, {
            flexDirection: "column",
            pointerEvents: "auto",
            backgroundColor: 0x1a1a2e,
            opacity: "80%",
            fontFamilies: HUD_UIKIT_FONT_FAMILIES,
        });
        this.camera.add(this.fullscreen);

        // Set up pointer events for the preview
        this.pointerEvents = forwardHtmlEvents(this.canvas, this.camera, this.scene, {
            batchEvents: true,
            intersectEveryFrame: false,
        });

        this.initialized = true;
        if (this.pendingUpdate) {
            this.renderScreen(this.pendingUpdate.tab, this.pendingUpdate.data);
            this.pendingUpdate = undefined;
        }
        this.startRenderLoop();
    }

    private startRenderLoop() {
        const animate = () => {
            this.animFrameId = requestAnimationFrame(animate);
            this.resize();
            this.pointerEvents?.update();
            this.fullscreen?.update(1 / 60);
            this.renderer.render(this.scene, this.camera);
        };
        animate();
    }

    private resize() {
        const parent = this.canvas.parentElement;
        if (!parent) return;
        const width = parent.clientWidth;
        const height = parent.clientHeight;
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.renderer.setSize(width, height, false);
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        }
    }

    updateScreen(
        tab: HUD_TABS,
        data: {
            startMenu?: StartGameMenuDataType;
            inGameMenu?: InGameMenuDataType;
            gameHUD?: GameDataType;
        },
    ) {
        if (!this.initialized || !this.fullscreen) {
            this.pendingUpdate = {tab, data};
            return;
        }
        this.renderScreen(tab, data);
    }

    private renderScreen(
        tab: HUD_TABS,
        data: {
            startMenu?: StartGameMenuDataType;
            inGameMenu?: InGameMenuDataType;
            gameHUD?: GameDataType;
        },
    ) {
        if (!this.fullscreen) return;
        // Dispose current screen
        if (this.activeScreen) {
            this.fullscreen.remove(this.activeScreen.container);
            this.activeScreen.dispose();
            this.activeScreen = undefined;
        }

        switch (tab) {
            case HUD_TABS.GAME_START_MENU:
                if (data.startMenu) {
                    const screen = new UIKitStartMenu(data.startMenu);
                    this.activeScreen = screen;
                    this.fullscreen.add(screen.container);
                }
                break;

            case HUD_TABS.IN_GAME_MENU:
                if (data.inGameMenu) {
                    const screen = new UIKitInGameMenu(data.inGameMenu, () => {});
                    this.activeScreen = screen;
                    this.fullscreen.add(screen.container);
                }
                break;

            case HUD_TABS.GAME_HUD:
                if (data.gameHUD) {
                    const screen = new UIKitGameHUD(data.gameHUD);
                    screen.update(PREVIEW_GAME_DATA);
                    this.activeScreen = screen;
                    this.fullscreen.add(screen.container);
                }
                break;
        }
    }

    dispose() {
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
        }
        this.pointerEvents?.destroy();
        if (this.activeScreen) {
            this.activeScreen.dispose();
        }
        this.fullscreen?.dispose();
        this.renderer.dispose();
    }
}
