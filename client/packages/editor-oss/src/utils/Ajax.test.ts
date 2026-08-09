import {afterEach, describe, expect, it, vi} from "vitest";

import Ajax from "./Ajax";

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("Ajax", () => {
    it("returns an axios-like JSON response and attaches the local auth token", async () => {
        const fetchMock = vi.fn(async (request: Request) => {
            expect(request.headers.get("Authorization")).toBe("Bearer stemstudio-token");
            return new Response(JSON.stringify({Code: 200, Data: {ok: true}}), {
                status: 200,
                headers: {"Content-Type": "application/json"},
            });
        });
        vi.stubGlobal("fetch", fetchMock);

        const response = await Ajax.get({url: "http://localhost/api/test"});

        expect(fetchMock).toHaveBeenCalledOnce();
        expect(response?.status).toBe(200);
        expect(response?.data).toEqual({Code: 200, Data: {ok: true}});
    });

    it("sends JSON request bodies without requiring auth when disabled", async () => {
        const fetchMock = vi.fn(async (request: Request) => {
            expect(request.headers.get("Content-type")).toBe("application/json");
            expect(await request.text()).toBe(JSON.stringify({name: "scene"}));
            return new Response("{}", {status: 200, headers: {"Content-Type": "application/json"}});
        });
        vi.stubGlobal("fetch", fetchMock);

        await Ajax.post({
            url: "http://localhost/api/test",
            data: {name: "scene"},
            msgBodyType: "json",
            needAuthorization: false,
        });

        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("throws axios-like errors with response data on non-2xx responses", async () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(JSON.stringify({message: "bad"}), {
                status: 400,
                statusText: "Bad Request",
                headers: {"Content-Type": "application/json"},
            })),
        );

        await expect(Ajax.get({
            url: "http://localhost/api/test",
            needAuthorization: false,
        })).rejects.toMatchObject({
            response: {
                status: 400,
                data: {message: "bad"},
            },
        });
    });
});
