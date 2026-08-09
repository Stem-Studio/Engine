import type * as Nav from 'navcat';
import { DEFAULT_QUERY_FILTER, findPath, findNearestPoly, createFindNearestPolyResult, findRandomPointAroundCircle, createNavMeshHelper as createNavMeshDebugPrimitives, DebugPrimitiveType } from 'navcat';
import { generateSoloNavMesh } from 'navcat/blocks';
import * as THREE from 'three';

import Editor from '@stem/editor-oss/editor/Editor';
import {traverseObjectDepthFirst} from '@stem/editor-oss/utils/SceneTraverser';
import { BehaviorBase } from '../../Behavior';
import GameManager from '../../game/GameManager';

const DEFAULT_NAV_QUERY_HALF_EXTENTS = new THREE.Vector3(1, 1, 1);

const writeNavVec3 = (target: Nav.Vec3, source: THREE.Vector3): Nav.Vec3 => {
    target[0] = source.x;
    target[1] = source.y;
    target[2] = source.z;
    return target;
};

class NavMeshBehavior extends BehaviorBase {
    private navMesh: Nav.NavMesh | null = null;
    private isReady: boolean = false;
    private isGenerating: boolean = false;
    private debugGroup: THREE.Group | null = null;
    private game: GameManager | null = null;
    private editor: Editor | null = null;
    private scene: THREE.Scene | null = null;
    private previewScene: THREE.Scene | THREE.Group | null = null;
    private regenerationTimeout: NodeJS.Timeout | null = null;
    private readonly queryStartVec: Nav.Vec3 = [0, 0, 0];
    private readonly queryEndVec: Nav.Vec3 = [0, 0, 0];
    private readonly queryHalfExtentsVec: Nav.Vec3 = [1, 1, 1];
    private readonly nearestPositionVec: Nav.Vec3 = [0, 0, 0];
    private readonly nearestHalfExtentsVec: Nav.Vec3 = [1, 1, 1];
    private readonly randomPositionVec: Nav.Vec3 = [0, 0, 0];
    private readonly randomHalfExtentsVec: Nav.Vec3 = [1, 1, 1];
    private readonly nearestPolyResult = createFindNearestPolyResult();
    private readonly randomNearestPolyResult = createFindNearestPolyResult();

    async init(game: GameManager): Promise<void> {
        this.game = game;
        this.scene = game.scene!;
        this.previewScene = this.scene;

        if (this.attributes.autoGenerate) {
            await this.generateNavMesh();
        }
    }

    async onStart(): Promise<void> {
        if (this.attributes.debugVisualization) {
            this.showDebugVisualization();
        }
    }

    onStop(): void {
        this.hideDebugVisualization();
    }

    onAttributesUpdated(): void {
        if (this.attributes.autoGenerate && this.isReady) {
            this.regenerateNavMesh();
        }
        
        if (this.attributes.debugVisualization) {
            this.showDebugVisualization();
        } else {
            this.hideDebugVisualization();
        }
    }

    // Editor methods
    onEditorAdded(editor: Editor): void {
        this.editor = editor;
        this.scene = editor.scene!;
        this.previewScene = editor.sceneHelpers!;
        
        // Subscribe to object changes to regenerate navmesh
        editor.engine?.on('objectChanged.NavMeshBehavior', this.handleObjectChanged.bind(this));
        
        if (!this.attributes.autoGenerate) {
            return;
        }

        this.generateNavMesh().then((success) => {
            // Show debug visualization after generation if enabled
            if (success && this.attributes.debugVisualization) {
                this.showDebugVisualization();
            }
        });
    }

    onEditorRemoved(): void {
        this.cleanupEditor();
    }

    onEditorAttributesUpdated(): void {
        // Hide old visualization before regenerating
        this.hideDebugVisualization();
        
        // Regenerate navmesh if settings changed
        if (this.attributes.autoGenerate) {
            const shouldRegenerate = this.isReady; // Only regenerate if navmesh already exists
            
            const generatePromise = shouldRegenerate 
                ? this.regenerateNavMesh() 
                : this.generateNavMesh();
                
            generatePromise.then((success) => {
                // Show debug visualization after regeneration if enabled
                if (success && this.attributes.debugVisualization) {
                    this.showDebugVisualization();
                }
            });
        } else {
            // Just toggle visualization if not regenerating
            if (this.isReady && this.attributes.debugVisualization) {
                this.showDebugVisualization();
            }
        }
    }

    onEditorDispose(): void {
        this.cleanupEditor();
    }

    private cleanupEditor(): void {
        // Clean up when switching from editor to game mode
        this.hideDebugVisualization();
        
        // Clear pending regeneration
        if (this.regenerationTimeout) {
            clearTimeout(this.regenerationTimeout);
            this.regenerationTimeout = null;
        }
        
        // Unsubscribe from object changes
        this.editor?.engine?.on('objectChanged.NavMeshBehavior', null);
        
        this.editor = null;
    }

    /**
     * Handle object changes in the scene
     * @param object
     */
    private handleObjectChanged(object: THREE.Object3D): void {
        if (!this.editor || !this.attributes.autoGenerate || !object) {
            return;
        }

        const onlyPhysics = this.attributes.onlyPhysicsMeshes || false;
        if (onlyPhysics && !this.isPhysicsRelevantObject(object)) {
            return;
        }

        console.info('[NavMeshBehavior]: Object changed, scheduling navmesh regeneration');

        // Debounce regeneration to avoid excessive calls
        if (this.regenerationTimeout) {
            clearTimeout(this.regenerationTimeout);
        }

        this.regenerationTimeout = setTimeout(() => {
            console.info('[NavMeshBehavior]: Regenerating navmesh after object change');
            this.hideDebugVisualization();
            
            this.regenerateNavMesh().then((success) => {
                if (success && this.attributes.debugVisualization) {
                    this.showDebugVisualization();
                }
            });
            
            this.regenerationTimeout = null;
        }, 1000); // 1 second debounce
    }

    /**
     * Generate NavMesh from current scene geometry
     */
    async generateNavMesh(): Promise<boolean> {
        if (this.isGenerating) {
            console.warn('[NavMeshBehavior]: Already generating NavMesh');
            return false;
        }

        this.isGenerating = true;
        this.isReady = false;

        try {
            console.info('[NavMeshBehavior]: Starting NavMesh generation...');
            
            // Collect unique meshes from the scene. The previous Group+Mesh collection
            // could process child meshes twice when a group and its descendants were
            // both visited by Scene.traverse.
            const meshes: THREE.Mesh[] = [];
            const seenMeshes = new Set<THREE.Mesh>();
            const onlyPhysics = this.attributes.onlyPhysicsMeshes || false;
            
            traverseObjectDepthFirst(this.scene!, (child) => {
                if (!(child instanceof THREE.Mesh) || !child.geometry) {
                    return;
                }

                if (onlyPhysics && !this.hasPhysicsEnabledInHierarchy(child)) {
                    return;
                }

                if (seenMeshes.has(child)) {
                    return;
                }

                seenMeshes.add(child);
                meshes.push(child);
            });
            
            if (meshes.length === 0) {
                const filterMsg = onlyPhysics ? ' with physics bodies' : '';
                console.warn(`[NavMeshBehavior]: No meshes${filterMsg} found in scene`);
                return false;
            }
            
            console.info(`[NavMeshBehavior]: Using ${meshes.length} meshes for navmesh generation${onlyPhysics ? ' (physics only)' : ''}`);
            
            // Extract positions and indices from meshes using local safe implementation
            const [positions, indices] = this.getSafePositionsAndIndices(meshes);
            
            if (positions.length === 0 || indices.length === 0) {
                console.warn('[NavMeshBehavior]: No geometry data extracted');
                return false;
            }
            
            // Calculate voxel parameters from world-space values
            const cellSize = this.attributes.cellSize;
            const cellHeight = this.attributes.cellHeight;
            const walkableRadiusWorld = this.attributes.agentRadius;
            const walkableHeightWorld = this.attributes.agentHeight;
            const walkableClimbWorld = this.attributes.agentMaxClimb;
            
            const walkableRadiusVoxels = Math.ceil(walkableRadiusWorld / cellSize);
            const walkableClimbVoxels = Math.ceil(walkableClimbWorld / cellHeight);
            const walkableHeightVoxels = Math.ceil(walkableHeightWorld / cellHeight);
            
            // Calculate detail mesh parameters
            const detailSampleDistanceVoxels = this.attributes.detailSampleDist;
            const detailSampleMaxErrorVoxels = this.attributes.detailSampleMaxError;
            const detailSampleDistance = detailSampleDistanceVoxels < 0.9 ? 0 : cellSize * detailSampleDistanceVoxels;
            const detailSampleMaxError = cellHeight * detailSampleMaxErrorVoxels;

            // Generate NavMesh with navcat
            const navMeshResult = generateSoloNavMesh(
                { positions, indices },
                {
                    cellSize,
                    cellHeight,
                    walkableRadiusWorld,
                    walkableRadiusVoxels,
                    walkableHeightWorld,
                    walkableHeightVoxels,
                    walkableClimbWorld,
                    walkableClimbVoxels,
                    walkableSlopeAngleDegrees: this.attributes.agentMaxSlope,
                    borderSize: 0,
                    minRegionArea: this.attributes.regionMinSize,
                    mergeRegionArea: this.attributes.regionMergeSize,
                    maxSimplificationError: this.attributes.edgeMaxError,
                    maxEdgeLength: this.attributes.edgeMaxLen,
                    maxVerticesPerPoly: this.attributes.vertsPerPoly,
                    detailSampleDistance,
                    detailSampleMaxError,
                },
            );
            
            if (!navMeshResult.navMesh) {
                console.error('[NavMeshBehavior]: Failed to generate NavMesh from geometry');
                return false;
            }

            this.navMesh = navMeshResult.navMesh;
            this.isReady = true;
            
            console.info('[NavMeshBehavior]: NavMesh generated successfully');
            return true;
            
        } catch (error) {
            console.error('[NavMeshBehavior]: Failed to generate NavMesh:', error);
            return false;
        } finally {
            this.isGenerating = false;
        }
    }

    /**
     * Regenerate NavMesh with current settings
     */
    async regenerateNavMesh(): Promise<boolean> {
        console.info('[NavMeshBehavior]: Regenerating NavMesh...');
        return await this.generateNavMesh();
    }

    /**
     * Find path between two points
     * Use halfExtents to define agent size for pathfinding
     * @param from
     * @param to
     * @param halfExtents
     */
    findPath(from: THREE.Vector3, to: THREE.Vector3, halfExtents: THREE.Vector3 = DEFAULT_NAV_QUERY_HALF_EXTENTS): THREE.Vector3[] | null {
        if (!this.isReady || !this.navMesh) {
            console.warn('[NavMeshBehavior]: NavMesh not ready for pathfinding');
            return null;
        }

        try {
            // Convert THREE.Vector3 to navcat Vec3 format [x, y, z]
            const startVec = writeNavVec3(this.queryStartVec, from);
            const endVec = writeNavVec3(this.queryEndVec, to);
            const halfExtentsVec = writeNavVec3(this.queryHalfExtentsVec, halfExtents);
            
            // Use navcat findPath function
            const pathResult = findPath(
                this.navMesh,
                startVec,
                endVec,
                halfExtentsVec,
                DEFAULT_QUERY_FILTER,
            );
            
            if (!pathResult.success) {
                console.warn('[NavMeshBehavior]: No path found from', from, 'to', to);
                return null;
            }
            
            const path: THREE.Vector3[] = [];
            for (let i = 0; i < pathResult.path.length; i += 1) {
                const point = pathResult.path[i];
                if (!point) continue;

                path.push(new THREE.Vector3(point.position[0], point.position[1], point.position[2]));
            }
            
            return path;
            
        } catch (error) {
            console.error('[NavMeshBehavior]: Pathfinding failed:', error);
            return null;
        }
    }

    /**
     * Find nearest walkable point on NavMesh
     * Use halfExtents to define search area size
     * @param position
     * @param halfExtents
     */
    findNearestPoint(position: THREE.Vector3, halfExtents: THREE.Vector3 = DEFAULT_NAV_QUERY_HALF_EXTENTS): THREE.Vector3 | null {
        if (!this.isReady || !this.navMesh) {
            return null;
        }

        try {
            // Convert THREE.Vector3 to navcat Vec3 format
            const positionVec = writeNavVec3(this.nearestPositionVec, position);
            const halfExtentsVec = writeNavVec3(this.nearestHalfExtentsVec, halfExtents);
            
            // Use navcat findNearestPoly function
            const result = this.nearestPolyResult;
            result.success = false;
            findNearestPoly(
                result,
                this.navMesh,
                positionVec,
                halfExtentsVec,
                DEFAULT_QUERY_FILTER,
            );
            
            if (!result.success) {
                console.warn('[NavMeshBehavior]: No navmesh point found near position:', position);
                return null;
            }
            
            // Convert result position from [x,y,z] to THREE.Vector3
            return new THREE.Vector3(result.position[0], result.position[1], result.position[2]);
            
        } catch (error) {
            console.error('[NavMeshBehavior]: Find nearest point failed:', error);
            return null;
        }
    }

    /**
     * Find random walkable point around given position
     * @param position
     * @param radius
     */
    findRandomPoint(position: THREE.Vector3, radius: number): THREE.Vector3 | null {
        if (!this.isReady || !this.navMesh) {
            return null;
        }

        try {
            // Convert THREE.Vector3 to navcat Vec3 format
            const positionVec = writeNavVec3(this.randomPositionVec, position);
            const halfExtents = this.randomHalfExtentsVec;
            halfExtents[0] = 1;
            halfExtents[1] = 1;
            halfExtents[2] = 1;
            
            // First find nearest poly to get a nodeRef
            const nearestPolyResult = this.randomNearestPolyResult;
            nearestPolyResult.success = false;
            findNearestPoly(
                nearestPolyResult,
                this.navMesh,
                positionVec,
                halfExtents,
                DEFAULT_QUERY_FILTER,
            );
            
            if (!nearestPolyResult.success) {
                console.warn('[NavMeshBehavior]: No navmesh polygon found near position:', position);
                return null;
            }
            
            // Find random point around circle using the nodeRef
            const randomResult = findRandomPointAroundCircle(
                this.navMesh,
                nearestPolyResult.nodeRef,
                positionVec,
                radius,
                DEFAULT_QUERY_FILTER,
                Math.random,
            );
            
            if (!randomResult.success) {
                console.warn('[NavMeshBehavior]: Failed to find random point around position:', position);
                return null;
            }
            
            // Convert result position from [x,y,z] to THREE.Vector3
            return new THREE.Vector3(
                randomResult.position[0],
                randomResult.position[1],
                randomResult.position[2],
            );
            
        } catch (error) {
            console.error('[NavMeshBehavior]: Find random point failed:', error);
            return null;
        }
    }

    isNavMeshReady(): boolean {
        return this.isReady && !this.isGenerating;
    }

    /**
     * Get the navMesh instance for use by other behaviors (e.g., NavMeshConnectionBehavior)
     */
    getNavMesh(): Nav.NavMesh | null {
        return this.navMesh;
    }

    private showDebugVisualization(): void {
        if (this.debugGroup || !this.isReady || !this.navMesh) return;

        try {
            // Get NavMesh debug primitives from navcat
            const debugPrimitives = createNavMeshDebugPrimitives(this.navMesh);
            
            this.debugGroup = new THREE.Group();
            this.debugGroup.name = 'NavMesh_Debug';
            
            // Convert primitives to WebGPU-compatible Three.js objects
            for (const primitive of debugPrimitives) {
                if (primitive.type === DebugPrimitiveType.Triangles) {
                    const geometry = new THREE.BufferGeometry();
                    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(primitive.positions), 3));
                    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(primitive.colors), 3));
                    
                    if (primitive.indices && primitive.indices.length > 0) {
                        geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(primitive.indices), 1));
                    }
                    
                    // Solid mesh with vertex colors
                    const solidMaterial = new THREE.MeshBasicMaterial({
                        vertexColors: true,
                        transparent: primitive.transparent || false,
                        opacity: (primitive.opacity || 1.0) * 0.5, // More transparent for solid
                        side: primitive.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
                        depthWrite: true,
                    });
                    
                    const solidMesh = new THREE.Mesh(geometry, solidMaterial);
                    this.debugGroup.add(solidMesh);
                    
                    // Wireframe overlay for better visibility (WebGPU compatible)
                    const wireframeMaterial = new THREE.MeshBasicMaterial({
                        vertexColors: true,
                        transparent: true,
                        opacity: (primitive.opacity || 1.0) * 0.8,
                        wireframe: true,
                        side: primitive.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
                        depthWrite: false,
                    });
                    
                    const wireframeMesh = new THREE.Mesh(geometry.clone(), wireframeMaterial);
                    this.debugGroup.add(wireframeMesh);
                }
                // Skip Lines primitives - they're incompatible with WebGPU
                // The wireframe mode above provides similar visual information
            }
            
            this.previewScene!.add(this.debugGroup);
            console.info('[NavMeshBehavior]: Debug visualization enabled');
            
        } catch (error) {
            console.error('[NavMeshBehavior]: Failed to show debug visualization:', error);
        }
    }

    private hideDebugVisualization(): void {
        if (this.debugGroup) {
            this.previewScene?.remove(this.debugGroup);
            
            // Dispose all geometries and materials
            traverseObjectDepthFirst(this.debugGroup, (child) => {
                if (child instanceof THREE.Mesh) {
                    child.geometry?.dispose();
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material?.dispose();
                    }
                }
            });
            
            this.debugGroup = null;
            console.info('[NavMeshBehavior]: Debug visualization disabled');
        }
    }

    update(): void {
        // NavMesh doesn't need frame updates
        // Only regenerate when explicitly requested
    }

    dispose(): void {
        this.hideDebugVisualization();
        this.navMesh = null;
        this.isReady = false;
    }

    /**
     * Safely extract positions and indices from meshes and groups, handling invalid index counts
     * mirrors navcat's deduplication logic but adds safety checks for triangle integrity
     * @param objects - array of Meshes or Groups (Groups are traversed for child Meshes)
     */
    private getSafePositionsAndIndices(objects: (THREE.Mesh | THREE.Group)[]): [number[], number[]] {
        const mergedPositions: number[] = [];
        const mergedIndices: number[] = [];
        const positionToIndex = new Map<string, number>();
        let indexCounter = 0;

        const _v = new THREE.Vector3();

        // Flatten groups into their constituent meshes
        const meshes: THREE.Mesh[] = [];
        const seenMeshes = new Set<THREE.Mesh>();
        for (const obj of objects) {
            if (obj instanceof THREE.Group) {
                traverseObjectDepthFirst(obj, (child) => {
                    if (child instanceof THREE.Mesh && child.geometry && !seenMeshes.has(child)) {
                        seenMeshes.add(child);
                        meshes.push(child);
                    }
                });
            } else if (!seenMeshes.has(obj)) {
                seenMeshes.add(obj);
                meshes.push(obj);
            }
        }

        for (const mesh of meshes) {
            const geometry = mesh.geometry;
            if (!geometry) continue;

            const positionAttribute = geometry.attributes.position;
            if (!positionAttribute || positionAttribute.count === 0) continue;

            // Ensure we use the world matrix
            mesh.updateMatrixWorld();
            const matrixWorld = mesh.matrixWorld; 

            // Helper to process a vertex index (local index in the mesh)
            const processVertex = (localIndex: number) => {
                _v.fromBufferAttribute(positionAttribute, localIndex);
                _v.applyMatrix4(matrixWorld);
                
                // Deduplicate vertices using string hash (same as navcat)
                const key = `${_v.x}_${_v.y}_${_v.z}`;
                let globalIndex = positionToIndex.get(key);

                if (globalIndex === undefined) {
                    globalIndex = indexCounter;
                    positionToIndex.set(key, indexCounter);
                    mergedPositions.push(_v.x, _v.y, _v.z);
                    indexCounter++;
                }

                mergedIndices.push(globalIndex);
            };

            // Process indices
            if (geometry.index) {
                const indexAttribute = geometry.index;
                let count = indexAttribute.count;
                
                // Handle invalid index counts (must be divisible by 3)
                if (count % 3 !== 0) {
                    console.warn(`[NavMeshBehavior] Mesh "${mesh.name}" has invalid index count ${count}. Truncating to ${count - count % 3}.`);
                    count -= count % 3;
                }

                for (let i = 0; i < count; i++) {
                    processVertex(indexAttribute.getX(i));
                }
            } else {
                // Non-indexed geometry
                let count = positionAttribute.count;
                
                // Handle invalid vertex counts for triangles (must be divisible by 3)
                if (count % 3 !== 0) {
                    console.warn(`[NavMeshBehavior] Mesh "${mesh.name}" has invalid vertex count ${count} for non-indexed geometry. Truncating.`);
                    count -= count % 3;
                }

                for (let i = 0; i < count; i++) {
                    processVertex(i);
                }
            }
        }

        return [mergedPositions, mergedIndices];
    }

    private hasPhysicsEnabledInHierarchy(object: THREE.Object3D): boolean {
        let current: THREE.Object3D | null = object;
        while (current && current !== this.scene) {
            if (current.userData?.physics?.enabled) {
                return true;
            }
            current = current.parent;
        }

        return false;
    }

    private isPhysicsRelevantObject(object: THREE.Object3D): boolean {
        if (this.hasPhysicsEnabledInHierarchy(object)) {
            return true;
        }

        let hasPhysicsDescendant = false;
        traverseObjectDepthFirst(object, (child) => {
            if (hasPhysicsDescendant || child === object) {
                return;
            }

            if (child.userData?.physics?.enabled) {
                hasPhysicsDescendant = true;
            }
        });

        return hasPhysicsDescendant;
    }
}

export default NavMeshBehavior;
