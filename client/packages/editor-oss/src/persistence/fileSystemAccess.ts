export const isFileSystemAccessSupported = (): boolean =>
    typeof window !== "undefined" &&
    typeof (window as unknown as {showDirectoryPicker?: unknown}).showDirectoryPicker === "function";
