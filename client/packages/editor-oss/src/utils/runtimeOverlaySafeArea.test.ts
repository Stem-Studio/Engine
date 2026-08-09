import {afterEach, describe, expect, it} from "vitest";

import {RuntimeOverlaySafeAreaCoordinator} from "./runtimeOverlaySafeArea";

describe("RuntimeOverlaySafeAreaCoordinator", () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it("moves a legacy fullscreen body overlay below host chrome and restores it", () => {
        const overlay = document.createElement("div");
        overlay.id = "legacy-game-hud";
        overlay.style.position = "fixed";
        overlay.style.top = "0px";
        overlay.style.height = "100vh";
        overlay.style.zIndex = "9999";
        Object.defineProperty(overlay, "getBoundingClientRect", {
            configurable: true,
            value: () => {
                const top = Number.parseFloat(overlay.style.top || "0");
                const height = top > 0 ? 414 - top : 414;
                return {top, bottom: top + height, left: 0, right: 896, width: 896, height};
            },
        });
        document.body.append(overlay);

        const coordinator = new RuntimeOverlaySafeAreaCoordinator({
            getSafeArea: () => ({
                left: 0,
                top: 48,
                right: 896,
                bottom: 414,
                width: 896,
                height: 366,
                insetLeft: 0,
                insetTop: 48,
                insetRight: 0,
                insetBottom: 0,
            }),
            document,
            window,
        });

        coordinator.start();

        expect(overlay.style.top).toBe("48px");
        expect(overlay.style.height).toContain("100vh");
        expect(overlay.dataset.stemSafeOverlayManaged).toBe("true");

        coordinator.dispose();

        expect(overlay.style.top).toBe("0px");
        expect(overlay.style.height).toBe("100vh");
        expect(overlay.hasAttribute("data-stem-safe-overlay-managed")).toBe(false);
    });

    it("does not move marked host chrome", () => {
        const nav = document.createElement("nav");
        nav.setAttribute("data-stem-host-chrome", "true");
        nav.style.position = "fixed";
        nav.style.top = "0px";
        nav.style.height = "48px";
        nav.style.zIndex = "10000";
        document.body.append(nav);

        const coordinator = new RuntimeOverlaySafeAreaCoordinator({
            getSafeArea: () => ({
                left: 0, top: 48, right: 896, bottom: 414, width: 896, height: 366,
                insetLeft: 0, insetTop: 48, insetRight: 0, insetBottom: 0,
            }),
            document,
            window,
        });
        coordinator.start();

        expect(nav.style.top).toBe("0px");
        expect(nav.hasAttribute("data-stem-safe-overlay-managed")).toBe(false);
        coordinator.dispose();
    });
});

