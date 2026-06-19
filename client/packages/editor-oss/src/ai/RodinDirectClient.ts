// Browser-direct Hyper3D Rodin client.
//
// In the public-site playground there is no Go `ai-server` to proxy model
// generation, so — as with Meshy — the browser calls the Rodin API directly
// with a BYOK key. This mirrors the subset of the Go server's Rodin wrapper
// that `ModelGeneratorProvider` needs.
//
// Rodin's task lifecycle uses three calls keyed off two identifiers (the task
// uuid for downloads, the subscription key for status), so this client packs
// both into the same composite `task_id` the Go path uses:
//   "<task_uuid>|<subscription_key>"
//
// NOTE: unlike Meshy, Rodin's CORS posture for browser origins is not formally
// documented. If the playground origin is blocked, generation surfaces a clear
// network error; desktop builds route through the Go server instead.

import {getBYOKKeyStore} from "./aiBackendFactory";

const RODIN_BASE_URL = "https://hyperhuman.deemos.com/api/v2";
const TASK_ID_SEPARATOR = "|";

/** Task shape consumed by `ModelGeneratorProvider.pollTaskStatus`. */
export type RodinTask = {
    id: string;
    status: string;
    progress: number;
    model?: string;
    error?: string;
};

export function encodeRodinTaskId(taskUUID: string, subscriptionKey: string): string {
    return `${taskUUID}${TASK_ID_SEPARATOR}${subscriptionKey}`;
}

export function decodeRodinTaskId(taskId: string): {taskUUID: string; subscriptionKey: string} {
    const idx = taskId.indexOf(TASK_ID_SEPARATOR);
    if (idx === -1) {
        return {taskUUID: taskId, subscriptionKey: ""};
    }
    return {taskUUID: taskId.slice(0, idx), subscriptionKey: taskId.slice(idx + 1)};
}

async function getRodinKey(): Promise<string> {
    const store = getBYOKKeyStore();
    const key = (await store?.get("rodin"))?.trim();
    if (!key) {
        throw new Error(
            "No Rodin API key configured. Add one via the AI provider key panel " +
                "to generate 3D models with Rodin in the playground.",
        );
    }
    return key;
}

/** Map Rodin's per-job status vocabulary to the unified poller vocabulary. */
function summarizeJobs(jobs: Array<{status?: string}>): {status: string; progress: number} {
    if (!jobs.length) return {status: "processing", progress: 0};
    let done = 0;
    for (const job of jobs) {
        const s = (job.status ?? "").trim().toLowerCase();
        if (s === "done" || s === "succeeded" || s === "success" || s === "completed") {
            done++;
        } else if (s === "failed" || s === "error" || s === "canceled" || s === "cancelled") {
            return {status: "failed", progress: 0};
        }
    }
    if (done === jobs.length) return {status: "completed", progress: 100};
    return {status: "processing", progress: Math.floor((done * 100) / jobs.length)};
}

function selectModelUrl(list: Array<{name?: string; url?: string}>): string | undefined {
    let gltf: string | undefined;
    for (const f of list) {
        const name = (f.name ?? "").toLowerCase();
        if (name.endsWith(".glb")) return f.url;
        if (name.endsWith(".gltf") && !gltf) gltf = f.url;
    }
    return gltf;
}

/**
 * Browser-direct equivalent of the Go server's Rodin object-generation
 * endpoints. Every method resolves the BYOK key fresh so a key added after the
 * editor loaded is picked up without a reload.
 */
export const RodinDirectClient = {
    /** Create a text-to-3D task. `payload` carries at least `{prompt}`. */
    async generate(payload: Record<string, unknown>): Promise<{task_id: string}> {
        const apiKey = await getRodinKey();
        const prompt = String(payload.prompt ?? "").trim();
        if (!prompt) throw new Error("A text prompt is required for Rodin generation.");

        const form = new FormData();
        form.append("prompt", prompt);
        form.append("tier", String(payload.tier ?? "Regular"));
        form.append("quality", String(payload.quality ?? "medium"));
        form.append("material", String(payload.material ?? "PBR"));
        form.append("geometry_file_format", "glb");

        const res = await fetch(`${RODIN_BASE_URL}/rodin`, {
            method: "POST",
            headers: {Authorization: `Bearer ${apiKey}`, Accept: "application/json"},
            body: form,
        });
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(`Rodin generate failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
        }
        const body = (await res.json()) as {
            uuid?: string;
            jobs?: {subscription_key?: string};
            error?: string;
        };
        if (body.error) throw new Error(`Rodin generate error: ${body.error}`);
        const taskUUID = body.uuid;
        const subscriptionKey = body.jobs?.subscription_key;
        if (!taskUUID || !subscriptionKey) {
            throw new Error("Rodin generate returned no task uuid / subscription key");
        }
        return {task_id: encodeRodinTaskId(taskUUID, subscriptionKey)};
    },

    /** Poll a Rodin task; resolves the GLB url once every job is done. */
    async fetchTask(taskId: string): Promise<RodinTask> {
        const apiKey = await getRodinKey();
        const {taskUUID, subscriptionKey} = decodeRodinTaskId(taskId);
        if (!subscriptionKey) {
            throw new Error(`Invalid Rodin task id (missing subscription key): ${taskId}`);
        }

        const statusRes = await fetch(`${RODIN_BASE_URL}/status`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                Accept: "application/json",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({subscription_key: subscriptionKey}),
        });
        if (!statusRes.ok) throw new Error(`Rodin status fetch failed (HTTP ${statusRes.status})`);
        const statusBody = (await statusRes.json()) as {jobs?: Array<{status?: string}>; error?: string};
        const {status, progress} = summarizeJobs(statusBody.jobs ?? []);

        const task: RodinTask = {id: taskId, status, progress, error: statusBody.error};
        if (status !== "completed") return task;

        const downloadRes = await fetch(`${RODIN_BASE_URL}/download`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                Accept: "application/json",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({task_uuid: taskUUID}),
        });
        if (!downloadRes.ok) throw new Error(`Rodin download fetch failed (HTTP ${downloadRes.status})`);
        const downloadBody = (await downloadRes.json()) as {list?: Array<{name?: string; url?: string}>};
        const model = selectModelUrl(downloadBody.list ?? []);
        if (!model) throw new Error("Rodin task produced no GLB/GLTF output");
        task.model = model;
        return task;
    },
};
