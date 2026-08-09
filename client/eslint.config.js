// Full-repo ESLint flat config for `bun run lint` (ESLint 9).
//
// This is the default config ESLint picks up when running `eslint packages`
// from `client/`. It applies the standard recommended rule sets across the
// whole workspace (JS + TypeScript + React + React Hooks).
//
// Severity policy: the recommended rule sets surface ~24k pre-existing
// violations across the exported tree. Treating those as errors would keep
// CI permanently red, so the recommended rules are downgraded to `warn` —
// `bun run lint` still reports every issue (full visibility, incremental
// cleanup possible) but exits 0. A short allowlist of rules that catch real
// bugs (not style) is kept at `error` so regressions there still fail CI.
//
// The narrower `eslint.boundary.cjs` is still run separately by
// `bun run lint:oss-boundary` and remains the load-bearing gate that keeps
// hosted-service imports out of `@stem/editor-oss`. This config does NOT
// duplicate that boundary contract — keep the two concerns separate.

import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import importPlugin from 'eslint-plugin-import';

/**
 * Rewrite every rule in a recommended rule set to `warn`, preserving any
 * rule options. `off` entries stay off.
 * @param {Record<string, unknown>} rules
 * @returns {Record<string, unknown>}
 */
function asWarnings(rules) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [name, value] of Object.entries(rules ?? {})) {
    if (Array.isArray(value)) {
      const [severity, ...options] = value;
      out[name] = severity === 'off' || severity === 0 ? ['off', ...options] : ['warn', ...options];
    } else {
      out[name] = value === 'off' || value === 0 ? 'off' : 'warn';
    }
  }
  return out;
}

/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/*.d.ts',
      'packages/editor-oss/src/physics/worker/**',
      '**/__generated__/**',
      '**/ammo/*.js',
      '**/draco/**',
      '**/basis/**',
      '**/ktx2/*.js',
    ],
  },
  {
    files: ['packages/**/*.{ts,tsx,js,jsx,mjs,cjs}'],
    // Source carries many `eslint-disable` directives for type-aware rules
    // (`no-unsafe-*`, `no-floating-promises`, `restrict-*`, …) that this
    // non-type-checked config does not run. Reporting them as "unused" is
    // pure noise — the directives stay correct for any future type-aware
    // lint pass — so don't flag unused disable directives.
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {jsx: true},
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      react,
      'react-hooks': reactHooks,
      // Registered so inline `eslint-disable import/...` directives in source
      // resolve to a known rule. The import rules are intentionally left
      // disabled — their resolver pass is slow and adds no signal here.
      import: importPlugin,
    },
    settings: {
      react: {version: 'detect'},
    },
    rules: {
      ...asWarnings(js.configs.recommended.rules),
      ...asWarnings(tsPlugin.configs.recommended.rules),
      ...asWarnings(react.configs.recommended.rules),
      // TypeScript already resolves identifiers; `no-undef` only produces
      // false positives on typed code (browser/Node globals, JSX, etc.).
      'no-undef': 'off',
      // React 17+ automatic JSX runtime — no in-scope React import needed.
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      // Honour the `_`-prefix convention: an unused arg/var/catch-binding
      // deliberately renamed with a leading underscore is not reported.
      // `args: after-used` only flags trailing unused params.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      // Kept at `error`: these catch real bugs, not style. Regressions here
      // fail CI; the recommended-set backlog above only warns.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-debugger': 'error',
      'no-cond-assign': ['error', 'except-parens'],
      'no-dupe-keys': 'error',
      'no-unsafe-negation': 'error',
    },
  },
  {
    // Ported Three.js loaders/controls and browser polyfills. These carry
    // pre-ESM-idiom code where aliasing `this` to a local (`var scope = this`)
    // inside nested callbacks is the original upstream pattern — not worth
    // rewriting in vendored-style files.
    files: ['packages/*/src/assets/js/**', 'packages/*/src/polyfills.js'],
    rules: {
      '@typescript-eslint/no-this-alias': 'off',
    },
  },
];
