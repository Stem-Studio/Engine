import {Scene} from "three";

import {SEARCH_GAME_QUERY} from "./types";
import {ROUTES} from "@web-shared/routes";
import {DEFAULT_FILE_DATA, FileData} from "../../editor/assets/v2/types/file";
import {traverseObjectDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";

export const truncateName = (name: string, limit: number) => {
    if (name.length > limit) {
        return name.slice(0, limit) + "...";
    }
    return name;
};

export const formatNumber = (n: number, maxWithoutK?: number) => {
    if (maxWithoutK && n > maxWithoutK) {
        return Math.round(n / 1000).toLocaleString() + "k";
    } else if (n > 99999) {
        return Math.round(n / 1000).toLocaleString() + "k";
    } else {
        return n.toLocaleString();
    }
};

export const getProgressPercentage = (args: {completed: number; total: number}) => {
    const {total, completed} = args;
    if (total <= 0) {
        return console.error("Total number of tasks must be greater than zero.");
    }
    if (completed < 0) {
        return console.error("Number of completed tasks cannot be negative.");
    }
    if (completed > total) {
        return console.error("Number of completed tasks cannot exceed total number of tasks.");
    }

    const progress = completed / total * 100;
    return `${progress}%`;
};

export const isHexColor = (color: string) => {
    const hexColorRegex = /^#?([a-fA-F0-9]{6})$/;
    return hexColorRegex.test(color);
};

export const hexToRgb = (hex: string) => {
    hex = hex.replace("#", "");

    if (hex.length === 3) {
        hex = hex
            .split("")
            .map(char => char + char)
            .join("");
    }

    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    return {r, g, b};
};

export const numberToHex = (value: number): string => {
    const intValue = Math.round(value);
    const hex = intValue.toString(16);
    return hex.length === 1 ? "0" + hex : hex;
};

export const handleGetRGBValues = (color: string) => {
    const rgbValues = color.substring(4, color.length - 1);

    const [r, g, b] = rgbValues.split(",").map(val => parseFloat(val.trim()));
    return {r, g, b};
};

export const isRGB = (rgbColor: string) => rgbColor.match(/rgb\((\d+(\.\d+)?),\s*(\d+(\.\d+)?),\s*(\d+(\.\d+)?)\)/);

export const rgbToHex = (rgbColor: string): string => {
    const match = isRGB(rgbColor);

    if (!match) {
        console.error("Incorrect format of RGB");
        return "#ffffff";
    }

    if (match.length < 6) {
        return "#ffffff";
    }
    const r = numberToHex(parseFloat(match[1] ?? "0"));
    const g = numberToHex(parseFloat(match[3] ?? "0"));
    const b = numberToHex(parseFloat(match[5] ?? "0"));

    return `#${r}${g}${b}`;
};

export type ModelData = {
    Url: string;
    Name: string;
    ID: string;
    IsAvatar: boolean;
    Type: string;
    ERTHLibrary: boolean;
    Tags: string[];
    Description: string;
    CreatedAt: string;
    UpdatedAt: string;
    IsAIGenerated: boolean;
    Thumbnail: string;
};

export const fetchModels = async (_SceneID?: string, _ERTHModels?: boolean): Promise<ModelData[]> => {
    return [];
};

export const getSceneUniqueModels = (scene: Scene) => {
    const modelsData: FileData[] = [];
    const seenModelIds = new Set<string>();
    const validKeys = new Set(Object.keys(DEFAULT_FILE_DATA) as (keyof FileData)[]);

    const cleanUserData = (userData: any): FileData => {
        const cleanedData: Partial<FileData> = {};

        for (const key in userData) {
            if (validKeys.has(key as keyof FileData)) {
                cleanedData[key as keyof FileData] = userData[key];
            }
        }

        return cleanedData as FileData;
    };

    traverseObjectDepthFirst(scene, child => {
        const modelId = child.userData.ID;
        if (!modelId || seenModelIds.has(modelId)) return;
        seenModelIds.add(modelId);
        modelsData.push(cleanUserData(child.userData));
    });

    return modelsData.reverse();
};

export const getObjectNamesInScene = (scene: Scene) => {
    const objectNames = new Set<string>();
    traverseObjectDepthFirst(scene, child => {
        if (child.name) {
            objectNames.add(child.name);
        }
    });
    return objectNames;
};

export const generateUniqueName = (baseName: string, existingNames: Set<string>): string => {
    const namePattern = /^(.*?)(?:\s(\d+))?$/;
    const match = baseName.match(namePattern);
    let name = match ? match[1]?.trim() : baseName;
    let counter = 1;
    let newName = `${name}`;

    while (existingNames.has(newName)) {
        newName = `${name} ${counter}`;
        counter++;
    }

    return newName;
};

/**
 * Generates a unique name using a monotonically increasing counter stored in scene userData.
 * This ensures that clone numbers always increase, even if objects are deleted.
 *
 * @param baseName - The base name of the object (e.g., "Box")
 * @param scene - The Three.js scene object
 * @param existingNames - Set of existing names in the scene
 * @returns A unique name with a monotonically increasing suffix
 */
export const generateUniqueNameWithCounter = (baseName: string, scene: Scene, existingNames: Set<string>): string => {
    // Initialize clone counter in scene userData if it doesn't exist
    if (!scene.userData.cloneCounter) {
        scene.userData.cloneCounter = {};
    }

    // Extract the base name without any existing number suffix
    const namePattern = /^(.*?)(?:\s(\d+))?$/;
    const match = baseName.match(namePattern);
    const name: string = (match ? match[1]?.trim() : baseName) ?? baseName;

    // If this exact name doesn't exist in the scene, use it without a number
    if (!existingNames.has(name)) {
        // Initialize counter for this base name if needed
        if (scene.userData.cloneCounter[name] === undefined) {
            scene.userData.cloneCounter[name] = 1;
        }
        return name;
    }

    // Get or initialize the counter for this base name
    if (scene.userData.cloneCounter[name] === undefined) {
        // Find the highest existing number for this base name to initialize counter
        let maxNumber = 0;
        existingNames.forEach(existingName => {
            const existingMatch = existingName.match(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s(\\d+))?$`));
            if (existingMatch && existingMatch[1]) {
                const num = parseInt(existingMatch[1], 10);
                if (num > maxNumber) {
                    maxNumber = num;
                }
            }
        });
        scene.userData.cloneCounter[name] = maxNumber + 1;
    }

    // Generate name with the current counter value
    let newName = `${name} ${scene.userData.cloneCounter[name]}`;

    // Increment counter for next use
    scene.userData.cloneCounter[name]++;

    // Safety check: ensure the name is unique (shouldn't happen with proper counter management)
    while (existingNames.has(newName)) {
        newName = `${name} ${scene.userData.cloneCounter[name]}`;
        scene.userData.cloneCounter[name]++;
    }

    return newName;
};

export const getGameUrl = (sceneID: string, slug: string | null) => {
    if (slug) {
        // Update published URL
        return `${slug}.${process.env.REACT_APP_DNS_SUFFIX?.replace(/^https?:\/\//, "") || "localhost"}`;
    }
    return ROUTES.PLAY.replace(":projectID", encodeURIComponent(sceneID));
};

export const saveSearchToLocalStorage = (searchItem: string) => {
    const storedSearchHistory = localStorage.getItem("searchHistory");
    const currentSearches: string[] = storedSearchHistory ? JSON.parse(storedSearchHistory) : [];

    if (!currentSearches.includes(searchItem)) {
        currentSearches.unshift(searchItem);
        // keep max 3 recent searches
        if (currentSearches.length > 3) {
            currentSearches.pop(); //remove the oldest element
        }
        localStorage.setItem("searchHistory", JSON.stringify(currentSearches));
        return currentSearches;
    }
};

export const getQueryParams = (): Partial<Record<SEARCH_GAME_QUERY, string>> => {
    const queryParams = new URLSearchParams(location.search);
    const params: Partial<Record<SEARCH_GAME_QUERY, string>> = {};

    Object.values(SEARCH_GAME_QUERY).forEach(key => {
        const value = queryParams.get(key);
        if (value) {
            params[key] = value;
        }
    });

    return params;
};

export const generateProjectLink = (projectId?: string, options?: {readOnly?: boolean}) => {
    const params = new URLSearchParams(window.location.search);
    const hasFTUE = params.get("ftue");
    if (projectId) {
        const query = new URLSearchParams();
        if (hasFTUE) query.set("ftue", "true");
        if (options?.readOnly) query.set("readOnly", "1");
        const qs = query.toString();
        return `${ROUTES.CREATE_PROJECT}/${projectId}${qs ? `?${qs}` : ""}`;
    } else {
        return `${ROUTES.CREATE_PROJECT}`;
    }
};
