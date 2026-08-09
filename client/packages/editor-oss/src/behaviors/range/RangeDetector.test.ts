import * as THREE from "three";
import {describe, expect, it, vi} from "vitest";

import RangeDetector from "./RangeDetector";

type RangeDetectorHarness = Record<string, unknown> & {
    distanceThreshold: number;
    playerWorldPosition: THREE.Vector3;
    targetWorldPosition: THREE.Vector3;
    labelWorldPosition: THREE.Vector3;
    textMesh?: THREE.Object3D;
    textElement?: HTMLSpanElement;
    keyElement?: HTMLSpanElement;
    setPlayer(player: THREE.Object3D): void;
    setTarget(target: THREE.Object3D): void;
    setText(text: string): void;
    setKeyText(keyText: string | null): void;
    createText(): void;
    updateDisplayedText(): void;
    updateDisplayedKeyText(): void;
    update(): void;
    isInRange(): boolean;
    updateTextPosition(): void;
};

function createDetector() {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 10);
    const detector = new RangeDetector({scene, camera} as never) as unknown as RangeDetectorHarness;
    const player = new THREE.Object3D();
    const target = new THREE.Object3D();
    scene.add(player, target);
    detector.setPlayer(player);
    detector.setTarget(target);
    return {detector, player, target, camera};
}

describe("RangeDetector", () => {
    it("uses squared distance while preserving threshold semantics", () => {
        const {detector, player, target} = createDetector();
        detector.distanceThreshold = 5;
        player.position.set(0, 0, 0);
        target.position.set(3, 4, 0);
        player.updateMatrixWorld(true);
        target.updateMatrixWorld(true);

        expect(detector.isInRange()).toBe(true);

        target.position.set(3.1, 4, 0);
        target.updateMatrixWorld(true);

        expect(detector.isInRange()).toBe(false);

        detector.distanceThreshold = -1;
        target.position.set(0, 0, 0);
        target.updateMatrixWorld(true);

        expect(detector.isInRange()).toBe(false);
    });

    it("reuses world-position scratch vectors for range checks", () => {
        const {detector, player, target} = createDetector();
        const playerScratch = detector.playerWorldPosition;
        const targetScratch = detector.targetWorldPosition;
        detector.distanceThreshold = 10;
        player.position.set(1, 2, 3);
        target.position.set(4, 5, 6);
        player.updateMatrixWorld(true);
        target.updateMatrixWorld(true);

        detector.isInRange();
        detector.isInRange();

        expect(detector.playerWorldPosition).toBe(playerScratch);
        expect(detector.targetWorldPosition).toBe(targetScratch);
        expect(playerScratch.toArray()).toEqual([1, 2, 3]);
        expect(targetScratch.toArray()).toEqual([4, 5, 6]);
    });

    it("reuses the label-position scratch vector when updating text placement", () => {
        const {detector, target} = createDetector();
        const labelScratch = detector.labelWorldPosition;
        const textMesh = new THREE.Object3D();
        const lookAt = vi.spyOn(textMesh, "lookAt").mockImplementation(() => undefined);
        detector.textMesh = textMesh;
        target.position.set(2, 3, 4);
        target.updateMatrixWorld(true);

        detector.updateTextPosition();

        expect(detector.labelWorldPosition).toBe(labelScratch);
        expect(textMesh.position.toArray()).toEqual([2, 3, 4]);
        expect(lookAt).toHaveBeenCalled();
    });

    it("reuses the range-check target position when updating a visible label", () => {
        const {detector, player, target} = createDetector();
        const textMesh = new THREE.Object3D();
        vi.spyOn(textMesh, "lookAt").mockImplementation(() => undefined);
        detector.textMesh = textMesh;
        detector.distanceThreshold = 10;
        player.position.set(0, 0, 0);
        target.position.set(3, 4, 0);
        player.updateMatrixWorld(true);
        target.updateMatrixWorld(true);
        const playerGetWorldPosition = vi.spyOn(player, "getWorldPosition");
        const targetGetWorldPosition = vi.spyOn(target, "getWorldPosition");

        detector.update();

        expect(detector.isTargetInRange).toBe(true);
        expect(textMesh.visible).toBe(true);
        expect(textMesh.position.toArray()).toEqual([3, 4, 0]);
        expect(playerGetWorldPosition).toHaveBeenCalledTimes(1);
        expect(targetGetWorldPosition).toHaveBeenCalledTimes(1);
    });

    it("skips DOM text updates when the label text is unchanged", () => {
        const {detector} = createDetector();
        const updateDisplayedText = vi.spyOn(detector, "updateDisplayedText");

        detector.setText("Open");
        detector.setText("Open");
        detector.setText("Collect");

        expect(updateDisplayedText).toHaveBeenCalledTimes(2);
    });

    it("skips DOM key updates when the key text is unchanged", () => {
        const {detector} = createDetector();
        const updateDisplayedKeyText = vi.spyOn(detector, "updateDisplayedKeyText");

        detector.setKeyText("E");
        detector.setKeyText("E");
        detector.setKeyText(null);

        expect(updateDisplayedKeyText).toHaveBeenCalledTimes(2);
    });

    it("preserves key text while changing the label text", () => {
        const {detector} = createDetector();
        detector.setKeyText("E");
        detector.setText("Open");
        detector.createText();
        const keyElement = detector.keyElement;

        detector.setText("Collect");

        expect(detector.textElement?.textContent).toBe("ECollect");
        expect(detector.keyElement).toBe(keyElement);
        expect(detector.textElement?.firstChild).toBe(keyElement);
    });
});
