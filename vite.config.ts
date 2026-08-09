import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import * as dotEnv from "dotenv";
import * as fs from "node:fs";
import { ViteImageOptimizer } from "vite-plugin-image-optimizer";
import { imagetools } from "vite-imagetools";
import viteCompression from "vite-plugin-compression";
import { resolve } from "path";
import * as path from "node:path";
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import type {Plugin, UserConfig} from "vite";

const CESIUM_PUBLIC_PATH = "/cesium";
const CESIUM_BUILD_DIR = resolve(__dirname, "node_modules/cesium/Build/Cesium");
const CESIUM_OUTPUT_DIR = resolve(__dirname, "build/public/cesium");
const WEB_BUILD_PUBLIC_DIR = resolve(__dirname, "build/public");
const KTX2_ENCODER_WEB_ENTRY = resolve(
  __dirname,
  "node_modules/ktx2-encoder/dist/web/index.js",
);
const AMMO_BROWSER_ENTRY = resolve(__dirname, "client/assets/js/ammo/ammo.wasm.js");
const BROWSER_ONLY_QUERY = "?browser-only";
const NODE_BROWSER_UNAVAILABLE_ENTRY = resolve(__dirname, "client/oss-stubs/node-browser-unavailable.ts");
const reactRefreshInclude = /\.[jt]sx$/;
const reactRefreshExclude = [/\/node_modules\//, /\.worker\.[tj]sx?$/];
const DEFERRED_SCENE_PRELOAD_RE =
  /(?:^|\/)(?:AiWorldController|AssetLoader|AssetResolutionContext|AssetSource|Behavior|BehaviorAttributeType|CSS3DRenderer|CanvasUtils|Cesium|Converter|DRACOLoader|DashboardAssetPackImportUtils|DashboardImportUtils|DetectDevice|DirectCopilotProvider|Editor|EngineRuntime|GLTFLoader|HDRLoader|ImportUtils|ModelLoader|ModelPreview(?:WebGL)?Renderer|ModelUtils|OrbitControls|PhysicsBase|PhysicsEngine|PhysicsUtil|SVGLoader|SceneLoadProfiler|TagUtil|Viewport|ammo|asset|context|convertToGlb|createModelWithData|getPhysics|loadHumanoidAnimations|loadModelFromFile|rapier|saveStemEditor|scene|schemas|scriptImports|serialization|three\.quarks(?:\.esm)?|three\.tsl|three\.webgpu|util)-/;
const EDITOR_PLAY_DEFERRED_PRELOAD_RE =
  /(?:^|\/)(?:AiWorldController|AssetLoader|AtlasDetector|BaseGameServiceController|BehaviorScriptInjector|BufferGeometryUtils|Converter|CrazyGamesController|DRACOLoader|DiscordController|EffectRenderer|EmailPasswordController|ExtendedDirectionalLight|GeometryComputePool|GLTFLoader(?:Extended)?|GeometryUtils|GuestController|HUDManager|KTX2Loader|LambdaScriptInjector|MobileGameServicesController|ModelGeneratorProvider|ModelLoader|ModelPreview(?:WebGL)?Renderer|ModelUtils|ParametricGeometry|PhysicsBase|PhysicsEngine|PhysicsEngineFactory|PhysicsUtil|preloadPhysics|QualitySystemIntegration|SparkCompositeBridge|SteamController|Teapot(?:Geometry)?|TextGeometry|TextureMapping|UIKitPointerEvents|additions|ammo|dist|game-service-controllers|gaussianSplats|jszip(?:\.min)?|load-util|loadMixamoAnimationToVRM|meshoptimizer|rapier|runtime-geometry-helpers|serialization|spark\.module|three\.module|three\.quarks(?:\.esm)?|three\.tsl|three\.webgpu|translations|worker-PhysicsWorker)-/;
const LAZY_ROUTE_PRELOAD_RE =
  /(?:^|\/)(?:AdminPanel|Create|CreateDashboard|DashboardAssetPackImportUtils|DashboardImportUtils|GameOverview|MyAvatarsView|Player|SettingsPage|StemEditor)-/;
const PLAYGROUND_COPILOT_REGISTRATION_PRELOAD_RE =
  /(?:^|\/)registerPlaygroundCopilot-/;
const THREE_ADDON_OPTIMIZED_DEPS = [
  "three/addons/loaders/AMFLoader.js",
  "three/addons/loaders/ColladaLoader.js",
  "three/addons/loaders/DRACOLoader.js",
  "three/addons/loaders/EXRLoader.js",
  "three/addons/loaders/FBXLoader.js",
  "three/addons/loaders/FontLoader.js",
  "three/addons/loaders/GCodeLoader.js",
  "three/addons/loaders/GLTFLoader.js",
  "three/addons/loaders/HDRLoader.js",
  "three/addons/loaders/KMZLoader.js",
  "three/addons/loaders/KTX2Loader.js",
  "three/addons/loaders/LUT3dlLoader.js",
  "three/addons/loaders/LUTCubeLoader.js",
  "three/addons/loaders/MD2Loader.js",
  "three/addons/loaders/MTLLoader.js",
  "three/addons/loaders/NRRDLoader.js",
  "three/addons/loaders/OBJLoader.js",
  "three/addons/loaders/PCDLoader.js",
  "three/addons/loaders/PDBLoader.js",
  "three/addons/loaders/PLYLoader.js",
  "three/addons/loaders/STLLoader.js",
  "three/addons/loaders/SVGLoader.js",
  "three/addons/loaders/TDSLoader.js",
  "three/addons/loaders/USDLoader.js",
  "three/addons/loaders/VRMLLoader.js",
  "three/addons/loaders/VTKLoader.js",
];
const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".glb": "model/gltf-binary",
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".xml": "application/xml; charset=utf-8",
};

function resolveModulePreloadDependencies(
  filename: string,
  deps: string[],
  context: { hostId: string; hostType: "html" | "js" },
) {
  const isMarketingShellHtml =
    context.hostType === "html" &&
    (context.hostId === "packages/marketing/index.html" || context.hostId.endsWith("/packages/marketing/index.html"));
  const isEditorOrPlayHtml =
    context.hostType === "html" &&
    /(?:^|\/)packages\/(?:editor\/editor|play\/play)\.html$/.test(context.hostId);
  const isLazyRouteImport =
    context.hostType === "js" &&
    (LAZY_ROUTE_PRELOAD_RE.test(filename) || LAZY_ROUTE_PRELOAD_RE.test(context.hostId));
  const isPlaygroundCopilotRegistrationImport =
    context.hostType === "js" &&
    PLAYGROUND_COPILOT_REGISTRATION_PRELOAD_RE.test(filename);

  if (isPlaygroundCopilotRegistrationImport) {
    return [];
  }

  if (isEditorOrPlayHtml) {
    return deps.filter(dep => !EDITOR_PLAY_DEFERRED_PRELOAD_RE.test(dep));
  }

  if (!isMarketingShellHtml && !isLazyRouteImport) {
    return deps;
  }

  return deps.filter(dep => !DEFERRED_SCENE_PRELOAD_RE.test(dep));
}

dotEnv.config({ path: __dirname + "/client/.env" });

const packageJson = JSON.parse(
  fs.readFileSync(resolve(__dirname, "package.json"), "utf8"),
) as { version?: string };

const buildTimestamp = new Date().toISOString();
const appVersion = process.env.REACT_APP_VERSION || packageJson.version || "0.0.0";
const appBuildId =
  process.env.REACT_APP_BUILD_ID ||
  process.env.GITHUB_SHA ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  `${appVersion}-${buildTimestamp}`;

function emitAppVersionManifest() {
  return {
    name: "emit-app-version-manifest",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "app-version.json",
        source: JSON.stringify(
          {
            buildId: appBuildId,
            version: appVersion,
            builtAt: buildTimestamp,
          },
          null,
          2,
        ),
      });
    },
  };
}

function serveCesiumAsset(reqPath: string, res: any, next: () => void) {
  const pathname = decodeURIComponent((reqPath || "/").split("?")[0] || "/");
  const resolvedPath = path.resolve(CESIUM_BUILD_DIR, `.${pathname}`);

  if (!resolvedPath.startsWith(CESIUM_BUILD_DIR)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }

  if (!fs.existsSync(resolvedPath) || fs.statSync(resolvedPath).isDirectory()) {
    next();
    return;
  }

  const extension = path.extname(resolvedPath);
  const mimeType = MIME_TYPES[extension] || "application/octet-stream";
  res.setHeader("Content-Type", mimeType);
  res.end(fs.readFileSync(resolvedPath));
}

function cesiumAssetsPlugin() {
  return {
    name: "cesium-assets",
    configureServer(server: any) {
      server.middlewares.use(CESIUM_PUBLIC_PATH, (req: any, res: any, next: () => void) => {
        serveCesiumAsset(req.url || "/", res, next);
      });
    },
    writeBundle() {
      fs.rmSync(CESIUM_OUTPUT_DIR, { recursive: true, force: true });
      fs.cpSync(CESIUM_BUILD_DIR, CESIUM_OUTPUT_DIR, { recursive: true });
    },
  };
}

function normalizeHtmlEntrypointsPlugin() {
  return {
    name: "normalize-html-entrypoints",
    writeBundle() {
      const htmlCopies: Array<[string, string]> = [
        // Public landing / docs / playground SPA. Becomes the top-level
        // index.html on the static deploy; static-host rules route
        // `/dashboard`, `/create/project`, `/play` etc. to their own
        // shell HTML files (see client/packages/site/public/_redirects).
        ["packages/site/index.html", "index.html"],
        // App shell (PublicAppContainerLite — dashboard, project list,
        // local storage bootstrap modal). No longer the top-level index in this build.
        ["packages/marketing/index.html", "shell.html"],
        ["packages/editor/editor.html", "editor.html"],
        ["packages/play/play.html", "play.html"],
      ];

      for (const [sourceRelativePath, targetRelativePath] of htmlCopies) {
        const sourcePath = resolve(WEB_BUILD_PUBLIC_DIR, sourceRelativePath);
        const targetPath = resolve(WEB_BUILD_PUBLIC_DIR, targetRelativePath);
        if (fs.existsSync(sourcePath)) {
          fs.copyFileSync(sourcePath, targetPath);
        }
      }

      // GitHub Pages does not honour `_redirects` and answers deep links with
      // its global 404.html fallback.  That fallback is deliberately kept for
      // arbitrary editor/player paths, but the two entry points used by the
      // public Playground should be real directories as well.  Emitting an
      // index.html in each directory makes `/playground` and the embedded
      // `/dashboard?mode=playground` resolve with a normal 200 response on
      // every static host, including hosts that do not run rewrite rules.
      const directRouteCopies: Array<[string, string]> = [
        ["packages/site/index.html", "playground/index.html"],
        ["packages/marketing/index.html", "dashboard/index.html"],
      ];
      for (const [sourceRelativePath, targetRelativePath] of directRouteCopies) {
        const sourcePath = resolve(WEB_BUILD_PUBLIC_DIR, sourceRelativePath);
        const targetPath = resolve(WEB_BUILD_PUBLIC_DIR, targetRelativePath);
        if (fs.existsSync(sourcePath)) {
          fs.mkdirSync(path.dirname(targetPath), {recursive: true});
          fs.copyFileSync(sourcePath, targetPath);
        }
      }
    },
  };
}

function nodePolyfillsWithoutDeprecatedEsbuild(): Plugin {
  const plugin = nodePolyfills({
    // Browser code directly uses EventEmitter. Keep path for glTF-Transform's
    // lazy NodeIO export, but do not inject the full Node standard library.
    include: ["events", "path"],
    globals: {
      Buffer: false,
      global: false,
      process: false,
    },
    protocolImports: true,
  }) as Plugin;
  const originalConfig = plugin.config;

  if (!originalConfig) return plugin;

  plugin.config = async function patchedConfig(config, env) {
    const resolved = await originalConfig.call(this, config, env);
    if (!resolved || typeof resolved !== "object") return resolved;

    // Vite 8 deprecates `esbuild` in plugin config in favor of `oxc`.
    // Keep node polyfill aliases/injection behavior, but drop the deprecated key
    // to avoid noisy startup warnings until upstream migrates.
    const {esbuild, ...rest} = resolved as UserConfig & {esbuild?: unknown};
    void esbuild;
    return rest;
  };

  return plugin;
}

function redirectKtx2NodeToWebPlugin(): Plugin {
  return {
    name: "redirect-ktx2-node-to-web",
    enforce: "pre",
    resolveId: {
      filter: { id: /^\.\.\/node\/index\.js$/ },
      handler(source, importer) {
        if (source === "../node/index.js" && importer?.includes("ktx2-encoder")) {
          return KTX2_ENCODER_WEB_ENTRY;
        }
      },
    },
  };
}

function browserOnlyPhysicsWasmPlugin(): Plugin {
  const replaceGeneratedRange = (
    code: string,
    startMarker: string,
    endMarker: string,
    replacement: string,
    id: string,
  ): string => {
    const start = code.indexOf(startMarker);
    const end = start === -1 ? -1 : code.indexOf(endMarker, start + startMarker.length);
    if (start === -1 || end === -1) {
      throw new Error(`Unexpected physics WASM wrapper format: ${id}`);
    }
    return code.slice(0, start) + replacement + code.slice(end + endMarker.length);
  };

  return {
    name: "browser-only-physics-wasm",
    enforce: "pre",
    apply(_config, env) {
      return env.mode !== "test";
    },
    transform: {
      filter: {
        id: /client\/assets\/js\/ammo\/ammo\.wasm\.js(?:\?.*)?$/,
      },
      handler(code, id) {
        const queryIndex = id.indexOf("?");
        const normalizedSourceId = queryIndex === -1 ? id : id.slice(0, queryIndex);
        if (normalizedSourceId === AMMO_BROWSER_ENTRY) {
          const nodePredicate = 'ca="object"==typeof process&&process.versions?.node&&"renderer"!=process.type';
          if (!code.includes(nodePredicate)) {
            throw new Error(`Unexpected Ammo WASM wrapper format: ${normalizedSourceId}`);
          }
          return replaceGeneratedRange(
            code.replace(nodePredicate, "ca=false"),
            'if(ca){var fs=require("fs");',
            '}else if(aa||ba){',
            'if(aa||ba){',
            normalizedSourceId,
          );
        }

        return null;
      },
    },
  };
}

export default async ({ mode }) => {
  const isProduction = mode === "production";

  const visualizerPlugin = isProduction
    ? (await import("rollup-plugin-visualizer")).visualizer({
        filename: "build/bundle-analysis.html",
        open: false,
        gzipSize: true,
        brotliSize: true,
      })
    : null;
  const compressionPlugins = isProduction
    ? [
        viteCompression({
          algorithm: "brotliCompress",
          ext: ".br",
        }),
        viteCompression({
          algorithm: "gzip",
          ext: ".gz",
        }),
      ]
    : [];

  return defineConfig({
    // Resolve from the config location rather than the process cwd. This keeps
    // the same app root when Vite is started from the repository root or from
    // `client/` via the compatibility shim in `client/vite.config.ts`.
    root: resolve(__dirname, "client"),
    envPrefix: ["REACT_APP_", "REACT_ENGINE_", "NODE_ENV", "CORS_", "OLD_BUILD_SYSTEM", "USE_WORKER_PHYSICS", "PRODUCTION_BUILD"],
    assetsInclude: ["assets/**", "**/*.glb"],
    build: {
      target: "esnext",
      chunkSizeWarningLimit: 16000,
      modulePreload: {
        resolveDependencies: resolveModulePreloadDependencies,
      },
      commonjsOptions: {
        exclude: ["assets/**"],
      },
      rolldownOptions: {
        onwarn(warning, defaultHandler) {
          // three-mesh-bvh: PURE annotation in a position Rollup can't interpret (node_modules, can't fix)
          if (warning.code === "INVALID_ANNOTATION" && warning.id?.includes("three-mesh-bvh")) return;
          // LoaderSupport.js: legacy code uses eval for worker support (can't remove without rewrite)
          if (warning.code === "EVAL" && warning.id?.includes("LoaderSupport.js")) return;
          // ammo.wasm.js ships a UMD/CommonJS compatibility tail in an ESM file.
          // This warning is expected for this vendored third-party asset.
          if (warning.code === "COMMONJS_VARIABLE_IN_ESM" && warning.id?.includes("client/assets/js/ammo/ammo.wasm.js")) return;
          // import.meta.glob modules that are also statically imported elsewhere (by design)
          if (warning.code === "PLUGIN_WARNING" && warning.message?.includes("dynamic import will not move module into another chunk")) return;
          defaultHandler(warning);
        },
        input: {
          // Public marketing/docs/playground SPA (buildwithstem.com).
          main: resolve(__dirname, "client/packages/site/index.html"),
          // App shell — dashboard, project list. Reachable at /dashboard.
          shell: resolve(__dirname, "client/packages/marketing/index.html"),
          editor: resolve(__dirname, "client/packages/editor/editor.html"),
          play: resolve(__dirname, "client/packages/play/play.html"),
        },
        output: {
          codeSplitting: {
            groups: [
              {
                name: "dashboard-thumbnails",
                test: /\/client\/packages\/editor-oss\/src\/(?:utils\/thumbnailUrl|editor\/assets\/v2\/CreateDashboard\/GameOverview\/placeholderThumbnails)\.ts$/,
              },
              {
                name: "runtime-serialization-helpers",
                test: /\/client\/packages\/editor-oss\/src\/core\/(?:noDeserializeSerializers|scenePhysicsSettings)\.ts$/,
              },
              {
                name: "platform-environment",
                test: /\/client\/packages\/editor-oss\/src\/userManagement\/(?:utils\/PlatformDetector|playerProfile\/discordEnvironment)\.ts$/,
              },
              {
                name: "physics-runtime",
                test: /\/client\/packages\/(?:editor-oss|shared)\/src\/physics\/(?:PhysicsRuntimeUtil|worker\/GeometryComputePoolConfig)\.ts$/,
              },
              {
                name: "logger",
                test: /\/client\/packages\/(?:shared|editor-oss)\/src\/utils\/Logger\.ts$/,
              },
              {
                name: "vendor",
                test: /\/node_modules\/(react|react-dom)\//,
              },
            ],
          },
          entryFileNames: "assets/[name]-[hash].js",
          chunkFileNames: "assets/[name]-[hash].js",
          assetFileNames: "assets/[name]-[hash].[ext]",
        },
      },
      sourcemap: process.env.PRODUCTION_BUILD !== "true",
      outDir: "../build/public", // This is the default output directory for Create React AppContainer
    },
    optimizeDeps: {
      include: THREE_ADDON_OPTIMIZED_DEPS,
      exclude: [
        "@stemstudio/validators",
        "cesium",
        "threejs-gif-texture",
        // Bun patches this package in-repo. Let Vite serve the patched files
        // directly instead of reusing a stale optimized dependency copy.
        "@ni2khanna/uikit",
      ],
    },
    server: {
      allowedHosts: true,
      // Keep the local dev endpoint reachable through the IPv4 loopback URL
      // used by the browser/playwright verification scripts. Vite otherwise
      // prefers ::1 on some macOS versions, making 127.0.0.1 look offline.
      host: process.env.REACT_APP_HOST || "127.0.0.1",
      port: parseInt(process.env.REACT_APP_PORT || "5173"),
      open: true, // Automatically open the app in the browser on server start
      proxy: {
        "/api": {
          // Fall back to the local ai-server's default port so the dev proxy
          // works without requiring the user to first run `cp .env.example .env`.
          // REACT_APP_SERVER_HOST can still override this for custom local
          // deployments.
          target: process.env.REACT_APP_SERVER_HOST || "http://localhost:8081",
          ws: true,
          secure: process.env.REACT_APP_SECURE_WEB_SOCKET === "true",
          changeOrigin: true,
        },
        "/Upload": {
          target: process.env.REACT_APP_SERVER_HOST,
          changeOrigin: true,
        },
        "/uploads": {
          target: process.env.REACT_APP_SERVER_HOST,
          changeOrigin: true,
        },
        // Local proxy for testing Discord-style asset proxying.
        // Simulates the proxy that Discord provides in its sandboxed iframe.
        // Strips auth and internal headers to mimic Discord's reverse proxy.
        // To test using this, you'll need to set the following environment
        // variables:
        //
        // REACT_APP_ASSET_GET_PROXY_BASE=/.proxy/stem-assets
        // REACT_APP_ASSET_PUT_PROXY_BASE=/.proxy/stem-uploads
        "/.proxy/stem-assets": {
          target: "http://minio:9000",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/.proxy\/stem-assets/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.removeHeader("authorization");
              proxyReq.removeHeader("x-asset-get-proxy-base");
              proxyReq.removeHeader("x-asset-put-proxy-base");
              proxyReq.removeHeader("x-scene-id");
            });
          },
        },
        "/.proxy/stem-uploads": {
          target: "http://minio:9000",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/.proxy\/stem-uploads/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.removeHeader("authorization");
              proxyReq.removeHeader("x-asset-get-proxy-base");
              proxyReq.removeHeader("x-asset-put-proxy-base");
              proxyReq.removeHeader("x-scene-id");
            });
          },
        },
      },
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
      },
    },
    resolve: {
      alias: [
        // This repository resolves Firebase SDK imports to local stubs so the SDK
        // never enters the bundle. Keep these first so they win over
        // node_modules resolution.
        {
          find: /^firebase\/app$/,
          replacement: path.resolve(__dirname, "./client/oss-stubs/firebase-app.ts"),
        },
        {
          find: /^firebase\/auth$/,
          replacement: path.resolve(__dirname, "./client/oss-stubs/firebase-auth.ts"),
        },
        {
          find: /^firebase\/firestore$/,
          replacement: path.resolve(__dirname, "./client/oss-stubs/firebase-firestore.ts"),
        },
        {
          find: /^firebase\/analytics$/,
          replacement: path.resolve(__dirname, "./client/oss-stubs/firebase-analytics.ts"),
        },
        // {find: /^three$/, replacement: 'three/webgpu'},
        // Force @three.ez/batched-mesh-extensions to use the prebuilt WebGPU bundle
        {
          find: "@three.ez/batched-mesh-extensions",
          replacement: resolve(
            __dirname,
            "node_modules/@three.ez/batched-mesh-extensions/build/webgpu.js",
          ),
        },
        ...(mode === "test"
          ? []
          : [{
              find: /^(?:node:)?(?:fs|module|os|url|util|worker_threads)$/,
              replacement: NODE_BROWSER_UNAVAILABLE_ENTRY,
            }]),
        { find: "ammo", replacement: `${AMMO_BROWSER_ENTRY}${BROWSER_ONLY_QUERY}` },
        {
          // MUST come before the bare @web-shared alias so the api/ subpath
          // resolves to the new remote-go adapter location (alias matching is
          // first-match-wins).
          find: /^@web-shared\/api\/(.*)$/,
          replacement: path.resolve(__dirname, "./client/packages/network/src/adapters/remote-go/$1"),
        },
        {
          find: "@web-shared",
          replacement: path.resolve(__dirname, "./client/packages/shared/src"),
        },
        {
          find: "@web-dashboard",
          replacement: path.resolve(__dirname, "./client/packages/dashboard/src"),
        },
        {
          find: /^@stem\/network$/,
          replacement: path.resolve(__dirname, "./client/packages/network/src/index.ts"),
        },
        {
          find: /^@stem\/network\/api\/(.*)$/,
          replacement: path.resolve(__dirname, "./client/packages/network/src/adapters/remote-go/$1"),
        },
        {
          find: /^@stem\/network\/(.*)$/,
          replacement: path.resolve(__dirname, "./client/packages/network/src/$1"),
        },
        {
          // Deprecated: legacy alias kept until consumers migrate to @stem/network.
          find: "@web-backend",
          replacement: path.resolve(__dirname, "./client/packages/network/src"),
        },
        {
          find: /^@stem\/copilot-stemstudio$/,
          replacement: path.resolve(__dirname, "./client/oss-stubs/copilot-stemstudio.ts"),
        },
        {
          find: /^@stem\/copilot-stemstudio\/(.*)$/,
          replacement: path.resolve(__dirname, "./client/oss-stubs/copilot-stemstudio.ts"),
        },
        // Compatibility stubs for packages that are intentionally not part of
        // this repository.
        {
          find: /^@stem\/auth-firebase$/,
          replacement: path.resolve(__dirname, "./client/oss-stubs/auth-firebase.ts"),
        },
        {
          find: /^@stem\/auth-firebase\/(.*)$/,
          replacement: path.resolve(__dirname, "./client/oss-stubs/auth-firebase.ts"),
        },
        {
          find: /^@stem\/editor-oss$/,
          replacement: path.resolve(__dirname, "./client/packages/editor-oss/src/index.ts"),
        },
        {
          find: /^@stem\/editor-oss\/(.*)$/,
          replacement: path.resolve(__dirname, "./client/packages/editor-oss/src/$1"),
        },
        {
          find: /^@stem\/copilot$/,
          replacement: path.resolve(__dirname, "./client/packages/copilot/src/index.ts"),
        },
        {
          find: /^@stem\/copilot\/(.*)$/,
          replacement: path.resolve(__dirname, "./client/packages/copilot/src/$1"),
        },
        {
          find: "@stemstudio/validators",
          replacement: resolve(__dirname, "client/oss-stubs/validators.js"),
        },
      ],
    },
    test: {
      globals: true, // For describe, it, expect, etc.
      environment: "jsdom", // Simulate browser environment
      setupFiles: "./test/setupTests.ts",
      include: ["packages/**/*.test.{ts,tsx}"], // Explicitly include only our test files (relative to root: "client")
      exclude: [
        "**/node_modules/**", // Exclude all node_modules (including nested ones)
        "**/dist/**",
        "**/build/**",
      ],
      pool: "forks", // Use forked processes to prevent memory leaks
      isolate: true, // Isolate each test file in separate environment
      alias: [
        { find: /^url$/, replacement: "node:url" },
        { find: /^path$/, replacement: "node:path" },
        // Force ESM source builds to avoid circular CJS self-require in UMD bundles.
        // three-mesh-bvh's UMD does require('three-mesh-bvh') causing BVH to be undefined.
        {
          find: "three-mesh-bvh",
          replacement: resolve(__dirname, "node_modules/three-mesh-bvh/src/index.js"),
        },
        {
          find: "three-bvh-csg",
          replacement: resolve(__dirname, "node_modules/three-bvh-csg/src/index.js"),
        },
      ],
    },
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __APP_BUILD_ID__: JSON.stringify(appBuildId),
      __APP_BUILD_TIMESTAMP__: JSON.stringify(buildTimestamp),
      __BUILD_MODE__: JSON.stringify("oss"),
      "process.browser": "true",
      "process.env": (() => {
        // Only expose env vars with allowed prefixes to avoid leaking system vars (PATH, HOME, secrets, etc.)
        const allowedPrefixes = ["REACT_APP_", "REACT_ENGINE_", "CORS_", "OLD_BUILD_SYSTEM", "USE_WORKER_PHYSICS", "PRODUCTION_BUILD"];
        const allowedExact = ["NODE_ENV", "SHOW_DEV_PROPERTIES", "ACP_SESSION_DIR"];
        const filtered = Object.fromEntries(
          Object.entries(process.env).filter(([key]) =>
            allowedPrefixes.some((prefix) => key.startsWith(prefix)) || allowedExact.includes(key),
          ),
        );
        filtered.REACT_APP_SERVER_HOST =
          mode === "development"
            ? `http://localhost:${process.env.REACT_APP_PORT}`
            : process.env.REACT_APP_SERVER_HOST;
        return filtered;
      })(),
    },
    worker: {
      format: "es",
      // ktx2-encoder uses `typeof window` to choose its encoder, but Web
      // Workers intentionally have no window and would select the Node path.
      plugins: () => [
        redirectKtx2NodeToWebPlugin(),
        browserOnlyPhysicsWasmPlugin(),
      ],
      rolldownOptions: {
        output: {
          entryFileNames: "assets/worker-[name]-[hash].js",
        },
      },
    },
    plugins: [
      // Dev-server URL rewrites for the multi-HTML entry layout.
      //
      // Production routes some URL prefixes to dedicated HTML entries via
      // the static server (nginx / vercel / cf-pages):
      //   /play/*                  → packages/play/play.html (creates EngineRuntime in play-mode, mounts Player UI via init())
      //   /create/project/*        → packages/editor/editor.html (creates the full editor EngineRuntime, mounts AppContainer)
      //   /stem-editor/*           → packages/editor/editor.html (same — script-only stem editor view)
      // everything else            → packages/marketing/index.html (PublicAppContainerLite, no engine)
      //
      // Vite dev has no notion of these rewrites — without this plugin every
      // URL falls through to index.html, which mounts PublicAppContainerLite.
      // That works for `/dashboard` and similar marketing-shell routes, but
      // breaks any route whose React subtree expects an EngineRuntime or the
      // AppContainer provider stack (SceneAssetResolutionProvider, etc.).
      // Symptoms observed: hung loader on `/play/<id>` (no engine), and
      // "useAssetResolution must be used inside AssetResolutionProvider" on
      // `/create/project/<id>` (no provider). This middleware mirrors the
      // production routing so dev hits the right HTML entry for each URL
      // family.
      {
        name: "stemstudio-dev-html-routing",
        configureServer(server) {
          server.middlewares.use((req, _res, next) => {
            const url = req.url ?? "";
            const pathname = url.split("?")[0] ?? "";
            // Accept-header guard so we only rewrite the document fetch,
            // not JS / CSS / asset requests that happen to live under
            // the same prefix (none today, but future-proofing).
            const accepts = (req.headers["accept"] ?? "").toString();
            if (!accepts.includes("text/html")) {
              next();
              return;
            }
            if (pathname.startsWith("/play/")) {
              req.url = "/packages/play/play.html";
            } else if (
                pathname === "/create/project" ||
                pathname.startsWith("/create/project/") ||
                pathname.startsWith("/stem-editor/")
            ) {
                req.url = "/packages/editor/editor.html";
            } else if (
                pathname === "/" ||
                pathname === "/docs" ||
                pathname.startsWith("/docs/") ||
                pathname === "/playground" ||
                pathname.startsWith("/playground/")
            ) {
                // Public site (landing / docs / playground iframe wrapper).
                req.url = "/packages/site/index.html";
            } else {
                // Everything else is an app-shell route (dashboard, login,
                // settings, browse, etc.) and continues to be served by
                // the marketing/PublicAppContainerLite entry.
                req.url = "/packages/marketing/index.html";
            }
            next();
          });
        },
      },
      // Specialize generated dual-runtime wrappers before browser bundling.
      browserOnlyPhysicsWasmPlugin(),
      nodePolyfillsWithoutDeprecatedEsbuild(),
      imagetools(),
      react({ include: reactRefreshInclude, exclude: reactRefreshExclude }),
      emitAppVersionManifest(),
      cesiumAssetsPlugin(),
      normalizeHtmlEntrypointsPlugin(),
      ...compressionPlugins,
      // Bundle analyzer (production only)
      visualizerPlugin,
      ViteImageOptimizer({
        test: /\.(jpe?g|png|gif|tiff|webp|svg|avif)$/i,
        // This GIF exceeds Sharp's pixel limits and fails optimization.
        // Skip it while keeping optimization for other assets.
        exclude: /asset_library.*\.gif$/i,
        include: undefined,
        includePublic: true,
        logStats: true,
        ansiColors: true,
        svg: {
          multipass: true,
          plugins: [
            {
              name: "preset-default",
              params: {
                overrides: {
                  cleanupNumericValues: false,
                  removeViewBox: false,
                },
              },
            },
            "removeViewBox",
            "sortAttrs",
            {
              name: "addAttributesToSVGElement",
              params: {
                attributes: [{ xmlns: "http://www.w3.org/2000/svg" }],
              },
            },
          ],
        },
        png: {
          // https://sharp.pixelplumbing.com/api-output#png
          quality: 90, // More aggressive compression for large PNGs
          compressionLevel: 9, // Maximum compression
        },
        jpeg: {
          // https://sharp.pixelplumbing.com/api-output#jpeg
          quality: 80, // More aggressive for large images
          progressive: true,
        },
        jpg: {
          // https://sharp.pixelplumbing.com/api-output#jpeg
          quality: 80, // More aggressive for large images
          progressive: true,
        },
        tiff: {
          // https://sharp.pixelplumbing.com/api-output#tiff
          quality: 90,
        },
        // gif does not support lossless compression
        // https://sharp.pixelplumbing.com/api-output#gif
        gif: {},
        webp: {
          // https://sharp.pixelplumbing.com/api-output#webp
          lossless: true,
        },
        avif: {
          // https://sharp.pixelplumbing.com/api-output#avif
          lossless: true,
        },
        cache: true,
        // Live inside ./build/ so the cache doesn't clutter the repo root and
        // is gitignored along with the rest of build output.
        cacheLocation: "./build/imageCache",
      }),
    ].filter(Boolean), // Remove falsy plugins
  });
};
