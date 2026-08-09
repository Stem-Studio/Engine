import { addOffMeshConnection, OffMeshConnectionDirection } from 'navcat';
import * as THREE from 'three';

import Editor from '@stem/editor-oss/editor/Editor';
import { BehaviorBase } from '../../Behavior';
import GameManager from '../../game/GameManager';
import {findObjectDepthFirst} from '@stem/editor-oss/utils/SceneTraverser';

/**
 * NavMeshConnectionBehavior creates an off-mesh connection between this object
 * and a target object, allowing AI agents to jump, teleport, climb, or traverse
 * special paths that aren't part of the regular navigation mesh.
 */
class NavMeshConnectionBehavior extends BehaviorBase {
    private game: GameManager | null = null;
    private editor: Editor | null = null;
    private scene: THREE.Scene | null = null;
    private previewScene: THREE.Group | THREE.Scene | null = null;
    private navMeshBehavior: any = null;
    private connectionAdded: boolean = false;
    private visualizationHelper: THREE.Group | null = null;
    private readonly scratchStartPos = new THREE.Vector3();
    private readonly scratchEndPos = new THREE.Vector3();
    private readonly scratchDirection = new THREE.Vector3();
    private readonly scratchBackwardDirection = new THREE.Vector3();

    async init(game: GameManager): Promise<void> {
        this.game = game;
        this.scene = game.scene!;
        this.previewScene = this.scene;
        
        // Find NavMesh behavior in scene
        this.findNavMeshBehavior();
    }

    async onStart(): Promise<void> {
        // Try to add connection when behavior starts
        this.addConnection();
        
        // Show visualization if enabled
        if (this.attributes.showConnection) {
            this.showVisualization();
        }
    }

    onStop(): void {
        this.hideVisualization();
    }

    onAttributesUpdated(): void {
        // Re-add connection with new settings
        if (this.connectionAdded) {
            console.info('[NavMeshConnectionBehavior]: Attributes changed, will re-add on next navmesh generation');
            this.connectionAdded = false;
        }
        
        // Update visualization
        if (this.attributes.showConnection) {
            this.showVisualization();
        } else {
            this.hideVisualization();
        }
    }

    // Editor methods
    onEditorAdded(editor: Editor): void {
        this.editor = editor;
        this.scene = editor.scene!;
        this.previewScene = editor.sceneHelpers!;
        
        if (this.attributes.showConnection) {
            this.showVisualization();
        }
    }

    onEditorUpdate(): void {
        // Update visualization every frame when in editor
        if (this.attributes.showConnection) {
            this.updateVisualizationPositions();
        }
    }

    onEditorAttributesUpdated(): void {
        // Update visualization when attributes change
        if (this.attributes.showConnection) {
            this.showVisualization();
        } else {
            this.hideVisualization();
        }
    }

    onEditorDispose(): void {
        // Clean up when switching from editor to game mode
        this.hideVisualization();
        this.editor = null;
    }

    /**
     * Update visualization positions without recreating arrows
     */
    private updateVisualizationPositions(): void {
        if (!this.visualizationHelper) return;

        const targetUUID = this.attributes.targetObject;
        if (!targetUUID) return;

        const targetObject = this.getObjectByUUID(targetUUID);
        if (!targetObject) return;

        // Get current positions
        const startPos = this.target.getWorldPosition(this.scratchStartPos);
        const endPos = targetObject.getWorldPosition(this.scratchEndPos);
        const direction = this.scratchDirection;

        const children = this.visualizationHelper.children;
        for (let i = 0; i < children.length; i += 1) {
            const child = children[i];
            if (!(child instanceof THREE.ArrowHelper)) continue;

            if (i === 0) {
                // Forward arrow: from start to end
                direction.subVectors(endPos, startPos);
                const length = direction.length();
                direction.normalize();

                child.position.copy(startPos);
                child.setDirection(direction);
                child.setLength(length, length * 0.2, length * 0.1);
            } else {
                // Backward arrow: from end to start
                direction.subVectors(startPos, endPos);
                const length = direction.length();
                direction.normalize();

                child.position.copy(endPos);
                child.setDirection(direction);
                child.setLength(length, length * 0.2, length * 0.1);
            }
        }
    }

    /**
     * Find NavMesh behavior in the scene
     */
    private findNavMeshBehavior(): void {
        const navMeshBehaviors = this.game?.behaviorManager?.getBehaviorsById('navmesh');
        if (navMeshBehaviors && navMeshBehaviors.length > 0) {
            this.navMeshBehavior = navMeshBehaviors[0];
        } else {
            console.warn('[NavMeshConnectionBehavior]: NavMesh behavior not found in scene');
        }
    }

    /**
     * Add off-mesh connection to the NavMesh
     */
    private addConnection(): void {
        if (this.connectionAdded) return;
        if (!this.navMeshBehavior) {
            this.findNavMeshBehavior();
            if (!this.navMeshBehavior) return;
        }

        // Check if NavMesh is ready
        if (!this.navMeshBehavior.isNavMeshReady()) {
            console.warn('[NavMeshConnectionBehavior]: NavMesh not ready yet, will retry');
            // Retry after a delay
            setTimeout(() => this.addConnection(), 1000);
            return;
        }

        // Get target object
        const targetUUID = this.attributes.targetObject;
        if (!targetUUID) {
            console.warn('[NavMeshConnectionBehavior]: No target object specified');
            return;
        }

        const targetObject = this.game?.getObjectByUUID(targetUUID);
        if (!targetObject) {
            console.warn('[NavMeshConnectionBehavior]: Target object not found:', targetUUID);
            return;
        }

        // Get world positions
        const startPos = this.target.getWorldPosition(this.scratchStartPos);
        const endPos = targetObject.getWorldPosition(this.scratchEndPos);

        // Get connection direction
        const direction = this.attributes.bidirectional 
            ? OffMeshConnectionDirection.BIDIRECTIONAL 
            : OffMeshConnectionDirection.START_TO_END;

        // Get radius
        const radius = this.attributes.radius || 0.5;

        try {
            // Get navMesh from NavMeshBehavior
            const navMesh = this.navMeshBehavior.navMesh;
            if (!navMesh) {
                console.warn('[NavMeshConnectionBehavior]: NavMesh not available');
                return;
            }

            // Add off-mesh connection
            addOffMeshConnection(navMesh, {
                start: [startPos.x, startPos.y, startPos.z],
                end: [endPos.x, endPos.y, endPos.z],
                direction,
                radius,
                area: 0,
                flags: 0xffffff,
            });

            this.connectionAdded = true;
            console.info('[NavMeshConnectionBehavior]: Added connection:', this.target.name, '->', targetObject.name);
        } catch (error) {
            console.error('[NavMeshConnectionBehavior]: Failed to add connection:', error);
        }
    }

    /**
     * Show visual representation of the connection
     */
    private showVisualization(): void {
        this.hideVisualization();

        const targetUUID = this.attributes.targetObject;
        if (!targetUUID) return;

        // Find target in the main scene, not previewScene
        const targetObject = this.getObjectByUUID(targetUUID);
        if (!targetObject) return;

        // Get positions
        const startPos = this.target.getWorldPosition(this.scratchStartPos);
        const endPos = targetObject.getWorldPosition(this.scratchEndPos);

        // Create direction vector
        const direction = this.scratchDirection.subVectors(endPos, startPos);
        const length = direction.length();
        direction.normalize();

        // Create visualization group
        this.visualizationHelper = new THREE.Group();
        this.visualizationHelper.name = `NavMeshConnection_${this.target.name}`;

        // Get color based on bidirectional setting
        const isBidirectional = this.attributes.bidirectional;
        const color = new THREE.Color(isBidirectional ? '#00ffff' : '#00ff00'); // Cyan for bidirectional, green for one-way

        // Create forward arrow
        const forwardArrow = new THREE.ArrowHelper(
            direction,
            startPos,
            length,
            color.getHex(),
            length * 0.2, // headLength
            length * 0.1,  // headWidth
        );
        this.visualizationHelper.add(forwardArrow);

        // Add backward arrow if bidirectional
        if (isBidirectional) {
            const backwardDirection = this.scratchBackwardDirection.copy(direction).negate();
            const backwardArrow = new THREE.ArrowHelper(
                backwardDirection,
                endPos,
                length,
                color.getHex(),
                length * 0.2, // headLength
                length * 0.1,  // headWidth
            );
            this.visualizationHelper.add(backwardArrow);
        }

        this.previewScene!.add(this.visualizationHelper);
    }

    private getObjectByUUID(uuid: string): THREE.Object3D | null {
        if (this.game) {
            return this.game.getObjectByUUID(uuid);
        }

        return this.scene
            ? findObjectDepthFirst(this.scene, object => object.uuid === uuid)
            : null;
    }

    /**
     * Hide visualization
     */
    private hideVisualization(): void {
        if (this.visualizationHelper) {
            this.previewScene!.remove(this.visualizationHelper);
            
            // Dispose all children
            this.visualizationHelper.traverse((child: any) => {
                if (child.dispose) {
                    child.dispose();
                }
            });
            
            this.visualizationHelper = null;
        }
    }

    update(): void {
        // No frame updates needed
        // Connection is added once when NavMesh is ready
    }

    dispose(): void {
        this.hideVisualization();
        this.navMeshBehavior = null;
        this.connectionAdded = false;
    }
}

export default NavMeshConnectionBehavior;
