const DOCS_URL_OVERRIDE =
  import.meta.env.VITE_STEM_DOCS_URL ?? import.meta.env.REACT_APP_DOCS_URL;

export function getEditorDocsUrl(docsUrlOverride = DOCS_URL_OVERRIDE) {
  const trimmed = docsUrlOverride?.trim();
  return trimmed || "/docs";
}
