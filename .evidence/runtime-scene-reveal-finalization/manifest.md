Runtime scene reveal finalization evidence

Scenario: Focused runtime scene reveal regression suite, including sparse RAF coverage and the final instanced ramp acknowledgement regression.
Invocation: `bunx --bun vitest run client/packages/editor-oss/src/utils/runtimeSceneReveal.test.ts`
Binary observable: exit code 0; `Test Files  1 passed (1)`; `Tests  33 passed (33)`.
Captured artifact: `.evidence/runtime-scene-reveal-finalization/vitest-runtimeSceneReveal.log`

Scenario: 8GB TypeScript typecheck.
Invocation: `NODE_OPTIONS=--max-old-space-size=8192 bun run typecheck`
Binary observable: exit code 0; `tsc --noEmit` emitted no diagnostics.
Captured artifact: `.evidence/runtime-scene-reveal-finalization/typecheck-8gb.log`
