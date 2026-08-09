import {afterEach, describe, expect, it} from "vitest";
import {cleanup, render, screen} from "@testing-library/react";

import {Tooltip} from "./Tooltip";

afterEach(cleanup);

describe("Tooltip accessibility", () => {
    it("names its interactive trigger from the tooltip text", () => {
        render(
            <Tooltip text="Project setting help">
                <span>?</span>
            </Tooltip>,
        );

        expect(screen.getByRole("button", {name: "Project setting help"})).toBeTruthy();
    });
});
