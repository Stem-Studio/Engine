// Narrow ESLint config used by `bun run lint:oss-boundary`. The full repo
// config (eslint.config.cjs) accumulated 1437 pre-existing errors across
// rules unrelated to the open-source package boundary — running it as a gate
// is a separate cleanup project. This config enforces only that boundary, so a green
// `lint:oss-boundary` is the load-bearing CI gate that prevents new
// hosted-service imports from leaking into `@stem/editor-oss`.
//
// Keep this list aligned with the per-files block in eslint.config.cjs.

const parserTypeScript = require('@typescript-eslint/parser');

/** @type {import("eslint").Linter.FlatConfig[]} */
module.exports = [
  {ignores: ['public/**', 'src/physics/worker/**', 'test/setupTests.ts']},
  {
    files: ['packages/editor-oss/src/**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      parser: parserTypeScript,
      parserOptions: {
        sourceType: 'module',
        ecmaFeatures: {jsx: true},
      },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@web-dashboard', '@web-dashboard/*', '@stemstudio/web-dashboard', '@stemstudio/web-dashboard/*'],
              message: 'editor-oss must not import from the dashboard package.',
            },
            {
              group: ['@stemstudio/web-marketing', '@stemstudio/web-marketing/*'],
              message: 'editor-oss must not import from the marketing package.',
            },
            {
              group: ['@web-backend', '@web-backend/*'],
              message:
                'editor-oss must not import @stem/network internals via the legacy @web-backend alias. Use the public @stem/network entrypoint instead.',
            },
            {
              group: ['@stem/copilot', '@stem/copilot/*', '@stem/copilot-stemstudio', '@stem/copilot-stemstudio/*'],
              message:
                'editor-oss must not depend on the hosted copilot bridge. Use ICopilotProvider (client/packages/editor-oss/src/copilot/) and inject a concrete implementation via the compatibility bootstrap.',
            },
            {
              group: ['stripe', '@stripe/*'],
              message: 'editor-oss must not depend on Stripe.',
            },
            {
              group: ['firebase', 'firebase/*', '@firebase/*', '@web-shared/firebase', '@web-shared/firebase/*', '@stem/auth-firebase', '@stem/auth-firebase/*'],
              message:
                'editor-oss must not depend on Firebase. Use IAuthProvider / IAnalyticsRecorder / IRemoteDocStore and inject concrete implementations through the compatibility bootstrap.',
            },
            {
              // Ban @web-shared/* from inside editor-oss except for the five
              // subsystems that genuinely live in shared/ (`routes`, `player/`,
              // `queryClient`, `editorConfig`, `AppRuntime` — see the
              // 2026-05-16 self-reference cleanup). Subsystem code that lives
              // in editor-oss must route to itself via `@stem/editor-oss/...`,
              // not back through a shim path. Uses a negative-lookahead regex
              // because `no-restricted-imports`'s gitignore-style `group`
              // patterns ignore `!` negations.
              regex: '^@web-shared/(?!routes($|/)|player($|/)|queryClient$|editorConfig$|AppRuntime$).+',
              message:
                'editor-oss should route to itself via @stem/editor-oss/* — not through the @web-shared shim. The five shared-only paths (routes, player/, queryClient, editorConfig, AppRuntime) are the only allowed exceptions.',
            },
            // @web-shared/api/stripe is shielded the same way: the export
            // script's open-source overrides replace it with a null-shaped stub at
            // export time, and the 3 stripe-coupled files inside editor-oss
            // (Products, CreditsPurchaseModal, CreditsSummary) are listed
            // in the per-file override block below to skip the boundary
            // check until physical migration into a dashboard-internal
            // package lands.
          ],
        },
      ],
    },
  },
  // Pre-existing tech-debt allowlist: these legacy billing UI files are inert
  // in this repository because the feature flag is always false and the
  // network adapter is a compatibility stub. The boundary gate still bans
  // new Stripe imports everywhere else.
  {
    files: [
      'packages/editor-oss/src/editor/assets/v2/CreateDashboard/AdminPanel/Products/Products.tsx',
      'packages/editor-oss/src/editor/assets/v2/CreditsPurchaseModal/CreditsPurchaseModal.tsx',
      'packages/editor-oss/src/editor/assets/v2/CreditsSummary/CreditsSummary.tsx',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
];
