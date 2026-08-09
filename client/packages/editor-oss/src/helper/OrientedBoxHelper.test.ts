import {afterEach, describe, expect, it, vi} from "vitest";
import {Box3, PerspectiveCamera, Vector3} from "three";

import {OrientedBoxHelper} from "./OrientedBoxHelper";

const createCanvasContextMock = () => ({
    measureText: vi.fn((text: string) => ({width: text.length * 32})),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    font: "",
    fillStyle: "",
    textBaseline: "",
    textAlign: "",
}) as unknown as CanvasRenderingContext2D;

const mockCanvasContext = () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
        ((contextId: string) => (
            contextId === "2d" ? createCanvasContextMock() : null
        )) as typeof HTMLCanvasElement.prototype.getContext,
    );
};

describe("OrientedBoxHelper label presentation", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("reuses label rect scratch targets across frame updates", () => {
        mockCanvasContext();

        const helper = new OrientedBoxHelper();
        helper.setFromWorldBox(new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)));

        const camera = new PerspectiveCamera(50, 1, 0.1, 100);
        camera.position.set(0, 0, 8);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);

        const labels = [helper.labelX, helper.labelY, helper.labelZ].filter(
            (label): label is NonNullable<typeof label> => label !== null,
        );
        const scratch = helper as unknown as {
            _labelList: unknown[];
            _labelRects: Array<{cx: number; cy: number; hx: number; hy: number; z: number}>;
            _labelOverlaps: boolean[];
        };
        const labelList = scratch._labelList;
        const rects = scratch._labelRects;
        const overlaps = scratch._labelOverlaps;
        const targets: Array<{cx: number; cy: number; hx: number; hy: number; z: number}> = [];

        labels.forEach((label, index) => {
            vi.spyOn(label, "setPixelHeight").mockImplementation(() => {});
            vi.spyOn(label, "getNDCRect").mockImplementation((_camera, out) => {
                targets.push(out);
                out.cx = index * 0.3;
                out.cy = 0;
                out.hx = 0.05;
                out.hy = 0.05;
                out.z = index * 0.1;
                return true;
            });
        });

        helper.updateLabelPresentation(camera);
        helper.updateLabelPresentation(camera);

        expect(targets).toHaveLength(6);
        expect(scratch._labelList).toBe(labelList);
        expect(scratch._labelRects).toBe(rects);
        expect(scratch._labelOverlaps).toBe(overlaps);
        expect(targets[0]).toBe(rects[0]);
        expect(targets[1]).toBe(rects[1]);
        expect(targets[2]).toBe(rects[2]);
        expect(targets[3]).toBe(rects[0]);
        expect(targets[4]).toBe(rects[1]);
        expect(targets[5]).toBe(rects[2]);
    });
});
