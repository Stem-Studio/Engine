// Stub for @stemstudio/validators. The importer package is not part of this
// repository, so this no-op keeps Monaco's behavior editor working without
// importer pattern checks. Monaco's built-in TypeScript service still
// surfaces syntax errors.

export function validateCode() {
    return [];
}

export default { validateCode };
