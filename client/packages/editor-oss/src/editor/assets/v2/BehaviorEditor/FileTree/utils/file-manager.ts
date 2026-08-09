import {BehaviorConfig} from "../../../../../behaviors/BehaviorConfig";
import {cloneJsonCompatible} from "../../../../../../utils/cloneJsonCompatible";

export enum Type {
    FILE, // file
    DIRECTORY, // directory
    DUMMY, // virtual file (used for display when file fetch fails)
}

interface CommonProps {
    id: string; // file id
    type: Type; // file type
    name: string; // name
    parentId: string | undefined; // parent directory, undefined if root directory
    depth: number; // file depth
    behaviorId?: string; // behavior id if file is related to a behavior
    isLocal?: boolean; // is file local (not fetched from server)
    revisionId?: string; // for backend behaviors
}

export interface File extends CommonProps {
    content: string; // file content
    language: string; // programming language
    isSaved?: boolean; // is file saved
    fileType?: "script" | "config";
}

export interface Directory extends CommonProps {
    files: File[];
    dirs: Directory[];
    config?: BehaviorConfig; // behavior config if file is related to a behavior
}

/**
 * Build file tree
 * @param orgFiles original files array
 * @param orgDirs original directories array
 * @returns root directory containing the built file tree
 */
export function buildFileTree(orgFiles: File[], orgDirs: Directory[]): Directory {
    const cache = new Map<string, Directory | File>(); // cache
    const dirs = cloneJsonCompatible(orgDirs); // deep copy to avoid mutating original data
    const files = cloneJsonCompatible(orgFiles); // deep copy to avoid mutating original data
    // root directory to be built
    let rootDir: Directory = {
        id: "0",
        name: "root",
        parentId: undefined,
        type: Type.DIRECTORY,
        depth: 0,
        dirs: [],
        files: [],
    };
    // store <id, directory object> in map
    dirs.forEach(item => {
        const copy = {...item}; // create a copy to avoid mutating original data
        cache.set(item.id, copy);
    });
    // store <id, file object> in map
    files.forEach(item => {
        const copy = {...item}; // create a copy to avoid mutating original data
        cache.set(item.id, copy);
    });
    // start traversing to build file tree
    cache.forEach(value => {
        // '0' indicates file or directory is in root directory
        if (value.parentId === "0") {
            if (value.type === Type.DIRECTORY) rootDir.dirs.push(value as Directory);
            else rootDir.files.push(value as File);
        } else {
            const parentDir = cache.get(value.parentId as string) as Directory;
            if (value.type === Type.DIRECTORY) parentDir?.dirs?.push(value as Directory);
            else parentDir?.files.push(value as File);
        }
    });

    // get file depth
    getDepth(rootDir, 0);

    return rootDir;
}

/**
 * Get file depth
 * @param rootDir root directory
 * @param curDepth current depth
 */
function getDepth(rootDir: Directory, curDepth: number) {
    rootDir.files.forEach(file => {
        file.depth = curDepth + 1;
    });
    rootDir.dirs.forEach(dir => {
        dir.depth = curDepth + 1;
        getDepth(dir, curDepth + 1);
    });
}

/**
 * Find file by name
 * @param rootDir root directory
 * @param filename file name to search for
 * @returns found file or undefined
 */
export function findFileByName(rootDir: Directory, filename: string): File | undefined {
    let targetFile: File | undefined = undefined;

    /**
     * Helper function to recursively find file
     * @param rootDir directory to search in
     * @param filename file name to find
     */
    function findFile(rootDir: Directory, filename: string) {
        rootDir.files.forEach(file => {
            if (file.name === filename) {
                targetFile = file;
                return;
            }
        });
        rootDir.dirs.forEach(dir => {
            findFile(dir, filename);
        });
    }

    findFile(rootDir, filename);
    return targetFile;
}

/**
 * Sort directories by name
 * @param l left directory
 * @param r right directory
 * @returns comparison result for sorting
 */
export function sortDir(l: Directory, r: Directory) {
    // If both have same temporary status, sort by name
    return l.name.localeCompare(r.name);
}

/**
 * Sort files by name
 * @param l left file
 * @param r right file
 * @returns comparison result for sorting
 */
export function sortFile(l: File, r: File) {
    return l.name.localeCompare(r.name);
}

/**
 * Search files by name
 * @param rootDir root directory
 * @param searchTerm search term
 * @returns array of files matching the search term
 */
export function searchFilesByName(rootDir: Directory, searchTerm: string): File[] {
    const results: File[] = [];
    const term = searchTerm.toLowerCase();

    /**
     * Search in directory recursively
     * @param dir directory to search in
     */
    function searchInDirectory(dir: Directory) {
        dir.files.forEach(file => {
            if (file.name.toLowerCase().includes(term)) {
                results.push(file);
            }
        });
        dir.dirs.forEach(subDir => {
            searchInDirectory(subDir);
        });
    }

    searchInDirectory(rootDir);
    return results;
}

/**
 * Search content within files
 * @param rootDir root directory
 * @param searchTerm search term
 * @returns array of files with matching content and line information
 */
export function searchFilesContent(
    rootDir: Directory,
    searchTerm: string,
): Array<{file: File; matches: Array<{line: number; text: string; lineNumber: number}>}> {
    const results: Array<{file: File; matches: Array<{line: number; text: string; lineNumber: number}>}> = [];
    const term = searchTerm.toLowerCase();

    /**
     * Search in directory recursively
     * @param dir directory to search in
     */
    function searchInDirectory(dir: Directory) {
        dir.files.forEach(file => {
            const lines = file.content.split("\n");
            const matches: Array<{line: number; text: string; lineNumber: number}> = [];

            lines.forEach((line, index) => {
                if (line.toLowerCase().includes(term)) {
                    matches.push({
                        line: index,
                        text: line.trim(),
                        lineNumber: index + 1,
                    });
                }
            });

            if (matches.length > 0) {
                results.push({file, matches});
            }
        });
        dir.dirs.forEach(subDir => {
            searchInDirectory(subDir);
        });
    }

    searchInDirectory(rootDir);
    return results;
}

/**
 * Get all files in a directory recursively
 * @param rootDir root directory
 * @returns array of all files
 */
export function getAllFiles(rootDir: Directory): File[] {
    const files: File[] = [];

    /**
     * Collect files recursively
     * @param dir directory to collect from
     */
    function collectFiles(dir: Directory) {
        files.push(...dir.files);
        dir.dirs.forEach(subDir => {
            collectFiles(subDir);
        });
    }

    collectFiles(rootDir);
    return files;
}

/**
 * Find directory by id
 * @param rootDir root directory
 * @param id directory id
 * @returns found directory or undefined
 */
export function findDirectoryById(rootDir: Directory, id: string): Directory | undefined {
    if (rootDir.id === id) return rootDir;

    for (const dir of rootDir.dirs) {
        const found = findDirectoryById(dir, id);
        if (found) return found;
    }

    return undefined;
}

/**
 * Generate unique file id
 * @returns unique file id string
 */
export function generateFileId(): string {
    return "file_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
}

/**
 * Generate unique directory id
 * @returns unique directory id string
 */
export function generateDirectoryId(): string {
    return "dir_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
}
