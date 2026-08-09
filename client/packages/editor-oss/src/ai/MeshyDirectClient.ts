// Browser-direct Meshy client.
//
// In the public-site playground there is no Go `ai-server` to proxy model
// generation. Meshy's API (`api.meshy.ai`) sends permissive CORS headers, so
// the browser can call it directly with a BYOK key. This client mirrors the
// subset of the Go server's Meshy wrapper that `ModelGeneratorProvider` needs.
//
// The desktop editor can use the Go server; this client is reached on the
// playground code path where no local server is available.

import {getBYOKKeyStore} from "./aiBackendFactory";

const MESHY_V2 = "https://api.meshy.ai/openapi/v2";
const MESHY_V1 = "https://api.meshy.ai/openapi/v1";

/** Task shape consumed by `ModelGeneratorProvider.pollTaskStatus`. */
export type MeshyTask = {
    id: string;
    status: string;
    progress: number;
    model?: string;
    thumbnail?: string;
    error?: string;
};

async function getMeshyKey(): Promise<string> {
    const store = getBYOKKeyStore();
    const key = (await store?.get("meshy"))?.trim();
    if (!key) {
        throw new Error(
            "No Meshy API key configured. Add one via the AI provider key panel " +
                "to generate 3D models in the playground.",
        );
    }
    return key;
}

async function meshyFetch(
    url: string,
    init: {method: "GET" | "POST"; apiKey: string; body?: unknown},
): Promise<Response> {
    return fetch(url, {
        method: init.method,
        headers: {
            Authorization: `Bearer ${init.apiKey}`,
            Accept: "application/json",
            ...(init.body !== undefined ? {"Content-Type": "application/json"} : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
}

async function readResultId(res: Response, context: string): Promise<string> {
    // Meshy returns 202 Accepted for create calls; 200 is also tolerated.
    if (res.status !== 202 && res.status !== 200) {
        const text = await res.text().catch(() => "");
        throw new Error(`Meshy ${context} failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
    }
    const body = (await res.json()) as {result?: string};
    if (!body.result) throw new Error(`Meshy ${context} returned no task id`);
    return body.result;
}

/**
 * Browser-direct equivalent of the Go server's Meshy object-generation
 * endpoints. Every method resolves the BYOK key fresh so a key added after
 * the editor loaded is picked up without a reload.
 */
export const MeshyDirectClient = {
    /** Create a text-to-3D / image-to-3D preview task. `payload` is the body. */
    async generate(payload: Record<string, unknown>): Promise<{task_id: string}> {
        const apiKey = await getMeshyKey();
        const res = await meshyFetch(`${MESHY_V2}/text-to-3d`, {method: "POST", apiKey, body: payload});
        return {task_id: await readResultId(res, "generate")};
    },

    /** Promote a preview task to a refined (textured) model. */
    async refine(previewTaskId: string): Promise<{task_id: string}> {
        const apiKey = await getMeshyKey();
        const res = await meshyFetch(`${MESHY_V2}/text-to-3d`, {
            method: "POST",
            apiKey,
            body: {mode: "refine", preview_task_id: previewTaskId, target_formats: ["glb"]},
        });
        return {task_id: await readResultId(res, "refine")};
    },

    /** Auto-rig a generated model. */
    async rig(inputTaskId: string): Promise<{task_id: string}> {
        const apiKey = await getMeshyKey();
        const res = await meshyFetch(`${MESHY_V1}/rigging`, {
            method: "POST",
            apiKey,
            body: {input_task_id: inputTaskId, height_meters: 1.7},
        });
        return {task_id: await readResultId(res, "rig")};
    },

    /** Poll a text-to-3D task. */
    async fetchTask(taskId: string): Promise<MeshyTask> {
        const apiKey = await getMeshyKey();
        const res = await meshyFetch(`${MESHY_V2}/text-to-3d/${encodeURIComponent(taskId)}`, {
            method: "GET",
            apiKey,
        });
        if (!res.ok) throw new Error(`Meshy task fetch failed (HTTP ${res.status})`);
        const body = (await res.json()) as {
            id: string;
            status: string;
            progress?: number;
            model_urls?: {glb?: string};
            thumbnail_url?: string;
            task_error?: {message?: string};
        };
        return {
            id: body.id,
            status: body.status,
            progress: body.progress ?? 0,
            model: body.model_urls?.glb,
            thumbnail: body.thumbnail_url,
            error: body.task_error?.message,
        };
    },

    /** Poll a rigging task (v1 API, different response shape). */
    async fetchRigTask(taskId: string): Promise<MeshyTask> {
        const apiKey = await getMeshyKey();
        const res = await meshyFetch(`${MESHY_V1}/rigging/${encodeURIComponent(taskId)}`, {
            method: "GET",
            apiKey,
        });
        if (!res.ok) throw new Error(`Meshy rig task fetch failed (HTTP ${res.status})`);
        const body = (await res.json()) as {
            id: string;
            status: string;
            progress?: number;
            result?: {rigged_character_glb_url?: string};
        };
        return {
            id: body.id,
            status: body.status,
            progress: body.progress ?? 0,
            model: body.result?.rigged_character_glb_url,
        };
    },
};
