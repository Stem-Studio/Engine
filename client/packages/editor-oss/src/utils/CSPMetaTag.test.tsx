import {render} from "@testing-library/react";
import {describe, expect, it} from "vitest";

import CSPMetaTag, {
    customCSPPolicies,
    DIRECT_AI_PROVIDER_CONNECT_SOURCES,
    PASCAL_ASSET_CONNECT_SOURCES,
} from "./CSPMetaTag";

describe("CSPMetaTag", () => {
    it("allows direct playground copilot provider connections", () => {
        render(<CSPMetaTag customPolicies={customCSPPolicies} />);

        const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
        expect(meta).toBeTruthy();
        const content = meta?.getAttribute("content") ?? "";

        for (const source of DIRECT_AI_PROVIDER_CONNECT_SOURCES) {
            expect(content).toContain(source);
        }
        for (const source of PASCAL_ASSET_CONNECT_SOURCES) {
            expect(content).toContain(source);
        }
    });
});
