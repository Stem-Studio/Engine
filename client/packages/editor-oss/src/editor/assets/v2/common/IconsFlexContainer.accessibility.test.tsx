import {afterEach, describe, expect, it, vi} from "vitest";
import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import type {ReactNode} from "react";

import {IconsFlexContainer} from "./IconsFlexContainer";

vi.mock("./Tooltip", () => ({
    Tooltip: ({children}: {children: ReactNode}) => <>{children}</>,
}));

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe("IconsFlexContainer accessibility", () => {
    it("exposes selectable assets and their non-hover actions as named buttons", () => {
        const onSelectItem = vi.fn();
        const onDelete = vi.fn();
        const onEdit = vi.fn();

        render(
            <IconsFlexContainer
                list={[{id: "cube-1", name: "Cube", text: "Cube"}]}
                onSelectItem={onSelectItem}
                onDelete={onDelete}
                onEdit={onEdit}
            />,
        );

        const assetButton = screen.getByRole("button", {name: "Cube"});
        expect(assetButton.getAttribute("aria-pressed")).toBe("false");
        expect(screen.getByRole("button", {name: "Delete Cube"})).toBeTruthy();
        expect(screen.getByRole("button", {name: "Edit Cube"})).toBeTruthy();

        fireEvent.click(assetButton);
        fireEvent.click(screen.getByRole("button", {name: "Delete Cube"}));
        fireEvent.click(screen.getByRole("button", {name: "Edit Cube"}));

        expect(onDelete).toHaveBeenCalledWith({id: "cube-1", name: "Cube"});
        expect(onEdit).toHaveBeenCalledWith({id: "cube-1", name: "Cube"});
    });

    it("uses the native disabled state for unavailable assets", () => {
        render(
            <IconsFlexContainer
                list={[{name: "Unavailable", text: "Unavailable", disabled: true}]}
                onSelectItem={vi.fn()}
            />,
        );

        expect((screen.getByRole("button", {name: "Unavailable"}) as HTMLButtonElement).disabled).toBe(true);
    });
});
