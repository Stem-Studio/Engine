import {render} from "@testing-library/react";
import {describe, expect, it} from "vitest";

import {MyAvatarsView} from "./MyAvatarsView";

describe("MyAvatarsView in the OSS build", () => {
    it("renders nothing because hosted avatar management is unsupported", () => {
        const {container} = render(<MyAvatarsView />);

        expect(container).toBeEmptyDOMElement();
    });
});
