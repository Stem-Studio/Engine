# BIM Plan

BIM Plan is the architectural planning surface behind the per-project **Enable CAD & BIM tools (beta)** toggle. It is opened from the ActionBar Build menu → Plan, or directly with `/create/project?builder=plan`.

## Node Model

Plan data is a flat node dictionary stored at `scene.userData.planCad`.

| Node                      | Purpose                                                            |
| ------------------------- | ------------------------------------------------------------------ |
| `site`                    | Top-level site container                                           |
| `building`                | Building container                                                 |
| `level`                   | Storey metadata: elevation, height, index                          |
| `wall`                    | Start/end wall segment with thickness, height, elevation, openings |
| `slab`, `ceiling`, `roof` | Polygonal horizontal/roof elements                                 |
| `zone`                    | Named floor-area polygon                                           |
| `item`                    | Procedural or external architectural part                          |
| `guide`, `scan`           | Reference inputs                                                   |

The launch UI creates a default site/building/level and exposes a compact level picker, add-level button, and display-mode cycle in the Plan toolbar. `activeLevelId`, `selectedNodeId`, and `displayMode` live beside the node dictionary.

## Persistence Contract

- Persisted key: `scene.userData.planCad`
- Schema: `stem.planCad.v1`
- Source of truth: the node dictionary only.
- Generated root object: `BIM Plan`
- Generated geometry: runtime-only and rebuilt from `scene.userData.planCad` on load, undo, redo, and managed-object changes.

Unknown newer schemas must be treated as unsupported/read-only until a migration is added. Do not silently coerce newer plan data into v1.

## Editing Rules

Generated BIM objects carry `userData.planNodeId` and are managed by the Plan system. Scene-tree deletion or direct object edits are resynced from node data; edit architectural data through BIM Plan tools or the BIM properties panel.

Undo/redo must keep `scene.userData.planCad` and generated geometry in sync. Use `commitPlanCadSceneData(editor, data)` for mutations rather than writing `scene.userData.planCad` directly.

## Interchange

Exports are intentionally limited:

| Format | Label                  | Supported subset                                               |
| ------ | ---------------------- | -------------------------------------------------------------- |
| JSON   | Plan JSON              | Full StemStudio node dictionary                                |
| DXF    | DXF (walls & polygons) | Walls, slabs, zones, supported embedded StemStudio payload     |
| IFC    | IFC (basic)            | Basic semantic entities plus StemStudio payload for round trip |

Units are meters. Axes follow editor world coordinates: X/Z horizontal, Y vertical.

Malformed or unsupported DXF/IFC imports must fail with a controlled Plan/CAD import error. Empty files or files without supported wall/slab/zone/furnishing entities are not treated as successful imports.

Validation note: on 2026-07-07, a representative IFC export containing one wall, one slab, one space, and one furnishing element parsed successfully with IfcOpenShell 0.8.5 as IFC4. Entity counts: `IfcProject=1`, `IfcWallStandardCase=1`, `IfcSlab=1`, `IfcSpace=1`, `IfcFurnishingElement=1`.

## Test IDs

Smokes rely on these stable selectors:

- `actionbar-cad-tools`
- `actionbar-enable-cad-tools`
- `actionbar-plan-cad`
- `plan-cad-toolbar`
- `plan-cad-close`
- `plan-cad-hint`
- `plan-cad-tool-{select|wall|room|zone|door|window|part}`
- `plan-cad-group-{structure|openings|objects}`
- `plan-cad-active-level`
- `plan-cad-add-level`
- `plan-cad-display-mode`
- `plan-cad-interchange`
- `plan-cad-export-{json|dxf|ifc}`
- `plan-cad-import-{json|dxf|ifc}`
- `plan-cad-interchange-status`
- `plan-cad-measurement`
- `plan-cad-finish-polygon`
- `plan-cad-cancel-polygon`
- `plan-cad-delete-node`

## Attribution

The BIM Plan work was informed by `pascalorg/editor` (MIT licensed) as architectural/product inspiration. No Pascal source is bundled in this repository; keep this note if future work ports source-level implementation details.

## Known Limitations

- Collaboration writes the whole plan key; simultaneous editors can clobber each other.
- Multi-level editing has launch UI for active level/add level/display mode; richer storey management is still pending.
- Pointer events are supported for mouse, pen, and one-finger touch. Multi-touch viewport input is ignored so two-finger navigation does not stamp.
- IFC/DXF are MVP subsets, not full CAD/BIM interchange implementations.
