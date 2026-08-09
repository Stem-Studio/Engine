import * as THREE from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import ShopBehavior from "./ShopBehavior";

const createShopBehavior = (attributes: Record<string, unknown>): ShopBehavior => {
    const target = new THREE.Object3D();
    return new ShopBehavior(target, "shop", {
        gameObject: {target} as any,
        erth: {} as any,
        attributes,
    });
};

describe("ShopBehavior", () => {
    afterEach(() => {
        document.getElementById("shopMenu")?.remove();
    });

    it("builds the shop menu from behavior attributes without executing authored HTML", () => {
        const behavior = createShopBehavior({
            introDialog: "<b>Welcome</b>",
            items: [{
                itemId: {assetId: "item-prefab", revisionId: "rev-1"},
                itemDisplayName: "<script>bad()</script>",
                price: 3,
            }],
        });

        behavior.createShopMenu();

        const menu = document.getElementById("shopMenu");
        expect(menu).not.toBeNull();
        expect(menu?.textContent).toContain("<b>Welcome</b>");
        expect(menu?.textContent).toContain("<script>bad()</script>");
        expect(menu?.querySelector("b")).toBeNull();
        expect(menu?.querySelector("script")).toBeNull();
    });

    it("falls back to a safe image for unsupported image URL schemes", () => {
        const behavior = createShopBehavior({
            shopImage: "javascript:alert(1)",
            items: [],
        });

        behavior.createShopMenu();

        const image = document.querySelector<HTMLImageElement>("#shopMenu img[alt='Shop']");
        expect(image?.src).toContain("data:image/svg+xml");
    });

    it("removes the open shop menu when the behavior is removed", () => {
        const behavior = createShopBehavior({
            introDialog: "Welcome",
            items: [],
        });

        behavior.createShopMenu();
        expect(document.getElementById("shopMenu")).not.toBeNull();

        behavior.onRemoved();

        expect(document.getElementById("shopMenu")).toBeNull();
    });

    it("resets menu state when the cancel button closes the menu", () => {
        const behavior = createShopBehavior({
            introDialog: "Welcome",
            items: [],
        });
        const player = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
        behavior.target.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
        behavior.init({
            player,
            collisionDetector: undefined,
        } as any);

        behavior.update();
        document.querySelector<HTMLButtonElement>("#shopMenu button:last-child")?.click();
        expect(document.getElementById("shopMenu")).toBeNull();

        behavior.update();

        expect(document.getElementById("shopMenu")).not.toBeNull();
    });

    it("preloads item prefabs from behavior attributes", () => {
        const behavior = createShopBehavior({
            items: [
                {itemId: {assetId: "item-1", revisionId: "rev-1"}},
                {itemId: {assetId: "item-2", revisionId: "rev-2"}},
                {itemDisplayName: "No prefab"},
            ],
        });
        const preloadPrefab = vi.fn();
        behavior.init({
            scene: new THREE.Scene(),
            prefabManager: {preloadPrefab},
            collisionDetector: undefined,
        } as any);

        behavior.preloadPrefabs();

        expect(preloadPrefab).toHaveBeenCalledWith({assetId: "item-1", revisionId: "rev-1"});
        expect(preloadPrefab).toHaveBeenCalledWith({assetId: "item-2", revisionId: "rev-2"});
        expect(preloadPrefab).toHaveBeenCalledTimes(2);
    });

    it("does not register the removed no-op physics collision listener", () => {
        const behavior = createShopBehavior({items: []});
        const addListener = vi.fn();
        behavior.init({
            scene: new THREE.Scene(),
            prefabManager: {preloadPrefab: vi.fn()},
            collisionDetector: {addListener},
        } as any);

        behavior.onAdded();

        expect(addListener).not.toHaveBeenCalled();
    });
});
