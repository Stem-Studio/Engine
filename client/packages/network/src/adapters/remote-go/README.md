# Remote-Go Compatibility Modules

These API-shaped modules retain the canonical Go server's REST contracts and
the legacy `remote-go` directory name. They are not the default deployment
mode: no-flag OSS and Playground sessions select local mode, and scene
load/save/list operations use the browser-backed `ProjectStore`. A deployment
must opt in with `?backend=remote` before treating the remote service contracts
as available.

35 domains live here, each as its own subdirectory: `asset/`, `scene/`,
`behavior/`, `lambda/`, `audio/`, `image/`, etc. Public exports go
through `network/src/index.ts` and the path alias `@stem/network/api/*`.

Imports from elsewhere in the codebase should target the alias rather
than the file paths:

```typescript
// ✓ Preferred
import {getScene} from "@stem/network/api/scene";

// ✓ Legacy (still resolves to the same files via path alias)
import {getScene} from "@web-shared/api/scene";

// ✗ Avoid — couples consumers to the adapter's physical location
import {getScene} from "../../../network/src/adapters/remote-go/scene";
```

The 6 in-tree tests (`avatarCreator/index.test.ts`, `copilotTasks/index.test.ts`,
`scene/v2.test.ts`, `scene/index.test.ts`, …) verify each domain wraps
the underlying client correctly. They use `vi.mock("@web-shared/utils/Ajax", …)`
to stub the HTTP layer.
