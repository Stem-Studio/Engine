#!/usr/bin/env node
/** Minimal production-preview server for the multi-entry Vite output. */
import {createReadStream, existsSync, statSync} from "node:fs";
import {createServer} from "node:http";
import {extname, join, normalize, resolve} from "node:path";
import {pipeline} from "node:stream/promises";

const root = resolve(process.env.BUILD_ROOT || process.argv[2] || "build/public");
const port = Number(process.env.PORT || process.argv[3] || 5184);
const host = process.env.HOST || "127.0.0.1";
const mime = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".wasm": "application/wasm",
};

const routeFallback = pathname => {
    if (
        pathname === "/" ||
        pathname.startsWith("/playground") ||
        pathname.startsWith("/docs")
    ) return "/index.html";
    if (pathname.startsWith("/dashboard") || pathname.startsWith("/login")) return "/packages/marketing/index.html";
    if (pathname.startsWith("/create/project/") || pathname.startsWith("/stem-editor/")) return "/packages/editor/editor.html";
    if (pathname.startsWith("/play/")) return "/packages/play/play.html";
    return "/404.html";
};

const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const decoded = decodeURIComponent(url.pathname);
    const relative = normalize(decoded).replace(/^([.][.][/\\])+/, "");
    let filePath = resolve(join(root, relative));
    if (!filePath.startsWith(root) || !existsSync(filePath) || !statSync(filePath).isFile()) {
        filePath = resolve(join(root, routeFallback(decoded)));
    }
    if (!filePath.startsWith(root) || !existsSync(filePath) || !statSync(filePath).isFile()) {
        response.writeHead(404);
        response.end();
        return;
    }
    response.writeHead(200, {"Content-Type": mime[extname(filePath).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache"});
    if (request.method === "HEAD") {
        response.end();
        return;
    }
    await pipeline(createReadStream(filePath), response).catch(() => response.destroy());
});

server.listen(port, host, () => console.log(`Build preview: http://${host}:${port}/ (root ${root})`));
