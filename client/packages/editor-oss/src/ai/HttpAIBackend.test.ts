import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {InMemoryBYOKKeyStore} from "./BYOKKeyStore";
import {HttpAIBackend} from "./HttpAIBackend";

const ORIGIN = "http://localhost";

describe("HttpAIBackend.capabilities", () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchSpy = vi.fn(async () =>
            new Response(JSON.stringify({buildMode: "oss", providers: {}}), {
                status: 200,
                headers: {"content-type": "application/json"},
            }),
        );
        vi.stubGlobal("fetch", fetchSpy);
        vi.stubGlobal("window", {location: {origin: ORIGIN}});
    });

    afterEach(() => vi.unstubAllGlobals());

    it("fetches GET /api/AI/Capabilities and returns parsed JSON", async () => {
        const backend = new HttpAIBackend();
        const result = await backend.capabilities();

        expect(fetchSpy).toHaveBeenCalledWith(`${ORIGIN}/api/AI/Capabilities`, expect.objectContaining({method: "GET"}));
        expect(result.buildMode).toBe("oss");
    });

    it("memoizes the result across calls (no re-fetch without forceRefresh)", async () => {
        const backend = new HttpAIBackend();
        await backend.capabilities();
        await backend.capabilities();
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("forces a re-fetch when forceRefresh=true", async () => {
        const backend = new HttpAIBackend();
        await backend.capabilities();
        await backend.capabilities(true);
        expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
});

describe("HttpAIBackend.setProviderKey", () => {
    let fetchSpy: ReturnType<typeof vi.fn>;
    let keyStore: InMemoryBYOKKeyStore;

    beforeEach(() => {
        fetchSpy = vi.fn(async () => new Response("{}", {status: 200}));
        vi.stubGlobal("fetch", fetchSpy);
        vi.stubGlobal("window", {location: {origin: ORIGIN}});
        keyStore = new InMemoryBYOKKeyStore();
    });

    afterEach(() => vi.unstubAllGlobals());

    it("stores the key client-side and POSTs to /api/AI/ConfigureKeys", async () => {
        const backend = new HttpAIBackend({keyStore});
        const ok = await backend.setProviderKey("anthropic", "sk-test");

        expect(ok).toBe(true);
        expect(await keyStore.get("anthropic")).toBe("sk-test");
        expect(fetchSpy).toHaveBeenCalledWith(
            `${ORIGIN}/api/AI/ConfigureKeys`,
            expect.objectContaining({
                method: "POST",
                body: JSON.stringify({provider: "anthropic", key: "sk-test"}),
            }),
        );
    });

    it("rejects empty keys", async () => {
        const backend = new HttpAIBackend({keyStore});
        const ok = await backend.setProviderKey("anthropic", "   ");
        expect(ok).toBe(false);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns false when there is no key store", async () => {
        const backend = new HttpAIBackend();
        const ok = await backend.setProviderKey("anthropic", "sk-test");
        expect(ok).toBe(false);
    });

    it("clears the client key and posts an empty key to reset the server BYOK session", async () => {
        await keyStore.set("anthropic", "sk-test");
        const backend = new HttpAIBackend({keyStore});

        await backend.clearProviderKey("anthropic");

        expect(await keyStore.get("anthropic")).toBeUndefined();
        expect(fetchSpy).toHaveBeenCalledWith(
            `${ORIGIN}/api/AI/ConfigureKeys`,
            expect.objectContaining({
                method: "POST",
                body: JSON.stringify({provider: "anthropic", key: ""}),
            }),
        );
    });
});

describe("HttpAIBackend.request BYOK header forwarding", () => {
    let fetchSpy: ReturnType<typeof vi.fn>;
    let keyStore: InMemoryBYOKKeyStore;

    beforeEach(() => {
        fetchSpy = vi.fn(async () => new Response("{}", {status: 200, headers: {"content-type": "application/json"}}));
        vi.stubGlobal("fetch", fetchSpy);
        vi.stubGlobal("window", {location: {origin: ORIGIN}});
        keyStore = new InMemoryBYOKKeyStore();
    });

    afterEach(() => vi.unstubAllGlobals());

    it("attaches X-BYOK-Key header when caller hints a provider with a stored key", async () => {
        await keyStore.set("anthropic", "stored-key");
        const backend = new HttpAIBackend({keyStore});

        await backend.request("/api/AI/Agent", {
            method: "POST",
            headers: {"X-BYOK-Provider": "anthropic"},
            body: {prompt: "hi"},
        });

        const callArg = fetchSpy.mock.calls[0]![1] as {headers: Record<string, string>};
        expect(callArg.headers["X-BYOK-Key"]).toBe("stored-key");
        expect(callArg.headers["X-BYOK-Provider"]).toBe("anthropic");
    });

    it("does not attach BYOK header when caller does not hint a provider", async () => {
        await keyStore.set("anthropic", "stored-key");
        const backend = new HttpAIBackend({keyStore});

        await backend.request("/api/AI/Agent", {method: "POST", body: {}});

        const callArg = fetchSpy.mock.calls[0]![1] as {headers: Record<string, string>};
        expect(callArg.headers["X-BYOK-Key"]).toBeUndefined();
    });

    it("respects an explicit X-BYOK-Key passed by caller (does not overwrite)", async () => {
        await keyStore.set("anthropic", "stored-key");
        const backend = new HttpAIBackend({keyStore});

        await backend.request("/api/AI/Agent", {
            method: "POST",
            headers: {"X-BYOK-Provider": "anthropic", "X-BYOK-Key": "explicit-key"},
            body: {},
        });

        const callArg = fetchSpy.mock.calls[0]![1] as {headers: Record<string, string>};
        expect(callArg.headers["X-BYOK-Key"]).toBe("explicit-key");
    });
});
