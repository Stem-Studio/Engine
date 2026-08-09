import * as THREE from "three";

import { AssetRef } from '@stem/editor-oss/asset-management/AssetRef';
import { PrefabManager } from "@stem/editor-oss/prefab/PrefabManager";
import { BehaviorBase } from "../../Behavior";
import GameManager from "../../game/GameManager";

type ShopItem = {
    itemId?: AssetRef;
    itemDisplayName?: string;
    paymentType?: AssetRef;
    price?: number | string;
};

const NO_IMAGE_URL = "data:image/svg+xml;charset=UTF-8," +
    encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#18181b" stroke="#3f3f46" stroke-width="2"/><text x="50" y="50" font-family="Arial" font-size="12" fill="#71717a" text-anchor="middle" dominant-baseline="middle">No Image</text></svg>`);

const PAYMENT_IMAGE_URL = "data:image/svg+xml;charset=UTF-8," +
    encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15"><rect width="15" height="15" fill="transparent" stroke="white" stroke-width="1"/></svg>`);

class ShopBehavior extends BehaviorBase {
    private game?: GameManager;
    private prefabManager?: PrefabManager;
    private isMenuOpen: boolean = false;
    private readonly playerBounds = new THREE.Box3();
    private readonly targetBounds = new THREE.Box3();

    init(game: GameManager) {
        this.game = game;
        this.prefabManager = game.prefabManager;
    }

    onAdded() {
        this.preloadPrefabs();
    }

    onRemoved(): void {
        this.closeShopMenu();
    }

    onReset() { }

    preloadPrefabs(): void {
        if (!this.prefabManager || !this.game?.scene) return;

        for (const item of this.getShopItems()) {
            if (item.itemId) {
                void this.prefabManager.preloadPrefab(item.itemId);
            }
        }
    }

    update() {
        if (!this.game?.player || !this.target) return;

        const playerBox = this.playerBounds.setFromObject(this.game.player);
        const targetBox = this.targetBounds.setFromObject(this.target);

        if (playerBox.intersectsBox(targetBox)) {
            if (!this.isMenuOpen) {
                this.createShopMenu();
                this.isMenuOpen = true;
            }
        } else {
            if (this.isMenuOpen) {
                this.closeShopMenu();
            }
        }
    }

    createShopMenu() {
        if (document.getElementById('shopMenu')) return;

        const menu = document.createElement('div');
        menu.id = 'shopMenu';
        menu.appendChild(this.createShopPanel());

        document.body.appendChild(menu);
    }

    private closeShopMenu() {
        document.getElementById("shopMenu")?.remove();
        this.isMenuOpen = false;
    }

    private getShopItems(): ShopItem[] {
        return Array.isArray(this.attributes.items)
            ? this.attributes.items.filter((item: ShopItem | null | undefined): item is ShopItem => !!item?.itemId)
            : [];
    }

    private getIntroDialog(): string {
        return String(this.attributes.introDialog || "No introduction available.");
    }

    private getSafeImageUrl(value: unknown): string {
        if (typeof value !== "string") {
            return NO_IMAGE_URL;
        }

        const trimmed = value.trim();
        if (
            trimmed.startsWith("data:image/") ||
            trimmed.startsWith("blob:") ||
            trimmed.startsWith("https://") ||
            trimmed.startsWith("http://") ||
            trimmed.startsWith("/") ||
            trimmed.startsWith("./") ||
            trimmed.startsWith("../")
        ) {
            return trimmed;
        }

        return NO_IMAGE_URL;
    }

    private createShopPanel(): HTMLDivElement {
        const panel = document.createElement("div");
        Object.assign(panel.style, {
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            background: "#202020",
            color: "white",
            padding: "10px",
            display: "flex",
            flexDirection: "column",
            borderRadius: "10px",
            zIndex: "1000",
            border: "2px solid #202020",
            boxSizing: "border-box",
            maxHeight: "80vh",
            overflowY: "auto",
            width: "min(820px, calc(100vw - 32px))",
        });

        panel.appendChild(this.createShopHeader());
        panel.appendChild(this.createItemsList());
        panel.appendChild(this.createButtonRow());

        return panel;
    }

    private createShopHeader(): HTMLDivElement {
        const header = document.createElement("div");
        Object.assign(header.style, {
            display: "flex",
            alignItems: "flex-start",
            gap: "10px",
            background: "#27272a",
            padding: "10px",
            borderRadius: "10px",
            marginBottom: "10px",
        });

        const image = document.createElement("img");
        image.src = this.getSafeImageUrl(this.attributes.shopImage);
        image.alt = "Shop";
        Object.assign(image.style, {
            width: "100px",
            height: "100px",
            objectFit: "cover",
            borderRadius: "10px",
            flex: "0 0 auto",
        });

        const intro = document.createElement("p");
        intro.textContent = this.getIntroDialog();
        Object.assign(intro.style, {
            margin: "0",
            lineHeight: "1.35",
            whiteSpace: "pre-wrap",
        });

        header.append(image, intro);
        return header;
    }

    private createItemsList(): HTMLDivElement {
        const itemsContainer = document.createElement("div");
        Object.assign(itemsContainer.style, {
            flexGrow: "1",
            overflowY: "auto",
            overflowX: "hidden",
            marginBottom: "10px",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(125px, 1fr))",
            gap: "10px",
        });

        const items = this.getShopItems();
        if (items.length === 0) {
            const emptyState = document.createElement("p");
            emptyState.textContent = "No shop items available";
            Object.assign(emptyState.style, {
                margin: "0",
                color: "#d4d4d8",
            });
            itemsContainer.appendChild(emptyState);
            return itemsContainer;
        }

        items.forEach(item => {
            itemsContainer.appendChild(this.createItemCard(item));
        });

        return itemsContainer;
    }

    private createItemCard(item: ShopItem): HTMLDivElement {
        const card = document.createElement("div");
        Object.assign(card.style, {
            display: "flex",
            flexDirection: "column",
            textAlign: "left",
            borderRadius: "8px",
            background: "#27272a",
            overflow: "hidden",
            minWidth: "0",
        });

        const image = document.createElement("img");
        image.src = NO_IMAGE_URL;
        image.alt = String(item.itemDisplayName || "Shop item");
        Object.assign(image.style, {
            width: "100%",
            height: "100px",
            objectFit: "cover",
        });

        const displayName = document.createElement("span");
        displayName.textContent = String(item.itemDisplayName || "Shop item");
        Object.assign(displayName.style, {
            marginTop: "10px",
            padding: "0 8px",
            overflowWrap: "anywhere",
        });

        const priceRow = document.createElement("div");
        Object.assign(priceRow.style, {
            display: "flex",
            alignItems: "center",
            gap: "5px",
            marginTop: "10px",
            padding: "0 8px 8px",
        });

        const paymentImage = document.createElement("img");
        paymentImage.src = PAYMENT_IMAGE_URL;
        paymentImage.alt = "Payment";
        Object.assign(paymentImage.style, {
            width: "25px",
            height: "25px",
            flex: "0 0 auto",
        });

        const price = document.createElement("span");
        price.textContent = String(item.price ?? "N/A");

        priceRow.append(paymentImage, price);
        card.append(image, displayName, priceRow);

        return card;
    }

    private createButtonRow(): HTMLDivElement {
        const buttonRow = document.createElement("div");
        Object.assign(buttonRow.style, {
            display: "flex",
            justifyContent: "flex-end",
            gap: "10px",
            padding: "10px 0 0",
        });

        const remainingButton = document.createElement("button");
        remainingButton.type = "button";
        remainingButton.textContent = "REMAINING";
        Object.assign(remainingButton.style, {
            backgroundColor: "blue",
            color: "white",
            padding: "10px",
            border: "none",
            borderRadius: "5px",
            cursor: "pointer",
        });

        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.textContent = "CANCEL";
        Object.assign(cancelButton.style, {
            backgroundColor: "#27272a",
            color: "white",
            padding: "10px",
            border: "none",
            borderRadius: "5px",
            cursor: "pointer",
        });
        cancelButton.addEventListener("click", () => {
            this.closeShopMenu();
        });

        buttonRow.append(remainingButton, cancelButton);
        return buttonRow;
    }

}

export default ShopBehavior;
