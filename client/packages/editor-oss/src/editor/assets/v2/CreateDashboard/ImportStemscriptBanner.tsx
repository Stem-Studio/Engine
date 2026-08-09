import {useState} from "react";
import styled from "styled-components";

import type {StagedStemscriptImport} from "@stem/editor-oss/agent/script-tool/stemscriptImportStaging";
import {isFileSystemAccessSupported} from "@stem/editor-oss/persistence/fileSystemAccess";
import {importProjectBundleFiles} from "@stem/editor-oss/persistence/projectBundleImport";
import {openEditorRoute} from "../../../../v2/pages/editorHandoff";
import {generateProjectLink} from "../../../../v2/pages/links";

const Panel = styled.div`
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 14px 16px;
    background: rgba(16, 22, 36, 0.78);
    border: 1px solid rgba(160, 230, 170, 0.18);
    border-radius: 10px;
    color: #eef7ee;
    font-size: 12.5px;
    flex: 1 1 0;
    min-width: 0;
    backdrop-filter: blur(6px);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
    transition: border-color 120ms ease, box-shadow 120ms ease;
    &:hover {
        border-color: rgba(160, 230, 170, 0.32);
        box-shadow: 0 6px 22px rgba(0, 0, 0, 0.26);
    }
`;

const Icon = styled.div`
    flex: 0 0 32px;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(160, 230, 170, 0.16);
    color: #c4e8c4;
`;

const Body = styled.div`
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    flex: 1 1 auto;
`;

const Title = styled.div`
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: #c4e8c4;
    text-transform: uppercase;
`;

const Text = styled.span`
    line-height: 1.4;
    color: #eef7ee;
`;

const Action = styled.button`
    background: linear-gradient(180deg, #6fd07a 0%, #58b863 100%);
    color: #06121f;
    border: none;
    border-radius: 6px;
    padding: 6px 14px;
    font-weight: 600;
    cursor: pointer;
    font-size: 11.5px;
    align-self: flex-start;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    transition: filter 120ms ease, transform 80ms ease;
    &:hover:not(:disabled) {
        filter: brightness(1.08);
    }
    &:active:not(:disabled) {
        transform: translateY(1px);
    }
    &:disabled {
        opacity: 0.55;
        cursor: default;
    }
`;

const Actions = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
`;

const Hint = styled.span`
    opacity: 0.75;
    font-size: 11px;
`;

const MAX_FILES = 500;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

type FsFile = {kind: "file"; name: string; getFile(): Promise<File>};
type FsDir = {
    kind: "directory";
    name: string;
    entries(): AsyncIterableIterator<[string, FsFile | FsDir]>;
};

async function walkDirectory(dir: FsDir, prefix = ""): Promise<File[]> {
    const out: File[] = [];
    for await (const [name, handle] of dir.entries()) {
        if (name === ".DS_Store") continue;
        const relPath = prefix ? `${prefix}/${name}` : name;
        if (handle.kind === "file") {
            const file = await handle.getFile();
            try {
                Object.defineProperty(file, "webkitRelativePath", {value: relPath, configurable: true});
            } catch {
                // webkitRelativePath read-only in some engines; the path-based
                // import resolver falls back to basename matching.
            }
            out.push(file);
        } else if (handle.kind === "directory") {
            const children = await walkDirectory(handle, relPath);
            out.push(...children);
        }
        if (out.length > MAX_FILES) {
            throw new Error(`Folder contains more than ${MAX_FILES} files — refusing import.`);
        }
    }
    return out;
}

async function fileToBase64(file: File): Promise<string> {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
    }
    return btoa(binary);
}

function mimeFor(name: string): string {
    const lower = name.toLowerCase();
    if (lower.endsWith(".gltf")) return "model/gltf+json";
    if (lower.endsWith(".glb")) return "model/gltf-binary";
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".webp")) return "image/webp";
    if (lower.endsWith(".mp3")) return "audio/mpeg";
    if (lower.endsWith(".wav")) return "audio/wav";
    if (lower.endsWith(".ogg")) return "audio/ogg";
    if (lower.endsWith(".mp4")) return "video/mp4";
    if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "application/x-yaml";
    if (lower.endsWith(".json")) return "application/json";
    if (lower.endsWith(".md") || lower.endsWith(".txt") || lower.endsWith(".stemscript")) return "text/plain";
    return "application/octet-stream";
}

/**
 * Dashboard banner that lets a user import either an exported local project
 * bundle (`.stemscript.json` plus the matching sidecar asset folder) or an
 * existing stemscript-format game folder (a `.stemscript` file plus referenced
 * models / textures / audio). Project bundles are committed directly through
 * the active local ProjectStore. Legacy script folders keep using the
 * cross-navigation staged exec path.
 *
 * Companion files live alongside the stemscript and are matched by
 * relative path — same convention the Copilot terminal's exec builtin
 * uses today, so a folder that runs cleanly via `exec` here will run
 * cleanly through `exec` there.
 */
export const ImportStemscriptBanner = () => {
    const [supported] = useState<boolean>(() => isFileSystemAccessSupported());
    const [busy, setBusy] = useState(false);
    const [hint, setHint] = useState<string | null>(null);

    if (!supported) return null;

    const openProject = (projectId: string) => {
        openEditorRoute(generateProjectLink(projectId));
    };

    const importProjectFiles = async (files: File[]) => {
        let total = 0;
        for (const f of files) total += f.size;
        if (total > MAX_TOTAL_BYTES) {
            throw new Error(`Selection is ${(total / 1024 / 1024).toFixed(0)}MB — exceeds the ${(MAX_TOTAL_BYTES / 1024 / 1024).toFixed(0)}MB cap.`);
        }
        const result = await importProjectBundleFiles(files);
        openProject(result.meta.id);
    };

    const handleProjectFileClick = async () => {
        setBusy(true);
        setHint("Reading project file…");
        try {
            const picker = (window as unknown as {
                showOpenFilePicker?: (opts?: {
                    multiple?: boolean;
                    types?: Array<{description: string; accept: Record<string, string[]>}>;
                }) => Promise<Array<{getFile(): Promise<File>}>>;
            }).showOpenFilePicker;
            if (!picker) {
                setHint("File picker is not supported in this browser.");
                return;
            }
            const handles = await picker({
                multiple: false,
                types: [{
                    description: "StemStudio project",
                    accept: {"application/json": [".json"]},
                }],
            });
            const file = await handles[0]?.getFile();
            if (!file) {
                setHint("No project file selected.");
                return;
            }
            if (!file.name.toLowerCase().endsWith(".stemscript.json")) {
                setHint("Select a .stemscript.json project file.");
                return;
            }
            await importProjectFiles([file]);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (/AbortError|aborted|cancell?ed/i.test(message)) {
                setHint(null);
            } else {
                setHint(`Import failed: ${message}`);
            }
        } finally {
            setBusy(false);
        }
    };

    const handleFolderClick = async () => {
        setBusy(true);
        setHint("Reading folder…");
        try {
            const picker = (window as unknown as {
                showDirectoryPicker?: (opts?: {mode?: "read" | "readwrite"}) => Promise<unknown>;
            }).showDirectoryPicker;
            if (!picker) {
                setHint("File System Access is not supported in this browser.");
                return;
            }
            const dir = (await picker({mode: "read"})) as FsDir;
            const files = await walkDirectory(dir);
            if (files.some(f => ((f as File & {webkitRelativePath?: string}).webkitRelativePath || f.name).toLowerCase().endsWith(".stemscript.json"))) {
                await importProjectFiles(files);
                return;
            }
            const scriptFile = files.find(f =>
                ((f as File & {webkitRelativePath?: string}).webkitRelativePath || f.name).toLowerCase().endsWith(".stemscript"),
            );
            if (!scriptFile) {
                setHint("No .stemscript file found in that folder.");
                return;
            }
            let total = 0;
            for (const f of files) total += f.size;
            if (total > MAX_TOTAL_BYTES) {
                setHint(`Folder is ${(total / 1024 / 1024).toFixed(0)}MB — exceeds the ${(MAX_TOTAL_BYTES / 1024 / 1024).toFixed(0)}MB cap.`);
                return;
            }

            const scriptContent = await scriptFile.text();
            const companion = files.filter(f => f !== scriptFile);
            const staged: Omit<StagedStemscriptImport, "stagedAt"> = {
                content: scriptContent,
                label: dir.name,
                files: await Promise.all(
                    companion.map(async f => ({
                        name: (f as File & {webkitRelativePath?: string}).webkitRelativePath || f.name,
                        mime: mimeFor(f.name),
                        data: await fileToBase64(f),
                    })),
                ),
            };
            const {stageStemscriptImport} = await import("@stem/editor-oss/agent/script-tool/stemscriptImportStaging");
            const ok = await stageStemscriptImport(staged);
            if (!ok) {
                setHint("Could not stage import — local storage is unavailable.");
                return;
            }
            openEditorRoute(generateProjectLink(), {autoCreate: true});
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (/AbortError|aborted|cancell?ed/i.test(message)) {
                setHint(null);
            } else {
                setHint(`Import failed: ${message}`);
            }
        } finally {
            setBusy(false);
        }
    };

    return (
        <Panel role="status" data-testid="import-stemscript-banner">
            <Icon aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3v12" />
                    <path d="M7 10l5 5 5-5" />
                    <path d="M5 21h14" />
                </svg>
            </Icon>
            <Body>
                <Title>Import project</Title>
                <Text>
                    Bring in a local <code>.stemscript.json</code> project bundle, or a legacy <code>.stemscript</code> game folder.
                </Text>
                <Actions>
                    <Action
                        type="button"
                        onClick={handleProjectFileClick}
                        disabled={busy}
                        data-testid="import-project-file-button"
                    >
                        {busy ? "Importing…" : "Import project file"}
                    </Action>
                    <Action
                        type="button"
                        onClick={handleFolderClick}
                        disabled={busy}
                        data-testid="import-stemscript-button"
                    >
                        {busy ? "Importing…" : "Import project folder"}
                    </Action>
                </Actions>
                {hint && <Hint>{hint}</Hint>}
            </Body>
        </Panel>
    );
};
