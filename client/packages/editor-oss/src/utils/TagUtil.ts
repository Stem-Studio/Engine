import {Object3D} from "three";

import {findObjectDepthFirst, traverseObjectDepthFirst} from "./SceneTraverser";

type TagMatcher = {
    tag: string;
    path?: never;
} | {
    tag?: never;
    path: string[];
};

/**
 * Utility class for managing tags on Three.js Object3D instances.
 * Tags are stored in the object's userData?.tags property as an array of strings.
 */
class TagUtil {
    private static matcherCache = new Map<string, TagMatcher>();

    private static createMatcher(tag: string): TagMatcher {
        let matcher = this.matcherCache.get(tag);
        if (!matcher) {
            matcher = tag.includes(".") ? { path: tag.split(".") } : { tag };
            this.matcherCache.set(tag, matcher);
        }
        return matcher;
    }

    private static matchesTag(object: Object3D, matcher: TagMatcher): boolean {
        if (matcher.path) {
            let current: unknown = object.userData;

            for (const part of matcher.path) {
                if (current === undefined || current === null) {
                    return false;
                }
                current = (current as Record<string, unknown>)[part];
            }

            return Boolean(current);
        }

        return object.userData?.tags ? object.userData?.tags.includes(matcher.tag) : false;
    }

    /**
     * Adds one or more tags to an Object3D instance.
     * If the object doesn't have a tags array, it will be created.
     * Duplicate tags are ignored.
     *
     * @param object - The Object3D to add tags to
     * @param tag - A single tag string or an array of tag strings
     */
    public static addTag(object: Object3D, tag: string | string[]): void {
        if (!object.userData) {
            object.userData = {};
        }

        if (!object.userData?.tags) {
            object.userData.tags = [];
        }

        const tags = Array.isArray(tag) ? tag : [tag];

        for (const t of tags) {
            if (!object.userData?.tags.includes(t)) {
                object.userData?.tags.push(t);
            }
        }
    }

    /**
     * Removes one or more tags from an Object3D instance.
     * If the object doesn't have tags, this method does nothing.
     *
     * @param object - The Object3D to remove tags from
     * @param tag - A single tag string or an array of tag strings
     */
    public static removeTag(object: Object3D, tag: string | string[]): void {
        if (!object.userData?.tags) {
            return;
        }

        const tags = Array.isArray(tag) ? tag : [tag];

        for (const t of tags) {
            const index = object.userData?.tags.indexOf(t);
            if (index !== -1) {
                object.userData?.tags.splice(index, 1);
            }
        }
    }

    /**
     * Checks if an Object3D has a specific tag.
     * Supports both simple tags (e.g., "climbable") and nested properties (e.g., "physics.climbable").
     *
     * @param object - The Object3D to check
     * @param tag - The tag to look for (can use dot notation for nested properties)
     * @returns True if the object has the tag, false otherwise
     */
    public static hasTag(object: Object3D, tag: string): boolean {
        return this.matchesTag(object, this.createMatcher(tag));
    }

    /**
     * Checks if an Object3D has any of the specified tags.
     *
     * @param object - The Object3D to check
     * @param tags - Array of tags to look for
     * @returns True if the object has at least one of the tags, false otherwise
     */
    public static hasAnyTag(object: Object3D, tags: string[]): boolean {
        const objectTags = object.userData?.tags;
        if (!objectTags) {
            return false;
        }

        for (const tag of tags) {
            if (objectTags.includes(tag)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Checks if an Object3D has all of the specified tags.
     *
     * @param object - The Object3D to check
     * @param tags - Array of tags that must all be present
     * @returns True if the object has all the tags, false otherwise
     */
    public static hasAllTags(object: Object3D, tags: string[]): boolean {
        const objectTags = object.userData?.tags;
        if (!objectTags) {
            return false;
        }

        for (const tag of tags) {
            if (!objectTags.includes(tag)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Gets all tags from an Object3D.
     *
     * @param object - The Object3D to get tags from
     * @returns Array of tag strings, empty array if no tags exist
     */
    public static getTags(object: Object3D): string[] {
        return object.userData?.tags || [];
    }

    /**
     * Removes all tags from an Object3D.
     *
     * @param object - The Object3D to clear tags from
     */
    public static clearTags(object: Object3D): void {
        if (object.userData?.tags) {
            object.userData.tags.length = 0;
        }
    }

    /**
     * Replaces an existing tag with a new tag on an Object3D.
     * If the old tag doesn't exist, the new tag is simply added.
     *
     * @param object - The Object3D to modify
     * @param oldTag - The tag to replace
     * @param newTag - The new tag to add
     */
    public static replaceTag(object: Object3D, oldTag: string, newTag: string): void {
        if (this.hasTag(object, oldTag)) {
            this.removeTag(object, oldTag);
        }
        this.addTag(object, newTag);
    }

    /**
     * Toggles a tag on an Object3D. If the tag exists, it's removed; if it doesn't exist, it's added.
     *
     * @param object - The Object3D to modify
     * @param tag - The tag to toggle
     * @returns True if the tag was added, false if it was removed
     */
    public static toggleTag(object: Object3D, tag: string): boolean {
        if (this.hasTag(object, tag)) {
            this.removeTag(object, tag);
            return false;
        } else {
            this.addTag(object, tag);
            return true;
        }
    }

    /**
     * Finds all objects in an object or scene that have specific tags.
     * Supports both simple tags (e.g., "climbable") and nested properties (e.g., "physics.climbable").
     *
     * @param object - The Object3D to search in
     * @param tag - A single tag string or an array of tag strings to search for (supports dot notation)
     * @returns Array of Object3D instances that have any of the specified tags
     */
    public static getObjectsByTag(object: Object3D, tag: string | string[]): Object3D[] {
        const tags = Array.isArray(tag) ? tag : [tag];
        const matchers = tags.map(t => this.createMatcher(t));
        const objectsWithTag: Object3D[] = [];

        traverseObjectDepthFirst(object, child => {
            for (const matcher of matchers) {
                if (this.matchesTag(child, matcher)) {
                    objectsWithTag.push(child);
                    break;
                }
            }
        });

        return objectsWithTag;
    }

    /**
     * Finds the first object in depth-first order that has any of the requested tags.
     * Prefer this over getObjectsByTag when the caller only needs a single match.
     */
    public static getFirstObjectByTag(object: Object3D, tag: string | string[]): Object3D | null {
        const tags = Array.isArray(tag) ? tag : [tag];
        const matchers = tags.map(t => this.createMatcher(t));

        return findObjectDepthFirst(object, child => {
            for (const matcher of matchers) {
                if (this.matchesTag(child, matcher)) {
                    return true;
                }
            }
            return false;
        });
    }
}

export default TagUtil;
