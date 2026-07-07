import type { AngleUnitsSettings } from "./AngleUnitsSection";
import type { SnappingSettings } from "./SnappingSection";
import type { UnitsSettings } from "./UnitsSection";

export type BoundingBoxMode = "oobb" | "aabb";

export interface BoundingBoxSettings {
  mode: BoundingBoxMode;
}

export const DEFAULT_BOUNDING_BOX_SETTINGS: BoundingBoxSettings = {
  mode: "oobb",
};

export const DEFAULT_SNAPPING_SETTINGS: SnappingSettings = {
  playMode: {
    enabled: false,
  },
  grid: {
    enabled: true,
    increment: 0.25,
  },
  rotation: {
    enabled: true,
    angleDegrees: 15,
  },
  scale: {
    enabled: true,
    increment: 0.1,
  },
  geometric: {
    enabled: false,
    snapToVertex: false,
    snapToEdge: false,
    snapToFace: false,
    snapDistance: 0.5,
    visualFeedback: true,
  },
  priority: "auto",
};

type PartialSnappingSettings = Partial<SnappingSettings> & {
  playMode?: Partial<SnappingSettings["playMode"]>;
  grid?: Partial<SnappingSettings["grid"]>;
  rotation?: Partial<SnappingSettings["rotation"]>;
  scale?: Partial<SnappingSettings["scale"]>;
  geometric?: Partial<SnappingSettings["geometric"]>;
};

export const mergeSnappingSettings = (
  settings?: PartialSnappingSettings | null,
): SnappingSettings => ({
  ...DEFAULT_SNAPPING_SETTINGS,
  ...settings,
  playMode: {
    ...DEFAULT_SNAPPING_SETTINGS.playMode,
    ...settings?.playMode,
  },
  grid: {
    ...DEFAULT_SNAPPING_SETTINGS.grid,
    ...settings?.grid,
  },
  rotation: {
    ...DEFAULT_SNAPPING_SETTINGS.rotation,
    ...settings?.rotation,
  },
  scale: {
    ...DEFAULT_SNAPPING_SETTINGS.scale,
    ...settings?.scale,
  },
  geometric: {
    ...DEFAULT_SNAPPING_SETTINGS.geometric,
    ...settings?.geometric,
  },
});

export const DEFAULT_UNITS_SETTINGS: UnitsSettings = {
  enabled: true,
  currentUnit: "meters",
};

export const getSnappingSettings = (
  scene?: { userData?: Record<string, unknown> } | null,
): SnappingSettings =>
  mergeSnappingSettings(
    scene?.userData?.snapping as PartialSnappingSettings | undefined,
  );

export const getUnitsSettings = (
  scene?: { userData?: Record<string, unknown> } | null,
): UnitsSettings => ({
  ...DEFAULT_UNITS_SETTINGS,
  ...((scene?.userData?.units as Partial<UnitsSettings> | undefined) ?? {}),
});

export const DEFAULT_ANGLE_UNITS_SETTINGS: AngleUnitsSettings = {
  currentUnit: "degrees",
};
