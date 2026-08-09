import {APP_MENU_ITEM} from "./AppMenu";

describe("AppMenu export copy", () => {
    it("labels the JSON artifact as scene source rather than a standalone game", () => {
        expect(APP_MENU_ITEM.EXPORT_SCENE_SOURCE).toBe("Export Scene Source (.json)");
        expect(Object.values(APP_MENU_ITEM)).not.toContain("Export Game");
    });
});
