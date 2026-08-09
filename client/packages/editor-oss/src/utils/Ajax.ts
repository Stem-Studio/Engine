/**
 * Module: Ajax.ts
 * Purpose: Small axios-compatible fetch wrapper used by editor/network code.
 */

import MIMETypeUtils from "./MIMETypeUtils";
import {getAuthProvider} from "../auth";
import global from "../global";

type AjaxResponseType = "arraybuffer" | "blob" | "document" | "json" | "text" | "stream";

export interface AjaxParams {
    url?: string;
    method?: string;
    data?: any;
    token?: string | null;
    msgBodyType?: "multipart" | "urlEncoded" | "json";
    usesApiKey?: boolean;
    needAuthorization?: boolean;
    signal?: AbortSignal;
    timeout?: number;
    expectedSize?: number;
    responseType?: AjaxResponseType;
}

export interface AjaxResponse<T = any> {
    data: T;
    status: number;
    statusText: string;
    headers: Record<string, any>;
    config: any;
    request?: any;
}

type AjaxRequestConfig = {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: BodyInit | null;
    signal?: AbortSignal;
    timeout: number;
    responseType?: AjaxResponseType;
    _retry?: boolean;
};

export class AjaxError<T = any> extends Error {
    isAxiosError = true;
    config: AjaxRequestConfig;
    request?: Request;
    response?: AjaxResponse<T>;

    constructor(message: string, config: AjaxRequestConfig, response?: AjaxResponse<T>, request?: Request) {
        super(message);
        this.name = "AjaxError";
        this.config = config;
        this.response = response;
        this.request = request;
    }
}

let refreshTokenPromise: Promise<string | null> | null = null;

/**
 * Resolve the auth token to attach to a request, falling back through explicit
 * token, app-managed token, and the current auth provider.
 * @param explicitToken Token supplied directly by the caller, used as-is when present.
 * @returns The resolved bearer token, or null when no token is available.
 */
async function resolveAuthToken(explicitToken?: string | null): Promise<string | null> {
    if (explicitToken) {
        return explicitToken;
    }

    const appToken = global.app?.authManager?.getAuthToken() ?? null;
    if (appToken) {
        return appToken;
    }

    const user = getAuthProvider().getCurrentUser();
    if (!user) {
        return null;
    }

    try {
        return await user.getIdToken();
    } catch {
        return null;
    }
}

/**
 * Force-refresh the ID token and propagate the new value to the app auth
 * manager. Concurrent callers share a single in-flight refresh.
 * @returns The refreshed token, or null when no user is signed in or refresh fails.
 */
async function refreshAuthToken(): Promise<string | null> {
    if (refreshTokenPromise) {
        return refreshTokenPromise;
    }

    refreshTokenPromise = (async () => {
        const user = getAuthProvider().getCurrentUser();
        if (!user) {
            return null;
        }

        try {
            const token = await user.getIdToken(true);
            global.app?.call("updateToken", null, token);
            global.app?.authManager.setAuthToken(token);
            return token;
        } catch {
            return null;
        } finally {
            refreshTokenPromise = null;
        }
    })();

    return refreshTokenPromise;
}

/**
 *
 */
function handleLoggedOut(): void {
    // The open-source app has no external login screen. A stray /api/* 401
    // should not navigate the user away from local work.
}

/**
 * Calculate dynamic timeout based on expected file size.
 * @param contentLength
 */
function calculateTimeout(contentLength?: number): number {
    if (!contentLength) return 90000;

    const baseTimeout = 90000;
    const sizeBasedTimeout = 5 * (contentLength / (1024 * 1024)) * 1000;
    const maxTimeout = 300000;

    return Math.min(baseTimeout + sizeBasedTimeout, maxTimeout);
}

function headersToObject(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
        result[key] = value;
    });
    return result;
}

function isRecord(value: unknown): value is Record<string, any> {
    return !!value && typeof value === "object";
}

function containsFileLike(data: unknown): data is Record<string, any> {
    if (!isRecord(data) || data instanceof FormData || data instanceof Blob) {
        return false;
    }

    return Object.values(data).some(value => value instanceof Blob || value instanceof File);
}

function appendFormValue(formData: FormData, name: string, value: any): void {
    if (value instanceof File) {
        formData.append(name, value);
    } else if (value instanceof Blob) {
        const extension = MIMETypeUtils.getExtension(value.type);
        const filename = "name" in value && typeof value.name === "string"
            ? value.name
            : `${name}.${extension}`;
        formData.append(name, value, filename);
    } else if (typeof value === "object" && value !== null) {
        formData.append(name, JSON.stringify(value));
    } else if (value !== undefined) {
        formData.append(name, String(value));
    }
}

function buildFormData(data: any): FormData {
    if (data instanceof FormData) {
        return data;
    }

    const formData = new FormData();
    if (!isRecord(data)) {
        return formData;
    }

    for (const name in data) {
        appendFormValue(formData, name, data[name]);
    }

    return formData;
}

function buildUrlEncodedBody(data: any, headers: Record<string, string>): string {
    if (typeof data === "string") {
        headers["Content-type"] = "application/x-www-form-urlencoded";
        return data;
    }

    const params = new URLSearchParams();
    if (isRecord(data)) {
        for (const name in data) {
            const value = data[name];
            if (value !== undefined) {
                params.append(name, String(value));
            }
        }
    }

    const body = params.toString();
    if (body.length) {
        headers["Content-type"] = "application/x-www-form-urlencoded";
    }
    return body;
}

function buildJsonBody(data: any, headers: Record<string, string>): string {
    headers["Content-type"] = "application/json";
    return typeof data === "string" ? data : JSON.stringify(data);
}

async function maybeCompressBody(body: BodyInit | null | undefined, headers: Record<string, string>) {
    if (typeof body !== "string" || body.length <= 1024) {
        return body;
    }

    if (typeof CompressionStream === "undefined") {
        return body;
    }

    headers["Content-Encoding"] = "gzip";
    const zippedData = await new Response(
        new Blob([body]).stream().pipeThrough(new CompressionStream("gzip")),
    ).blob();
    console.log(`API: compressing data: ${body.length} -> ${zippedData.size}`);
    return zippedData;
}

async function buildRequestBody(
    method: string,
    data: any,
    msgBodyType: AjaxParams["msgBodyType"],
    headers: Record<string, string>,
): Promise<BodyInit | null | undefined> {
    if (method === "GET" || data === null || data === undefined) {
        return undefined;
    }

    if (data instanceof FormData) {
        return data;
    }

    if (data instanceof Blob) {
        return data;
    }

    let body: BodyInit | null | undefined;
    if (containsFileLike(data) || msgBodyType === "multipart") {
        body = buildFormData(data);
    } else if (msgBodyType === "json") {
        body = buildJsonBody(data, headers);
    } else {
        body = buildUrlEncodedBody(data, headers);
    }

    return maybeCompressBody(body, headers);
}

function createTimeoutSignal(timeout: number, signal?: AbortSignal) {
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) {
        abort();
    } else if (signal) {
        signal.addEventListener("abort", abort, {once: true});
    }

    if (timeout > 0) {
        timeoutId = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), timeout);
    }

    return {
        signal: controller.signal,
        cleanup: () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            signal?.removeEventListener("abort", abort);
        },
    };
}

async function parseResponseData(response: Response, responseType?: AjaxResponseType): Promise<any> {
    if (response.status === 204) {
        return "";
    }

    if (responseType === "arraybuffer") {
        return response.arrayBuffer();
    }
    if (responseType === "blob") {
        return response.blob();
    }
    if (responseType === "text") {
        return response.text();
    }
    if (responseType === "stream") {
        return response.body;
    }

    const text = await response.text();
    if (!text) {
        return "";
    }

    const contentType = response.headers.get("content-type") || "";
    if (responseType === "json" || contentType.includes("application/json") || /^[\[{]/.test(text.trim())) {
        try {
            return JSON.parse(text);
        } catch {
            if (responseType === "json") {
                throw new Error("Failed to parse JSON response");
            }
        }
    }

    return text;
}

async function sendRequest(request: AjaxRequestConfig): Promise<AjaxResponse> {
    const timeoutSignal = createTimeoutSignal(request.timeout, request.signal);
    const fetchRequest = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: timeoutSignal.signal,
    });

    try {
        const response = await fetch(fetchRequest);
        const ajaxResponse: AjaxResponse = {
            data: await parseResponseData(response, request.responseType),
            status: response.status,
            statusText: response.statusText,
            headers: headersToObject(response.headers),
            config: request,
            request: fetchRequest,
        };

        if (!response.ok) {
            throw new AjaxError(
                `Request failed with status code ${response.status}`,
                request,
                ajaxResponse,
                fetchRequest,
            );
        }

        return ajaxResponse;
    } finally {
        timeoutSignal.cleanup();
    }
}

export const ajax = async (params: AjaxParams): Promise<AjaxResponse | undefined> => {
    const url = params.url || "";
    const method = params.method || "GET";
    const msgBodyType = params.msgBodyType ?? "urlEncoded";
    const usesApiKey = params.usesApiKey ?? false;
    const secure = params.needAuthorization ?? true;
    const token = await resolveAuthToken(params.token ?? null);

    const headers: Record<string, string> = {};
    if (!usesApiKey && token) {
        headers["Authorization"] = `Bearer ${token}`;
    }
    if (!usesApiKey && secure && !token) {
        throw new Error("Unauthorized ajax error");
    }

    const request: AjaxRequestConfig = {
        method,
        url,
        headers,
        signal: params.signal,
        timeout: params.timeout || calculateTimeout(params.expectedSize),
        responseType: params.responseType,
    };

    request.body = await buildRequestBody(method, params.data ?? null, msgBodyType, headers);

    try {
        return await sendRequest(request);
    } catch (error) {
        console.error("ERROR: API request failed");
        console.error(request);

        if (error instanceof AjaxError) {
            let msg = error.message;
            if (error.response) {
                msg = `${msg} with status code ${error.response.status}`;
            } else if (error.request) {
                msg = `${msg} because no response was received`;
            }

            console.error(`API failed : ${msg}`);

            if (error.response?.status === 401) {
                if (!request._retry) {
                    const refreshedToken = await refreshAuthToken();
                    if (refreshedToken) {
                        const retryRequest = {
                            ...request,
                            headers: {
                                ...(request.headers || {}),
                                Authorization: `Bearer ${refreshedToken}`,
                            },
                            _retry: true,
                        };

                        try {
                            return await sendRequest(retryRequest);
                        } catch (retryError) {
                            if (retryError instanceof AjaxError && retryError.response?.status === 401) {
                                handleLoggedOut();
                            }
                            throw retryError;
                        }
                    }
                }

                handleLoggedOut();
            }
        }

        throw error;
    }
};

export const post = async (params: AjaxParams): Promise<AjaxResponse | undefined> => {
    return ajax({...params, method: "POST"});
};

export const ajaxDelete = async (params: AjaxParams): Promise<AjaxResponse | undefined> => {
    return ajax({...params, method: "DELETE"});
};

export const put = async (params: AjaxParams): Promise<AjaxResponse | undefined> => {
    return ajax({...params, method: "PUT"});
};

export const get = async (params: AjaxParams): Promise<AjaxResponse | undefined> => {
    return ajax({...params, method: "GET"});
};

const Ajax = {
    request: ajax,
    get,
    post,
    put,
    ajaxDelete,
};

export default Ajax;
