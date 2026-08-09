// Keep `cd client && vite dev` on the same configuration as the supported
// repository-root command. Without this shim Vite silently falls back to its
// defaults, so TypeScript path aliases such as `@web-shared/*` fail at runtime.
export {default} from "../vite.config.ts";
