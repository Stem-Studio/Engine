Startup addObject batching evidence

Scenario: focused GameManager startup addObject batching, forced behavior yield, quiescence, and barrier coverage.
Invocation: rtk bunx --bun vitest run client/packages/editor-oss/src/behaviors/game/GameManager.test.ts
Binary observable: exit 0; 1 test file passed; 63 tests passed.
Artifact: .evidence/startup-addobject-batch/vitest-game-manager.log

Scenario: progressive yield elapsed-time frameBudgetMs regression plus focused GameManager startup coverage.
Invocation: rtk bunx --bun vitest run client/packages/editor-oss/src/utils/progressiveYield.test.ts client/packages/editor-oss/src/behaviors/game/GameManager.test.ts
Binary observable: exit 0; 2 test files passed; 66 tests passed.
Artifact: .evidence/startup-addobject-batch/vitest-progressive-yield-game-manager.log

Scenario: repository TypeScript typecheck with 8GB Node heap.
Invocation: rtk env NODE_OPTIONS=--max-old-space-size=8192 bun run typecheck
Binary observable: exit 0; command completed with tsc --noEmit.
Artifact: .evidence/startup-addobject-batch/typecheck-8gb.log
