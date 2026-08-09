import * as THREE from "three";

import {MeshData} from "./MeshData";
import {createGeometryFromMeshData, rehydrateMeshData} from "./meshDataUtils";
import {CADSelectionMode, CADTool, SerializedMeshData} from "./types";
import {TransformControls} from "../../assets/js/controls/TransformControls";
import {SetEditableMeshCommand} from "@stem/editor-oss/command/Commands";
import global from "@stem/editor-oss/global";
import UnscaledText from "../../object/text/UnscaledText";
import {showToast} from "@stem/editor-oss/showToast";
import {UNIT_LABELS, UNITS, UnitType} from "../../units/constants";
import type Editor from "../Editor";

type FacePickMesh = THREE.Mesh & {userData: {cadFaceId?: number}};
type EdgePickLine = THREE.Line & {userData: {cadEdgeId?: number}};

function addPositionToVector(target: THREE.Vector3, position: THREE.Vector3Like): THREE.Vector3 {
    target.x += position.x;
    target.y += position.y;
    target.z += position.z;
    return target;
}

function setVectorFromPosition(target: THREE.Vector3, position: THREE.Vector3Like): THREE.Vector3 {
    return target.set(position.x, position.y, position.z);
}

function getPositionDistance(first: THREE.Vector3Like, second: THREE.Vector3Like): number {
    return Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z);
}

function setVectorToPositionMidpoint(target: THREE.Vector3, first: THREE.Vector3Like, second: THREE.Vector3Like): THREE.Vector3 {
    target.x = (first.x + second.x) * 0.5;
    target.y = (first.y + second.y) * 0.5;
    target.z = (first.z + second.z) * 0.5;
    return target;
}

export class CADController {
    editor: Editor;
    selectedVertexIds = new Set<number>();
    selectedEdgeIds = new Set<number>();
    selectedFaceIds = new Set<number>();
    editedObjectUuid: string | null = null;

    private helperObjects: THREE.Object3D[] = [];
    private vertexPoints: THREE.Points | null = null;
    private selectedVertexOverlay: THREE.Points | null = null;
    private selectedEdgeOverlay: THREE.Group | null = null;
    private dragMeasurementLabels = new Map<number, UnscaledText>();
    private transformControls: any = null;
    private transformControlsHelper: THREE.Object3D | null = null;
    private transformHelper: THREE.Object3D | null = null;
    private operationHelper: THREE.Object3D | null = null;
    private dragStartHelperPosition: THREE.Vector3 | null = null;
    private dragStartHelperQuaternion: THREE.Quaternion | null = null;
    private dragStartHelperScale: THREE.Vector3 | null = null;
    private dragStartGeometry: THREE.BufferGeometry | null = null;
    private dragStartMeshData: SerializedMeshData | null = null;
    private dragStartWorldPositions = new Map<number, THREE.Vector3>();
    private isDraggingSelection = false;
    private activeTransformMode: "move" | "rotate" | "scale" | "operation" | null = null;
    private operationPreviewSelection: {faceIds?: number[]} | null = null;

    constructor(editor: Editor) {
        this.editor = editor;
        global.app?.on("geometryChanged.CADController", this.handleGeometryChanged);
        global.app?.on("objectChanged.CADController", this.handleObjectChanged);
        global.app?.on("snappingSettingsChanged.CADController", this.handleSnappingSettingsChanged);
    }

    dispose() {
        global.app?.on("geometryChanged.CADController", null);
        global.app?.on("objectChanged.CADController", null);
        global.app?.on("snappingSettingsChanged.CADController", null);
        this.detachTransformControls();
        this.clearHelpers();
    }

    get editedObject(): THREE.Mesh | null {
        if (!this.editedObjectUuid) {
            return null;
        }

        const object = this.editor.objectByUuid(this.editedObjectUuid);
        return object instanceof THREE.Mesh ? object : null;
    }

    get meshData(): MeshData | null {
        const object = this.editedObject;
        return object ? rehydrateMeshData(object.userData.meshData) : null;
    }

    activate(object: THREE.Mesh) {
        this.editedObjectUuid = object.uuid;
        this.clearSelection();
        this.refresh();
        this.updateTransformControls();
    }

    deactivate() {
        this.editedObjectUuid = null;
        this.clearSelection();
        this.detachTransformControls();
        this.clearHelpers();
    }

    setTool(_tool: CADTool) {
        this.updateTransformControls();
    }

    setSelectionMode(_mode: CADSelectionMode) {
        this.clearSelection();
        this.refresh();
        this.updateTransformControls();
    }

    clearSelection() {
        this.selectedVertexIds.clear();
        this.selectedEdgeIds.clear();
        this.selectedFaceIds.clear();
        this.refreshHighlights();
        this.updateTransformControls();
        global.app?.call("cadSelectionChanged", this, {
            vertexIds: [],
            edgeIds: [],
            faceIds: [],
        });
        global.app?.call("objectChanged", this, this.editedObject);
    }

    getPickableObjects() {
        if (this.editor.cadSelectionMode === "vertex") {
            return this.vertexPoints ? [this.vertexPoints] : [];
        }

        if (this.editor.cadSelectionMode === "edge") {
            return this.helperObjects.filter(helper => typeof (helper as EdgePickLine).userData?.cadEdgeId === "number");
        }

        if (this.editor.cadSelectionMode === "face") {
            return this.helperObjects.filter(helper => typeof (helper as FacePickMesh).userData?.cadFaceId === "number");
        }

        return [];
    }

    isTransformDragging() {
        return this.isDraggingSelection || !!this.transformControls?.dragging;
    }

    handlePickIntersections(intersections: THREE.Intersection[], additive: boolean) {
        const object = this.editedObject;
        if (!object) {
            return false;
        }

        const hit = intersections[0];
        if (!hit) {
            if (!additive) {
                this.clearSelection();
            }
            return true;
        }

        if (!additive) {
            this.clearSelection();
        }

        if (this.editor.cadSelectionMode === "vertex") {
            const vertexId = this.getVertexIdFromIntersection(hit);
            if (vertexId === null) {
                return true;
            }

            this.toggleSelection(this.selectedVertexIds, vertexId, additive);
        } else if (this.editor.cadSelectionMode === "edge") {
            const edgeId = this.getEdgeIdFromIntersection(hit);
            if (edgeId === null) {
                return true;
            }

            this.toggleSelection(this.selectedEdgeIds, edgeId, additive);
        } else if (this.editor.cadSelectionMode === "face") {
            const faceId = this.getFaceIdFromIntersection(hit);
            if (faceId === null) {
                return true;
            }

            this.toggleSelection(this.selectedFaceIds, faceId, additive);
        }

        this.refreshHighlights();
        this.updateTransformControls();
        global.app?.call("cadSelectionChanged", this, {
            vertexIds: Array.from(this.selectedVertexIds),
            edgeIds: Array.from(this.selectedEdgeIds),
            faceIds: Array.from(this.selectedFaceIds),
        });
        global.app?.call("objectChanged", this, object);

        return true;
    }

    refresh() {
        const object = this.editedObject;
        const meshData = this.meshData;
        if (!object || !meshData) {
            this.clearHelpers();
            return;
        }

        this.clearHelpers();
        this.buildVertexPoints(object, meshData);
        this.buildEdgeLines(object, meshData);
        this.buildFaceMeshes(object, meshData);
        this.refreshHighlights();
    }

    updateTransformControls() {
        const object = this.editedObject;
        const selectedVertexIds = this.getSelectedVertexIds();
        const faceOperationData = this.getFaceOperationTransformData();
        const shouldShowMoveTransform =
            !!object &&
            this.editor.cadMode &&
            ["move", "rotate", "scale"].includes(this.editor.cadTool) &&
            selectedVertexIds.length > 0;
        const shouldShowOperationTransform =
            !!object &&
            this.editor.cadMode &&
            ["extrude", "inset", "bevel"].includes(this.editor.cadTool) &&
            !!faceOperationData;

        if (!shouldShowMoveTransform && !shouldShowOperationTransform) {
            this.detachTransformControls();
            return;
        }

        this.ensureTransformControls();
        if (!this.transformControls || !this.transformHelper || !this.operationHelper) {
            return;
        }

        if (this.editor.cadTool === "rotate") {
            this.transformControls.setMode("rotate");
        } else if (this.editor.cadTool === "scale") {
            this.transformControls.setMode("scale");
        } else {
            this.transformControls.setMode("translate");
        }
        this.transformControls.visible = true;
        if (this.transformControlsHelper) {
            this.transformControlsHelper.visible = true;
        }

        if (shouldShowMoveTransform) {
            const center = this.getSelectionCenterWorld();
            if (!center) {
                this.detachTransformControls();
                return;
            }

            const axisConstraint = this.editor.cadAxisConstraint;
            this.transformControls.showX = axisConstraint.includes("x");
            this.transformControls.showY = axisConstraint.includes("y");
            this.transformControls.showZ = axisConstraint.includes("z");
            this.transformControls.setSpace("world");
            this.transformHelper.position.copy(center);
            this.transformHelper.quaternion.identity();
            this.transformHelper.scale.set(1, 1, 1);
            this.transformHelper.updateMatrixWorld(true);
            this.transformControls.attach(this.transformHelper);
            this.operationHelper.visible = false;
            return;
        }

        if (!faceOperationData) {
            this.detachTransformControls();
            return;
        }

        this.operationHelper.position.copy(faceOperationData.centerWorld);
        this.operationHelper.quaternion.copy(faceOperationData.quaternionWorld);
        this.operationHelper.updateMatrixWorld(true);
        this.operationHelper.visible = true;
        this.transformControls.setSpace("local");
        this.transformControls.showX = this.editor.cadTool === "inset";
        this.transformControls.showY = this.editor.cadTool === "inset";
        this.transformControls.showZ = this.editor.cadTool !== "inset";
        this.transformControls.attach(this.operationHelper);
    }

    private handleGeometryChanged = (_source: unknown, object: THREE.Object3D) => {
        if (!this.editedObjectUuid || object?.uuid !== this.editedObjectUuid) {
            return;
        }

        this.refresh();
        if (!this.isDraggingSelection) {
            this.updateTransformControls();
        }
    };

    private handleObjectChanged = (_source: unknown, object: THREE.Object3D) => {
        if (!this.editedObjectUuid || object?.uuid !== this.editedObjectUuid) {
            return;
        }

        this.refreshHighlights();
        if (!this.isDraggingSelection) {
            this.updateTransformControls();
        }
    };

    private handleSnappingSettingsChanged = (_source: unknown, settings: any) => {
        this.applySnappingSettings(settings);
    };

    private toggleSelection(target: Set<number>, value: number, additive: boolean) {
        if (additive && target.has(value)) {
            target.delete(value);
            return;
        }

        target.add(value);
    }

    private getVertexIdFromIntersection(intersection: THREE.Intersection): number | null {
        const points = intersection.object as THREE.Points;
        const index = intersection.index ?? intersection.faceIndex;
        if (!points.geometry || index == null) {
            return null;
        }

        const vertexIdAttr = points.geometry.getAttribute("vertexId");
        if (!vertexIdAttr) {
            return null;
        }

        const vertexId = vertexIdAttr.getX(index);
        return typeof vertexId === "number" ? vertexId : null;
    }

    private getEdgeIdFromIntersection(intersection: THREE.Intersection): number | null {
        const line = intersection.object as EdgePickLine;
        return typeof line.userData?.cadEdgeId === "number" ? line.userData.cadEdgeId : null;
    }

    private getFaceIdFromIntersection(intersection: THREE.Intersection): number | null {
        const mesh = intersection.object as FacePickMesh;
        return typeof mesh.userData?.cadFaceId === "number" ? mesh.userData.cadFaceId : null;
    }

    private buildVertexPoints(object: THREE.Mesh, meshData: MeshData) {
        const positions: number[] = [];
        const colors: number[] = [];
        const vertexIds: number[] = [];

        for (const vertex of meshData.vertices.values()) {
            positions.push(vertex.position.x, vertex.position.y, vertex.position.z);
            colors.push(0.82, 0.88, 1);
            vertexIds.push(vertex.id);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
        geometry.setAttribute("vertexId", new THREE.Uint32BufferAttribute(vertexIds, 1));

        const material = new THREE.PointsMaterial({
            size: 12,
            sizeAttenuation: false,
            vertexColors: true,
            depthTest: false,
            transparent: true,
            opacity: 0.95,
        });

        const points = new THREE.Points(geometry, material);
        points.name = "__CADVertexPoints";
        points.userData.isCADHelper = true;
        points.matrix.copy(object.matrixWorld);
        points.matrix.decompose(points.position, points.quaternion, points.scale);
        points.renderOrder = 1000;

        this.vertexPoints = points;
        this.addHelper(points);
    }

    private buildEdgeLines(object: THREE.Mesh, meshData: MeshData) {
        for (const edge of meshData.edges.values()) {
            const v1 = meshData.getVertex(edge.v1Id);
            const v2 = meshData.getVertex(edge.v2Id);
            if (!v1 || !v2) {
                continue;
            }

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute(
                "position",
                new THREE.Float32BufferAttribute(
                    [v1.position.x, v1.position.y, v1.position.z, v2.position.x, v2.position.y, v2.position.z],
                    3,
                ),
            );

            const material = new THREE.LineBasicMaterial({
                color: 0x94a3b8,
                transparent: true,
                opacity: 0.95,
                depthTest: false,
            });

            const line = new THREE.LineSegments(geometry, material) as EdgePickLine;
            line.userData.isCADHelper = true;
            line.userData.cadEdgeId = edge.id;
            line.name = "__CADEdgeLine";
            line.matrix.copy(object.matrixWorld);
            line.matrix.decompose(line.position, line.quaternion, line.scale);
            line.renderOrder = 999;

            this.addHelper(line);
        }
    }

    private buildFaceMeshes(object: THREE.Mesh, meshData: MeshData) {
        for (const face of meshData.faces.values()) {
            if (face.vertexIds.length < 3) {
                continue;
            }

            const geometry = new THREE.BufferGeometry();
            const positions: number[] = [];
            const indices: number[] = [];
            let vertexOffset = 0;

            for (const vertexId of face.vertexIds) {
                const vertex = meshData.getVertex(vertexId);
                if (!vertex) {
                    continue;
                }

                positions.push(vertex.position.x, vertex.position.y, vertex.position.z);
                vertexOffset++;
            }

            if (vertexOffset < 3) {
                continue;
            }

            for (let index = 1; index < vertexOffset - 1; index++) {
                indices.push(0, index, index + 1);
            }

            geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
            geometry.setIndex(indices);
            geometry.computeVertexNormals();

            const material = new THREE.MeshBasicMaterial({
                color: 0xfb923c,
                transparent: true,
                opacity: 0.08,
                depthTest: false,
                side: THREE.DoubleSide,
            });

            const faceMesh = new THREE.Mesh(geometry, material) as FacePickMesh;
            faceMesh.userData.isCADHelper = true;
            faceMesh.userData.cadFaceId = face.id;
            faceMesh.name = "__CADFaceMesh";
            faceMesh.matrix.copy(object.matrixWorld);
            faceMesh.matrix.decompose(faceMesh.position, faceMesh.quaternion, faceMesh.scale);
            faceMesh.renderOrder = 998;

            this.addHelper(faceMesh);
        }
    }

    private refreshHighlights() {
        if (this.vertexPoints?.geometry) {
            const colorAttr = this.vertexPoints.geometry.getAttribute("color");
            const vertexIdAttr = this.vertexPoints.geometry.getAttribute("vertexId");
            const vertexMaterial = this.vertexPoints.material as THREE.PointsMaterial;
            const isVertexMode = this.editor.cadSelectionMode === "vertex";
            vertexMaterial.size = isVertexMode ? 14 : 10;
            vertexMaterial.opacity = isVertexMode ? 0.96 : 0.46;
            for (let index = 0; index < colorAttr.count; index++) {
                const vertexId = vertexIdAttr.getX(index);
                const selected = this.selectedVertexIds.has(vertexId) || this.getSelectedVertexIds().includes(vertexId);
                if (selected) {
                    colorAttr.setXYZ(index, 1, 0.54, 0.18);
                } else {
                    colorAttr.setXYZ(index, isVertexMode ? 0.92 : 0.82, isVertexMode ? 0.97 : 0.88, 1);
                }
            }
            colorAttr.needsUpdate = true;
        }

        this.helperObjects.forEach(helper => {
            if ((helper as EdgePickLine).userData?.cadEdgeId !== undefined) {
                const edgeId = (helper as EdgePickLine).userData.cadEdgeId!;
                const material = (helper as THREE.Line).material as THREE.LineBasicMaterial;
                const isEdgeMode = this.editor.cadSelectionMode === "edge";
                const selected = this.selectedEdgeIds.has(edgeId);
                material.color.set(selected ? 0xff8c42 : isEdgeMode ? 0xf8fafc : 0x94a3b8);
                material.opacity = selected ? 0.95 : isEdgeMode ? 1 : 0.32;
            }

            if ((helper as FacePickMesh).userData?.cadFaceId !== undefined) {
                const faceId = (helper as FacePickMesh).userData.cadFaceId!;
                const material = (helper as THREE.Mesh).material as THREE.MeshBasicMaterial;
                const isFaceMode = this.editor.cadSelectionMode === "face";
                const selected = this.selectedFaceIds.has(faceId);
                material.color.set(selected ? 0xff6b1a : isFaceMode ? 0xffd166 : 0xfb923c);
                material.opacity = selected ? 0.62 : isFaceMode ? 0.2 : 0.04;
            }
        });

        this.refreshSelectionOverlays();
    }

    private refreshSelectionOverlays() {
        this.disposeSelectionOverlays();

        const object = this.editedObject;
        const meshData = this.meshData;
        if (!object || !meshData) {
            return;
        }

        if (this.selectedVertexIds.size > 0) {
            const positions: number[] = [];
            this.selectedVertexIds.forEach(vertexId => {
                const vertex = meshData.getVertex(vertexId);
                if (!vertex) {
                    return;
                }

                positions.push(vertex.position.x, vertex.position.y, vertex.position.z);
            });

            if (positions.length > 0) {
                const geometry = new THREE.BufferGeometry();
                geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));

                const material = new THREE.PointsMaterial({
                    size: this.editor.cadSelectionMode === "vertex" ? 22 : 18,
                    sizeAttenuation: false,
                    color: 0xff5a1f,
                    depthTest: false,
                    transparent: true,
                    opacity: 1,
                });

                const overlay = new THREE.Points(geometry, material);
                overlay.name = "__CADSelectedVertexOverlay";
                overlay.matrix.copy(object.matrixWorld);
                overlay.matrix.decompose(overlay.position, overlay.quaternion, overlay.scale);
                overlay.renderOrder = 1003;

                this.selectedVertexOverlay = overlay;
                global.app?.sceneHelpers.add(overlay);
            }
        }

        if (this.selectedEdgeIds.size > 0) {
            const overlay = new THREE.Group();
            overlay.name = "__CADSelectedEdgeOverlay";

            const boundingSphere = object.geometry.boundingSphere || (object.geometry.computeBoundingSphere(), object.geometry.boundingSphere);
            const highlightRadius = Math.max(
                (boundingSphere?.radius || 1) * (this.editor.cadSelectionMode === "edge" ? 0.0022 : 0.0018),
                0.0012,
            );
            const axis = new THREE.Vector3(0, 1, 0);
            const start = new THREE.Vector3();
            const end = new THREE.Vector3();
            const direction = new THREE.Vector3();
            const center = new THREE.Vector3();

            this.selectedEdgeIds.forEach(edgeId => {
                const edge = meshData.edges.get(edgeId);
                if (!edge) {
                    return;
                }

                const firstVertex = meshData.getVertex(edge.v1Id);
                const secondVertex = meshData.getVertex(edge.v2Id);
                if (!firstVertex || !secondVertex) {
                    return;
                }

                setVectorFromPosition(start, firstVertex.position);
                setVectorFromPosition(end, secondVertex.position);
                direction.subVectors(end, start);
                const length = direction.length();
                if (length <= 1e-6) {
                    return;
                }

                setVectorToPositionMidpoint(center, start, end);
                const cylinder = new THREE.Mesh(
                    new THREE.CylinderGeometry(highlightRadius, highlightRadius, length, 10, 1, false),
                    new THREE.MeshBasicMaterial({
                        color: 0xff5a1f,
                        transparent: true,
                        opacity: 0.98,
                        depthTest: false,
                    }),
                );
                cylinder.position.copy(center);
                cylinder.quaternion.setFromUnitVectors(axis, direction.normalize());
                cylinder.renderOrder = 1002;
                overlay.add(cylinder);
            });

            if (overlay.children.length > 0) {
                overlay.matrix.copy(object.matrixWorld);
                overlay.matrix.decompose(overlay.position, overlay.quaternion, overlay.scale);
                this.selectedEdgeOverlay = overlay;
                global.app?.sceneHelpers.add(overlay);
            }
        }
    }

    private disposeSelectionOverlays() {
        if (this.selectedVertexOverlay) {
            this.selectedVertexOverlay.parent?.remove(this.selectedVertexOverlay);
            this.selectedVertexOverlay.geometry.dispose();
            const material = this.selectedVertexOverlay.material;
            if (Array.isArray(material)) {
                material.forEach(mat => mat.dispose());
            } else {
                material.dispose();
            }
            this.selectedVertexOverlay = null;
        }

        if (this.selectedEdgeOverlay) {
            this.selectedEdgeOverlay.parent?.remove(this.selectedEdgeOverlay);
            this.selectedEdgeOverlay.traverse(child => {
                const mesh = child as THREE.Mesh;
                if (mesh.geometry) {
                    mesh.geometry.dispose();
                }
                const material = mesh.material;
                if (Array.isArray(material)) {
                    material.forEach(mat => mat.dispose());
                } else if (material) {
                    material.dispose();
                }
            });
            this.selectedEdgeOverlay = null;
        }
    }

    private refreshDragMeasurementLabels() {
        const object = this.editedObject;
        const meshData = this.meshData;
        if (!object || !meshData || !this.isDraggingSelection || this.activeTransformMode !== "move") {
            this.disposeDragMeasurementLabels();
            return;
        }

        const measuredEdgeIds = this.getMeasuredEdgeIds(meshData);
        const measuredEdgeSet = new Set(measuredEdgeIds);

        Array.from(this.dragMeasurementLabels.keys()).forEach(edgeId => {
            if (measuredEdgeSet.has(edgeId)) {
                return;
            }

            const label = this.dragMeasurementLabels.get(edgeId);
            label?.parent?.remove(label);
            this.dragMeasurementLabels.delete(edgeId);
        });

        const rendererDom = global.app?.editor?.renderer?.domElement;
        const domWidth = rendererDom?.width || window.innerWidth;
        const domHeight = rendererDom?.height || window.innerHeight;
        const startWorld = new THREE.Vector3();
        const endWorld = new THREE.Vector3();
        const midpoint = new THREE.Vector3();

        measuredEdgeIds.forEach(edgeId => {
            const edge = meshData.edges.get(edgeId);
            if (!edge) {
                return;
            }

            const firstVertex = meshData.getVertex(edge.v1Id);
            const secondVertex = meshData.getVertex(edge.v2Id);
            if (!firstVertex || !secondVertex) {
                return;
            }

            let label = this.dragMeasurementLabels.get(edgeId);
            if (!label) {
                label = new UnscaledText("", {
                    domWidth,
                    domHeight,
                    lineWidth: 0,
                    strokeStyle: "rgba(0,0,0,0)",
                    fillStyle: "#ffffff",
                    padding: 2,
                });
                label.material.depthTest = false;
                label.material.depthWrite = false;
                label.renderOrder = 1004;
                this.dragMeasurementLabels.set(edgeId, label);
                global.app?.sceneHelpers.add(label);
            }

            setVectorFromPosition(startWorld, firstVertex.position).applyMatrix4(object.matrixWorld);
            setVectorFromPosition(endWorld, secondVertex.position).applyMatrix4(object.matrixWorld);
            setVectorToPositionMidpoint(midpoint, startWorld, endWorld);
            const length = startWorld.distanceTo(endWorld);

            label.position.copy(midpoint);
            label.setText(this.formatMeasurementLength(length));
        });
    }

    private disposeDragMeasurementLabels() {
        this.dragMeasurementLabels.forEach(label => {
            label.parent?.remove(label);
            label.dispose?.();
        });
        this.dragMeasurementLabels.clear();
    }

    private getMeasuredEdgeIds(meshData: MeshData): number[] {
        if (this.editor.cadSelectionMode === "edge") {
            return Array.from(this.selectedEdgeIds);
        }

        if (this.editor.cadSelectionMode !== "vertex") {
            return [];
        }

        const edgeIds = new Set<number>();
        this.selectedVertexIds.forEach(vertexId => {
            const vertex = meshData.getVertex(vertexId);
            vertex?.edgeIds.forEach(edgeId => edgeIds.add(edgeId));
        });

        return Array.from(edgeIds);
    }

    private formatMeasurementLength(lengthInMeters: number): string {
        const unitsSettings = this.editor.scene?.userData?.units as {enabled?: boolean; currentUnit?: UnitType} | undefined;
        if (!unitsSettings?.enabled || !unitsSettings.currentUnit) {
            return `${lengthInMeters.toFixed(2)}`;
        }

        const currentUnit = unitsSettings.currentUnit;
        const convertedLength = lengthInMeters / UNITS[currentUnit];
        return `${convertedLength.toFixed(2)} ${UNIT_LABELS[currentUnit]}`;
    }

    private ensureTransformControls() {
        if (this.transformControls) {
            return;
        }

        const app = global.app;
        if (!app?.viewport) {
            return;
        }

        this.transformControls = new TransformControls(app.camera, app.viewport);
        this.applySnappingSettings(this.editor.scene?.userData?.snapping);
        this.transformControls.setSpace("world");
        this.transformControls.addEventListener("mouseDown", this.handleTransformMouseDown);
        this.transformControls.addEventListener("objectChange", this.handleTransformChange);
        this.transformControls.addEventListener("mouseUp", this.handleTransformMouseUp);

        this.transformControlsHelper = this.transformControls.getHelper
            ? this.transformControls.getHelper()
            : this.transformControls;
        this.transformControlsHelper?.traverse((child: THREE.Object3D) => {
            (child as THREE.Object3D & {tag?: string}).tag = "gizmo";
        });

        this.transformHelper = new THREE.Object3D();
        this.transformHelper.name = "__CADTransformHelper";
        (this.transformHelper as THREE.Object3D & {tag?: string}).tag = "gizmo";

        this.operationHelper = new THREE.Object3D();
        this.operationHelper.name = "__CADOperationHelper";
        (this.operationHelper as THREE.Object3D & {tag?: string}).tag = "gizmo";
        const operationMarker = new THREE.Mesh(
            new THREE.SphereGeometry(0.08, 20, 20),
            new THREE.MeshBasicMaterial({
                color: 0xfb923c,
                transparent: true,
                opacity: 0.95,
                depthTest: false,
            }),
        );
        operationMarker.renderOrder = 1002;
        operationMarker.name = "__CADOperationMarker";
        this.operationHelper.add(operationMarker);
        this.operationHelper.visible = false;

        app.sceneHelpers.add(this.transformHelper);
        app.sceneHelpers.add(this.operationHelper);
        if (this.transformControlsHelper) {
            app.sceneHelpers.add(this.transformControlsHelper);
            this.transformControlsHelper.visible = false;
        }
        (this.transformControls as {visible?: boolean}).visible = false;
    }

    private applySnappingSettings(settings: any) {
        if (!this.transformControls || !settings) {
            return;
        }

        const translationSnap = settings.grid?.enabled ? settings.grid.increment : null;
        const rotationSnap = settings.rotation?.enabled ? (settings.rotation.angleDegrees * Math.PI) / 180 : null;
        const scaleSnap = settings.scale?.enabled ? settings.scale.increment : null;

        this.transformControls.setTranslationSnap?.(translationSnap);
        this.transformControls.setRotationSnap?.(rotationSnap);
        this.transformControls.setScaleSnap?.(scaleSnap);
    }

    private detachTransformControls() {
        if (this.transformControls) {
            this.transformControls.detach();
            (this.transformControls as {visible?: boolean}).visible = false;
        }

        if (this.transformControlsHelper) {
            this.transformControlsHelper.visible = false;
        }

        this.dragStartGeometry = null;
        this.dragStartMeshData = null;
        this.dragStartHelperPosition = null;
        this.dragStartHelperQuaternion = null;
        this.dragStartHelperScale = null;
        this.dragStartWorldPositions.clear();
        this.isDraggingSelection = false;
        this.activeTransformMode = null;
        this.operationPreviewSelection = null;
        this.disposeDragMeasurementLabels();
        if (this.operationHelper) {
            this.operationHelper.visible = false;
        }
    }

    private handleTransformMouseDown = () => {
        const object = this.editedObject;
        const meshData = this.meshData;
        if (!object || !meshData || !this.transformHelper || !this.operationHelper) {
            return;
        }

        this.isDraggingSelection = true;
        this.dragStartGeometry = object.geometry.clone();
        this.dragStartMeshData = structuredClone(object.userData.meshData || null);
        this.operationPreviewSelection = null;

        if (["move", "rotate", "scale"].includes(this.editor.cadTool)) {
            this.activeTransformMode = this.editor.cadTool as "move" | "rotate" | "scale";
            this.dragStartHelperPosition = this.transformHelper.position.clone();
            this.dragStartHelperQuaternion = this.transformHelper.quaternion.clone();
            this.dragStartHelperScale = this.transformHelper.scale.clone();
            this.dragStartWorldPositions.clear();

            this.getSelectedVertexIds().forEach(vertexId => {
                const vertex = meshData.getVertex(vertexId);
                if (!vertex) {
                    return;
                }

                const worldPosition = new THREE.Vector3(vertex.position.x, vertex.position.y, vertex.position.z).applyMatrix4(
                    object.matrixWorld,
                );
                this.dragStartWorldPositions.set(vertexId, worldPosition);
            });
            if (this.editor.cadTool === "move") {
                this.refreshDragMeasurementLabels();
            }
            return;
        }

        if (["extrude", "inset", "bevel"].includes(this.editor.cadTool)) {
            this.activeTransformMode = "operation";
            this.dragStartHelperPosition = this.operationHelper.position.clone();
        }
    };

    private handleTransformChange = () => {
        if (!this.isDraggingSelection || !this.dragStartHelperPosition) {
            return;
        }

        const object = this.editedObject;
        if (!object) {
            return;
        }

        if (this.activeTransformMode === "move" || this.activeTransformMode === "rotate" || this.activeTransformMode === "scale") {
            const meshData = this.meshData;
            if (!meshData || !this.transformHelper) {
                return;
            }

            const selectionCenterWorld = this.dragStartHelperPosition.clone();
            const inverseWorld = object.matrixWorld.clone().invert();
            const translationDelta = new THREE.Vector3().subVectors(this.transformHelper.position, this.dragStartHelperPosition);
            const rotationDelta = this.dragStartHelperQuaternion
                ? this.transformHelper.quaternion.clone().multiply(this.dragStartHelperQuaternion.clone().invert())
                : new THREE.Quaternion();
            const startScale = this.dragStartHelperScale || new THREE.Vector3(1, 1, 1);
            const currentScale = this.transformHelper.scale.clone();
            const scaleDelta = new THREE.Vector3(
                startScale.x !== 0 ? currentScale.x / startScale.x : 1,
                startScale.y !== 0 ? currentScale.y / startScale.y : 1,
                startScale.z !== 0 ? currentScale.z / startScale.z : 1,
            );

            const nextWorldPosition = new THREE.Vector3();
            const offset = new THREE.Vector3();
            for (const [vertexId, startWorldPosition] of this.dragStartWorldPositions.entries()) {
                nextWorldPosition.copy(startWorldPosition);

                if (this.activeTransformMode === "move") {
                    nextWorldPosition.add(translationDelta);
                } else if (this.activeTransformMode === "rotate") {
                    offset.subVectors(startWorldPosition, selectionCenterWorld).applyQuaternion(rotationDelta);
                    nextWorldPosition.copy(selectionCenterWorld).add(offset);
                } else if (this.activeTransformMode === "scale") {
                    offset.subVectors(startWorldPosition, selectionCenterWorld);
                    offset.set(offset.x * scaleDelta.x, offset.y * scaleDelta.y, offset.z * scaleDelta.z);
                    nextWorldPosition.copy(selectionCenterWorld).add(offset);
                }

                const localPosition = nextWorldPosition.applyMatrix4(inverseWorld);
                const vertex = meshData.getVertex(vertexId);
                if (!vertex) {
                    continue;
                }

                vertex.position = {
                    x: localPosition.x,
                    y: localPosition.y,
                    z: localPosition.z,
                };
            }

            object.userData.meshData = meshData.toJSON();
            this.applyPreviewMeshData(meshData);
            if (this.activeTransformMode === "move") {
                this.refreshDragMeasurementLabels();
            }
            global.app?.call("objectChanged", this, object);
            return;
        }

        if (this.activeTransformMode !== "operation" || !this.operationHelper || !this.dragStartMeshData) {
            return;
        }

        const faceTransform = this.getFaceOperationTransformData(MeshData.fromJSON(this.dragStartMeshData));
        if (!faceTransform) {
            return;
        }

        const delta = new THREE.Vector3().subVectors(this.operationHelper.position, this.dragStartHelperPosition);
        const localDelta = delta.clone().applyQuaternion(faceTransform.quaternionWorld.clone().invert());
        const baseMeshData = MeshData.fromJSON(this.dragStartMeshData);
        let preview: {meshData: MeshData; selection: {faceIds?: number[]}} | null = null;

        if (this.editor.cadTool === "extrude") {
            preview = this.buildExtrudedMeshData(baseMeshData, Array.from(this.selectedFaceIds), localDelta.z);
        } else if (this.editor.cadTool === "inset") {
            preview = this.buildInsetMeshData(baseMeshData, Array.from(this.selectedFaceIds)[0], Math.max(Math.hypot(localDelta.x, localDelta.y), 0));
        } else if (this.editor.cadTool === "bevel") {
            const width = Math.max(localDelta.z, 0);
            preview = this.buildBevelMeshData(baseMeshData, Array.from(this.selectedFaceIds)[0], width, Math.max(width * 0.35, 0.01));
        }

        if (!preview) {
            return;
        }

        this.operationPreviewSelection = preview.selection;
        object.userData.meshData = preview.meshData.toJSON();
        this.applyPreviewMeshData(preview.meshData);
        global.app?.call("objectChanged", this, object);
    };

    private handleTransformMouseUp = () => {
        if (!this.isDraggingSelection) {
            return;
        }

        this.isDraggingSelection = false;

        const object = this.editedObject;
        const meshData = this.meshData;
        if (!object || !meshData || !this.dragStartGeometry) {
            this.detachTransformControls();
            return;
        }

        const previewGeometry = object.geometry;
        const committedGeometry = previewGeometry.clone();
        const committedMeshData = meshData.toJSON();
        const previousGeometry = this.dragStartGeometry;
        const previousMeshData = this.dragStartMeshData;
        const completedTransformMode = this.activeTransformMode;
        const completedOperationSelection = this.operationPreviewSelection;

        object.geometry = previousGeometry;
        if (previousMeshData) {
            object.userData.meshData = structuredClone(previousMeshData);
        }

        void this.editor.execute(
            new SetEditableMeshCommand(object, committedGeometry, committedMeshData, previousGeometry, previousMeshData),
        ).then(() => {
            if (completedTransformMode === "operation" && completedOperationSelection) {
                this.selectedVertexIds.clear();
                this.selectedEdgeIds.clear();
                this.selectedFaceIds = new Set(completedOperationSelection.faceIds || []);
                this.refresh();
                this.refreshHighlights();
                this.updateTransformControls();
                global.app?.call("objectChanged", this, object);
            }
        });

        previewGeometry.dispose();
        this.dragStartGeometry = null;
        this.dragStartMeshData = null;
        this.dragStartHelperPosition = null;
        this.dragStartWorldPositions.clear();
        this.activeTransformMode = null;
        this.operationPreviewSelection = null;
        this.disposeDragMeasurementLabels();
    };

    extrudeSelection(distance = 0.25) {
        const object = this.editedObject;
        const sourceMeshData = this.meshData;
        if (!object || !sourceMeshData || this.editor.cadSelectionMode !== "face" || this.selectedFaceIds.size === 0) {
            return false;
        }

        const result = this.buildExtrudedMeshData(MeshData.fromJSON(sourceMeshData.toJSON()), Array.from(this.selectedFaceIds), distance);
        if (!result) {
            return false;
        }

        this.commitMeshEdit(result.meshData, result.selection);

        return true;
    }

    private buildExtrudedMeshData(meshData: MeshData, selectedFaceIds: number[], distance: number) {
        if (selectedFaceIds.length === 0) {
            return null;
        }

        const selectedFaceSet = new Set(selectedFaceIds);
        const duplicatedVertexIds = new Map<number, number>();
        const newFaceIds: number[] = [];

        selectedFaceIds.forEach(faceId => {
            const face = meshData.faces.get(faceId);
            if (!face) {
                return;
            }

            face.vertexIds.forEach(vertexId => {
                if (duplicatedVertexIds.has(vertexId)) {
                    return;
                }

                const vertex = meshData.getVertex(vertexId);
                if (!vertex) {
                    return;
                }

                const duplicated = meshData.addVertex({...vertex.position});
                duplicatedVertexIds.set(vertexId, duplicated.id);
            });
        });

        selectedFaceIds.forEach(faceId => {
            const face = meshData.faces.get(faceId);
            if (!face) {
                return;
            }

            const topFace = meshData.addFace(face.vertexIds.map(vertexId => duplicatedVertexIds.get(vertexId) as number));
            newFaceIds.push(topFace.id);
        });

        if (distance !== 0) {
            const averageNormal = new THREE.Vector3();
            selectedFaceIds.forEach(faceId => {
                const face = meshData.faces.get(faceId);
                if (!face) {
                    return;
                }

                averageNormal.add(this.computeFaceNormal(meshData, face.vertexIds));
            });

            if (averageNormal.lengthSq() > 0) {
                averageNormal.normalize().multiplyScalar(distance);
                duplicatedVertexIds.forEach(newVertexId => {
                    const vertex = meshData.getVertex(newVertexId);
                    if (!vertex) {
                        return;
                    }

                    vertex.position = {
                        x: vertex.position.x + averageNormal.x,
                        y: vertex.position.y + averageNormal.y,
                        z: vertex.position.z + averageNormal.z,
                    };
                });
            }
        }

        const processedBoundaryEdges = new Set<number>();
        selectedFaceIds.forEach(faceId => {
            const face = meshData.faces.get(faceId);
            if (!face) {
                return;
            }

            face.edgeIds.forEach(edgeId => {
                if (processedBoundaryEdges.has(edgeId)) {
                    return;
                }

                const edge = meshData.edges.get(edgeId);
                if (!edge) {
                    return;
                }

                const selectedAdjacentFaces = Array.from(edge.faceIds).filter(id => selectedFaceSet.has(id));
                if (selectedAdjacentFaces.length !== 1) {
                    return;
                }

                const orderedEdgeVertices = this.getOrderedEdgeVerticesForFace(face.vertexIds, edge.v1Id, edge.v2Id);
                if (!orderedEdgeVertices) {
                    return;
                }

                const [v1Id, v2Id] = orderedEdgeVertices;
                const newV1Id = duplicatedVertexIds.get(v1Id);
                const newV2Id = duplicatedVertexIds.get(v2Id);
                if (newV1Id === undefined || newV2Id === undefined) {
                    return;
                }

                meshData.addFace([v1Id, v2Id, newV2Id, newV1Id]);
                processedBoundaryEdges.add(edgeId);
            });
        });

        return {
            meshData,
            selection: {
                faceIds: newFaceIds,
            },
        };
    }

    private buildInsetMeshData(meshData: MeshData, faceId: number | undefined, amount: number) {
        if (faceId === undefined) {
            return null;
        }

        const face = meshData.faces.get(faceId);
        if (!face) {
            return null;
        }

        const centroid = this.computeFaceCentroid(meshData, face.vertexIds);
        const faceNormal = this.computeFaceNormal(meshData, face.vertexIds);
        const newVertexIds: number[] = [];

        face.vertexIds.forEach(vertexId => {
            const vertex = meshData.getVertex(vertexId);
            if (!vertex) {
                return;
            }

            const toCenterX = (centroid.x - vertex.position.x) * amount;
            const toCenterY = (centroid.y - vertex.position.y) * amount;
            const toCenterZ = (centroid.z - vertex.position.z) * amount;
            const normalOffset = toCenterX * faceNormal.x + toCenterY * faceNormal.y + toCenterZ * faceNormal.z;
            const newVertex = meshData.addVertex({
                x: vertex.position.x + toCenterX - faceNormal.x * normalOffset,
                y: vertex.position.y + toCenterY - faceNormal.y * normalOffset,
                z: vertex.position.z + toCenterZ - faceNormal.z * normalOffset,
            });
            newVertexIds.push(newVertex.id);
        });

        meshData.deleteFace(face);
        face.vertexIds.forEach((vertexId, index) => {
            const nextIndex = (index + 1) % face.vertexIds.length;
            const nextVertexId = face.vertexIds[nextIndex]!;
            const insetVertexId = newVertexIds[index]!;
            const nextInsetVertexId = newVertexIds[nextIndex]!;
            meshData.addFace([vertexId, nextVertexId, nextInsetVertexId, insetVertexId]);
        });

        const insetFace = meshData.addFace(newVertexIds);
        return {
            meshData,
            selection: {
                faceIds: [insetFace.id],
            },
        };
    }

    private buildBevelMeshData(meshData: MeshData, faceId: number | undefined, width: number, lift: number) {
        if (faceId === undefined) {
            return null;
        }

        const face = meshData.faces.get(faceId);
        if (!face) {
            return null;
        }

        const centroid = this.computeFaceCentroid(meshData, face.vertexIds);
        const faceNormal = this.computeFaceNormal(meshData, face.vertexIds);
        const newVertexIds: number[] = [];

        face.vertexIds.forEach(vertexId => {
            const vertex = meshData.getVertex(vertexId);
            if (!vertex) {
                return;
            }

            const toCenterX = (centroid.x - vertex.position.x) * width;
            const toCenterY = (centroid.y - vertex.position.y) * width;
            const toCenterZ = (centroid.z - vertex.position.z) * width;
            const normalOffset = toCenterX * faceNormal.x + toCenterY * faceNormal.y + toCenterZ * faceNormal.z;
            const newVertex = meshData.addVertex({
                x: vertex.position.x + toCenterX - faceNormal.x * normalOffset + faceNormal.x * lift,
                y: vertex.position.y + toCenterY - faceNormal.y * normalOffset + faceNormal.y * lift,
                z: vertex.position.z + toCenterZ - faceNormal.z * normalOffset + faceNormal.z * lift,
            });
            newVertexIds.push(newVertex.id);
        });

        meshData.deleteFace(face);
        face.vertexIds.forEach((vertexId, index) => {
            const nextIndex = (index + 1) % face.vertexIds.length;
            const nextVertexId = face.vertexIds[nextIndex]!;
            const bevelVertexId = newVertexIds[index]!;
            const nextBevelVertexId = newVertexIds[nextIndex]!;
            meshData.addFace([vertexId, nextVertexId, nextBevelVertexId, bevelVertexId]);
        });

        const bevelFace = meshData.addFace(newVertexIds);
        return {
            meshData,
            selection: {
                faceIds: [bevelFace.id],
            },
        };
    }

    getSelectedEdgeLength() {
        const meshData = this.meshData;
        if (!meshData || this.selectedEdgeIds.size === 0) {
            return null;
        }

        let totalLength = 0;
        let count = 0;

        this.selectedEdgeIds.forEach(edgeId => {
            const edge = meshData.edges.get(edgeId);
            if (!edge) {
                return;
            }

            const v1 = meshData.getVertex(edge.v1Id);
            const v2 = meshData.getVertex(edge.v2Id);
            if (!v1 || !v2) {
                return;
            }

            totalLength += new THREE.Vector3(
                v2.position.x - v1.position.x,
                v2.position.y - v1.position.y,
                v2.position.z - v1.position.z,
            ).length();
            count++;
        });

        return count > 0 ? totalLength / count : null;
    }

    setSelectedEdgeLength(length: number) {
        const object = this.editedObject;
        const sourceMeshData = this.meshData;
        if (!object || !sourceMeshData || this.editor.cadSelectionMode !== "edge" || this.selectedEdgeIds.size === 0) {
            showToast({
                type: "warning",
                title: "Select at least one edge to set length.",
            });
            return false;
        }

        const targetLength = Math.max(Math.abs(length), 0.0001);
        const meshData = MeshData.fromJSON(sourceMeshData.toJSON());
        const selectedEdgeIds = Array.from(this.selectedEdgeIds);
        const edgeComponents = this.getSelectedEdgeComponents(meshData, selectedEdgeIds);
        let usedFallbackSolver = false;

        edgeComponents.forEach(component => {
            const solvedExactly = this.applyExactChainEdgeLength(meshData, component, targetLength);
            if (!solvedExactly) {
                this.applyAveragedEdgeLengthComponent(meshData, component.edgeIds, targetLength);
                usedFallbackSolver = true;
            }
        });

        if (usedFallbackSolver) {
            showToast({
                type: "info",
                title: "Used averaged edge sizing for complex edge graphs. Open chains are solved exactly.",
            });
        }

        this.commitMeshEdit(meshData, {
            edgeIds: selectedEdgeIds,
        });
        return true;
    }

    selectInScreenRectangle(
        start: THREE.Vector2,
        end: THREE.Vector2,
        camera: THREE.Camera,
        viewport: HTMLElement,
        additive = false,
    ) {
        const object = this.editedObject;
        const meshData = this.meshData;
        if (!object || !meshData || this.editor.cadSelectionMode === "object") {
            return false;
        }

        const rect = viewport.getBoundingClientRect();
        const minX = Math.min(start.x, end.x);
        const maxX = Math.max(start.x, end.x);
        const minY = Math.min(start.y, end.y);
        const maxY = Math.max(start.y, end.y);
        const leftToRight = end.x >= start.x;

        const isInsideRect = (point: {x: number; y: number}) =>
            point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;

        const projectedPoint = new THREE.Vector3();
        const projectLocalPoint = (position: {x: number; y: number; z: number}) => {
            setVectorFromPosition(projectedPoint, position).applyMatrix4(object.matrixWorld).project(camera);

            return {
                x: (projectedPoint.x * 0.5 + 0.5) * rect.width + rect.left,
                y: (-projectedPoint.y * 0.5 + 0.5) * rect.height + rect.top,
                z: projectedPoint.z,
            };
        };

        if (!additive) {
            this.selectedVertexIds.clear();
            this.selectedEdgeIds.clear();
            this.selectedFaceIds.clear();
        }

        if (this.editor.cadSelectionMode === "vertex") {
            meshData.vertices.forEach(vertex => {
                const point = projectLocalPoint(vertex.position);
                if (point.z < -1 || point.z > 1) {
                    return;
                }

                if (isInsideRect(point)) {
                    this.selectedVertexIds.add(vertex.id);
                }
            });
        } else if (this.editor.cadSelectionMode === "edge") {
            meshData.edges.forEach(edge => {
                const v1 = meshData.getVertex(edge.v1Id);
                const v2 = meshData.getVertex(edge.v2Id);
                if (!v1 || !v2) {
                    return;
                }

                const p1 = projectLocalPoint(v1.position);
                const p2 = projectLocalPoint(v2.position);
                if ((p1.z < -1 || p1.z > 1) && (p2.z < -1 || p2.z > 1)) {
                    return;
                }

                const shouldSelect = leftToRight
                    ? isInsideRect(p1) && isInsideRect(p2)
                    : isInsideRect(p1) || isInsideRect(p2) || this.lineIntersectsRect(p1, p2, minX, minY, maxX, maxY);

                if (shouldSelect) {
                    this.selectedEdgeIds.add(edge.id);
                }
            });
        } else if (this.editor.cadSelectionMode === "face") {
            meshData.faces.forEach(face => {
                const points = face.vertexIds
                    .map(vertexId => meshData.getVertex(vertexId))
                    .filter((vertex): vertex is NonNullable<typeof vertex> => !!vertex)
                    .map(vertex => projectLocalPoint(vertex.position))
                    .filter(point => point.z >= -1 && point.z <= 1);

                if (points.length < 3) {
                    return;
                }

                const shouldSelect = leftToRight
                    ? points.every(isInsideRect)
                    : this.polygonIntersectsRect(points, minX, minY, maxX, maxY);

                if (shouldSelect) {
                    this.selectedFaceIds.add(face.id);
                }
            });
        }

        this.refreshHighlights();
        this.updateTransformControls();
        global.app?.call("cadSelectionChanged", this, {
            vertexIds: Array.from(this.selectedVertexIds),
            edgeIds: Array.from(this.selectedEdgeIds),
            faceIds: Array.from(this.selectedFaceIds),
        });
        global.app?.call("objectChanged", this, object);
        return true;
    }

    selectInScreenLasso(
        points: THREE.Vector2[],
        camera: THREE.Camera,
        viewport: HTMLElement,
        additive = false,
    ) {
        const object = this.editedObject;
        const meshData = this.meshData;
        if (!object || !meshData || this.editor.cadSelectionMode === "object") {
            return false;
        }

        const polygon = points
            .map(point => ({x: point.x, y: point.y}))
            .filter((point, index, array) => index === 0 || point.x !== array[index - 1]!.x || point.y !== array[index - 1]!.y);

        if (polygon.length < 3) {
            return false;
        }

        const rect = viewport.getBoundingClientRect();
        const projectedPoint = new THREE.Vector3();
        const projectLocalPoint = (position: {x: number; y: number; z: number}) => {
            setVectorFromPosition(projectedPoint, position).applyMatrix4(object.matrixWorld).project(camera);

            return {
                x: (projectedPoint.x * 0.5 + 0.5) * rect.width + rect.left,
                y: (-projectedPoint.y * 0.5 + 0.5) * rect.height + rect.top,
                z: projectedPoint.z,
            };
        };

        if (!additive) {
            this.selectedVertexIds.clear();
            this.selectedEdgeIds.clear();
            this.selectedFaceIds.clear();
        }

        if (this.editor.cadSelectionMode === "vertex") {
            meshData.vertices.forEach(vertex => {
                const point = projectLocalPoint(vertex.position);
                if (point.z < -1 || point.z > 1) {
                    return;
                }

                if (this.pointInPolygon(point, polygon)) {
                    this.selectedVertexIds.add(vertex.id);
                }
            });
        } else if (this.editor.cadSelectionMode === "edge") {
            meshData.edges.forEach(edge => {
                const v1 = meshData.getVertex(edge.v1Id);
                const v2 = meshData.getVertex(edge.v2Id);
                if (!v1 || !v2) {
                    return;
                }

                const p1 = projectLocalPoint(v1.position);
                const p2 = projectLocalPoint(v2.position);
                if ((p1.z < -1 || p1.z > 1) && (p2.z < -1 || p2.z > 1)) {
                    return;
                }

                const shouldSelect =
                    this.pointInPolygon(p1, polygon) ||
                    this.pointInPolygon(p2, polygon) ||
                    this.lineIntersectsPolygon(p1, p2, polygon);

                if (shouldSelect) {
                    this.selectedEdgeIds.add(edge.id);
                }
            });
        } else if (this.editor.cadSelectionMode === "face") {
            meshData.faces.forEach(face => {
                const facePolygon = face.vertexIds
                    .map(vertexId => meshData.getVertex(vertexId))
                    .filter((vertex): vertex is NonNullable<typeof vertex> => !!vertex)
                    .map(vertex => projectLocalPoint(vertex.position))
                    .filter(point => point.z >= -1 && point.z <= 1);

                if (facePolygon.length < 3) {
                    return;
                }

                if (this.polygonsIntersect(facePolygon, polygon)) {
                    this.selectedFaceIds.add(face.id);
                }
            });
        }

        this.refreshHighlights();
        this.updateTransformControls();
        global.app?.call("cadSelectionChanged", this, {
            vertexIds: Array.from(this.selectedVertexIds),
            edgeIds: Array.from(this.selectedEdgeIds),
            faceIds: Array.from(this.selectedFaceIds),
        });
        global.app?.call("objectChanged", this, object);
        return true;
    }

    insetSelection(amount = 0.18) {
        const object = this.editedObject;
        const sourceMeshData = this.meshData;
        if (!object || !sourceMeshData || this.editor.cadSelectionMode !== "face" || this.selectedFaceIds.size !== 1) {
            showToast({
                type: "warning",
                title: "Inset currently supports one selected face.",
            });
            return false;
        }

        const result = this.buildInsetMeshData(MeshData.fromJSON(sourceMeshData.toJSON()), Array.from(this.selectedFaceIds)[0], amount);
        if (!result) {
            return false;
        }
        this.commitMeshEdit(result.meshData, result.selection);
        return true;
    }

    bevelSelection(width = 0.14, lift = 0.06, steps = 1, profile: "flat" | "round" = "flat") {
        const object = this.editedObject;
        const sourceMeshData = this.meshData;
        if (!object || !sourceMeshData) {
            return false;
        }

        if (this.editor.cadSelectionMode === "edge") {
            return this.edgeBevelSelection(width, steps, profile);
        }

        if (this.editor.cadSelectionMode !== "face" || this.selectedFaceIds.size !== 1) {
            showToast({
                type: "warning",
                title: "Bevel currently supports one selected face.",
            });
            return false;
        }

        const result = this.buildBevelMeshData(MeshData.fromJSON(sourceMeshData.toJSON()), Array.from(this.selectedFaceIds)[0], width, lift);
        if (!result) {
            return false;
        }
        this.commitMeshEdit(result.meshData, result.selection);
        return true;
    }

    deleteSelection() {
        const sourceMeshData = this.meshData;
        if (!sourceMeshData) {
            return false;
        }

        const meshData = MeshData.fromJSON(sourceMeshData.toJSON());
        let changed = false;

        if (this.editor.cadSelectionMode === "vertex") {
            Array.from(this.selectedVertexIds).forEach(vertexId => {
                const vertex = meshData.getVertex(vertexId);
                if (vertex) {
                    meshData.deleteVertex(vertex);
                    changed = true;
                }
            });
        } else if (this.editor.cadSelectionMode === "edge") {
            Array.from(this.selectedEdgeIds).forEach(edgeId => {
                const edge = meshData.edges.get(edgeId);
                if (edge) {
                    meshData.deleteEdge(edge);
                    changed = true;
                }
            });
        } else if (this.editor.cadSelectionMode === "face") {
            Array.from(this.selectedFaceIds).forEach(faceId => {
                const face = meshData.faces.get(faceId);
                if (face) {
                    meshData.deleteFace(face);
                    changed = true;
                }
            });
        }

        if (!changed) {
            showToast({
                type: "warning",
                title: "Select vertices, edges, or faces to delete.",
            });
            return false;
        }

        const rebuilt = this.rebuildMeshDataFromFaces(meshData, this.getFaceVertexLists(meshData));
        this.commitMeshEdit(rebuilt.meshData, {});
        return true;
    }

    dissolveSelection() {
        const sourceMeshData = this.meshData;
        if (!sourceMeshData || this.editor.cadSelectionMode !== "edge" || this.selectedEdgeIds.size === 0) {
            showToast({
                type: "warning",
                title: "Dissolve currently supports selected edges.",
            });
            return false;
        }

        const meshData = MeshData.fromJSON(sourceMeshData.toJSON());
        let changed = false;

        Array.from(this.selectedEdgeIds).forEach(edgeId => {
            if (this.mergeFacesAcrossEdge(meshData, edgeId)) {
                changed = true;
            }
        });

        if (!changed) {
            showToast({
                type: "warning",
                title: "Dissolve needs manifold edges shared by two faces.",
            });
            return false;
        }

        const rebuilt = this.rebuildMeshDataFromFaces(meshData, this.getFaceVertexLists(meshData));
        this.commitMeshEdit(rebuilt.meshData, {});
        return true;
    }

    mergeSelection() {
        const sourceMeshData = this.meshData;
        if (!sourceMeshData || this.editor.cadSelectionMode !== "vertex" || this.selectedVertexIds.size < 2) {
            showToast({
                type: "warning",
                title: "Merge currently supports two or more selected vertices.",
            });
            return false;
        }

        const selectedVertexIds = Array.from(this.selectedVertexIds);
        const representativeVertexId = selectedVertexIds[0]!;
        const mergedCenter = new THREE.Vector3();
        selectedVertexIds.forEach(vertexId => {
            const vertex = sourceMeshData.getVertex(vertexId);
            if (vertex) {
                addPositionToVector(mergedCenter, vertex.position);
            }
        });
        mergedCenter.divideScalar(selectedVertexIds.length);

        const mergeSet = new Set(selectedVertexIds);
        const nextFaces = this.getFaceVertexLists(sourceMeshData).map(faceVertexIds =>
            faceVertexIds.map(vertexId => (mergeSet.has(vertexId) ? representativeVertexId : vertexId)),
        );
        const overrides = new Map<number, THREE.Vector3>([
            [representativeVertexId, mergedCenter],
        ]);
        const rebuilt = this.rebuildMeshDataFromFaces(sourceMeshData, nextFaces, overrides);
        const mergedVertexId = rebuilt.oldToNewVertexId.get(representativeVertexId);
        this.commitMeshEdit(rebuilt.meshData, {
            vertexIds: mergedVertexId !== undefined ? [mergedVertexId] : [],
        });
        return true;
    }

    selectLinked() {
        const meshData = this.meshData;
        const object = this.editedObject;
        if (!meshData || !object) {
            return false;
        }

        if (this.editor.cadSelectionMode === "vertex") {
            const visitedVertices = new Set<number>();
            const queue = Array.from(this.selectedVertexIds);
            while (queue.length > 0) {
                const vertexId = queue.pop()!;
                if (visitedVertices.has(vertexId)) {
                    continue;
                }
                visitedVertices.add(vertexId);
                const vertex = meshData.getVertex(vertexId);
                vertex?.edgeIds.forEach(edgeId => {
                    const edge = meshData.edges.get(edgeId);
                    if (!edge) {
                        return;
                    }
                    queue.push(edge.v1Id, edge.v2Id);
                });
            }
            this.selectedVertexIds = visitedVertices;
        } else if (this.editor.cadSelectionMode === "edge") {
            const visitedEdges = new Set<number>();
            const queue = Array.from(this.selectedEdgeIds);
            while (queue.length > 0) {
                const edgeId = queue.pop()!;
                if (visitedEdges.has(edgeId)) {
                    continue;
                }
                visitedEdges.add(edgeId);
                const edge = meshData.edges.get(edgeId);
                if (!edge) {
                    continue;
                }
                [edge.v1Id, edge.v2Id].forEach(vertexId => {
                    meshData.getVertex(vertexId)?.edgeIds.forEach(connectedEdgeId => queue.push(connectedEdgeId));
                });
            }
            this.selectedEdgeIds = visitedEdges;
        } else if (this.editor.cadSelectionMode === "face") {
            const visitedFaces = new Set<number>();
            const queue = Array.from(this.selectedFaceIds);
            while (queue.length > 0) {
                const faceId = queue.pop()!;
                if (visitedFaces.has(faceId)) {
                    continue;
                }
                visitedFaces.add(faceId);
                const face = meshData.faces.get(faceId);
                if (!face) {
                    continue;
                }
                face.edgeIds.forEach(edgeId => {
                    meshData.edges.get(edgeId)?.faceIds.forEach(adjacentFaceId => queue.push(adjacentFaceId));
                });
            }
            this.selectedFaceIds = visitedFaces;
        } else {
            return false;
        }

        this.refreshHighlights();
        this.updateTransformControls();
        global.app?.call("cadSelectionChanged", this, {
            vertexIds: Array.from(this.selectedVertexIds),
            edgeIds: Array.from(this.selectedEdgeIds),
            faceIds: Array.from(this.selectedFaceIds),
        });
        global.app?.call("objectChanged", this, object);
        return true;
    }

    selectLoop() {
        const meshData = this.meshData;
        const object = this.editedObject;
        if (!meshData || !object || this.editor.cadSelectionMode !== "edge" || this.selectedEdgeIds.size === 0) {
            showToast({
                type: "warning",
                title: "Loop select currently supports selected edges.",
            });
            return false;
        }

        const selectedEdgeIds = new Set<number>();
        Array.from(this.selectedEdgeIds).forEach(edgeId => {
            this.computeEdgeLoopIds(meshData, edgeId).forEach(loopEdgeId => selectedEdgeIds.add(loopEdgeId));
        });
        this.selectedEdgeIds = selectedEdgeIds;
        this.refreshHighlights();
        this.updateTransformControls();
        global.app?.call("cadSelectionChanged", this, {
            vertexIds: [],
            edgeIds: Array.from(this.selectedEdgeIds),
            faceIds: [],
        });
        global.app?.call("objectChanged", this, object);
        return true;
    }

    selectRing() {
        const meshData = this.meshData;
        const object = this.editedObject;
        if (!meshData || !object || this.editor.cadSelectionMode !== "edge" || this.selectedEdgeIds.size === 0) {
            showToast({
                type: "warning",
                title: "Ring select currently supports selected edges.",
            });
            return false;
        }

        const ringEdgeIds = new Set<number>();
        Array.from(this.selectedEdgeIds).forEach(edgeId => {
            this.computeEdgeRingIds(meshData, edgeId).forEach(ringEdgeId => ringEdgeIds.add(ringEdgeId));
        });
        this.selectedEdgeIds = ringEdgeIds;
        this.refreshHighlights();
        this.updateTransformControls();
        global.app?.call("cadSelectionChanged", this, {
            vertexIds: [],
            edgeIds: Array.from(this.selectedEdgeIds),
            faceIds: [],
        });
        global.app?.call("objectChanged", this, object);
        return true;
    }

    loopCutSelection(ratio = 0.5) {
        const sourceMeshData = this.meshData;
        if (!sourceMeshData || this.editor.cadSelectionMode !== "edge" || this.selectedEdgeIds.size !== 1) {
            showToast({
                type: "warning",
                title: "Loop cut currently supports one selected edge on quad faces.",
            });
            return false;
        }

        const meshData = MeshData.fromJSON(sourceMeshData.toJSON());
        const startEdgeId = Array.from(this.selectedEdgeIds)[0]!;
        const ringEdgeIds = this.computeEdgeRingIds(meshData, startEdgeId);
        const ringEdgeSet = new Set(ringEdgeIds);
        const splitVertexIds = new Map<number, number>();

        ringEdgeIds.forEach(edgeId => {
            const edge = meshData.edges.get(edgeId);
            if (!edge) {
                return;
            }
            const firstVertex = meshData.getVertex(edge.v1Id);
            const secondVertex = meshData.getVertex(edge.v2Id);
            if (!firstVertex || !secondVertex) {
                return;
            }
            const midpoint = new THREE.Vector3(
                firstVertex.position.x + (secondVertex.position.x - firstVertex.position.x) * ratio,
                firstVertex.position.y + (secondVertex.position.y - firstVertex.position.y) * ratio,
                firstVertex.position.z + (secondVertex.position.z - firstVertex.position.z) * ratio,
            );
            const splitVertex = meshData.addVertex({
                x: midpoint.x,
                y: midpoint.y,
                z: midpoint.z,
            });
            splitVertexIds.set(edgeId, splitVertex.id);
        });

        const nextFaces: number[][] = [];
        let splitCount = 0;

        meshData.faces.forEach(face => {
            if (face.vertexIds.length !== 4) {
                nextFaces.push([...face.vertexIds]);
                return;
            }

            const orderedFaceEdgeIds = face.vertexIds.map((vertexId, index) => {
                const nextVertexId = face.vertexIds[(index + 1) % face.vertexIds.length]!;
                return meshData.getEdge(vertexId, nextVertexId)?.id ?? -1;
            });
            const selectedFaceEdgeIndices = orderedFaceEdgeIds
                .map((edgeId, index) => ringEdgeSet.has(edgeId) ? index : -1)
                .filter(index => index >= 0);

            if (selectedFaceEdgeIndices.length !== 2) {
                nextFaces.push([...face.vertexIds]);
                return;
            }

            const firstIndex = selectedFaceEdgeIndices[0]!;
            const secondIndex = selectedFaceEdgeIndices[1]!;
            if ((firstIndex + 2) % 4 !== secondIndex) {
                nextFaces.push([...face.vertexIds]);
                return;
            }

            const rotatedVertices = face.vertexIds.map((_, index, array) => array[(firstIndex + index) % array.length]!);
            const firstEdgeId = orderedFaceEdgeIds[firstIndex]!;
            const oppositeEdgeId = orderedFaceEdgeIds[secondIndex]!;
            const firstSplitVertexId = splitVertexIds.get(firstEdgeId);
            const oppositeSplitVertexId = splitVertexIds.get(oppositeEdgeId);
            if (firstSplitVertexId === undefined || oppositeSplitVertexId === undefined) {
                nextFaces.push([...face.vertexIds]);
                return;
            }

            nextFaces.push([rotatedVertices[0]!, firstSplitVertexId, oppositeSplitVertexId, rotatedVertices[3]!]);
            nextFaces.push([firstSplitVertexId, rotatedVertices[1]!, rotatedVertices[2]!, oppositeSplitVertexId]);
            splitCount++;
        });

        if (splitCount === 0) {
            showToast({
                type: "warning",
                title: "Loop cut needs a quad strip.",
            });
            return false;
        }

        const rebuilt = this.rebuildMeshDataFromFaces(meshData, nextFaces);
        this.commitMeshEdit(rebuilt.meshData, {});
        return true;
    }

    bridgeSelection() {
        const sourceMeshData = this.meshData;
        if (!sourceMeshData || this.editor.cadSelectionMode !== "edge" || this.selectedEdgeIds.size !== 2) {
            showToast({
                type: "warning",
                title: "Bridge currently supports exactly two selected edges.",
            });
            return false;
        }

        const meshData = MeshData.fromJSON(sourceMeshData.toJSON());
        const selectedEdges = Array.from(this.selectedEdgeIds).map(edgeId => meshData.edges.get(edgeId)).filter(Boolean);
        if (selectedEdges.length !== 2) {
            return false;
        }

        const [firstEdge, secondEdge] = selectedEdges as [NonNullable<typeof selectedEdges[0]>, NonNullable<typeof selectedEdges[1]>];
        if (new Set([firstEdge.v1Id, firstEdge.v2Id, secondEdge.v1Id, secondEdge.v2Id]).size < 4) {
            showToast({
                type: "warning",
                title: "Bridge needs two disjoint edges.",
            });
            return false;
        }

        const firstA = meshData.getVertex(firstEdge.v1Id);
        const firstB = meshData.getVertex(firstEdge.v2Id);
        const secondA = meshData.getVertex(secondEdge.v1Id);
        const secondB = meshData.getVertex(secondEdge.v2Id);
        if (!firstA || !firstB || !secondA || !secondB) {
            return false;
        }

        const optionDirect =
            getPositionDistance(firstA.position, secondA.position) +
            getPositionDistance(firstB.position, secondB.position);
        const optionCross =
            getPositionDistance(firstA.position, secondB.position) +
            getPositionDistance(firstB.position, secondA.position);

        const bridgeFace = optionDirect <= optionCross
            ? [firstEdge.v1Id, firstEdge.v2Id, secondEdge.v2Id, secondEdge.v1Id]
            : [firstEdge.v1Id, firstEdge.v2Id, secondEdge.v1Id, secondEdge.v2Id];
        meshData.addFace(bridgeFace);

        const rebuilt = this.rebuildMeshDataFromFaces(meshData, this.getFaceVertexLists(meshData));
        const lastFaceId = rebuilt.faceIds[rebuilt.faceIds.length - 1];
        this.commitMeshEdit(rebuilt.meshData, {
            faceIds: lastFaceId !== undefined ? [lastFaceId] : [],
        });
        return true;
    }

    fillSelection() {
        const sourceMeshData = this.meshData;
        if (!sourceMeshData || this.editor.cadSelectionMode !== "edge" || this.selectedEdgeIds.size < 3) {
            showToast({
                type: "warning",
                title: "Fill needs a closed edge loop.",
            });
            return false;
        }

        const meshData = MeshData.fromJSON(sourceMeshData.toJSON());
        const orderedLoop = this.orderSelectedEdgeLoop(meshData, Array.from(this.selectedEdgeIds));
        if (!orderedLoop || orderedLoop.length < 3) {
            showToast({
                type: "warning",
                title: "Fill needs a single closed edge loop.",
            });
            return false;
        }

        meshData.addFace(orderedLoop);
        const rebuilt = this.rebuildMeshDataFromFaces(meshData, this.getFaceVertexLists(meshData));
        const lastFaceId = rebuilt.faceIds[rebuilt.faceIds.length - 1];
        this.commitMeshEdit(rebuilt.meshData, {
            faceIds: lastFaceId !== undefined ? [lastFaceId] : [],
        });
        return true;
    }

    knifeSelection() {
        const sourceMeshData = this.meshData;
        if (!sourceMeshData || this.editor.cadSelectionMode !== "vertex" || this.selectedVertexIds.size !== 2) {
            showToast({
                type: "warning",
                title: "Knife currently supports exactly two selected vertices on the same face.",
            });
            return false;
        }

        const [firstVertexId, secondVertexId] = Array.from(this.selectedVertexIds);
        const face = Array.from(sourceMeshData.faces.values()).find(candidate =>
            candidate.vertexIds.includes(firstVertexId!) && candidate.vertexIds.includes(secondVertexId!),
        );
        if (!face) {
            showToast({
                type: "warning",
                title: "Knife needs two selected vertices on the same face.",
            });
            return false;
        }

        const firstPath = this.getForwardFacePath(face.vertexIds, firstVertexId!, secondVertexId!);
        const secondPath = this.getForwardFacePath(face.vertexIds, secondVertexId!, firstVertexId!);
        if (!firstPath || !secondPath || firstPath.length < 3 || secondPath.length < 3) {
            showToast({
                type: "warning",
                title: "Knife cannot cut adjacent vertices on the same face.",
            });
            return false;
        }

        const meshData = MeshData.fromJSON(sourceMeshData.toJSON());
        const editableFace = meshData.faces.get(face.id);
        if (!editableFace) {
            return false;
        }
        meshData.deleteFace(editableFace);
        const nextFaces = this.getFaceVertexLists(meshData);
        nextFaces.push(firstPath, secondPath);
        const rebuilt = this.rebuildMeshDataFromFaces(meshData, nextFaces);
        this.commitMeshEdit(rebuilt.meshData, {});
        return true;
    }

    subdivideSelection(cuts = 2) {
        const sourceMeshData = this.meshData;
        if (!sourceMeshData || this.editor.cadSelectionMode !== "face" || this.selectedFaceIds.size === 0) {
            showToast({type: "warning", title: "Select at least one face to subdivide."});
            return false;
        }

        const meshData = MeshData.fromJSON(sourceMeshData.toJSON());
        const faceIdsToSubdivide = Array.from(this.selectedFaceIds);
        const newFaceIds: number[] = [];

        faceIdsToSubdivide.forEach(faceId => {
            const face = meshData.faces.get(faceId);
            if (!face) {
                return;
            }

            if (face.vertexIds.length === 4) {
                this.subdivideQuadFace(meshData, face, cuts, newFaceIds);
            } else {
                this.subdivideNonQuadFace(meshData, face, newFaceIds);
            }
        });

        const rebuilt = this.rebuildMeshDataFromFaces(meshData, this.getFaceVertexLists(meshData));
        this.commitMeshEdit(rebuilt.meshData, {faceIds: rebuilt.faceIds.slice(-newFaceIds.length)});
        return true;
    }

    private subdivideQuadFace(meshData: MeshData, face: {id: number; vertexIds: number[]; edgeIds: Set<number>}, cuts: number, outFaceIds: number[]) {
        const [v0Id, v1Id, v2Id, v3Id] = face.vertexIds;
        const v0 = meshData.getVertex(v0Id!)!;
        const v1 = meshData.getVertex(v1Id!)!;
        const v2 = meshData.getVertex(v2Id!)!;
        const v3 = meshData.getVertex(v3Id!)!;
        if (!v0 || !v1 || !v2 || !v3) {
            return;
        }

        const gridSize = cuts + 1;
        const grid: number[][] = [];

        for (let row = 0; row <= gridSize; row++) {
            grid[row] = [];
            const tRow = row / gridSize;
            for (let col = 0; col <= gridSize; col++) {
                const tCol = col / gridSize;

                if (row === 0 && col === 0) { grid[row]![col] = v0Id!; continue; }
                if (row === 0 && col === gridSize) { grid[row]![col] = v1Id!; continue; }
                if (row === gridSize && col === gridSize) { grid[row]![col] = v2Id!; continue; }
                if (row === gridSize && col === 0) { grid[row]![col] = v3Id!; continue; }

                const x = (1 - tRow) * ((1 - tCol) * v0.position.x + tCol * v1.position.x) + tRow * ((1 - tCol) * v3.position.x + tCol * v2.position.x);
                const y = (1 - tRow) * ((1 - tCol) * v0.position.y + tCol * v1.position.y) + tRow * ((1 - tCol) * v3.position.y + tCol * v2.position.y);
                const z = (1 - tRow) * ((1 - tCol) * v0.position.z + tCol * v1.position.z) + tRow * ((1 - tCol) * v3.position.z + tCol * v2.position.z);
                const newVertex = meshData.addVertex({x, y, z});
                grid[row]![col] = newVertex.id;
            }
        }

        meshData.deleteFace(meshData.faces.get(face.id)!);

        for (let row = 0; row < gridSize; row++) {
            for (let col = 0; col < gridSize; col++) {
                const newFace = meshData.addFace([
                    grid[row]![col]!,
                    grid[row]![col + 1]!,
                    grid[row + 1]![col + 1]!,
                    grid[row + 1]![col]!,
                ]);
                outFaceIds.push(newFace.id);
            }
        }
    }

    extrudeEdgeSelection(amount = 0.25) {
        const sourceMeshData = this.meshData;
        if (!sourceMeshData || this.editor.cadSelectionMode !== "edge" || this.selectedEdgeIds.size === 0) {
            showToast({type: "warning", title: "Select at least one boundary edge to extrude."});
            return false;
        }

        const meshData = MeshData.fromJSON(sourceMeshData.toJSON());
        const newEdgeVertexIds: number[] = [];
        let extruded = false;

        Array.from(this.selectedEdgeIds).forEach(edgeId => {
            const edge = meshData.edges.get(edgeId);
            if (!edge) {
                return;
            }

            const v1 = meshData.getVertex(edge.v1Id);
            const v2 = meshData.getVertex(edge.v2Id);
            if (!v1 || !v2) {
                return;
            }

            const adjacentFaceIds = Array.from(edge.faceIds);
            const normal = new THREE.Vector3();
            adjacentFaceIds.forEach(faceId => {
                const face = meshData.faces.get(faceId);
                if (face) {
                    normal.add(this.computeFaceNormal(meshData, face.vertexIds));
                }
            });

            if (normal.lengthSq() === 0) {
                normal.set(0, 1, 0);
            }
            normal.normalize().multiplyScalar(amount);

            const newV1 = meshData.addVertex({
                x: v1.position.x + normal.x,
                y: v1.position.y + normal.y,
                z: v1.position.z + normal.z,
            });
            const newV2 = meshData.addVertex({
                x: v2.position.x + normal.x,
                y: v2.position.y + normal.y,
                z: v2.position.z + normal.z,
            });

            meshData.addFace([edge.v1Id, edge.v2Id, newV2.id, newV1.id]);
            newEdgeVertexIds.push(newV1.id, newV2.id);
            extruded = true;
        });

        if (!extruded) {
            return false;
        }

        const rebuilt = this.rebuildMeshDataFromFaces(meshData, this.getFaceVertexLists(meshData));
        this.commitMeshEdit(rebuilt.meshData, {});
        return true;
    }

    private subdivideNonQuadFace(meshData: MeshData, face: {id: number; vertexIds: number[]; edgeIds: Set<number>}, outFaceIds: number[]) {
        const centroid = this.computeFaceCentroid(meshData, face.vertexIds);
        const centerVertex = meshData.addVertex({x: centroid.x, y: centroid.y, z: centroid.z});

        const midpointIds: number[] = [];
        for (let i = 0; i < face.vertexIds.length; i++) {
            const v1 = meshData.getVertex(face.vertexIds[i]!);
            const v2 = meshData.getVertex(face.vertexIds[(i + 1) % face.vertexIds.length]!);
            if (!v1 || !v2) {
                midpointIds.push(-1);
                continue;
            }
            const midpoint = meshData.addVertex({
                x: (v1.position.x + v2.position.x) / 2,
                y: (v1.position.y + v2.position.y) / 2,
                z: (v1.position.z + v2.position.z) / 2,
            });
            midpointIds.push(midpoint.id);
        }

        meshData.deleteFace(meshData.faces.get(face.id)!);

        for (let i = 0; i < face.vertexIds.length; i++) {
            const prevMid = midpointIds[(i - 1 + midpointIds.length) % midpointIds.length]!;
            const currentMid = midpointIds[i]!;
            if (prevMid === -1 || currentMid === -1) {
                continue;
            }
            const newFace = meshData.addFace([face.vertexIds[i]!, currentMid, centerVertex.id, prevMid]);
            outFaceIds.push(newFace.id);
        }
    }

    invertNormals() {
        const sourceMeshData = this.meshData;
        if (!sourceMeshData) {
            return false;
        }

        const meshData = MeshData.fromJSON(sourceMeshData.toJSON());
        const faceIds = this.selectedFaceIds.size > 0
            ? Array.from(this.selectedFaceIds)
            : Array.from(meshData.faces.keys());

        faceIds.forEach(faceId => {
            const face = meshData.faces.get(faceId);
            if (face) {
                face.vertexIds.reverse();
            }
        });

        const rebuilt = this.rebuildMeshDataFromFaces(meshData, this.getFaceVertexLists(meshData));
        this.commitMeshEdit(rebuilt.meshData, {});
        return true;
    }

    mergeCoplanarFaces(epsilon = 1e-3) {
        const sourceMeshData = this.meshData;
        if (!sourceMeshData || this.editor.cadSelectionMode !== "face" || this.selectedFaceIds.size < 2) {
            showToast({type: "warning", title: "Select two or more faces to merge coplanar."});
            return false;
        }

        const meshData = MeshData.fromJSON(sourceMeshData.toJSON());
        const selectedFaceIds = Array.from(this.selectedFaceIds);
        let merged = false;

        const processed = new Set<number>();
        for (const faceId of selectedFaceIds) {
            if (processed.has(faceId)) {
                continue;
            }

            const face = meshData.faces.get(faceId);
            if (!face) {
                continue;
            }

            const faceNormal = this.computeFaceNormal(meshData, face.vertexIds);
            for (const edgeId of Array.from(face.edgeIds)) {
                const edge = meshData.edges.get(edgeId);
                if (!edge) {
                    continue;
                }

                for (const adjFaceId of Array.from(edge.faceIds)) {
                    if (adjFaceId === faceId || processed.has(adjFaceId) || !this.selectedFaceIds.has(adjFaceId)) {
                        continue;
                    }

                    const adjFace = meshData.faces.get(adjFaceId);
                    if (!adjFace) {
                        continue;
                    }

                    const adjNormal = this.computeFaceNormal(meshData, adjFace.vertexIds);
                    if (Math.abs(faceNormal.dot(adjNormal) - 1) > epsilon) {
                        continue;
                    }

                    if (this.mergeFacesAcrossEdge(meshData, edge.id)) {
                        processed.add(adjFaceId);
                        merged = true;
                    }
                }
            }
            processed.add(faceId);
        }

        if (!merged) {
            showToast({type: "warning", title: "No coplanar adjacent faces found in the selection."});
            return false;
        }

        const rebuilt = this.rebuildMeshDataFromFaces(meshData, this.getFaceVertexLists(meshData));
        this.commitMeshEdit(rebuilt.meshData, {});
        return true;
    }

    offsetTop(amount = 0.25) {
        const sourceMeshData = this.meshData;
        if (!sourceMeshData) {
            showToast({type: "warning", title: "No mesh data to offset."});
            return false;
        }

        const meshData = MeshData.fromJSON(sourceMeshData.toJSON());
        let maxY = -Infinity;
        meshData.vertices.forEach(vertex => {
            if (vertex.position.y > maxY) {
                maxY = vertex.position.y;
            }
        });

        if (!isFinite(maxY)) {
            return false;
        }

        const epsilon = 1e-4;
        meshData.vertices.forEach(vertex => {
            if (Math.abs(vertex.position.y - maxY) < epsilon) {
                vertex.position = {
                    x: vertex.position.x,
                    y: vertex.position.y + amount,
                    z: vertex.position.z,
                };
            }
        });

        const rebuilt = this.rebuildMeshDataFromFaces(meshData, this.getFaceVertexLists(meshData));
        this.commitMeshEdit(rebuilt.meshData, {});
        return true;
    }

    edgeToEdgeCut() {
        const sourceMeshData = this.meshData;
        if (!sourceMeshData || this.editor.cadSelectionMode !== "edge" || this.selectedEdgeIds.size !== 2) {
            showToast({type: "warning", title: "Select exactly two edges on the same face."});
            return false;
        }

        const meshData = MeshData.fromJSON(sourceMeshData.toJSON());
        const [edgeId1, edgeId2] = Array.from(this.selectedEdgeIds);
        const edge1 = meshData.edges.get(edgeId1!);
        const edge2 = meshData.edges.get(edgeId2!);
        if (!edge1 || !edge2) {
            return false;
        }

        const sharedFaceId = Array.from(edge1.faceIds).find(fId => edge2.faceIds.has(fId));
        if (sharedFaceId === undefined) {
            showToast({type: "warning", title: "The two edges must share a face."});
            return false;
        }

        const face = meshData.faces.get(sharedFaceId);
        if (!face) {
            return false;
        }

        const mid1V1 = meshData.getVertex(edge1.v1Id);
        const mid1V2 = meshData.getVertex(edge1.v2Id);
        const mid2V1 = meshData.getVertex(edge2.v1Id);
        const mid2V2 = meshData.getVertex(edge2.v2Id);
        if (!mid1V1 || !mid1V2 || !mid2V1 || !mid2V2) {
            return false;
        }

        const midpoint1 = meshData.addVertex({
            x: (mid1V1.position.x + mid1V2.position.x) / 2,
            y: (mid1V1.position.y + mid1V2.position.y) / 2,
            z: (mid1V1.position.z + mid1V2.position.z) / 2,
        });
        const midpoint2 = meshData.addVertex({
            x: (mid2V1.position.x + mid2V2.position.x) / 2,
            y: (mid2V1.position.y + mid2V2.position.y) / 2,
            z: (mid2V1.position.z + mid2V2.position.z) / 2,
        });

        const verts = face.vertexIds;
        const findEdgeIndex = (v1Id: number, v2Id: number) => {
            for (let i = 0; i < verts.length; i++) {
                const a = verts[i]!;
                const b = verts[(i + 1) % verts.length]!;
                if ((a === v1Id && b === v2Id) || (a === v2Id && b === v1Id)) {
                    return i;
                }
            }
            return -1;
        };

        const idx1 = findEdgeIndex(edge1.v1Id, edge1.v2Id);
        const idx2 = findEdgeIndex(edge2.v1Id, edge2.v2Id);
        if (idx1 === -1 || idx2 === -1) {
            return false;
        }

        const expandedVerts: number[] = [];
        for (let i = 0; i < verts.length; i++) {
            expandedVerts.push(verts[i]!);
            if (i === idx1) {
                expandedVerts.push(midpoint1.id);
            }
            if (i === idx2) {
                expandedVerts.push(midpoint2.id);
            }
        }

        const mp1Idx = expandedVerts.indexOf(midpoint1.id);
        const mp2Idx = expandedVerts.indexOf(midpoint2.id);
        const len = expandedVerts.length;

        const face1Verts: number[] = [];
        for (let i = mp1Idx; ; i = (i + 1) % len) {
            face1Verts.push(expandedVerts[i]!);
            if (i !== mp1Idx && expandedVerts[i] === midpoint2.id) {
                break;
            }
            if (face1Verts.length > len) {
                break;
            }
        }

        const face2Verts: number[] = [];
        for (let i = mp2Idx; ; i = (i + 1) % len) {
            face2Verts.push(expandedVerts[i]!);
            if (i !== mp2Idx && expandedVerts[i] === midpoint1.id) {
                break;
            }
            if (face2Verts.length > len) {
                break;
            }
        }

        meshData.deleteFace(face);
        const nextFaces = this.getFaceVertexLists(meshData);
        if (face1Verts.length >= 3) {
            nextFaces.push(face1Verts);
        }
        if (face2Verts.length >= 3) {
            nextFaces.push(face2Verts);
        }

        const rebuilt = this.rebuildMeshDataFromFaces(meshData, nextFaces);
        this.commitMeshEdit(rebuilt.meshData, {});
        return true;
    }

    arcEdge(offset = 0.2, segments = 8) {
        const sourceMeshData = this.meshData;
        if (!sourceMeshData || this.editor.cadSelectionMode !== "edge" || this.selectedEdgeIds.size === 0) {
            showToast({type: "warning", title: "Select at least one edge for arc."});
            return false;
        }

        const meshData = MeshData.fromJSON(sourceMeshData.toJSON());
        const clampedSegments = Math.max(2, Math.min(segments, 64));

        Array.from(this.selectedEdgeIds).forEach(edgeId => {
            const edge = meshData.edges.get(edgeId);
            if (!edge) {
                return;
            }

            const v1 = meshData.getVertex(edge.v1Id);
            const v2 = meshData.getVertex(edge.v2Id);
            if (!v1 || !v2) {
                return;
            }

            const start = setVectorFromPosition(new THREE.Vector3(), v1.position);
            const end = setVectorFromPosition(new THREE.Vector3(), v2.position);
            const chord = new THREE.Vector3().subVectors(end, start);
            const chordLen = chord.length();
            if (chordLen < 1e-6) {
                return;
            }

            const chordDir = chord.divideScalar(chordLen);

            const adjNormal = new THREE.Vector3();
            edge.faceIds.forEach(faceId => {
                const face = meshData.faces.get(faceId);
                if (face) {
                    adjNormal.add(this.computeFaceNormal(meshData, face.vertexIds));
                }
            });
            if (adjNormal.lengthSq() === 0) {
                adjNormal.set(0, 1, 0);
            }
            adjNormal.normalize();

            const perpDir = new THREE.Vector3().crossVectors(chordDir, adjNormal).normalize();
            if (perpDir.lengthSq() < 0.5) {
                return;
            }

            const sagitta = offset * chordLen;
            const halfChord = chordLen / 2;
            const radius = (halfChord * halfChord + sagitta * sagitta) / (2 * sagitta);
            const centerOffset = radius - sagitta;

            const arcVertexIds: number[] = [edge.v1Id];
            const point = new THREE.Vector3();
            for (let i = 1; i < clampedSegments; i++) {
                const t = i / clampedSegments;
                const distFromMid = t * chordLen - halfChord;
                const arcHeight = Math.sqrt(Math.max(0, radius * radius - distFromMid * distFromMid)) - centerOffset;
                point.copy(start).lerp(end, t).addScaledVector(perpDir, arcHeight);
                const newVertex = meshData.addVertex({x: point.x, y: point.y, z: point.z});
                arcVertexIds.push(newVertex.id);
            }
            arcVertexIds.push(edge.v2Id);

            const affectedFaceIds = Array.from(edge.faceIds);
            affectedFaceIds.forEach(faceId => {
                const face = meshData.faces.get(faceId);
                if (!face) {
                    return;
                }

                const newVerts: number[] = [];
                for (let i = 0; i < face.vertexIds.length; i++) {
                    const curr = face.vertexIds[i]!;
                    const next = face.vertexIds[(i + 1) % face.vertexIds.length]!;
                    newVerts.push(curr);

                    if (curr === edge.v1Id && next === edge.v2Id) {
                        for (let j = 1; j < arcVertexIds.length - 1; j++) {
                            newVerts.push(arcVertexIds[j]!);
                        }
                    } else if (curr === edge.v2Id && next === edge.v1Id) {
                        for (let j = arcVertexIds.length - 2; j > 0; j--) {
                            newVerts.push(arcVertexIds[j]!);
                        }
                    }
                }
                face.vertexIds = newVerts;
            });
        });

        const rebuilt = this.rebuildMeshDataFromFaces(meshData, this.getFaceVertexLists(meshData));
        this.commitMeshEdit(rebuilt.meshData, {});
        return true;
    }

    mergeEdges() {
        const sourceMeshData = this.meshData;
        if (!sourceMeshData || this.editor.cadSelectionMode !== "edge" || this.selectedEdgeIds.size < 1) {
            showToast({type: "warning", title: "Select at least one edge to merge."});
            return false;
        }

        const meshData = MeshData.fromJSON(sourceMeshData.toJSON());

        // Union-find: group connected vertices across selected edges
        const parent = new Map<number, number>();
        const find = (id: number): number => {
            if (!parent.has(id)) {
                parent.set(id, id);
            }
            if (parent.get(id) !== id) {
                parent.set(id, find(parent.get(id)!));
            }
            return parent.get(id)!;
        };
        const union = (a: number, b: number) => {
            parent.set(find(a), find(b));
        };

        this.selectedEdgeIds.forEach(edgeId => {
            const edge = meshData.edges.get(edgeId);
            if (edge) {
                union(edge.v1Id, edge.v2Id);
            }
        });

        // Group vertices by their root and compute average positions
        const groups = new Map<number, number[]>();
        parent.forEach((_, vertexId) => {
            const root = find(vertexId);
            const group = groups.get(root) || [];
            group.push(vertexId);
            groups.set(root, group);
        });

        // Build overrides with averaged positions and remap face vertex lists
        const vertexRemap = new Map<number, number>();
        const overrides = new Map<number, THREE.Vector3>();

        groups.forEach(group => {
            if (group.length < 2) {
                return;
            }

            const avg = new THREE.Vector3();
            let count = 0;
            group.forEach(vertexId => {
                const vertex = meshData.getVertex(vertexId);
                if (vertex) {
                    addPositionToVector(avg, vertex.position);
                    count++;
                }
            });
            if (count > 0) {
                avg.divideScalar(count);
            }

            const representative = group[0]!;
            overrides.set(representative, avg);
            group.forEach(vertexId => {
                vertexRemap.set(vertexId, representative);
            });
        });

        const nextFaces = this.getFaceVertexLists(meshData).map(faceVertexIds =>
            faceVertexIds.map(vertexId => vertexRemap.get(vertexId) ?? vertexId),
        );

        const rebuilt = this.rebuildMeshDataFromFaces(meshData, nextFaces, overrides);
        this.commitMeshEdit(rebuilt.meshData, {});
        return true;
    }

    fillFromVertices() {
        const sourceMeshData = this.meshData;
        if (!sourceMeshData || this.editor.cadSelectionMode !== "vertex" || this.selectedVertexIds.size < 3) {
            showToast({type: "warning", title: "Select at least 3 vertices to fill a face."});
            return false;
        }

        const meshData = MeshData.fromJSON(sourceMeshData.toJSON());
        const vertexIds = Array.from(this.selectedVertexIds);

        // Order vertices around their centroid to form a proper polygon
        const centroid = new THREE.Vector3();
        const positions: THREE.Vector3Like[] = [];
        vertexIds.forEach(vertexId => {
            const vertex = meshData.getVertex(vertexId);
            if (vertex) {
                positions.push(vertex.position);
                addPositionToVector(centroid, vertex.position);
            }
        });
        centroid.divideScalar(positions.length);

        // Compute a normal from the first 3 points
        const normal = this.computeFaceNormal(meshData, vertexIds);
        if (normal.lengthSq() === 0) {
            showToast({type: "warning", title: "Cannot determine face orientation from selected vertices."});
            return false;
        }

        // Build a tangent frame and sort vertices by angle around centroid
        const tangent = new THREE.Vector3();
        if (Math.abs(normal.z) < 0.9) {
            tangent.set(0, 0, 1).cross(normal).normalize();
        } else {
            tangent.set(0, 1, 0).cross(normal).normalize();
        }
        const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();

        const sorted = vertexIds
            .map((vertexId, i) => {
                const position = positions[i]!;
                const offsetX = position.x - centroid.x;
                const offsetY = position.y - centroid.y;
                const offsetZ = position.z - centroid.z;
                const tangentDot = offsetX * tangent.x + offsetY * tangent.y + offsetZ * tangent.z;
                const bitangentDot = offsetX * bitangent.x + offsetY * bitangent.y + offsetZ * bitangent.z;
                return {vertexId, angle: Math.atan2(bitangentDot, tangentDot)};
            })
            .sort((a, b) => a.angle - b.angle)
            .map(entry => entry.vertexId);

        meshData.addFace(sorted);

        const rebuilt = this.rebuildMeshDataFromFaces(meshData, this.getFaceVertexLists(meshData));
        const lastFaceId = rebuilt.faceIds[rebuilt.faceIds.length - 1];
        this.commitMeshEdit(rebuilt.meshData, {
            faceIds: lastFaceId !== undefined ? [lastFaceId] : [],
        });
        return true;
    }

    inflateDeflate(factor: number) {
        const sourceMeshData = this.meshData;
        if (!sourceMeshData) {
            return false;
        }

        const meshData = MeshData.fromJSON(sourceMeshData.toJSON());
        const vertexNormals = this.computeVertexNormals(meshData);

        meshData.vertices.forEach(vertex => {
            const normal = vertexNormals.get(vertex.id);
            if (!normal || normal.lengthSq() === 0) {
                return;
            }

            vertex.position = {
                x: vertex.position.x + normal.x * factor,
                y: vertex.position.y + normal.y * factor,
                z: vertex.position.z + normal.z * factor,
            };
        });

        const rebuilt = this.rebuildMeshDataFromFaces(meshData, this.getFaceVertexLists(meshData));
        this.commitMeshEdit(rebuilt.meshData, {});
        return true;
    }

    private computeVertexNormals(meshData: MeshData): Map<number, THREE.Vector3> {
        const normals = new Map<number, THREE.Vector3>();

        meshData.vertices.forEach(vertex => {
            normals.set(vertex.id, new THREE.Vector3());
        });

        meshData.faces.forEach(face => {
            const faceNormal = this.computeFaceNormal(meshData, face.vertexIds);
            face.vertexIds.forEach(vertexId => {
                const accumulated = normals.get(vertexId);
                if (accumulated) {
                    accumulated.add(faceNormal);
                }
            });
        });

        normals.forEach(normal => {
            if (normal.lengthSq() > 0) {
                normal.normalize();
            }
        });

        return normals;
    }

    mirrorMesh(axis: "x" | "y" | "z") {
        const sourceMeshData = this.meshData;
        if (!sourceMeshData) {
            return false;
        }

        const meshData = MeshData.fromJSON(sourceMeshData.toJSON());
        meshData.vertices.forEach(vertex => {
            vertex.position = {
                ...vertex.position,
                [axis]: -vertex.position[axis],
            };
        });

        meshData.faces.forEach(face => {
            face.vertexIds.reverse();
        });

        const rebuilt = this.rebuildMeshDataFromFaces(meshData, this.getFaceVertexLists(meshData));
        this.commitMeshEdit(rebuilt.meshData, {});
        return true;
    }

    /**
     * Build an array of mesh copies and merge them into the current mesh.
     *
     * For each copy `i` from 0 to count-1, apply `transform(i)` to every vertex
     * position and emit the source's faces with a fresh vertex ID namespace.
     * Copy 0 is the original, unmodified geometry. The result is committed as
     * one destructive mesh edit (undo/redo via the command stack).
     *
     * Returns false when there is no active mesh or count <= 1 (nothing to do).
     */
    private arrayMeshWithTransform(count: number, transform: (index: number, position: THREE.Vector3) => THREE.Vector3): boolean {
        const sourceMeshData = this.meshData;
        if (!sourceMeshData || count <= 1) {
            return false;
        }

        const result = new MeshData();
        const sourceFaceVertexLists = this.getFaceVertexLists(sourceMeshData);

        for (let copyIndex = 0; copyIndex < count; copyIndex++) {
            const sourceToResultVertexId = new Map<number, number>();

            // Clone every source vertex with the per-copy transform applied.
            for (const vertex of sourceMeshData.vertices.values()) {
                const src = new THREE.Vector3(vertex.position.x, vertex.position.y, vertex.position.z);
                const transformed = transform(copyIndex, src);
                const created = result.addVertex({x: transformed.x, y: transformed.y, z: transformed.z});
                sourceToResultVertexId.set(vertex.id, created.id);
            }

            // Emit each source face with remapped vertex IDs.
            for (const faceVertexIds of sourceFaceVertexLists) {
                const mapped = faceVertexIds
                    .map(sourceId => sourceToResultVertexId.get(sourceId))
                    .filter((id): id is number => id !== undefined);
                if (mapped.length < 3) continue;
                result.addFace(mapped);
            }
        }

        const rebuilt = this.rebuildMeshDataFromFaces(result, this.getFaceVertexLists(result));
        this.commitMeshEdit(rebuilt.meshData, {});
        return true;
    }

    /**
     * Linear array: produce `count` copies of the mesh, each shifted by
     * `i * offset` from the original.
     */
    arrayMeshLinear(count: number, offset: THREE.Vector3): boolean {
        if (count < 2) {
            showToast({type: "warning", title: "Array count must be at least 2."});
            return false;
        }
        return this.arrayMeshWithTransform(count, (i, position) => {
            return new THREE.Vector3(
                position.x + offset.x * i,
                position.y + offset.y * i,
                position.z + offset.z * i,
            );
        });
    }

    /**
     * Radial array: produce `count` copies of the mesh rotated around `axis`.
     * The total sweep is `totalAngleRad` (defaults to a full circle); copies
     * land at evenly spaced angles from 0 to that sweep. `pivot` defaults to
     * the mesh's local origin (0,0,0) — rotation happens in the mesh's local
     * frame, so an outer caller can position the mesh beforehand if they want
     * a world-space pivot.
     */
    arrayMeshRadial(count: number, axis: "x" | "y" | "z", totalAngleRad = Math.PI * 2, pivot = new THREE.Vector3()): boolean {
        if (count < 2) {
            showToast({type: "warning", title: "Array count must be at least 2."});
            return false;
        }
        const angleStep = count === 1 ? 0 : totalAngleRad / (totalAngleRad >= Math.PI * 2 - 1e-6 ? count : count - 1);
        const axisVec = axis === "x"
            ? new THREE.Vector3(1, 0, 0)
            : axis === "y"
                ? new THREE.Vector3(0, 1, 0)
                : new THREE.Vector3(0, 0, 1);

        return this.arrayMeshWithTransform(count, (i, position) => {
            if (i === 0) return position.clone();
            const angle = angleStep * i;
            const quaternion = new THREE.Quaternion().setFromAxisAngle(axisVec, angle);
            const translated = position.clone().sub(pivot);
            translated.applyQuaternion(quaternion);
            translated.add(pivot);
            return translated;
        });
    }

    private edgeBevelSelection(width: number, steps = 1, profile: "flat" | "round" = "flat") {
        const sourceMeshData = this.meshData;
        if (!sourceMeshData || this.selectedEdgeIds.size === 0) {
            showToast({type: "warning", title: "Select at least one edge to bevel."});
            return false;
        }

        // Collect edge vertex positions for multi-edge lookup after topology changes
        const edgePositions: Array<[THREE.Vector3Like, THREE.Vector3Like]> = [];
        for (const eid of this.selectedEdgeIds) {
            const e = sourceMeshData.edges.get(eid);
            if (!e) continue;
            const v1 = sourceMeshData.getVertex(e.v1Id);
            const v2 = sourceMeshData.getVertex(e.v2Id);
            if (!v1 || !v2) continue;
            edgePositions.push([
                {...v1.position},
                {...v2.position},
            ]);
        }

        let meshData = MeshData.fromJSON(sourceMeshData.toJSON());
        let anyBeveled = false;

        for (const [p1, p2] of edgePositions) {
            let targetEdgeId: number | null = null;
            const eps = 1e-6;
            for (const edge of meshData.edges.values()) {
                const va = meshData.getVertex(edge.v1Id);
                const vb = meshData.getVertex(edge.v2Id);
                if (!va || !vb) continue;
                if ((getPositionDistance(va.position, p1) < eps && getPositionDistance(vb.position, p2) < eps) ||
                    (getPositionDistance(va.position, p2) < eps && getPositionDistance(vb.position, p1) < eps)) {
                    targetEdgeId = edge.id;
                    break;
                }
            }
            if (targetEdgeId === null) continue;

            const result = this.bevelSingleEdge(meshData, targetEdgeId, width, steps, profile);
            if (result) {
                meshData = result;
                anyBeveled = true;
            }
        }

        if (!anyBeveled) return false;
        const rebuilt = this.rebuildMeshDataFromFaces(meshData, this.getFaceVertexLists(meshData));
        this.commitMeshEdit(rebuilt.meshData, {});
        return true;
    }

    private bevelSingleEdge(
        meshData: MeshData, edgeId: number, width: number, steps: number, profile: "flat" | "round",
    ): MeshData | null {
        const edge = meshData.edges.get(edgeId);
        if (!edge) return null;

        const edgeFaceIds = Array.from(edge.faceIds);
        if (edgeFaceIds.length === 0 || edgeFaceIds.length > 2) return null;

        const firstVertex = meshData.getVertex(edge.v1Id);
        const secondVertex = meshData.getVertex(edge.v2Id);
        if (!firstVertex || !secondVertex) return null;

        const replacementFaces: number[][] = [];
        const facesToReplace = new Set<number>();
        const sideVerts: Array<{sId: number; eId: number; sPos: THREE.Vector3; ePos: THREE.Vector3}> = [];

        edgeFaceIds.forEach((faceId, faceIndex) => {
            const face = meshData.faces.get(faceId);
            if (!face) return;
            const path = this.getFaceBoundaryPathWithoutEdge(
                face.vertexIds,
                faceIndex === 0 ? edge.v1Id : edge.v2Id,
                faceIndex === 0 ? edge.v2Id : edge.v1Id,
            );
            if (!path || path.length < 3) return;

            const startNeighbor = meshData.getVertex(path[1]!);
            const endNeighbor = meshData.getVertex(path[path.length - 2]!);
            const startVtx = meshData.getVertex(path[0]!);
            const endVtx = meshData.getVertex(path[path.length - 1]!);
            if (!startNeighbor || !endNeighbor || !startVtx || !endVtx) return;

            const sPos = new THREE.Vector3(startVtx.position.x, startVtx.position.y, startVtx.position.z).lerp(
                new THREE.Vector3(startNeighbor.position.x, startNeighbor.position.y, startNeighbor.position.z), width);
            const ePos = new THREE.Vector3(endVtx.position.x, endVtx.position.y, endVtx.position.z).lerp(
                new THREE.Vector3(endNeighbor.position.x, endNeighbor.position.y, endNeighbor.position.z), width);

            const newS = meshData.addVertex({x: sPos.x, y: sPos.y, z: sPos.z});
            const newE = meshData.addVertex({x: ePos.x, y: ePos.y, z: ePos.z});
            sideVerts.push({sId: newS.id, eId: newE.id, sPos, ePos});
            replacementFaces.push([newS.id, ...path.slice(1, -1), newE.id]);
            facesToReplace.add(faceId);
        });

        if (replacementFaces.length === 0) return null;

        const nextFaces = Array.from(meshData.faces.values())
            .filter(f => !facesToReplace.has(f.id))
            .map(f => [...f.vertexIds]);
        nextFaces.push(...replacementFaces);

        if (edgeFaceIds.length === 1) {
            const s = sideVerts[0]!;
            this.addBevelStripFaces(meshData, nextFaces,
                new THREE.Vector3(firstVertex.position.x, firstVertex.position.y, firstVertex.position.z),
                new THREE.Vector3(secondVertex.position.x, secondVertex.position.y, secondVertex.position.z),
                s.sPos, s.ePos, edge.v1Id, edge.v2Id, s.sId, s.eId, steps, profile);
        } else {
            const sA = sideVerts[0]!;
            const sB = sideVerts[1]!;
            nextFaces.push([edge.v1Id, sB.sId, sA.sId]);
            nextFaces.push([edge.v2Id, sA.eId, sB.eId]);
            this.addBevelStripFaces(meshData, nextFaces,
                sA.sPos, sA.ePos, sB.sPos, sB.ePos,
                sA.sId, sA.eId, sB.sId, sB.eId, steps, profile);
        }

        return this.rebuildMeshDataFromFaces(meshData, nextFaces).meshData;
    }

    private addBevelStripFaces(
        meshData: MeshData, nextFaces: number[][],
        startA: THREE.Vector3, endA: THREE.Vector3,
        startB: THREE.Vector3, endB: THREE.Vector3,
        startAId: number, endAId: number, startBId: number, endBId: number,
        steps: number, profile: "flat" | "round",
    ) {
        let outwardDir: THREE.Vector3 | null = null;
        if (profile === "round") {
            const edgeDir = endA.clone().sub(startA).normalize();
            const chordDir = startB.clone().sub(startA).normalize();
            outwardDir = new THREE.Vector3().crossVectors(edgeDir, chordDir).normalize();
            if (outwardDir.lengthSq() < 1e-6) outwardDir = null;
        }
        const chordLen = startA.distanceTo(startB);

        let prevSId = startAId;
        let prevEId = endAId;
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const isLast = i === steps;
            let curSId: number;
            let curEId: number;
            if (isLast) {
                curSId = startBId;
                curEId = endBId;
            } else {
                const sPos = startA.clone().lerp(startB, t);
                const ePos = endA.clone().lerp(endB, t);
                if (profile === "round" && outwardDir) {
                    const bulge = Math.sin(t * Math.PI) * chordLen * 0.25;
                    sPos.addScaledVector(outwardDir, bulge);
                    ePos.addScaledVector(outwardDir, bulge);
                }
                const newS = meshData.addVertex({x: sPos.x, y: sPos.y, z: sPos.z});
                const newE = meshData.addVertex({x: ePos.x, y: ePos.y, z: ePos.z});
                curSId = newS.id;
                curEId = newE.id;
            }
            nextFaces.push([prevSId, prevEId, curEId, curSId]);
            prevSId = curSId;
            prevEId = curEId;
        }
    }

    private getFaceVertexLists(meshData: MeshData) {
        return Array.from(meshData.faces.values()).map(face => [...face.vertexIds]);
    }

    private normalizeFaceVertexIds(vertexIds: number[]) {
        const normalized = [...vertexIds];
        if (normalized.length > 1 && normalized[0] === normalized[normalized.length - 1]) {
            normalized.pop();
        }

        const collapsed = normalized.filter((vertexId, index, array) => index === 0 || vertexId !== array[index - 1]);
        if (collapsed.length > 1 && collapsed[0] === collapsed[collapsed.length - 1]) {
            collapsed.pop();
        }

        return collapsed;
    }

    private rebuildMeshDataFromFaces(
        meshData: MeshData,
        faceVertexLists: number[][],
        vertexOverrides = new Map<number, THREE.Vector3>(),
    ) {
        const rebuilt = new MeshData();
        const oldToNewVertexId = new Map<number, number>();
        const faceIds: number[] = [];

        const ensureVertex = (oldVertexId: number) => {
            const existing = oldToNewVertexId.get(oldVertexId);
            if (existing !== undefined) {
                return existing;
            }

            const override = vertexOverrides.get(oldVertexId);
            const sourceVertex = meshData.getVertex(oldVertexId);
            if (!override && !sourceVertex) {
                return null;
            }

            const nextVertex = rebuilt.addVertex(override
                ? {x: override.x, y: override.y, z: override.z}
                : {...sourceVertex!.position});
            oldToNewVertexId.set(oldVertexId, nextVertex.id);
            return nextVertex.id;
        };

        faceVertexLists.forEach(faceVertexIds => {
            const normalized = this.normalizeFaceVertexIds(faceVertexIds);
            if (new Set(normalized).size < 3) {
                return;
            }

            const mappedVertexIds = normalized
                .map(vertexId => ensureVertex(vertexId))
                .filter((vertexId): vertexId is number => vertexId !== null);

            const mappedNormalized = this.normalizeFaceVertexIds(mappedVertexIds);
            if (new Set(mappedNormalized).size < 3) {
                return;
            }

            const face = rebuilt.addFace(mappedNormalized);
            faceIds.push(face.id);
        });

        return {
            meshData: rebuilt,
            oldToNewVertexId,
            faceIds,
        };
    }

    private getFaceBoundaryPathWithoutEdge(faceVertexIds: number[], startVertexId: number, endVertexId: number) {
        const startIndex = faceVertexIds.indexOf(startVertexId);
        if (startIndex === -1) {
            return null;
        }

        const nextVertexId = faceVertexIds[(startIndex + 1) % faceVertexIds.length]!;
        const direction = nextVertexId === endVertexId ? -1 : 1;
        const path = [startVertexId];
        let index = startIndex;

        while (true) {
            index = (index + direction + faceVertexIds.length) % faceVertexIds.length;
            const vertexId = faceVertexIds[index]!;
            path.push(vertexId);
            if (vertexId === endVertexId) {
                return path;
            }
            if (path.length > faceVertexIds.length + 1) {
                return null;
            }
        }
    }

    private getForwardFacePath(faceVertexIds: number[], startVertexId: number, endVertexId: number) {
        const startIndex = faceVertexIds.indexOf(startVertexId);
        if (startIndex === -1 || !faceVertexIds.includes(endVertexId)) {
            return null;
        }

        const path = [startVertexId];
        let index = startIndex;

        while (true) {
            index = (index + 1) % faceVertexIds.length;
            const vertexId = faceVertexIds[index]!;
            path.push(vertexId);
            if (vertexId === endVertexId) {
                return path;
            }
            if (path.length > faceVertexIds.length + 1) {
                return null;
            }
        }
    }

    private mergeFacesAcrossEdge(meshData: MeshData, edgeId: number) {
        const edge = meshData.edges.get(edgeId);
        if (!edge) {
            return false;
        }

        const faceIds = Array.from(edge.faceIds);
        if (faceIds.length !== 2) {
            return false;
        }

        const firstFace = meshData.faces.get(faceIds[0]!);
        const secondFace = meshData.faces.get(faceIds[1]!);
        if (!firstFace || !secondFace) {
            return false;
        }

        const firstPath = this.getFaceBoundaryPathWithoutEdge(firstFace.vertexIds, edge.v1Id, edge.v2Id);
        const secondPath = this.getFaceBoundaryPathWithoutEdge(secondFace.vertexIds, edge.v2Id, edge.v1Id);
        if (!firstPath || !secondPath) {
            return false;
        }

        const mergedFace = [...firstPath, ...secondPath.slice(1, -1)];
        if (new Set(mergedFace).size < 3) {
            return false;
        }

        meshData.deleteFace(firstFace);
        meshData.deleteFace(secondFace);
        meshData.addFace(this.normalizeFaceVertexIds(mergedFace));
        return true;
    }

    private computeEdgeRingIds(meshData: MeshData, startEdgeId: number) {
        const visitedEdgeIds = new Set<number>();
        const queue = [startEdgeId];

        while (queue.length > 0) {
            const edgeId = queue.pop()!;
            if (visitedEdgeIds.has(edgeId)) {
                continue;
            }
            visitedEdgeIds.add(edgeId);

            const edge = meshData.edges.get(edgeId);
            if (!edge) {
                continue;
            }

            edge.faceIds.forEach(faceId => {
                const face = meshData.faces.get(faceId);
                if (!face || face.vertexIds.length !== 4) {
                    return;
                }

                const oppositeEdgeId = this.getOppositeEdgeIdInQuad(meshData, face.vertexIds, edge.v1Id, edge.v2Id);
                if (oppositeEdgeId !== null && !visitedEdgeIds.has(oppositeEdgeId)) {
                    queue.push(oppositeEdgeId);
                }
            });
        }

        return Array.from(visitedEdgeIds);
    }

    private computeEdgeLoopIds(meshData: MeshData, startEdgeId: number) {
        const result = new Set<number>([startEdgeId]);
        const walk = (fromEdgeId: number, fromVertexId: number) => {
            let currentEdgeId = fromEdgeId;
            let currentVertexId = fromVertexId;
            let previousDirection = this.getEdgeDirectionAtVertex(meshData, currentEdgeId, currentVertexId);

            while (true) {
                const vertex = meshData.getVertex(currentVertexId);
                if (!vertex) {
                    break;
                }

                const candidateEdgeIds = Array.from(vertex.edgeIds).filter(edgeId => edgeId !== currentEdgeId);
                let nextEdgeId: number | null = null;
                let bestDot = -Infinity;

                candidateEdgeIds.forEach(edgeId => {
                    const direction = this.getEdgeDirectionAtVertex(meshData, edgeId, currentVertexId);
                    if (!direction || !previousDirection) {
                        return;
                    }

                    const score = Math.abs(direction.dot(previousDirection));
                    if (score > bestDot) {
                        bestDot = score;
                        nextEdgeId = edgeId;
                    }
                });

                if (nextEdgeId === null || result.has(nextEdgeId)) {
                    break;
                }

                result.add(nextEdgeId);
                const nextEdge = meshData.edges.get(nextEdgeId);
                if (!nextEdge) {
                    break;
                }

                const nextVertexId = nextEdge.v1Id === currentVertexId ? nextEdge.v2Id : nextEdge.v1Id;
                previousDirection = this.getEdgeDirectionAtVertex(meshData, nextEdgeId, nextVertexId);
                currentEdgeId = nextEdgeId;
                currentVertexId = nextVertexId;
            }
        };

        const startEdge = meshData.edges.get(startEdgeId);
        if (!startEdge) {
            return [];
        }

        walk(startEdgeId, startEdge.v1Id);
        walk(startEdgeId, startEdge.v2Id);
        return Array.from(result);
    }

    private getEdgeDirectionAtVertex(meshData: MeshData, edgeId: number, vertexId: number) {
        const edge = meshData.edges.get(edgeId);
        if (!edge) {
            return null;
        }

        const currentVertex = meshData.getVertex(vertexId);
        const otherVertex = meshData.getVertex(edge.v1Id === vertexId ? edge.v2Id : edge.v1Id);
        if (!currentVertex || !otherVertex) {
            return null;
        }

        return new THREE.Vector3(
            otherVertex.position.x - currentVertex.position.x,
            otherVertex.position.y - currentVertex.position.y,
            otherVertex.position.z - currentVertex.position.z,
        ).normalize();
    }

    private getOppositeEdgeIdInQuad(meshData: MeshData, faceVertexIds: number[], edgeV1Id: number, edgeV2Id: number) {
        for (let index = 0; index < faceVertexIds.length; index++) {
            const currentId = faceVertexIds[index]!;
            const nextId = faceVertexIds[(index + 1) % faceVertexIds.length]!;
            const matchesForward = currentId === edgeV1Id && nextId === edgeV2Id;
            const matchesReverse = currentId === edgeV2Id && nextId === edgeV1Id;
            if (!matchesForward && !matchesReverse) {
                continue;
            }

            const oppositeV1Id = faceVertexIds[(index + 2) % faceVertexIds.length]!;
            const oppositeV2Id = faceVertexIds[(index + 3) % faceVertexIds.length]!;
            return meshData.getEdge(oppositeV1Id, oppositeV2Id)?.id ?? null;
        }

        return null;
    }

    private orderSelectedEdgeLoop(meshData: MeshData, edgeIds: number[]) {
        const selectedEdgeIdSet = new Set(edgeIds);
        const adjacency = new Map<number, number[]>();

        edgeIds.forEach(edgeId => {
            const edge = meshData.edges.get(edgeId);
            if (!edge) {
                return;
            }

            adjacency.set(edge.v1Id, [...(adjacency.get(edge.v1Id) || []), edge.v2Id]);
            adjacency.set(edge.v2Id, [...(adjacency.get(edge.v2Id) || []), edge.v1Id]);
        });

        if (Array.from(adjacency.values()).some(neighbors => neighbors.length !== 2)) {
            return null;
        }

        const firstEdge = meshData.edges.get(edgeIds[0]!);
        if (!firstEdge) {
            return null;
        }

        const orderedVertexIds = [firstEdge.v1Id];
        let previousVertexId: number | null = null;
        let currentVertexId = firstEdge.v1Id;

        while (true) {
            const neighbors = adjacency.get(currentVertexId) || [];
            const nextVertexId = neighbors.find(vertexId => vertexId !== previousVertexId);
            if (nextVertexId === undefined) {
                return null;
            }

            const edgeId = meshData.getEdge(currentVertexId, nextVertexId)?.id;
            if (edgeId === undefined || !selectedEdgeIdSet.has(edgeId)) {
                return null;
            }

            previousVertexId = currentVertexId;
            currentVertexId = nextVertexId;

            if (currentVertexId === orderedVertexIds[0]) {
                break;
            }

            if (orderedVertexIds.includes(currentVertexId)) {
                return null;
            }

            orderedVertexIds.push(currentVertexId);
        }

        return orderedVertexIds;
    }

    private applyPreviewMeshData(meshData: MeshData) {
        const object = this.editedObject;
        if (!object) {
            return;
        }

        const nextGeometry = createGeometryFromMeshData(meshData);
        object.geometry.dispose();
        object.geometry = nextGeometry;
        object.geometry.computeBoundingSphere();
        object.updateMatrixWorld(true);
        this.refresh();
        if (!this.activeTransformMode) {
            this.updateTransformControls();
        }
    }

    private getOrderedEdgeVerticesForFace(faceVertexIds: number[], v1Id: number, v2Id: number) {
        for (let index = 0; index < faceVertexIds.length; index++) {
            const currentId = faceVertexIds[index]!;
            const nextId = faceVertexIds[(index + 1) % faceVertexIds.length]!;

            if (currentId === v1Id && nextId === v2Id) {
                return [v1Id, v2Id] as const;
            }

            if (currentId === v2Id && nextId === v1Id) {
                return [v2Id, v1Id] as const;
            }
        }

        return null;
    }

    private commitMeshEdit(
        meshData: MeshData,
        selection: {
            vertexIds?: number[];
            edgeIds?: number[];
            faceIds?: number[];
        } = {},
    ) {
        const object = this.editedObject;
        if (!object) {
            return;
        }

        const previousGeometry = object.geometry.clone();
        const previousMeshData = structuredClone(object.userData.meshData || null);
        const nextGeometry = createGeometryFromMeshData(meshData);

        void this.editor.execute(
            new SetEditableMeshCommand(object, nextGeometry, meshData, previousGeometry, previousMeshData),
        ).then(() => {
            this.selectedVertexIds = new Set(selection.vertexIds || []);
            this.selectedEdgeIds = new Set(selection.edgeIds || []);
            this.selectedFaceIds = new Set(selection.faceIds || []);
            this.refresh();
            this.refreshHighlights();
            this.updateTransformControls();
            global.app?.call("cadSelectionChanged", this, {
                vertexIds: Array.from(this.selectedVertexIds),
                edgeIds: Array.from(this.selectedEdgeIds),
                faceIds: Array.from(this.selectedFaceIds),
            });
            global.app?.call("objectChanged", this, object);
        });
    }

    private computeFaceCentroid(meshData: MeshData, vertexIds: number[]) {
        const centroid = new THREE.Vector3();
        let count = 0;

        vertexIds.forEach(vertexId => {
            const vertex = meshData.getVertex(vertexId);
            if (!vertex) {
                return;
            }

            addPositionToVector(centroid, vertex.position);
            count++;
        });

        return count > 0 ? centroid.divideScalar(count) : centroid;
    }

    private computeFaceNormal(meshData: MeshData, vertexIds: number[]) {
        if (vertexIds.length < 3) {
            return new THREE.Vector3(0, 1, 0);
        }

        const p0 = meshData.getVertex(vertexIds[0]!)?.position;
        const p1 = meshData.getVertex(vertexIds[1]!)?.position;
        const p2 = meshData.getVertex(vertexIds[2]!)?.position;
        if (!p0 || !p1 || !p2) {
            return new THREE.Vector3(0, 1, 0);
        }

        const ux = p1.x - p0.x;
        const uy = p1.y - p0.y;
        const uz = p1.z - p0.z;
        const vx = p2.x - p0.x;
        const vy = p2.y - p0.y;
        const vz = p2.z - p0.z;
        const normal = new THREE.Vector3(
            uy * vz - uz * vy,
            uz * vx - ux * vz,
            ux * vy - uy * vx,
        );
        return normal.lengthSq() > 0 ? normal.normalize() : new THREE.Vector3(0, 1, 0);
    }

    private getSelectedVertexIds() {
        const meshData = this.meshData;
        if (!meshData) {
            return [];
        }

        if (this.editor.cadSelectionMode === "vertex") {
            return Array.from(this.selectedVertexIds);
        }

        if (this.editor.cadSelectionMode === "edge") {
            const vertexIds = new Set<number>();
            this.selectedEdgeIds.forEach(edgeId => {
                const edge = meshData.edges.get(edgeId);
                if (!edge) {
                    return;
                }

                vertexIds.add(edge.v1Id);
                vertexIds.add(edge.v2Id);
            });
            return Array.from(vertexIds);
        }

        const vertexIds = new Set<number>();
        this.selectedFaceIds.forEach(faceId => {
            const face = meshData.faces.get(faceId);
            face?.vertexIds.forEach(vertexId => vertexIds.add(vertexId));
        });
        return Array.from(vertexIds);
    }

    private getSelectionCenterWorld() {
        const object = this.editedObject;
        const meshData = this.meshData;
        const selectedVertexIds = this.getSelectedVertexIds();
        if (!object || !meshData || selectedVertexIds.length === 0) {
            return null;
        }

        const center = new THREE.Vector3();
        const worldPosition = new THREE.Vector3();
        selectedVertexIds.forEach(vertexId => {
            const vertex = meshData.getVertex(vertexId);
            if (!vertex) {
                return;
            }

            center.add(setVectorFromPosition(worldPosition, vertex.position).applyMatrix4(object.matrixWorld));
        });

        center.divideScalar(selectedVertexIds.length);
        return center;
    }

    private getFaceOperationTransformData(meshDataOverride?: MeshData) {
        const object = this.editedObject;
        const meshData = meshDataOverride || this.meshData;
        if (!object || !meshData || this.selectedFaceIds.size === 0) {
            return null;
        }

        if ((this.editor.cadTool === "inset" || this.editor.cadTool === "bevel") && this.selectedFaceIds.size !== 1) {
            return null;
        }

        const centerLocal = new THREE.Vector3();
        const normalLocal = new THREE.Vector3();
        let vertexCount = 0;
        let faceCount = 0;

        this.selectedFaceIds.forEach(faceId => {
            const face = meshData.faces.get(faceId);
            if (!face) {
                return;
            }

            face.vertexIds.forEach(vertexId => {
                const vertex = meshData.getVertex(vertexId);
                if (!vertex) {
                    return;
                }

                addPositionToVector(centerLocal, vertex.position);
                vertexCount++;
            });

            normalLocal.add(this.computeFaceNormal(meshData, face.vertexIds));
            faceCount++;
        });

        if (vertexCount === 0 || normalLocal.lengthSq() === 0 || faceCount === 0) {
            return null;
        }

        centerLocal.divideScalar(vertexCount);
        normalLocal.normalize();

        const centerWorld = centerLocal.clone().applyMatrix4(object.matrixWorld);
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(object.matrixWorld);
        const normalWorld = normalLocal.clone().applyMatrix3(normalMatrix).normalize();
        const quaternionWorld = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normalWorld);

        return {
            centerWorld,
            normalWorld,
            quaternionWorld,
        };
    }

    private getSelectedEdgeComponents(meshData: MeshData, edgeIds: number[]) {
        const remainingEdgeIds = new Set(edgeIds);
        const components: Array<{
            edgeIds: number[];
            vertexIds: number[];
            adjacency: Map<number, Array<{edgeId: number; otherId: number}>>;
        }> = [];

        while (remainingEdgeIds.size > 0) {
            const firstEdgeId = Array.from(remainingEdgeIds)[0]!;
            const queue = [firstEdgeId];
            const componentEdgeIds: number[] = [];
            const componentVertexIds = new Set<number>();
            const adjacency = new Map<number, Array<{edgeId: number; otherId: number}>>();

            while (queue.length > 0) {
                const edgeId = queue.pop()!;
                if (!remainingEdgeIds.has(edgeId)) {
                    continue;
                }

                remainingEdgeIds.delete(edgeId);
                componentEdgeIds.push(edgeId);

                const edge = meshData.edges.get(edgeId);
                if (!edge) {
                    continue;
                }

                componentVertexIds.add(edge.v1Id);
                componentVertexIds.add(edge.v2Id);

                const firstAdjacency = adjacency.get(edge.v1Id) || [];
                firstAdjacency.push({edgeId, otherId: edge.v2Id});
                adjacency.set(edge.v1Id, firstAdjacency);

                const secondAdjacency = adjacency.get(edge.v2Id) || [];
                secondAdjacency.push({edgeId, otherId: edge.v1Id});
                adjacency.set(edge.v2Id, secondAdjacency);

                [edge.v1Id, edge.v2Id].forEach(vertexId => {
                    const vertex = meshData.getVertex(vertexId);
                    if (!vertex) {
                        return;
                    }

                    vertex.edgeIds.forEach(connectedEdgeId => {
                        if (remainingEdgeIds.has(connectedEdgeId)) {
                            queue.push(connectedEdgeId);
                        }
                    });
                });
            }

            components.push({
                edgeIds: componentEdgeIds,
                vertexIds: Array.from(componentVertexIds),
                adjacency,
            });
        }

        return components;
    }

    private applyExactChainEdgeLength(
        meshData: MeshData,
        component: {
            edgeIds: number[];
            vertexIds: number[];
            adjacency: Map<number, Array<{edgeId: number; otherId: number}>>;
        },
        targetLength: number,
    ) {
        const degrees = Array.from(component.adjacency.entries()).map(([vertexId, links]) => ({
            vertexId,
            degree: links.length,
        }));

        if (degrees.some(entry => entry.degree > 2)) {
            return false;
        }

        const endpoints = degrees.filter(entry => entry.degree === 1).map(entry => entry.vertexId);
        if (endpoints.length !== 2) {
            return false;
        }

        const orderedVertexIds = [endpoints[0]!];
        const visitedEdgeIds = new Set<number>();
        let currentVertexId = endpoints[0]!;
        let previousVertexId: number | null = null;

        while (true) {
            const links = component.adjacency.get(currentVertexId) || [];
            const nextLink = links.find(link => !visitedEdgeIds.has(link.edgeId) && link.otherId !== previousVertexId);
            if (!nextLink) {
                break;
            }

            visitedEdgeIds.add(nextLink.edgeId);
            previousVertexId = currentVertexId;
            currentVertexId = nextLink.otherId;
            orderedVertexIds.push(currentVertexId);
        }

        if (visitedEdgeIds.size !== component.edgeIds.length || orderedVertexIds.length !== component.vertexIds.length) {
            return false;
        }

        const originalPositions = new Map<number, THREE.Vector3>();
        component.vertexIds.forEach(vertexId => {
            const vertex = meshData.getVertex(vertexId);
            if (!vertex) {
                return;
            }

            originalPositions.set(vertexId, new THREE.Vector3(vertex.position.x, vertex.position.y, vertex.position.z));
        });

        const solvedPositions = new Map<number, THREE.Vector3>();
        solvedPositions.set(orderedVertexIds[0]!, originalPositions.get(orderedVertexIds[0]!)!.clone());
        let previousDirection = new THREE.Vector3(1, 0, 0);

        for (let index = 0; index < orderedVertexIds.length - 1; index++) {
            const currentId = orderedVertexIds[index]!;
            const nextId = orderedVertexIds[index + 1]!;
            const currentPosition = solvedPositions.get(currentId);
            const originalCurrent = originalPositions.get(currentId);
            const originalNext = originalPositions.get(nextId);
            if (!currentPosition || !originalCurrent || !originalNext) {
                return false;
            }

            const direction = originalNext.clone().sub(originalCurrent);
            if (direction.lengthSq() === 0) {
                direction.copy(previousDirection);
            } else {
                direction.normalize();
                previousDirection = direction.clone();
            }

            solvedPositions.set(nextId, currentPosition.clone().add(direction.multiplyScalar(targetLength)));
        }

        const oldCentroid = new THREE.Vector3();
        const newCentroid = new THREE.Vector3();
        component.vertexIds.forEach(vertexId => {
            const original = originalPositions.get(vertexId);
            const solved = solvedPositions.get(vertexId);
            if (original) {
                oldCentroid.add(original);
            }
            if (solved) {
                newCentroid.add(solved);
            }
        });

        oldCentroid.divideScalar(component.vertexIds.length);
        newCentroid.divideScalar(component.vertexIds.length);
        const centroidDelta = oldCentroid.sub(newCentroid);

        solvedPositions.forEach((position, vertexId) => {
            const vertex = meshData.getVertex(vertexId);
            if (!vertex) {
                return;
            }

            position.add(centroidDelta);
            vertex.position = {
                x: position.x,
                y: position.y,
                z: position.z,
            };
        });

        return true;
    }

    private applyAveragedEdgeLengthComponent(meshData: MeshData, edgeIds: number[], targetLength: number) {
        const proposedVertexPositions = new Map<number, THREE.Vector3[]>();

        edgeIds.forEach(edgeId => {
            const edge = meshData.edges.get(edgeId);
            if (!edge) {
                return;
            }

            const firstVertex = meshData.getVertex(edge.v1Id);
            const secondVertex = meshData.getVertex(edge.v2Id);
            if (!firstVertex || !secondVertex) {
                return;
            }

            const start = new THREE.Vector3(firstVertex.position.x, firstVertex.position.y, firstVertex.position.z);
            const end = new THREE.Vector3(secondVertex.position.x, secondVertex.position.y, secondVertex.position.z);
            const midpoint = start.clone().add(end).multiplyScalar(0.5);
            const direction = end.clone().sub(start);

            if (direction.lengthSq() === 0) {
                direction.set(1, 0, 0);
            } else {
                direction.normalize();
            }

            const halfSpan = direction.multiplyScalar(targetLength * 0.5);
            const nextStart = midpoint.clone().sub(halfSpan);
            const nextEnd = midpoint.clone().add(halfSpan);

            const firstVertexTargets = proposedVertexPositions.get(edge.v1Id) || [];
            firstVertexTargets.push(nextStart);
            proposedVertexPositions.set(edge.v1Id, firstVertexTargets);

            const secondVertexTargets = proposedVertexPositions.get(edge.v2Id) || [];
            secondVertexTargets.push(nextEnd);
            proposedVertexPositions.set(edge.v2Id, secondVertexTargets);
        });

        proposedVertexPositions.forEach((targets, vertexId) => {
            if (targets.length === 0) {
                return;
            }

            const vertex = meshData.getVertex(vertexId);
            if (!vertex) {
                return;
            }

            const averaged = new THREE.Vector3();
            targets.forEach(target => averaged.add(target));
            averaged.divideScalar(targets.length);
            vertex.position = {
                x: averaged.x,
                y: averaged.y,
                z: averaged.z,
            };
        });
    }

    private lineIntersectsRect(
        a: {x: number; y: number},
        b: {x: number; y: number},
        minX: number,
        minY: number,
        maxX: number,
        maxY: number,
    ) {
        const corners = [
            [{x: minX, y: minY}, {x: maxX, y: minY}],
            [{x: maxX, y: minY}, {x: maxX, y: maxY}],
            [{x: maxX, y: maxY}, {x: minX, y: maxY}],
            [{x: minX, y: maxY}, {x: minX, y: minY}],
        ] as const;

        return corners.some(([c1, c2]) => this.lineSegmentsIntersect(a, b, c1, c2));
    }

    private lineIntersectsPolygon(a: {x: number; y: number}, b: {x: number; y: number}, polygon: Array<{x: number; y: number}>) {
        for (let index = 0; index < polygon.length; index++) {
            const current = polygon[index]!;
            const next = polygon[(index + 1) % polygon.length]!;
            if (this.lineSegmentsIntersect(a, b, current, next)) {
                return true;
            }
        }

        return false;
    }

    private lineSegmentsIntersect(
        a1: {x: number; y: number},
        a2: {x: number; y: number},
        b1: {x: number; y: number},
        b2: {x: number; y: number},
    ) {
        const orientation = (p: {x: number; y: number}, q: {x: number; y: number}, r: {x: number; y: number}) => {
            const value = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
            if (Math.abs(value) < 1e-6) {
                return 0;
            }
            return value > 0 ? 1 : 2;
        };

        const onSegment = (p: {x: number; y: number}, q: {x: number; y: number}, r: {x: number; y: number}) =>
            q.x <= Math.max(p.x, r.x) &&
            q.x >= Math.min(p.x, r.x) &&
            q.y <= Math.max(p.y, r.y) &&
            q.y >= Math.min(p.y, r.y);

        const o1 = orientation(a1, a2, b1);
        const o2 = orientation(a1, a2, b2);
        const o3 = orientation(b1, b2, a1);
        const o4 = orientation(b1, b2, a2);

        if (o1 !== o2 && o3 !== o4) {
            return true;
        }

        if (o1 === 0 && onSegment(a1, b1, a2)) return true;
        if (o2 === 0 && onSegment(a1, b2, a2)) return true;
        if (o3 === 0 && onSegment(b1, a1, b2)) return true;
        if (o4 === 0 && onSegment(b1, a2, b2)) return true;
        return false;
    }

    private polygonIntersectsRect(
        points: Array<{x: number; y: number}>,
        minX: number,
        minY: number,
        maxX: number,
        maxY: number,
    ) {
        if (points.some(point => point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY)) {
            return true;
        }

        for (let index = 0; index < points.length; index++) {
            const current = points[index]!;
            const next = points[(index + 1) % points.length]!;
            if (this.lineIntersectsRect(current, next, minX, minY, maxX, maxY)) {
                return true;
            }
        }

        const rectCorners = [
            {x: minX, y: minY},
            {x: maxX, y: minY},
            {x: maxX, y: maxY},
            {x: minX, y: maxY},
        ];

        return rectCorners.some(corner => this.pointInPolygon(corner, points));
    }

    private polygonsIntersect(a: Array<{x: number; y: number}>, b: Array<{x: number; y: number}>) {
        if (a.some(point => this.pointInPolygon(point, b))) {
            return true;
        }

        if (b.some(point => this.pointInPolygon(point, a))) {
            return true;
        }

        for (let index = 0; index < a.length; index++) {
            const currentA = a[index]!;
            const nextA = a[(index + 1) % a.length]!;
            if (this.lineIntersectsPolygon(currentA, nextA, b)) {
                return true;
            }
        }

        return false;
    }

    private pointInPolygon(point: {x: number; y: number}, polygon: Array<{x: number; y: number}>) {
        let inside = false;

        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i]!.x;
            const yi = polygon[i]!.y;
            const xj = polygon[j]!.x;
            const yj = polygon[j]!.y;

            const intersects =
                yi > point.y !== yj > point.y &&
                point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + Number.EPSILON) + xi;

            if (intersects) {
                inside = !inside;
            }
        }

        return inside;
    }

    private addHelper(object: THREE.Object3D) {
        this.helperObjects.push(object);
        global.app?.sceneHelpers.add(object);
    }

    private clearHelpers() {
        this.disposeDragMeasurementLabels();
        this.disposeSelectionOverlays();
        this.helperObjects.forEach(helper => {
            helper.parent?.remove(helper);
            if ((helper as THREE.Mesh).geometry) {
                (helper as THREE.Mesh).geometry.dispose();
            }
            const material = (helper as THREE.Mesh).material;
            if (Array.isArray(material)) {
                material.forEach(mat => mat.dispose());
            } else if (material) {
                material.dispose();
            }
        });
        this.helperObjects = [];
        this.vertexPoints = null;
    }
}
