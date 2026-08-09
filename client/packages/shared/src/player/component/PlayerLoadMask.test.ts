import {afterEach, describe, expect, it} from "vitest";

import PlayerLoadMask from "./PlayerLoadMask";

describe("PlayerLoadMask", () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    const makeApp = () => {
        const container = document.createElement("div");
        document.body.appendChild(container);
        return {container, options: {server: ""}};
    };

    it("uses a readable runtime handoff instead of an opaque black spinner", () => {
        const app = makeApp();
        const mask = new PlayerLoadMask(app);

        mask.show({revealScene: true, message: "Preparing your world"});

        const container = mask.container!;
        const message = mask.message!;
        const status = mask.status!;

        expect(container.dataset.maskMode).toBe("runtime");
        expect(container.style.background).toContain("radial-gradient");
        expect(container.style.backdropFilter).toContain("blur(2px)");
        expect(message.textContent).toBe("Preparing your world");
        expect(message.getAttribute("role")).toBe("status");
        expect(status.style.fontSize).toBe("14px");

        mask.hide();
        expect(container.dataset.maskMode).toBe("hidden");
        expect(container.style.display).toBe("none");
    });

    it("keeps the opaque loading treatment for scene loads", () => {
        const app = makeApp();
        const mask = new PlayerLoadMask(app);

        mask.show();

        const container = mask.container!;
        const message = mask.message!;

        expect(container.dataset.maskMode).toBe("loading");
        expect(container.style.background).toContain("rgba(3, 7, 15, 0.96)");
        expect(message.textContent).toBe("Loading scene");
    });
});
