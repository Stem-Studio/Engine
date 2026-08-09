import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {
    createBackendAdapter,
    getBackendAdapter,
    isLocalBackendMode,
} from "./adapter";

describe("backend adapter selection", () => {
    beforeEach(() => {
        window.history.replaceState({}, "", "/dashboard");
        window.localStorage.clear();
        window.sessionStorage.clear();
        delete window.__STEM_BACKEND_ADAPTER__;
        vi.stubEnv("REACT_ENGINE_BACKEND_MODE", "");
        vi.stubEnv("REACT_ENGINE_LOCAL_BACKEND_URL", "");
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it("defaults OSS browser sessions to the same-origin local adapter", () => {
        expect(createBackendAdapter("editor")).toEqual({
            mode: "local",
            entrypoint: "editor",
            server: window.location.origin,
        });
        expect(isLocalBackendMode()).toBe(true);
        expect(getBackendAdapter()?.mode).toBe("local");
    });

    it("keeps Playground local despite stale remote storage or deployment env", () => {
        window.history.replaceState({}, "", "/dashboard?mode=playground");
        window.localStorage.setItem("stem.backend.mode", "remote");
        vi.stubEnv("REACT_ENGINE_BACKEND_MODE", "remote");

        expect(createBackendAdapter("editor")).toEqual({
            mode: "local",
            entrypoint: "editor",
            server: window.location.origin,
        });

        // Playground mode is intentionally sticky across its hard navigations.
        window.history.replaceState({}, "", "/create/project/local-project");
        delete window.__STEM_BACKEND_ADAPTER__;
        expect(createBackendAdapter("editor").mode).toBe("local");
    });

    it("allows an explicit remote query as an opt-in in supported deployments", () => {
        window.history.replaceState({}, "", "/dashboard?mode=playground&backend=remote");

        expect(createBackendAdapter("play")).toEqual({
            mode: "remote",
            entrypoint: "play",
            server: window.location.origin,
        });
        expect(window.localStorage.getItem("stem.backend.mode")).toBe("remote");
    });

    it("preserves the explicit local Node backend fallback", () => {
        window.history.replaceState({}, "", "/dashboard?backend=local");

        expect(createBackendAdapter("editor")).toEqual({
            mode: "local",
            entrypoint: "editor",
            server: `${window.location.protocol}//${window.location.hostname}:3030`,
        });
    });

    it("honors same-origin and explicit loopback local backend URLs", () => {
        window.history.replaceState(
            {},
            "",
            "/dashboard?backend=local&localBackendUrl=%2Fapi",
        );
        expect(createBackendAdapter("editor").server).toBe(window.location.origin);

        window.history.replaceState(
            {},
            "",
            "/dashboard?backend=local&localBackendUrl=http%3A%2F%2F127.0.0.8%3A4040%2Fapi",
        );
        expect(createBackendAdapter("editor").server).toBe("http://127.0.0.8:4040");
    });

    it.each([
        "javascript:alert(1)",
        "data:text/plain,attacker",
        "//attacker.example/api",
        "//localhost:4040/api",
        "https://attacker.example/api",
        "https://user:secret@attacker.example/api",
    ])("rejects unsafe local backend URL %s", candidate => {
        window.history.replaceState(
            {},
            "",
            `/dashboard?backend=local&localBackendUrl=${encodeURIComponent(candidate)}`,
        );

        expect(createBackendAdapter("editor").server).toBe(
            `${window.location.protocol}//${window.location.hostname}:3030`,
        );
    });

    it("boots when browser storage is denied", () => {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new DOMException("denied", "SecurityError");
        });
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new DOMException("denied", "SecurityError");
        });
        window.history.replaceState({}, "", "/dashboard?mode=playground");

        expect(() => createBackendAdapter("editor")).not.toThrow();
        expect(createBackendAdapter("editor").mode).toBe("local");

        window.history.replaceState({}, "", "/dashboard?backend=remote");
        expect(() => createBackendAdapter("editor")).not.toThrow();
        expect(createBackendAdapter("editor").mode).toBe("remote");
    });

    it("boots without window for default-local and explicit-remote environments", () => {
        vi.stubGlobal("window", undefined);

        expect(createBackendAdapter("editor")).toEqual({
            mode: "local",
            entrypoint: "editor",
            server: "",
        });
        expect(getBackendAdapter()).toBeNull();
        expect(isLocalBackendMode()).toBe(true);

        vi.stubEnv("REACT_ENGINE_BACKEND_MODE", "remote");
        expect(createBackendAdapter("play")).toEqual({
            mode: "remote",
            entrypoint: "play",
            server: "",
        });
    });
});
