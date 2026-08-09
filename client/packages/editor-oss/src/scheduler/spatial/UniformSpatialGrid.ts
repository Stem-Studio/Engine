import { Object3D, Vector3 } from "three";

import type { ISpatialGrid } from "../types";
import {FrameWorldMatrixCache} from "../../utils/FrameWorldMatrixCache";

interface CellRecord {
    x: number;
    y: number;
    z: number;
    members: Set<string>;
}

/**
 * 3D uniform spatial grid for O(1) distance lookups.
 * Replaces per-frame O(n) getWorldPosition() calls in LambdaScheduler.shouldProcess().
 *
 * Cells are cubes of `cellSize` units. Each entity is stored in its cell
 * and its world position is cached so distance queries avoid getWorldPosition().
 */
export class UniformSpatialGrid implements ISpatialGrid {
    private static readonly DEFAULT_CELL_SIZE = 25;

    private cellSize: number;
    private inverseCellSize: number;
    private cells: Map<number, Map<number, Map<number, Set<string>>>> = new Map();
    private entityCells: Map<string, CellRecord> = new Map();
    private entityPositions: Map<string, Vector3> = new Map();
    private entityObjects: Map<string, Object3D> = new Map();
    private occupiedCellCount = 0;
    private _auxVec = new Vector3();
    private readonly worldMatrixCache = new FrameWorldMatrixCache();

    constructor(cellSize: number = 25) {
        this.cellSize = UniformSpatialGrid.normalizeCellSize(cellSize);
        this.inverseCellSize = 1 / this.cellSize;
    }

    private static normalizeCellSize(cellSize: number): number {
        return Number.isFinite(cellSize) && cellSize > 0
            ? cellSize
            : UniformSpatialGrid.DEFAULT_CELL_SIZE;
    }

    beginFrame(): void {
        this.worldMatrixCache.beginFrame();
    }

    endFrame(): void {
        this.worldMatrixCache.endFrame();
    }

    private getCell(x: number, y: number, z: number): Set<string> | undefined {
        return this.cells.get(x)?.get(y)?.get(z);
    }

    private getOrCreateCell(x: number, y: number, z: number): Set<string> {
        let yCells = this.cells.get(x);
        if (!yCells) {
            yCells = new Map();
            this.cells.set(x, yCells);
        }

        let zCells = yCells.get(y);
        if (!zCells) {
            zCells = new Map();
            yCells.set(y, zCells);
        }

        let cell = zCells.get(z);
        if (!cell) {
            cell = new Set();
            zCells.set(z, cell);
            this.occupiedCellCount++;
        }

        return cell;
    }

    private deleteCellIfEmpty(record: CellRecord): void {
        if (record.members.size > 0) {
            return;
        }

        const yCells = this.cells.get(record.x);
        const zCells = yCells?.get(record.y);
        if (!zCells || zCells.get(record.z) !== record.members) {
            return;
        }

        zCells.delete(record.z);
        if (zCells.size === 0) {
            yCells!.delete(record.y);
        }
        if (yCells!.size === 0) {
            this.cells.delete(record.x);
        }
        this.occupiedCellCount--;
    }

    /**
     * Update (or insert) an entity's position in the grid.
     * Call once per frame per entity when using spatial queries.
     * @param entityId
     * @param object
     */
    update(entityId: string, object: Object3D): void {
        this.readWorldPosition(object);
        const cellX = Math.floor(this._auxVec.x * this.inverseCellSize);
        const cellY = Math.floor(this._auxVec.y * this.inverseCellSize);
        const cellZ = Math.floor(this._auxVec.z * this.inverseCellSize);
        const oldCell = this.entityCells.get(entityId);

        // Fast path: most entities stay in the same cell across frames. Compare
        // numeric coords first so steady-state updates do not allocate cell-key strings.
        if (oldCell && oldCell.x === cellX && oldCell.y === cellY && oldCell.z === cellZ) {
            this.entityPositions.get(entityId)?.copy(this._auxVec);
            if (this.entityObjects.get(entityId) !== object) {
                this.entityObjects.set(entityId, object);
            }
            return;
        }

        // Remove from old cell
        if (oldCell) {
            oldCell.members.delete(entityId);
            this.deleteCellIfEmpty(oldCell);
        }

        // Insert into new cell. Reuse the existing record when an entity moves
        // across cells so mobile entities do not allocate every boundary cross.
        const cell = this.getOrCreateCell(cellX, cellY, cellZ);
        cell.add(entityId);
        if (oldCell) {
            oldCell.x = cellX;
            oldCell.y = cellY;
            oldCell.z = cellZ;
            oldCell.members = cell;
        } else {
            this.entityCells.set(entityId, {
                x: cellX,
                y: cellY,
                z: cellZ,
                members: cell,
            });
        }

        // Cache position
        let pos = this.entityPositions.get(entityId);
        if (!pos) {
            pos = new Vector3();
            this.entityPositions.set(entityId, pos);
        }
        pos.copy(this._auxVec);

        // Store Object3D ref for reverse lookups
        this.entityObjects.set(entityId, object);
    }

    private readWorldPosition(object: Object3D): void {
        this.worldMatrixCache.ensureCurrent(object);
        this._auxVec.setFromMatrixPosition(object.matrixWorld);
    }

    /**
     * O(1) cached distance squared to a point.
     * Returns null if entity is not tracked.
     * @param entityId
     * @param point
     */
    getDistanceSq(entityId: string, point: Vector3): number | null {
        const pos = this.entityPositions.get(entityId);
        if (!pos) {
            return null;
        }
        const dx = pos.x - point.x;
        const dy = pos.y - point.y;
        const dz = pos.z - point.z;
        return dx * dx + dy * dy + dz * dz;
    }

    /**
     * Query all entities within radius of a position.
     * Checks neighboring cells, then exact distance filter.
     * @param position
     * @param radius
     */
    queryRadius(position: Vector3, radius: number, target: string[] = []): string[] {
        target.length = 0;
        if (
            !Number.isFinite(radius) ||
            radius < 0 ||
            !Number.isFinite(position.x) ||
            !Number.isFinite(position.y) ||
            !Number.isFinite(position.z)
        ) {
            return target;
        }

        const radiusSq = radius * radius;
        const cellRadius = Math.ceil(radius * this.inverseCellSize);
        const cx = Math.floor(position.x * this.inverseCellSize);
        const cy = Math.floor(position.y * this.inverseCellSize);
        const cz = Math.floor(position.z * this.inverseCellSize);

        for (let dx = -cellRadius; dx <= cellRadius; dx++) {
            for (let dy = -cellRadius; dy <= cellRadius; dy++) {
                for (let dz = -cellRadius; dz <= cellRadius; dz++) {
                    const cell = this.getCell(cx + dx, cy + dy, cz + dz);
                    if (!cell) continue;
                    for (const entityId of cell) {
                        const pos = this.entityPositions.get(entityId);
                        if (!pos) continue;
                        const entityDx = pos.x - position.x;
                        const entityDy = pos.y - position.y;
                        const entityDz = pos.z - position.z;
                        if (entityDx * entityDx + entityDy * entityDy + entityDz * entityDz <= radiusSq) {
                            target.push(entityId);
                        }
                    }
                }
            }
        }
        return target;
    }

    /**
     * Get the cached Object3D reference for an entity.
     * @param entityId
     */
    getObject(entityId: string): Object3D | undefined {
        return this.entityObjects.get(entityId);
    }

    /**
     * Get the cached world position for an entity.
     * @param entityId
     */
    getPosition(entityId: string): Vector3 | undefined {
        return this.entityPositions.get(entityId);
    }

    remove(entityId: string): void {
        const cellRecord = this.entityCells.get(entityId);
        if (cellRecord) {
            cellRecord.members.delete(entityId);
            this.deleteCellIfEmpty(cellRecord);
            this.entityCells.delete(entityId);
            this.entityPositions.delete(entityId);
            this.entityObjects.delete(entityId);
        }
    }

    get entityCount(): number {
        return this.entityCells.size;
    }

    get cellCount(): number {
        return this.occupiedCellCount;
    }

    dispose(): void {
        this.endFrame();
        this.cells.clear();
        this.entityCells.clear();
        this.entityPositions.clear();
        this.entityObjects.clear();
        this.worldMatrixCache.reset();
        this.occupiedCellCount = 0;
    }
}
