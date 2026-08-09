import { useCallback, useEffect, useRef, useState } from "react";

import { CommandsExecutor } from "@stem/editor-oss/agent/CommandsExecutor";
import { CommandsRegistry } from "@stem/editor-oss/agent/CommandsRegistry";
import {
  executeBuiltin,
  BuiltinContext,
  TerminalResult,
} from "@stem/editor-oss/agent/script-tool/builtins";
import {
  formatCheckReport,
  runScriptCheck,
} from "@stem/editor-oss/agent/script-tool/checkScript";
import {
  showBatchImportDialog,
  autoResolveImports,
} from "@stem/editor-oss/agent/script-tool/ImportBatchDialog";
import type { AutoResolveResult } from "@stem/editor-oss/agent/script-tool/ImportBatchDialog";
import {
  handleImport,
  processImportedFile,
} from "@stem/editor-oss/agent/script-tool/importHandler";
import {
  ScriptCommandParser,
  ParsedCommand,
} from "@stem/editor-oss/agent/script-tool/ScriptCommandParser";
import { ScriptExecutor } from "@stem/editor-oss/agent/script-tool/ScriptExecutor";
import { beginScriptImportActivity } from "@stem/editor-oss/agent/script-tool/scriptImportActivity";
import {
  consumeStemscriptImport,
  peekStemscriptImport,
} from "@stem/editor-oss/agent/script-tool/stemscriptImportStaging";
import type { ReadonlyAssetResolutionContext } from "@stem/editor-oss/asset-management/AssetResolutionContext";
import type { ScriptImportRevisionMap } from "@stem/editor-oss/script-runtime/scriptImportCore";
import { saveScene } from "@stem/network/api/scene";
import { refreshEditorAssets } from "../../../../../editor/asset-management/hooks/assets";
import type EngineRuntime from "@stem/editor-oss/EngineRuntime";
import global from "@stem/editor-oss/global";
import { queryClient } from "@web-shared/queryClient";
import {
  showToast,
  showLoadingToast,
  dismissToast,
} from "@stem/editor-oss/showToast";
import { traverseObjectDepthFirst } from "@stem/editor-oss/utils/SceneTraverser";
import { collectSceneObjectAudit } from "./sceneAudit";

const DEFAULT_EXTENSION_BY_TYPE: Record<string, string> = {
  model: ".glb",
  image: ".png",
  audio: ".mp3",
  sound: ".mp3",
  video: ".mp4",
};

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

const getEngineRuntime = (): EngineRuntime | undefined =>
  global.app as EngineRuntime | undefined;

/**
 * Per-import safety ceiling. A single asset/behavior import that stalls
 * indefinitely would hang the entire stemscript run with no surfaced error.
 * Generous enough that a heavy model (FBX → GLB conversion + texture bake) or a
 * behavior revision completes well within it; short enough that a true hang
 * fails the run in seconds, not the 20-minute outer ceiling.
 */
const IMPORT_STEP_TIMEOUT_MS = 90_000;
const BEHAVIOR_IMPORT_CONCURRENCY = 4;

/**
 * Race a single import against {@link IMPORT_STEP_TIMEOUT_MS}. On timeout, the
 * import is reported as a failed result (so the run's failCount reflects it and
 * the named culprit is logged) and the loop continues with the next import —
 * the run never silently spins forever on one stuck import.
 */
async function withImportTimeout(
  work: Promise<{ success: boolean; message: string }>,
  label: string,
): Promise<{ success: boolean; message: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ success: boolean; message: string }>(
    (resolve) => {
      timer = setTimeout(() => {
        const message = `Import "${label}" timed out after ${IMPORT_STEP_TIMEOUT_MS}ms — skipped so the run can continue. This import hangs; it needs investigation.`;
        console.error(`[import-timeout] ${message}`);
        resolve({ success: false, message });
      }, IMPORT_STEP_TIMEOUT_MS);
    },
  );
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runImportTaskPool(
  tasks: Array<() => Promise<void>>,
  concurrency: number,
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, tasks.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < tasks.length) {
      const task = tasks[nextIndex++]!;
      await task();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  });

  await Promise.all(workers);
}

function recordImportTiming(entry: {
  type: string;
  label: string;
  ms: number;
  success: boolean;
  message?: string;
}): void {
  const root = globalThis as typeof globalThis & {
    __stemImportTimings?: Array<typeof entry>;
  };

  root.__stemImportTimings ??= [];
  root.__stemImportTimings.push(entry);
}

function flushDeferredBehaviorImportSync(): void {
  const app = getEngineRuntime();
  const editor = app?.editor;
  const scene = app?.scene ?? editor?.scene;
  if (!editor || !scene) return;

  editor.syncSceneBehaviorConfigs();
  app?.call?.("objectChanged", null, scene);
}

/**
 * Programmatic result of a full `runScript` pass. `failCount > 0` means at
 * least one command (including an unresolved import) failed — the run was NOT
 * clean. Surfaced through `window.__stemRunScript` so a test harness can assert
 * a complete, error-free import instead of inferring it from console scraping.
 */
export type ScriptRunSummary = {
  executedCommands: number;
  successCount: number;
  failCount: number;
};

/**
 * Derive a usable filename from a URL, preserving the extension when present.
 * @param url
 * @param type
 * @param name
 */
function filenameForUrlImport(
  url: string,
  type: string,
  name?: string,
): string {
  try {
    const parsed = new URL(
      url,
      typeof window !== "undefined" ? window.location.href : undefined,
    );
    const last = parsed.pathname.split("/").filter(Boolean).pop() || "";
    if (last && /\.[a-z0-9]+$/i.test(last)) {
      return last;
    }
  } catch {
    // fall through to synthetic filename
  }
  const base = name || type || "asset";
  return `${base}${DEFAULT_EXTENSION_BY_TYPE[type] || ""}`;
}

/**
 *
 * @param filename
 */
function inferContentType(filename: string): string {
  const match = filename.match(/\.[a-z0-9]+$/i);
  if (!match) return "";
  return CONTENT_TYPE_BY_EXT[match[0].toLowerCase()] || "";
}

export interface TerminalHistoryEntry {
  command: string;
  result: string;
  status: "success" | "error" | "info";
  format?: "text" | "markdown";
  timestamp: number;
}

export interface UseTerminalReturn {
  history: TerminalHistoryEntry[];
  commandBuffer: string[];
  isExecuting: boolean;
  executeInput: (input: string) => Promise<TerminalHistoryEntry[]>;
  clearHistory: () => void;
  historyIndex: number;
  navigateHistory: (direction: "up" | "down") => string | null;
}

export interface UseTerminalOptions {
  isAdmin?: boolean;
}

/**
 *
 * @param onExit
 * @param options
 */
export function useTerminal(
  onExit: () => void,
  options: UseTerminalOptions = {},
): UseTerminalReturn {
  const [history, setHistory] = useState<TerminalHistoryEntry[]>([]);
  const [commandBuffer, setCommandBuffer] = useState<string[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const registryRef = useRef<CommandsRegistry | null>(null);
  const executorRef = useRef<CommandsExecutor | null>(null);
  const importResultsRef = useRef<Map<
    number,
    { success: boolean; message: string }
  > | null>(null);
  const importCounterRef = useRef(0);
  const executionCollectorRef = useRef<TerminalHistoryEntry[] | null>(null);
  const lastScriptRef = useRef<{ content: string; label?: string } | null>(
    null,
  );

  const getExecutor = useCallback(() => {
    if (!executorRef.current) {
      registryRef.current = new CommandsRegistry();
      executorRef.current = new CommandsExecutor(registryRef.current);
    }
    return executorRef.current;
  }, []);

  const addEntry = useCallback(
    (
      command: string,
      result: string,
      status: "success" | "error" | "info",
      format: "text" | "markdown" = "text",
    ) => {
      const entry: TerminalHistoryEntry = {
        command,
        result,
        status,
        format,
        timestamp: Date.now(),
      };
      executionCollectorRef.current?.push(entry);
      setHistory((prev) => [...prev, entry]);
    },
    [],
  );

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  const executeRegistryCommand = useCallback(
    async (command: string, params: Record<string, unknown>) => {
      const executor = getExecutor();
      const result = await executor.executeCommand(command, params);
      const commandStatus = result.result?.status;
      const success =
        result.success &&
        commandStatus !== "failed" &&
        commandStatus !== "error";
      return {
        success,
        message: result.result?.message || (result.success ? "OK" : undefined),
        error: result.error || (!success ? result.result?.message : undefined),
      };
    },
    [getExecutor],
  );

  const executeGetterCommand = useCallback(
    async (command: string, params: Record<string, unknown>) => {
      const executor = getExecutor();
      const result = await executor.executeCommand(command, params);
      const commandStatus = result.result?.status;
      const success =
        result.success &&
        commandStatus !== "failed" &&
        commandStatus !== "error";
      return {
        success,
        data: result.result?.data,
        message: result.result?.message,
        error: result.error || (!success ? result.result?.message : undefined),
      };
    },
    [getExecutor],
  );

  const runCheck = useCallback(
    async (content: string, label?: string): Promise<TerminalResult> => {
      const report = await runScriptCheck(content, executeGetterCommand);
      const heading = label ? `Checked ${label}.\n\n` : "";
      return {
        output: `${heading}${formatCheckReport(report)}`,
        status: report.failed > 0 ? "error" : "success",
        format: "markdown",
      };
    },
    [executeGetterCommand],
  );

  const executeScriptBuiltin = useCallback(
    async (command: string, params: Record<string, unknown>) => {
      if (command === "import") {
        const type = params.type as string | undefined;
        const name = params.name as string | undefined;
        const message = params.message as string | undefined;
        const url = params.url as string | undefined;
        if (!type) return { success: false, error: "import requires a type" };

        // Use pre-processed results from runScript when available
        const cachedResults = importResultsRef.current;
        if (cachedResults) {
          const idx = importCounterRef.current++;
          const cached = cachedResults.get(idx);
          if (cached) {
            return {
              success: cached.success,
              message: cached.message,
              error: cached.success ? undefined : cached.message,
            };
          }
          const label = name || (message ? `${type} (${message})` : type);
          return { success: true, message: `Import skipped: ${label}` };
        }

        if (!getEngineRuntime()?.editor?.assetSource)
          return {
            success: false,
            error: "No active editing context (scene or stem)",
          };

        // Fallback A: URL-based single import (user typed `import model … url=…`).
        // Fetch the URL directly; do NOT prompt for a file.
        if (url) {
          try {
            const response = await fetch(url);
            if (!response.ok) {
              return {
                success: false,
                error: `HTTP ${response.status} while fetching ${url}`,
              };
            }
            const blob = await response.blob();
            const filename = filenameForUrlImport(url, type, name);
            const file = new File([blob], filename, {
              type: blob.type || inferContentType(filename),
            });
            const result = await processImportedFile(file, type, name);
            return {
              success: result.success,
              message: result.message,
              error: result.success ? undefined : result.message,
            };
          } catch (err: unknown) {
            return {
              success: false,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }

        // Fallback B: interactive file picker (single import command, not from script)
        const pickResult = await handleImport(type, message || name);
        if (pickResult.status !== "success" || !pickResult.file) {
          return {
            success: pickResult.status === "success",
            message: pickResult.output,
            error:
              pickResult.status === "error" ? pickResult.output : undefined,
          };
        }
        const result = await processImportedFile(
          pickResult.file,
          type,
          name,
          pickResult.companionFiles,
        );
        return {
          success: result.success,
          message: result.message,
          error: result.success ? undefined : result.message,
        };
      }
      return { success: true, message: `Skipped built-in: ${command}` };
    },
    [],
  );

  const processResolvedImports = useCallback(
    async (
      importRequests: ReturnType<typeof ScriptExecutor.extractImports>,
      files: Map<number, File>,
      companionFiles: Map<number, File[]>,
      /** Map of behavior `filepath` → logical id, from conversion-manifest.json. */
      behaviorIdByFilepath?: Map<string, string>,
    ) => {
      const hasEditorContext = Boolean(getEngineRuntime()?.editor?.assetSource);
      const ASSET_FIRST = new Set([
        "model",
        "audio",
        "sound",
        "image",
        "video",
      ]);
      const sorted = [...importRequests].sort((a, b) => {
        const aFirst = ASSET_FIRST.has(a.type) ? 0 : 1;
        const bFirst = ASSET_FIRST.has(b.type) ? 0 : 1;
        return aFirst - bFirst;
      });
      const results = new Map<number, { success: boolean; message: string }>();
      // One dedup cache for the whole batch: identical model source files
      // import once and every later placement reuses that shared asset.
      const modelAssetDedupCache = new Map<
        string,
        { id: string; headRevisionId: string }
      >();
      let deferredBehaviorSync = false;
      let behaviorScriptImportContext:
        | ReadonlyAssetResolutionContext
        | undefined;
      const behaviorScriptImportRevisionMap: ScriptImportRevisionMap = {};
      type ImportRequest = (typeof sorted)[number];
      const behaviorImportTasks: Array<() => Promise<void>> = [];
      const processImportRequest = async (
        req: ImportRequest,
      ): Promise<void> => {
        const file = files.get(req.index);
        if (file && hasEditorContext) {
          const label = req.name || file.name;
          addEntry(
            `import ${req.type} ${label}`,
            `Processing: ${file.name}...`,
            "info",
          );
          const companions = companionFiles?.get(req.index);
          const behaviorIdOverride =
            req.type === "behavior" && req.filepath
              ? behaviorIdByFilepath?.get(req.filepath)
              : undefined;
          // A single import must never be able to hang the whole run. A
          // never-resolving await inside processImportedFile (e.g. a
          // behavior revision call that stalls) would otherwise spin
          // forever with no error — the exact "failure that never
          // surfaces" we forbid. Bound each import and, on timeout,
          // surface it as a named failure and move on to the next.
          const startedAt = performance.now();
          const result = await withImportTimeout(
            processImportedFile(
              file,
              req.type,
              req.name,
              companions,
              behaviorIdOverride,
              modelAssetDedupCache,
              {
                deferBehaviorSceneSync: req.type === "behavior",
                scriptImportContext:
                  req.type === "behavior"
                    ? behaviorScriptImportContext
                    : undefined,
                scriptImportRevisionMap:
                  req.type === "behavior"
                    ? behaviorScriptImportRevisionMap
                    : undefined,
              },
            ),
            `${req.type} "${label}"`,
          );
          const ms = Math.round(performance.now() - startedAt);
          recordImportTiming({
            type: req.type,
            label,
            ms,
            success: result.success,
            message: result.message,
          });
          if (req.type === "behavior" && result.success) {
            deferredBehaviorSync = true;
          }
          results.set(req.index, result);
        } else {
          // Previously this branch dropped the import silently — that is how
          // raw-glb imports outside the asset folder (e.g. pirate-ship's
          // skybox_day.glb at models/skybox_day.glb) disappeared with no
          // trace in the scene or the logs. Surface the skip + its reason.
          const label = req.name || req.filepath || `${req.type} #${req.index}`;
          const reason = !hasEditorContext
            ? "no active editor/asset context"
            : "no source file resolved (filepath not matched in the imported folder)";
          console.warn(
            `[import-skip] Skipped "${label}" (${req.type}) — ${reason}`,
            {
              index: req.index,
              filepath: req.filepath,
              url: req.url,
            },
          );
          addEntry(
            `import ${req.type} ${label}`,
            `Skipped: ${reason}`,
            "error",
          );
          results.set(req.index, {
            success: false,
            message: `Skipped: ${reason}`,
          });
        }
      };
      for (const req of sorted) {
        if (req.type === "behavior") {
          behaviorImportTasks.push(() => processImportRequest(req));
        } else {
          await processImportRequest(req);
        }
      }
      if (behaviorImportTasks.length > 0) {
        const app = getEngineRuntime();
        const [
          { buildNameAwareScriptImportContext },
          { getAssetResolutionContext },
        ] = await Promise.all([
          import("@stem/editor-oss/script-runtime/scriptImportCore"),
          import("@stem/editor-oss/asset-management/AssetResolutionContext"),
        ]);
        const sceneContext = app?.scene
          ? getAssetResolutionContext(app.scene) || undefined
          : undefined;
        behaviorScriptImportContext = await buildNameAwareScriptImportContext(
          app?.editor?.sceneID,
          sceneContext,
        );
        await runImportTaskPool(
          behaviorImportTasks,
          BEHAVIOR_IMPORT_CONCURRENCY,
        );
      }
      if (deferredBehaviorSync) {
        const startedAt = performance.now();
        flushDeferredBehaviorImportSync();
        recordImportTiming({
          type: "behavior-sync",
          label: "behavior import batch flush",
          ms: Math.round(performance.now() - startedAt),
          success: true,
        });
      }
      return results;
    },
    [addEntry],
  );

  // Parse a stemscript-import folder's `conversion-manifest.json` into a
  // `filepath → logical behavior id` map. Generated game folders attach
  // behaviors by a logical id (e.g. `g2048.game`) that differs from the
  // bundled YAML's internal `config.id`; the manifest is the link.
  const buildBehaviorIdMap = useCallback(
    async (folderFiles?: File[]): Promise<Map<string, string>> => {
      const map = new Map<string, string>();
      const manifestFile = folderFiles?.find((f) => {
        const rel =
          (f as File & { webkitRelativePath?: string }).webkitRelativePath ||
          f.name;
        return rel.toLowerCase().endsWith("conversion-manifest.json");
      });
      if (!manifestFile) return map;
      try {
        const manifest = JSON.parse(await manifestFile.text()) as {
          files?: Record<string, { type?: string; id?: string }>;
          behaviors?: Array<{ id?: string; file?: string }>;
        };
        // The filepath → logical id link lives in `manifest.files`, keyed
        // by the same relative path the stemscript's `import behavior
        // filepath="…"` uses (e.g. "behaviors/chessGame/behavior.yaml").
        // `manifest.behaviors[]` only carries id/name/attachedTo — no
        // file field — so it cannot be the source of this map.
        for (const [filepath, meta] of Object.entries(manifest.files ?? {})) {
          if (meta?.type === "behavior" && meta.id) map.set(filepath, meta.id);
        }
        // Back-compat: honour an explicit `file` field on behaviors[] too.
        for (const b of manifest.behaviors ?? []) {
          if (b.id && b.file) map.set(b.file, b.id);
        }
      } catch {
        // Malformed manifest — proceed without behavior id overrides.
      }
      return map;
    },
    [],
  );

  // The full runScript flow; exposed below on `window.__stemRunScript` in
  // local dev so a Playwright test can drive the `exec` pipeline without
  // going through the OS file picker.
  const runScript = useCallback(
    async (
      content: string,
      folderFiles?: File[],
    ): Promise<ScriptRunSummary | undefined> => {
      let scriptExecutionFinished = false;
      let runSummary: ScriptRunSummary | undefined;

      // Persistent spinner toast for the *entire* import — asset resolution
      // (which is the slow part: models are fetched and baked here) through
      // command execution and the trailing auto-save. Created up front and
      // dismissed in the single `finally` below so the user always has
      // feedback that an import is in progress; every early-return path
      // (cancelled dialog, no imports) flows through that same `finally`.
      const importSpinnerId = showLoadingToast(
        "Importing scene…",
        "Loading assets & running stemscript…",
      );
      const endImportActivity = beginScriptImportActivity();
      getEngineRuntime()?.editor?.restoreScriptImportPreviewReveal();

      try {
        const timingRoot = globalThis as typeof globalThis & {
          __stemImportTimings?: unknown[];
          __stemImportPhaseTimings?: unknown[];
        };
        timingRoot.__stemImportTimings = [];
        timingRoot.__stemImportPhaseTimings = [];
        // Show persistent toasts for proxy requirements
        const proxyRequirements =
          ScriptExecutor.extractProxyRequirements(content);
        for (const req of proxyRequirements) {
          const label = req.comment || req.alias;
          showToast({
            type: "info",
            title: `Proxy required: ${label}`,
            body: `Route "${req.alias}" → ${req.destination}`,
            duration: 30000,
          });
        }

        // Pre-scan for imports and show batch dialog if any found
        const importRequests = ScriptExecutor.extractImports(content);

        // Pre-resolve URL-based imports (export-mode bundles) by fetching each
        // URL into a File. These go into the resolved map *before* the batch
        // dialog / folder auto-resolve, so the user never has to hand-pick a
        // file for an asset whose URL is already known.
        const urlResolved = new Map<number, File>();
        const urlFailures: {
          req: (typeof importRequests)[number];
          message: string;
        }[] = [];
        for (const req of importRequests) {
          if (!req.url) continue;
          try {
            const response = await fetch(req.url);
            if (!response.ok) {
              urlFailures.push({ req, message: `HTTP ${response.status}` });
              continue;
            }
            const blob = await response.blob();
            const filename = filenameForUrlImport(req.url, req.type, req.name);
            const file = new File([blob], filename, {
              type: blob.type || inferContentType(filename),
            });
            urlResolved.set(req.index, file);
          } catch (err: unknown) {
            urlFailures.push({
              req,
              message: err instanceof Error ? err.message : String(err),
            });
          }
        }
        for (const failure of urlFailures) {
          const label = failure.req.name || failure.req.type;
          addEntry(
            `(prefetch)`,
            `Failed to fetch asset URL for ${label}: ${failure.message}`,
            "error",
          );
        }

        if (importRequests.length > 0) {
          let resolvedFiles: Map<number, File> = new Map(urlResolved);
          let resolvedCompanions: Map<number, File[]> = new Map();
          // Imports still needing a source (neither a URL we could fetch nor
          // pre-picked) — these feed into folder auto-resolve / dialog.
          const unresolvedRequests = importRequests.filter(
            (r) => !resolvedFiles.has(r.index),
          );

          if (unresolvedRequests.length === 0) {
            // All imports resolved from URLs. Skip folder/dialog entirely.
          } else if (folderFiles && folderFiles.length > 0) {
            // Auto-resolve imports from the folder
            const autoResult: AutoResolveResult = autoResolveImports(
              unresolvedRequests,
              folderFiles,
            );
            for (const [idx, file] of autoResult.files)
              resolvedFiles.set(idx, file);
            for (const [idx, comps] of autoResult.companionFiles)
              resolvedCompanions.set(idx, comps);
            const stillUnresolved = unresolvedRequests.filter(
              (r) => !resolvedFiles.has(r.index),
            );

            if (stillUnresolved.length > 0) {
              const dialogResult = await showBatchImportDialog(
                unresolvedRequests,
                autoResult,
              );
              if (dialogResult.action === "cancel") {
                addEntry("(script)", "Script execution cancelled.", "info");
                return;
              }
              if (
                dialogResult.action === "import" &&
                dialogResult.files.size > 0
              ) {
                for (const [idx, file] of dialogResult.files)
                  resolvedFiles.set(idx, file);
                for (const [idx, comps] of dialogResult.companionFiles)
                  resolvedCompanions.set(idx, comps);
              } else {
                importResultsRef.current = new Map();
                importCounterRef.current = 0;
                resolvedFiles = new Map();
                resolvedCompanions = new Map();
              }
            }
          } else {
            // No folder files — dialog for the unresolved ones.
            const dialogResult =
              await showBatchImportDialog(unresolvedRequests);
            if (dialogResult.action === "cancel") {
              addEntry("(script)", "Script execution cancelled.", "info");
              return;
            }
            if (
              dialogResult.action === "import" &&
              dialogResult.files.size > 0
            ) {
              for (const [idx, file] of dialogResult.files)
                resolvedFiles.set(idx, file);
              for (const [idx, comps] of dialogResult.companionFiles)
                resolvedCompanions.set(idx, comps);
            } else {
              importResultsRef.current = new Map();
              importCounterRef.current = 0;
              resolvedFiles = new Map();
              resolvedCompanions = new Map();
            }
          }

          if (resolvedFiles.size > 0) {
            const behaviorIdByFilepath = await buildBehaviorIdMap(folderFiles);
            const results = await processResolvedImports(
              importRequests,
              resolvedFiles,
              resolvedCompanions,
              behaviorIdByFilepath,
            );
            importResultsRef.current = results;
            importCounterRef.current = 0;
          } else if (!importResultsRef.current) {
            importResultsRef.current = new Map();
            importCounterRef.current = 0;
          }
        }

        // All import-resolution and cancellation paths above have already
        // returned. Wipe previously-imported content now so the script runs
        // against the same blank-scene baseline every time. Wrapping the
        // execute() call in runInScriptImportContext tags every object the
        // script adds with userData.isImported, which the next exec uses to
        // wipe these same objects again.
        const editor = getEngineRuntime()?.editor;
        if (editor) {
          try {
            editor.clearImportedContent();
          } catch (error: unknown) {
            const message =
              error instanceof Error ? error.message : String(error);
            addEntry(
              "(script)",
              `Pre-exec wipe failed (continuing): ${message}`,
              "error",
            );
          }
        }

        const onProgress = (current: number, total: number, line: string) => {
          addEntry(line, `Executing ${current}/${total}...`, "info");
        };
        const result = editor
          ? await editor.runInScriptImportContext(() =>
              ScriptExecutor.execute(
                content,
                executeRegistryCommand,
                onProgress,
                executeScriptBuiltin,
              ),
            )
          : await ScriptExecutor.execute(
              content,
              executeRegistryCommand,
              onProgress,
              executeScriptBuiltin,
            );

        const summary = `Script complete: ${result.successCount}/${result.executedCommands} succeeded, ${result.failCount} failed`;
        addEntry(
          "(script)",
          summary,
          result.failCount > 0 ? "error" : "success",
        );
        lastScriptRef.current = { content };

        // Log individual failures
        for (const r of result.results) {
          if (!r.success && r.error) {
            const errText =
              r.error.length > 1024 ? r.error.slice(0, 1024) + "..." : r.error;
            addEntry(r.command, `Line ${r.lineNumber}: ${errText}`, "error");
          }
        }

        scriptExecutionFinished = true;
        // Programmatic summary so a harness (window.__stemRunScript) can
        // assert the run was actually clean — failCount > 0 includes any
        // import that could not be resolved (e.g. a skybox file the folder
        // didn't supply). An incomplete import must never look successful.
        runSummary = {
          executedCommands: result.executedCommands,
          successCount: result.successCount,
          failCount: result.failCount,
        };
      } finally {
        const editor = getEngineRuntime()?.editor;
        if (scriptExecutionFinished) {
          try {
            await saveScene(false, false);
            const assetSource = getEngineRuntime()?.editor?.assetSource;
            if (assetSource) {
              await refreshEditorAssets(queryClient, assetSource);
            }
            editor?.prepareScriptImportPreviewReveal();
          } catch (error: unknown) {
            const errorMessage =
              error instanceof Error ? error.message : "Unknown error";
            addEntry("(script)", `Auto-save failed: ${errorMessage}`, "error");
          }
        }

        try {
          dismissToast(importSpinnerId);
        } finally {
          endImportActivity();
          editor?.startScriptImportPreviewReveal();
        }
        importResultsRef.current = null;
        importCounterRef.current = 0;
      }
      return runSummary;
    },
    [
      executeRegistryCommand,
      addEntry,
      executeScriptBuiltin,
      processResolvedImports,
      buildBehaviorIdMap,
    ],
  );

  const executeInput = useCallback(
    async (input: string): Promise<TerminalHistoryEntry[]> => {
      const trimmed = input.trim();
      if (!trimmed) return [];

      const collectedEntries: TerminalHistoryEntry[] = [];
      executionCollectorRef.current = collectedEntries;
      setIsExecuting(true);
      setCommandBuffer((prev) => [...prev, trimmed]);
      setHistoryIndex(-1);

      try {
        const parsed: ParsedCommand = ScriptCommandParser.parse(trimmed);

        if (parsed.isBuiltin) {
          const builtinContext: BuiltinContext = {
            isAdmin: options.isAdmin,
            commandBuffer: [...commandBuffer, trimmed],
            clearOutput: clearHistory,
            runScript,
            getLastScript: () => lastScriptRef.current,
            runCheck,
            triggerImport: async (
              type: string,
              message?: string,
              name?: string,
            ) => {
              if (!getEngineRuntime()?.editor?.assetSource)
                return {
                  output: "No active editing context (scene or stem)",
                  status: "error" as const,
                };
              const pickResult = await handleImport(type, message || name);
              if (pickResult.status !== "success" || !pickResult.file) {
                return pickResult;
              }
              const result = await processImportedFile(
                pickResult.file,
                type,
                name,
                pickResult.companionFiles,
              );
              return {
                output: result.message,
                status: result.success
                  ? ("success" as const)
                  : ("error" as const),
              };
            },
            triggerExport: async (
              target: string,
              suggestedName?: string,
              mode: "dump" | "export" = "dump",
            ) => {
              if (target !== "scene") {
                const cmd = mode === "export" ? "export" : "dump";
                return {
                  output: `Usage: ${cmd} scene [name=<bundle-name>]`,
                  status: "error" as const,
                };
              }
              const { exportCurrentSceneBundle } =
                await import("@stem/editor-oss/agent/script-tool/exportSceneBundle");
              const result = await exportCurrentSceneBundle({
                suggestedName,
                mode,
              });
              return {
                output: result.message,
                status: result.success
                  ? ("success" as const)
                  : ("error" as const),
              };
            },
          };

          const result: TerminalResult = await executeBuiltin(
            parsed.command,
            parsed.params,
            builtinContext,
          );

          if (result.shouldExit) {
            onExit();
          } else if (result.output) {
            addEntry(trimmed, result.output, result.status, result.format);
          }
        } else {
          // Execute via CommandsRegistry
          const result = await executeRegistryCommand(
            parsed.command,
            parsed.params,
          );
          const output = result.success
            ? result.message || "OK"
            : result.error || "Command failed";
          const status = result.success ? "success" : "error";

          // Format data output if present
          addEntry(trimmed, output, status);
        }
      } catch (err: any) {
        addEntry(trimmed, `Error: ${err.message}`, "error");
      } finally {
        setIsExecuting(false);
        executionCollectorRef.current = null;
      }
      return collectedEntries;
    },
    [
      commandBuffer,
      clearHistory,
      onExit,
      addEntry,
      executeRegistryCommand,
      runScript,
      runCheck,
      options.isAdmin,
    ],
  );

  const navigateHistory = useCallback(
    (direction: "up" | "down"): string | null => {
      if (commandBuffer.length === 0) return null;

      let newIndex: number;
      if (direction === "up") {
        newIndex =
          historyIndex === -1
            ? commandBuffer.length - 1
            : Math.max(0, historyIndex - 1);
      } else {
        newIndex = historyIndex === -1 ? -1 : historyIndex + 1;
        if (newIndex >= commandBuffer.length) {
          newIndex = -1;
        }
      }

      setHistoryIndex(newIndex);
      return newIndex === -1 ? "" : commandBuffer[newIndex] || "";
    },
    [historyIndex, commandBuffer],
  );

  // Test hook: expose runScript on `window` so
  // Playwright (or any other automation harness) can drive the `exec`
  // pipeline without invoking the OS file picker. Accepts the script
  // body plus an optional `{name, mime, data}` array (base64-encoded
  // file payloads) that are reconstructed as File objects for the
  // import resolver.
  useEffect(() => {
    const w = window as unknown as {
      __stemRunScript?: (
        content: string,
        files?: Array<{ name: string; mime?: string; data: string }>,
      ) => Promise<ScriptRunSummary | undefined>;
    };
    w.__stemRunScript = async (content, files) => {
      console.log("[__stemRunScript] start", {
        scriptBytes: content.length,
        fileCount: (files ?? []).length,
      });
      const folderFiles = (files ?? []).map(({ name, mime, data }) => {
        const binary = atob(data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        // `name` may include forward slashes to encode a subfolder
        // path (e.g. "behaviors/chessGame/behavior.yaml"). Use the
        // trailing segment as File.name and stamp the full path on
        // webkitRelativePath so the script-tool's path-based import
        // resolver can disambiguate identically named files across
        // subfolders.
        const segments = name.split("/");
        const basename = segments[segments.length - 1]!;
        const file = new File([bytes], basename, {
          type: mime ?? "application/octet-stream",
        });
        if (segments.length > 1) {
          try {
            Object.defineProperty(file, "webkitRelativePath", {
              value: name,
              configurable: true,
            });
          } catch {
            // webkitRelativePath is read-only in some engines;
            // fall back to basename-only matching.
          }
        }
        return file;
      });
      // Cap the script run to a hard ceiling so test harnesses don't
      // hang waiting on a step that's stuck inside a local-only path
      // we haven't covered yet. Real users hit the same flow through
      // the UI dialogs and can dismiss; tests should fail loudly with
      // the timeout breadcrumb. Generous enough that a full game
      // import (dozens of models, real GLB parsing) completes inside
      // it rather than tripping a spurious timeout.
      // Bumped from 240s→600s→1200s: the heaviest games (procedural
      // terrain; cubecity's 32 building GLBs through the per-model
      // texture-conversion pipeline; 100+ vehicle GLBs) can take many
      // minutes, and a premature timeout makes the harness save/reload
      // before every asset is created (a partial import).
      const HARD_TIMEOUT_MS = 1_200_000;
      try {
        const summary = await Promise.race([
          runScript(content, folderFiles),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    `__stemRunScript timed out after ${HARD_TIMEOUT_MS}ms`,
                  ),
                ),
              HARD_TIMEOUT_MS,
            ),
          ),
        ]);
        console.log("[__stemRunScript] done", summary);
        return summary;
      } catch (err) {
        console.error("[__stemRunScript] threw", err);
        throw err;
      }
    };
    return () => {
      delete (window as unknown as { __stemRunScript?: unknown })
        .__stemRunScript;
    };
  }, [runScript]);

  // Test affordance: expose a small scene-introspection
  // helper on `window` so Playwright can verify the side-effects of
  // running scripts without needing access to the in-module `global`
  // singleton (which isn't reachable from page.evaluate).
  useEffect(() => {
    const w = window as unknown as {
      __stemGetScene?: () => {
        sceneName: string | null;
        sceneID: string | null;
        mode: string | null;
        isPlaying: boolean;
        assetCount: number;
        objectNames: string[];
        visibleObjectNames: string[];
        renderableNames: string[];
        visibleRenderableNames: string[];
        objectCount: number;
        visibleObjectCount: number;
        renderableCount: number;
        visibleRenderableCount: number;
        meshCount: number;
        visibleMeshCount: number;
        lights: Array<{
          type: string;
          name: string;
          intensity: number;
          visible: boolean;
          parent: string | null;
        }>;
        rendering: {
          ambient: { color: string; intensity: number } | null;
          hemisphere: {
            skyColor: string;
            groundColor: string;
            intensity: number;
          } | null;
          backgroundType: string | null;
          backgroundTexture: string | null;
          hasBackgroundTextureAsset: boolean;
        };
        sceneEnv: {
          background: string | null;
          environment: string | null;
          backgroundDetail?: unknown;
          hasBackgroundNode?: boolean;
          hasEnvironmentNode?: boolean;
          backgroundIntensity?: number | null;
          backgroundBlurriness?: number | null;
          backgroundRotationY?: number | null;
        };
      };
    };
    w.__stemGetScene = () => {
      const app = getEngineRuntime();
      const scene = app?.editor?.scene;
      if (!scene) {
        return {
          sceneName: null,
          sceneID: null,
          mode: null,
          isPlaying: false,
          assetCount: 0,
          objectNames: [],
          visibleObjectNames: [],
          renderableNames: [],
          visibleRenderableNames: [],
          objectCount: 0,
          visibleObjectCount: 0,
          renderableCount: 0,
          visibleRenderableCount: 0,
          meshCount: 0,
          visibleMeshCount: 0,
          lights: [],
          rendering: {
            ambient: null,
            hemisphere: null,
            backgroundType: null,
            backgroundTexture: null,
            hasBackgroundTextureAsset: false,
          },
          sceneEnv: { background: null, environment: null },
        };
      }

      // Classifies scene.background / scene.environment into a coarse,
      // serializable label so Playwright can assert the skybox/IBL is
      // present (Texture/CubeTexture) vs. lost (a flat Color / null).
      const classifyEnv = (value: unknown): string | null => {
        if (!value || typeof value !== "object") return null;
        const v = value as {
          isCubeTexture?: boolean;
          isTexture?: boolean;
          isColor?: boolean;
        };
        if (v.isCubeTexture) return "CubeTexture";
        if (v.isTexture) return "Texture";
        if (v.isColor) return "Color";
        return "Unknown";
      };
      // Detailed texture description so we can tell a *correctly rendered*
      // skybox from one that loaded with the wrong mapping/colorSpace or a
      // missing image (which renders flat/black even though it classifies
      // as "Texture").
      const describeTexture = (value: unknown) => {
        const t = value as {
          isTexture?: boolean;
          isColor?: boolean;
          mapping?: number;
          colorSpace?: string;
          flipY?: boolean;
          image?: { width?: number; height?: number } | null;
          source?: { data?: { width?: number; height?: number } | null } | null;
        } | null;
        if (!t || typeof t !== "object") return null;
        if (t.isColor) return { kind: "Color" };
        if (!t.isTexture) return { kind: "Unknown" };
        const img = t.image || t.source?.data || null;
        return {
          kind: "Texture",
          mapping: t.mapping ?? null,
          colorSpace: t.colorSpace ?? null,
          flipY: t.flipY ?? null,
          width: img?.width ?? null,
          height: img?.height ?? null,
        };
      };

      const sceneAudit = collectSceneObjectAudit(scene);
      return {
        sceneName: app?.editor?.sceneName ?? null,
        sceneID: app?.editor?.sceneID ?? null,
        mode: app?.mode ?? null,
        isPlaying: !!app?.isPlaying,
        assetCount: app?.editor?.assetsCount ?? 0,
        ...sceneAudit,
        rendering: {
          ambient: app?.editor?.rendering?.ambient ?? null,
          hemisphere: app?.editor?.rendering?.hemisphere ?? null,
          backgroundType: app?.editor?.rendering?.background?.type ?? null,
          backgroundTexture:
            app?.editor?.rendering?.background?.texture ?? null,
          hasBackgroundTextureAsset:
            !!app?.editor?.rendering?.background?.textureAsset,
        },
        sceneEnv: {
          background: classifyEnv(
            (scene as { background?: unknown }).background,
          ),
          environment: classifyEnv(
            (scene as { environment?: unknown }).environment,
          ),
          backgroundDetail: describeTexture(
            (scene as { background?: unknown }).background,
          ),
          hasBackgroundNode: !!(scene as { backgroundNode?: unknown })
            .backgroundNode,
          hasEnvironmentNode: !!(scene as { environmentNode?: unknown })
            .environmentNode,
          backgroundIntensity:
            (scene as { backgroundIntensity?: number }).backgroundIntensity ??
            null,
          backgroundBlurriness:
            (scene as { backgroundBlurriness?: number }).backgroundBlurriness ??
            null,
          backgroundRotationY:
            (scene as { backgroundRotation?: { y?: number } })
              .backgroundRotation?.y ?? null,
        },
      };
    };
    // Test affordance: deterministically pin the editor camera so visual
    // skybox/background regression shots are comparable across reloads
    // (the camera otherwise resets to a default orientation on reload).
    const wc = window as unknown as {
      __stemSetEditorCamera?: (
        pos: [number, number, number],
        target: [number, number, number],
      ) => boolean;
    };
    wc.__stemSetEditorCamera = (pos, target) => {
      const app = getEngineRuntime() as unknown as {
        camera?: {
          position?: { set: (x: number, y: number, z: number) => void };
          lookAt?: (x: number, y: number, z: number) => void;
          updateMatrixWorld?: () => void;
        };
        editor?: {
          controls?: {
            current?: {
              controls?: {
                target?: { set: (x: number, y: number, z: number) => void };
                update?: () => void;
              };
            };
          };
        };
      };
      const cam = app?.camera;
      if (!cam?.position) return false;
      const orbit = app?.editor?.controls?.current?.controls;
      cam.position.set(pos[0], pos[1], pos[2]);
      if (orbit?.target?.set) {
        orbit.target.set(target[0], target[1], target[2]);
        orbit.update?.();
      }
      cam.lookAt?.(target[0], target[1], target[2]);
      cam.updateMatrixWorld?.();
      return true;
    };
    // Debug affordance: dump the material maps applied to named objects so a
    // Playwright probe can verify which texture slots actually resolved.
    (
      window as unknown as {
        __stemInspectMaterials?: (names: string[]) => unknown;
      }
    ).__stemInspectMaterials = (names: string[]) => {
      const scene = getEngineRuntime()?.editor?.scene;
      if (!scene) return { error: "no scene" };
      const tex = (t: any) =>
        t
          ? {
              cs: t.colorSpace,
              w: t.image?.width ?? null,
              h: t.image?.height ?? null,
              hasImg: !!t.image,
            }
          : null;
      const mat = (m: any) => ({
        type: m?.type ?? m?.constructor?.name,
        isNode: !!(
          m?.isNodeMaterial ||
          /NodeMaterial/.test(m?.type ?? m?.constructor?.name ?? "")
        ),
        color: m?.color ? "#" + m.color.getHexString() : null,
        map: tex(m?.map),
        normalMap: tex(m?.normalMap),
        metalnessMap: tex(m?.metalnessMap),
        roughnessMap: tex(m?.roughnessMap),
        metalness: m?.metalness,
        roughness: m?.roughness,
      });
      const byName: Record<string, any> = {};
      traverseObjectDepthFirst(scene, (o: any) => {
        if (o.name && !byName[o.name]) byName[o.name] = o;
      });
      const out: Record<string, unknown> = {};
      for (const name of names) {
        const obj = byName[name];
        if (!obj) {
          out[name] = { missing: true };
          continue;
        }
        const meshes: unknown[] = [];
        traverseObjectDepthFirst(obj, (c: any) => {
          if (!c.isMesh) return;
          const mats = Array.isArray(c.material) ? c.material : [c.material];
          mats.forEach((m: any, i: number) =>
            meshes.push({ mesh: c.name || "(unnamed)", idx: i, ...mat(m) }),
          );
        });
        out[name] = {
          meshCount: meshes.length,
          hasMaterialSettings: !!obj.userData?.materialSettings,
          materials: meshes,
        };
      }
      return out;
    };
    return () => {
      delete (window as unknown as { __stemGetScene?: unknown }).__stemGetScene;
      delete (window as unknown as { __stemSetEditorCamera?: unknown })
        .__stemSetEditorCamera;
      delete (window as unknown as { __stemInspectMaterials?: unknown })
        .__stemInspectMaterials;
    };
  }, []);

  // Dashboard "Import stemscript folder" handoff. When the user
  // picks a folder on the dashboard we stage the script + base64 file
  // payloads in sessionStorage and navigate to a fresh project route.
  // The Create page auto-creates the project and the editor mounts this
  // hook — at which point we consume the staged data and drive the same
  // `runScript` flow as the inline `exec` command. The staging entry is
  // removed on consume, so a reload doesn't replay it.
  //
  // Timing is load-bearing here. This hook mounts (the AiCopilot panel
  // is always in the editor tree) while the editor is still booting:
  // the auto-created project scene has not been finalized yet. Running
  // exec at that point is doubly broken — the import resolver skips
  // every `import` because `editor.assetSource` isn't bound, and any
  // objects exec does add get discarded when the scene-setup pass
  // replaces `editor.scene`. So we wait for the `sceneLoaded` event,
  // which fires once the persisted project scene is fully in place, and
  // only `consume` (which clears the staged payload) once we run.
  useEffect(() => {
    const w = window as unknown as {
      __stemRunScript?: (...args: any[]) => Promise<void>;
    };
    if (typeof w.__stemRunScript !== "function") return;

    let done = false;
    let appPollTimer = 0;
    let settleTimer = 0;
    let boundApp: EngineRuntime | null = null;

    const detach = () => {
      if (appPollTimer) window.clearTimeout(appPollTimer);
      if (settleTimer) window.clearTimeout(settleTimer);
      boundApp?.on("sceneLoaded.StemscriptImport", null);
    };

    const run = () => {
      if (done) return;
      const editor = getEngineRuntime()?.editor;
      // sceneLoaded fired, but guard the invariants exec depends on:
      // a persisted scene id (proves the project was created) and a
      // bound asset source (proves imports resolve to it).
      if (!editor?.sceneID || !editor?.assetSource) return;
      done = true;
      detach();
      void consumeStemscriptImport().then((staged) => {
        if (!staged) return;
        // Fire-and-forget — runScript reports errors via inline
        // terminal entries (addEntry), which is the surface the user
        // is staring at while the import runs.
        void w.__stemRunScript!(staged.content, staged.files);
      });
    };

    // `sceneLoaded` can fire more than once across the autoCreate →
    // load handoff; debounce so exec runs after the final scene
    // settles rather than against an intermediate one.
    const onSceneLoaded = () => {
      if (done) return;
      if (settleTimer) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(run, 500);
    };

    const attach = () => {
      if (done) return;
      const app = getEngineRuntime();
      if (!app) {
        appPollTimer = window.setTimeout(attach, 150);
        return;
      }
      boundApp = app;
      app.on("sceneLoaded.StemscriptImport", onSceneLoaded);
    };

    // Only wire the sceneLoaded listener when a payload is actually
    // staged. The staging store is IndexedDB, so the check is async.
    void peekStemscriptImport().then((staged) => {
      if (done || !staged) return;
      attach();
    });

    return () => {
      done = true;
      detach();
    };
  }, [runScript]);

  return {
    history,
    commandBuffer,
    isExecuting,
    executeInput,
    clearHistory,
    historyIndex,
    navigateHistory,
  };
}
