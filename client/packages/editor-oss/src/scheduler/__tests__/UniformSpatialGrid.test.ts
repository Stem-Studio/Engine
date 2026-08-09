import {Object3D, Vector3} from "three";
import {describe, it, expect, beforeEach, afterEach} from "vitest";

import {UniformSpatialGrid} from "../spatial/UniformSpatialGrid";

describe("UniformSpatialGrid", () => {
    let grid: UniformSpatialGrid;

    beforeEach(() => {
        grid = new UniformSpatialGrid(25); // 25 unit cells
    });

    afterEach(() => {
        grid.dispose();
    });

    describe("constructor", () => {
        it("should use default cell size when not provided", () => {
            const defaultGrid = new UniformSpatialGrid();
            expect(defaultGrid.entityCount).toBe(0);
            expect(defaultGrid.cellCount).toBe(0);
            defaultGrid.dispose();
        });

        it("should use custom cell size", () => {
            const customGrid = new UniformSpatialGrid(50);
            // Cell size affects cell key computation
            const obj = new Object3D();
            obj.position.set(30, 0, 0);
            obj.updateMatrixWorld();
            customGrid.update("entity1", obj);

            // With 50 unit cells, position 30 should be in cell (0,0,0)
            expect(customGrid.entityCount).toBe(1);
            customGrid.dispose();
        });

        it("should fall back to the default cell size for invalid values", () => {
            const invalidGrids = [
                new UniformSpatialGrid(0),
                new UniformSpatialGrid(-10),
                new UniformSpatialGrid(Number.NaN),
            ];

            for (const invalidGrid of invalidGrids) {
                const obj1 = new Object3D();
                obj1.position.set(24, 0, 0);
                obj1.updateMatrixWorld();
                invalidGrid.update("entity1", obj1);

                const obj2 = new Object3D();
                obj2.position.set(26, 0, 0);
                obj2.updateMatrixWorld();
                invalidGrid.update("entity2", obj2);

                const results = invalidGrid.queryRadius(new Vector3(25, 0, 0), 5);
                expect(results).toContain("entity1");
                expect(results).toContain("entity2");

                invalidGrid.dispose();
            }
        });
    });

    describe("update", () => {
        it("should add entity to grid", () => {
            const obj = new Object3D();
            obj.position.set(10, 20, 30);
            obj.updateMatrixWorld();

            grid.update("entity1", obj);

            expect(grid.entityCount).toBe(1);
            expect(grid.cellCount).toBe(1);
        });

        it("should update entity position", () => {
            const obj = new Object3D();
            obj.position.set(10, 0, 0);
            obj.updateMatrixWorld();

            grid.update("entity1", obj);
            const pos1 = grid.getPosition("entity1");
            expect(pos1?.x).toBeCloseTo(10, 5);

            obj.position.set(20, 0, 0);
            obj.updateMatrixWorld();
            grid.update("entity1", obj);

            const pos2 = grid.getPosition("entity1");
            expect(pos2?.x).toBeCloseTo(20, 5);
        });

        it("should move entity between cells when crossing cell boundary", () => {
            const obj = new Object3D();
            obj.position.set(10, 0, 0); // Cell (0,0,0) with 25-unit cells
            obj.updateMatrixWorld();
            grid.update("entity1", obj);

            expect(grid.cellCount).toBe(1);

            // Move to different cell
            obj.position.set(30, 0, 0); // Cell (1,0,0)
            obj.updateMatrixWorld();
            grid.update("entity1", obj);

            // Should still be in one cell only
            expect(grid.entityCount).toBe(1);
            expect(grid.cellCount).toBe(1);
        });

        it("reuses the tracked cell record when an entity crosses cell boundaries", () => {
            const obj = new Object3D();
            obj.position.set(10, 0, 0);
            obj.updateMatrixWorld();
            grid.update("entity1", obj);

            const records = (grid as unknown as {entityCells: Map<string, unknown>}).entityCells;
            const originalRecord = records.get("entity1");

            obj.position.set(30, 0, 0);
            obj.updateMatrixWorld();
            grid.update("entity1", obj);

            expect(records.get("entity1")).toBe(originalRecord);
            expect(grid.queryRadius(new Vector3(30, 0, 0), 1)).toEqual(["entity1"]);
            expect(grid.queryRadius(new Vector3(10, 0, 0), 1)).toEqual([]);
            expect(grid.entityCount).toBe(1);
            expect(grid.cellCount).toBe(1);
        });

        it("should handle fast path when entity stays in same cell", () => {
            const obj = new Object3D();
            obj.position.set(10, 0, 0);
            obj.updateMatrixWorld();
            grid.update("entity1", obj);

            const initialCellCount = grid.cellCount;

            // Move within same cell
            obj.position.set(12, 0, 0);
            obj.updateMatrixWorld();
            grid.update("entity1", obj);

            // Position should be updated
            expect(grid.getPosition("entity1")?.x).toBeCloseTo(12, 5);
            // Cell count should not increase
            expect(grid.cellCount).toBe(initialCellCount);
        });

        it("should refresh Object3D reference when entity stays in same cell", () => {
            const oldObj = new Object3D();
            oldObj.position.set(10, 0, 0);
            oldObj.updateMatrixWorld();
            grid.update("entity1", oldObj);

            const initialCellCount = grid.cellCount;

            const newObj = new Object3D();
            newObj.position.set(12, 0, 0);
            newObj.updateMatrixWorld();
            grid.update("entity1", newObj);

            expect(grid.getObject("entity1")).toBe(newObj);
            expect(grid.getObject("entity1")).not.toBe(oldObj);
            expect(grid.getPosition("entity1")?.x).toBeCloseTo(12, 5);
            expect(grid.entityCount).toBe(1);
            expect(grid.cellCount).toBe(initialCellCount);
        });

        it("should handle negative positions", () => {
            const obj = new Object3D();
            obj.position.set(-50, -30, -10);
            obj.updateMatrixWorld();

            grid.update("entity1", obj);

            expect(grid.entityCount).toBe(1);
            const pos = grid.getPosition("entity1");
            expect(pos?.x).toBeCloseTo(-50, 5);
            expect(pos?.y).toBeCloseTo(-30, 5);
            expect(pos?.z).toBeCloseTo(-10, 5);
        });

        it("should store Object3D reference", () => {
            const obj = new Object3D();
            obj.position.set(10, 0, 0);
            obj.updateMatrixWorld();

            grid.update("entity1", obj);

            expect(grid.getObject("entity1")).toBe(obj);
        });

        it("reuses clean shared-ancestor validation within a frame", () => {
            const root = new Object3D();
            const sharedParent = new Object3D();
            root.add(sharedParent);
            const children = Array.from({length: 100}, () => {
                const child = new Object3D();
                sharedParent.add(child);
                return child;
            });
            root.updateMatrixWorld(true);

            let rootStateReads = 0;
            let rootNeedsUpdate = root.matrixWorldNeedsUpdate;
            Object.defineProperty(root, "matrixWorldNeedsUpdate", {
                configurable: true,
                get: () => {
                    rootStateReads++;
                    return rootNeedsUpdate;
                },
                set: value => {
                    rootNeedsUpdate = value;
                },
            });

            grid.beginFrame();
            for (let i = 0; i < children.length; i++) {
                grid.update(`entity-${i}`, children[i]!);
            }
            grid.endFrame();

            expect(rootStateReads).toBe(1);
            expect(grid.entityCount).toBe(children.length);
        });

        it("refreshes every tracked sibling below an ancestor that moved this frame", () => {
            const root = new Object3D();
            const movingParent = new Object3D();
            const childA = new Object3D();
            const childB = new Object3D();
            childA.position.x = 1;
            childB.position.x = 2;
            root.add(movingParent);
            movingParent.add(childA, childB);
            root.updateMatrixWorld(true);

            movingParent.position.x = 10;
            movingParent.updateMatrix();

            grid.beginFrame();
            grid.update("child-a", childA);
            grid.update("child-b", childB);
            grid.endFrame();

            expect(grid.getPosition("child-a")?.x).toBeCloseTo(11);
            expect(grid.getPosition("child-b")?.x).toBeCloseTo(12);
        });

        it("does not retain frame-cache assumptions for standalone updates", () => {
            const parent = new Object3D();
            const child = new Object3D();
            child.position.x = 1;
            parent.add(child);
            parent.updateMatrixWorld(true);
            grid.update("child", child);

            parent.position.x = 20;
            parent.updateMatrix();
            grid.update("child", child);

            expect(grid.getPosition("child")?.x).toBeCloseTo(21);
        });
    });

    describe("getDistanceSq", () => {
        it("should return squared distance to point", () => {
            const obj = new Object3D();
            obj.position.set(10, 0, 0);
            obj.updateMatrixWorld();
            grid.update("entity1", obj);

            const point = new Vector3(20, 0, 0);
            const distSq = grid.getDistanceSq("entity1", point);

            // Distance is 10, squared is 100
            expect(distSq).toBeCloseTo(100, 5);
        });

        it("should return null for untracked entity", () => {
            const point = new Vector3(0, 0, 0);
            const distSq = grid.getDistanceSq("nonexistent", point);
            expect(distSq).toBeNull();
        });

        it("should use cached position for O(1) lookup", () => {
            const obj = new Object3D();
            obj.position.set(0, 0, 0);
            obj.updateMatrixWorld();
            grid.update("entity1", obj);

            // Modify object position without calling update
            obj.position.set(100, 100, 100);

            // Should still use cached position
            const point = new Vector3(10, 0, 0);
            const distSq = grid.getDistanceSq("entity1", point);

            // Cached position is (0,0,0), distance to (10,0,0) is 100
            expect(distSq).toBeCloseTo(100, 5);
        });
    });

    describe("queryRadius", () => {
        it("should find entities within radius", () => {
            const obj1 = new Object3D();
            obj1.position.set(5, 0, 0);
            obj1.updateMatrixWorld();
            grid.update("entity1", obj1);

            const obj2 = new Object3D();
            obj2.position.set(100, 0, 0);
            obj2.updateMatrixWorld();
            grid.update("entity2", obj2);

            const results = grid.queryRadius(new Vector3(0, 0, 0), 10);

            expect(results).toContain("entity1");
            expect(results).not.toContain("entity2");
        });

        it("should return empty array when no entities in range", () => {
            const obj = new Object3D();
            obj.position.set(100, 100, 100);
            obj.updateMatrixWorld();
            grid.update("entity1", obj);

            const results = grid.queryRadius(new Vector3(0, 0, 0), 5);
            expect(results).toEqual([]);
        });

        it("should find multiple entities within radius", () => {
            for (let i = 0; i < 5; i++) {
                const obj = new Object3D();
                obj.position.set(i * 2, 0, 0);
                obj.updateMatrixWorld();
                grid.update(`entity${i}`, obj);
            }

            const results = grid.queryRadius(new Vector3(0, 0, 0), 10);
            expect(results.length).toBe(5);
        });

        it("should check neighboring cells", () => {
            // Place entities at cell boundaries
            const obj1 = new Object3D();
            obj1.position.set(24, 0, 0); // End of cell (0,0,0)
            obj1.updateMatrixWorld();
            grid.update("entity1", obj1);

            const obj2 = new Object3D();
            obj2.position.set(26, 0, 0); // Start of cell (1,0,0)
            obj2.updateMatrixWorld();
            grid.update("entity2", obj2);

            // Query from point that spans both cells
            const results = grid.queryRadius(new Vector3(25, 0, 0), 5);

            expect(results).toContain("entity1");
            expect(results).toContain("entity2");
        });

        it("should reuse an optional target array for allocation-free radius queries", () => {
            const near = new Object3D();
            near.position.set(5, 0, 0);
            near.updateMatrixWorld();
            grid.update("near", near);

            const far = new Object3D();
            far.position.set(100, 0, 0);
            far.updateMatrixWorld();
            grid.update("far", far);

            const target = ["stale"];
            const first = grid.queryRadius(new Vector3(0, 0, 0), 10, target);
            expect(first).toBe(target);
            expect(target).toEqual(["near"]);

            const second = grid.queryRadius(new Vector3(100, 0, 0), 1, target);
            expect(second).toBe(target);
            expect(target).toEqual(["far"]);
        });

        it("should return the cleared target for invalid radius queries", () => {
            const obj = new Object3D();
            obj.position.set(0, 0, 0);
            obj.updateMatrixWorld();
            grid.update("entity1", obj);

            const target = ["stale"];

            expect(grid.queryRadius(new Vector3(0, 0, 0), Number.POSITIVE_INFINITY, target)).toBe(target);
            expect(target).toEqual([]);

            target.push("stale");
            expect(grid.queryRadius(new Vector3(0, 0, 0), -1, target)).toBe(target);
            expect(target).toEqual([]);

            target.push("stale");
            expect(grid.queryRadius(new Vector3(Number.NaN, 0, 0), 5, target)).toBe(target);
            expect(target).toEqual([]);
        });
    });

    describe("getObject", () => {
        it("should return stored Object3D", () => {
            const obj = new Object3D();
            obj.position.set(10, 0, 0);
            obj.updateMatrixWorld();
            grid.update("entity1", obj);

            expect(grid.getObject("entity1")).toBe(obj);
        });

        it("should return undefined for untracked entity", () => {
            expect(grid.getObject("nonexistent")).toBeUndefined();
        });
    });

    describe("getPosition", () => {
        it("should return cached position", () => {
            const obj = new Object3D();
            obj.position.set(10, 20, 30);
            obj.updateMatrixWorld();
            grid.update("entity1", obj);

            const pos = grid.getPosition("entity1");
            expect(pos?.x).toBeCloseTo(10, 5);
            expect(pos?.y).toBeCloseTo(20, 5);
            expect(pos?.z).toBeCloseTo(30, 5);
        });

        it("should return undefined for untracked entity", () => {
            expect(grid.getPosition("nonexistent")).toBeUndefined();
        });
    });

    describe("remove", () => {
        it("should remove entity from grid", () => {
            const obj = new Object3D();
            obj.position.set(10, 0, 0);
            obj.updateMatrixWorld();
            grid.update("entity1", obj);

            expect(grid.entityCount).toBe(1);

            grid.remove("entity1");

            expect(grid.entityCount).toBe(0);
            expect(grid.cellCount).toBe(0);
            expect(grid.getPosition("entity1")).toBeUndefined();
            expect(grid.getObject("entity1")).toBeUndefined();
        });

        it("keeps occupied cell counts stable when removing one entity from a shared cell", () => {
            const obj1 = new Object3D();
            obj1.position.set(10, 0, 0);
            obj1.updateMatrixWorld();
            grid.update("entity1", obj1);

            const obj2 = new Object3D();
            obj2.position.set(12, 0, 0);
            obj2.updateMatrixWorld();
            grid.update("entity2", obj2);

            expect(grid.cellCount).toBe(1);

            grid.remove("entity1");

            expect(grid.entityCount).toBe(1);
            expect(grid.cellCount).toBe(1);
            expect(grid.queryRadius(new Vector3(12, 0, 0), 1)).toEqual(["entity2"]);
        });

        it("should handle removing non-existent entity", () => {
            // Should not throw
            grid.remove("nonexistent");
            expect(grid.entityCount).toBe(0);
        });
    });

    describe("entityCount", () => {
        it("should track number of entities", () => {
            expect(grid.entityCount).toBe(0);

            for (let i = 0; i < 5; i++) {
                const obj = new Object3D();
                obj.position.set(i * 100, 0, 0);
                obj.updateMatrixWorld();
                grid.update(`entity${i}`, obj);
            }

            expect(grid.entityCount).toBe(5);
        });
    });

    describe("cellCount", () => {
        it("should track number of active cells", () => {
            expect(grid.cellCount).toBe(0);

            // Add entities in same cell
            const obj1 = new Object3D();
            obj1.position.set(5, 0, 0);
            obj1.updateMatrixWorld();
            grid.update("entity1", obj1);

            const obj2 = new Object3D();
            obj2.position.set(10, 0, 0);
            obj2.updateMatrixWorld();
            grid.update("entity2", obj2);

            expect(grid.cellCount).toBe(1); // Both in same cell

            // Add entity in different cell
            const obj3 = new Object3D();
            obj3.position.set(100, 0, 0);
            obj3.updateMatrixWorld();
            grid.update("entity3", obj3);

            expect(grid.cellCount).toBe(2);
        });
    });

    describe("dispose", () => {
        it("should clear all data", () => {
            for (let i = 0; i < 5; i++) {
                const obj = new Object3D();
                obj.position.set(i * 100, 0, 0);
                obj.updateMatrixWorld();
                grid.update(`entity${i}`, obj);
            }

            expect(grid.entityCount).toBe(5);

            grid.dispose();

            expect(grid.entityCount).toBe(0);
            expect(grid.cellCount).toBe(0);
        });
    });

    describe("world position handling", () => {
        it("should use world position not local position", () => {
            const parent = new Object3D();
            parent.position.set(100, 0, 0);

            const child = new Object3D();
            child.position.set(10, 0, 0); // Local position
            parent.add(child);

            parent.updateMatrixWorld(true);

            grid.update("child", child);

            // World position should be 110, not 10
            const pos = grid.getPosition("child");
            expect(pos?.x).toBeCloseTo(110, 5);
        });
    });
});
