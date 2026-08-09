import type { Object3D, Scene } from "three";

import global from "@stem/editor-oss/global";
import { traverseObjectDepthFirst } from "@stem/editor-oss/utils/SceneTraverser";

// Token limit for AI Copilot prompts
export const MAX_PROMPT_TOKENS = 200000;
export const CHARS_PER_TOKEN = 2.5;

// Maximum characters in serialized objects context
export const MAX_SERIALIZED_CHARS = Math.floor(
  MAX_PROMPT_TOKENS * CHARS_PER_TOKEN * 0.05,
); // 5% of limit for focused attached-object context

/**
 * Estimate token count from text length
 * @param text Text to estimate
 * @returns Estimated token count
 */
export const estimateTokenCount = (text: string): number => {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
};

/**
 * Calculate size of serialized objects in characters.
 * Note: Objects should already be optimized with serializeObjectForAI before passing here.
 * @param serializedObjects Array of already optimized serialized objects
 * @returns Total character count
 */
export const calculateSerializedSize = (
  serializedObjects: unknown[],
): number => {
  try {
    const jsonString = JSON.stringify(serializedObjects);
    return jsonString.length;
  } catch (error) {
    console.error("Failed to calculate serialized size:", error);
    return 0;
  }
};

/**
 * Calculate estimated size after adding a new object.
 * Note: newObject should already be optimized with serializeObjectForAI.
 * @param currentObjects Current array of optimized serialized objects
 * @param newObject New optimized serialized object to add
 * @returns Estimated total character count
 */
export const estimateSizeWithNewObject = (
  currentObjects: unknown[],
  newObject: unknown,
  currentSerializedSize?: number,
): number => {
  try {
    if (currentSerializedSize !== undefined) {
      const serializedElement = JSON.stringify([newObject]);
      const elementSize = serializedElement.length - 2;
      return (
        currentSerializedSize +
        elementSize +
        (currentObjects.length > 0 ? 1 : 0)
      );
    }
    const combined = [...currentObjects, newObject];
    return calculateSerializedSize(combined);
  } catch (error) {
    console.error("Failed to estimate size with new object:", error);
    return Number.POSITIVE_INFINITY;
  }
};

/**
 * Check if adding an object would exceed the size limit.
 * Note: All objects should already be optimized with serializeObjectForAI.
 * @param currentObjects Current array of optimized serialized objects
 * @param newObject New optimized serialized object to add
 * @returns True if within limit, false if exceeds
 */
export const canAddObject = (
  currentObjects: unknown[],
  newObject: unknown,
  currentSerializedSize?: number,
): boolean => {
  const estimatedSize = estimateSizeWithNewObject(
    currentObjects,
    newObject,
    currentSerializedSize,
  );
  return estimatedSize <= MAX_SERIALIZED_CHARS;
};

/**
 * Get formatted size information
 * @param charCount Character count
 * @returns Formatted size info
 */
export const formatSizeInfo = (
  charCount: number,
): { chars: number; tokens: number; percentage: number } => {
  const tokens = Math.ceil(charCount / CHARS_PER_TOKEN);
  const percentage = (charCount / MAX_SERIALIZED_CHARS) * 100;
  return {
    chars: charCount,
    tokens: tokens,
    percentage: Math.round(percentage * 10) / 10,
  };
};

/**
 * Build optimized context from already summarized attached objects.
 * @param serializedObjects
 */
export const buildOptimizedContext = (
  serializedObjects: unknown[],
): { attachedObjects?: unknown[]; metadata?: unknown } => {
  if (serializedObjects.length === 0) {
    return {};
  }

  return {
    attachedObjects: serializedObjects,
    metadata: {
      objectCount: serializedObjects.length,
    },
  };
};

export type StructuredSceneSummaryObject = {
  name: string;
  uuid: string;
  type: string;
  childCount: number;
  behaviorCount: number;
  physics: boolean;
};

export type StructuredSceneSummary = {
  rootCount: number;
  totalObjectCount: number;
  topObjectTypes: Array<{ type: string; count: number }>;
  selectedObjects: StructuredSceneSummaryObject[];
  highSalienceObjects: StructuredSceneSummaryObject[];
  behaviorCount: number;
  physicsCount: number;
};

export type StructuredBehaviorAttributeSummary = {
  key: string;
  type?: string;
  default?: unknown;
};

export type StructuredBehaviorSummary = {
  id: string;
  name?: string;
  description?: string;
  isScript?: boolean;
  isSingleton?: boolean;
  isHidden?: boolean;
  attributes: StructuredBehaviorAttributeSummary[];
};

export type StructuredLambdaSummary = {
  id: string;
  name?: string;
  description?: string;
  attributes: StructuredBehaviorAttributeSummary[];
  componentSchema: StructuredBehaviorAttributeSummary[];
};

type BehaviorConfigLike = {
  id?: string;
  name?: string;
  description?: string;
  isScript?: boolean;
  isSingleton?: boolean;
  isHidden?: boolean;
  attributes?: Record<string, unknown>;
};

type LambdaConfigLike = {
  id?: string;
  name?: string;
  description?: string;
  attributes?: Record<string, unknown>;
  componentSchema?: Record<string, unknown>;
};

type EditorSceneApp = {
  editor?: {
    behaviorConfigRegistry?: {
      getAllConfigs?: () => BehaviorConfigLike[];
    };
    lambdaConfigRegistry?: {
      getAllConfigs?: () => LambdaConfigLike[];
    };
    scene?: Scene;
    selected?: Object3D | Object3D[] | null;
  };
  scene?: Scene;
};

function getEditorSceneApp(): EditorSceneApp | undefined {
  return global.app as unknown as EditorSceneApp | undefined;
}

function compactText(value: unknown, maxLength = 180): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 3)}...`
    : normalized;
}

function compactDefaultValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  try {
    const serialized = JSON.stringify(value);
    if (!serialized || serialized.length > 100) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function summarizeBehaviorAttribute([key, value]: [
  string,
  unknown,
]): StructuredBehaviorAttributeSummary | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : undefined;
  if (!type || type === "separator" || type === "label" || type === "button")
    return null;

  const summary: StructuredBehaviorAttributeSummary = { key, type };
  const defaultValue = compactDefaultValue(record.default);
  if (defaultValue !== undefined) {
    summary.default = defaultValue;
  }
  return summary;
}

/**
 * Build a compact behavior registry snapshot for the direct playground copilot.
 * This includes built-in behaviors and any imported/custom behavior configs
 * already registered in the scene, but intentionally omits behavior code.
 */
export const buildBehaviorRegistrySummary = (
  limit = Number.POSITIVE_INFINITY,
): StructuredBehaviorSummary[] => {
  const app = getEditorSceneApp();
  const configs = app?.editor?.behaviorConfigRegistry?.getAllConfigs?.() ?? [];
  const seen = new Set<string>();
  const summaries: StructuredBehaviorSummary[] = [];

  for (const config of configs) {
    const id = typeof config.id === "string" ? config.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);

    summaries.push({
      id,
      name: compactText(config.name, 80),
      description: compactText(config.description),
      isScript: config.isScript,
      isSingleton: config.isSingleton,
      isHidden: config.isHidden,
      attributes: Object.entries(config.attributes ?? {})
        .map(summarizeBehaviorAttribute)
        .filter(
          (item): item is StructuredBehaviorAttributeSummary => item !== null,
        )
        .slice(0, 16),
    });

    if (summaries.length >= limit) break;
  }

  return summaries;
};

export const buildLambdaRegistrySummary = (
  limit = Number.POSITIVE_INFINITY,
): StructuredLambdaSummary[] => {
  const app = getEditorSceneApp();
  const configs = app?.editor?.lambdaConfigRegistry?.getAllConfigs?.() ?? [];
  const seen = new Set<string>();
  const summaries: StructuredLambdaSummary[] = [];

  for (const config of configs) {
    const id = typeof config.id === "string" ? config.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);

    summaries.push({
      id,
      name: compactText(config.name, 80),
      description: compactText(config.description),
      attributes: Object.entries(config.attributes ?? {})
        .map(summarizeBehaviorAttribute)
        .filter(
          (item): item is StructuredBehaviorAttributeSummary => item !== null,
        )
        .slice(0, 16),
      componentSchema: Object.entries(config.componentSchema ?? {})
        .map(summarizeBehaviorAttribute)
        .filter(
          (item): item is StructuredBehaviorAttributeSummary => item !== null,
        )
        .slice(0, 16),
    });

    if (summaries.length >= limit) break;
  }

  return summaries;
};

function getObjectBehaviorCount(object: Object3D): number {
  const behaviorValues = [
    object.userData?.behaviors,
    object.userData?.Behaviors,
    object.userData?.behaviorIds,
    object.userData?.BehaviorIDs,
  ];
  for (const value of behaviorValues) {
    if (Array.isArray(value)) return value.length;
    if (value && typeof value === "object") return Object.keys(value).length;
  }
  return 0;
}

function hasPhysics(object: Object3D): boolean {
  const physics = object.userData?.physics || object.userData?.Physics;
  if (!physics || typeof physics !== "object") return false;
  return physics.enabled !== false;
}

function summarizeObject(object: Object3D): StructuredSceneSummaryObject {
  return {
    name: object.name || object.type || "Object3D",
    uuid: object.uuid,
    type: object.type,
    childCount: object.children.length,
    behaviorCount: getObjectBehaviorCount(object),
    physics: hasPhysics(object),
  };
}

function getSelectedObjects(
  selected: Object3D | Object3D[] | null | undefined,
): Object3D[] {
  if (!selected) return [];
  return Array.isArray(selected) ? selected.filter(Boolean) : [selected];
}

/**
 * Build a small, structured scene summary for intent-gated Copilot context.
 * This intentionally avoids full object serialization; detailed data remains available through scene tools.
 */
export const buildStructuredSceneSummary = (
  scene?: Scene,
  selected?: Object3D | Object3D[] | null,
): StructuredSceneSummary | null => {
  const app = getEditorSceneApp();
  const resolvedScene = scene || app?.editor?.scene || app?.scene;
  const resolvedSelected =
    selected === undefined ? app?.editor?.selected : selected;
  if (!resolvedScene) return null;

  const typeCounts = new Map<string, number>();
  let totalObjectCount = 0;
  let behaviorCount = 0;
  let physicsCount = 0;

  traverseObjectDepthFirst(
    resolvedScene,
    (object) => {
      totalObjectCount += 1;
      typeCounts.set(object.type, (typeCounts.get(object.type) || 0) + 1);
      behaviorCount += getObjectBehaviorCount(object);
      if (hasPhysics(object)) {
        physicsCount += 1;
      }
    },
    { includeRoot: false },
  );

  const selectedObjects = getSelectedObjects(resolvedSelected)
    .slice(0, 8)
    .map(summarizeObject);
  const selectedUUIDs = new Set(selectedObjects.map((object) => object.uuid));
  const highSalienceObjects: StructuredSceneSummaryObject[] = [];
  let rootCount = 0;
  for (const object of resolvedScene.children) {
    if (object.visible === false) continue;
    rootCount++;
    if (highSalienceObjects.length < 8 && !selectedUUIDs.has(object.uuid)) {
      highSalienceObjects.push(summarizeObject(object));
    }
  }

  return {
    rootCount,
    totalObjectCount,
    topObjectTypes: Array.from(typeCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([type, count]) => ({ type, count })),
    selectedObjects,
    highSalienceObjects,
    behaviorCount,
    physicsCount,
  };
};
