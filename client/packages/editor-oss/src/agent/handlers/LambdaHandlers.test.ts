import {Object3D, Scene} from "three";
import {beforeEach, describe, expect, it, vi} from "vitest";

const mocks = vi.hoisted(() => ({
    getScriptRevisionData: vi.fn(),
}));

vi.mock("@stem/network/api/script", () => ({
    getScriptRevisionData: mocks.getScriptRevisionData,
}));

import {LambdaHandlers} from "./LambdaHandlers";

const lambdaConfig = {
    id: "motion",
    name: "Motion Lambda",
    description: "Moves registered objects.",
    version: "1.0.0",
    main: "MotionLambda.ts",
    attributes: {
        speed: {name: "Speed", type: "number", default: 1},
    },
    componentSchema: {
        enabled: {name: "Enabled", type: "boolean", default: true},
    },
};

const createHandlers = () => {
    const scene = new Scene();
    scene.userData.lambdaInstances = [
        {lambdaId: "motion", instanceId: "scene-motion", enabled: true, attributes: {speed: 2}},
    ];

    const object = new Object3D();
    object.name = "Mover";
    object.userData.lambdaComponents = [
        {
            lambdaId: "motion",
            instanceId: "component-motion",
            uuid: "component-uuid",
            enabled: true,
            componentData: {enabled: true},
        },
    ];
    scene.add(object);

    const registry = {
        getAllConfigs: vi.fn(() => [lambdaConfig]),
        getAssetMeta: vi.fn(() => ({assetId: "lambda-asset", revisionId: "lambda-rev"})),
        getConfig: vi.fn((id: string) => id === "motion" ? lambdaConfig : null),
    };

    const engine = {
        editor: {lambdaConfigRegistry: registry},
        scene,
    } as any;

    return {handlers: new LambdaHandlers(engine), registry, scene};
};

describe("LambdaHandlers", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getScriptRevisionData.mockResolvedValue({code: "export default class MotionLambda {}"});
    });

    it("lists registered lambda metadata", () => {
        const {handlers} = createHandlers();

        const result = handlers.handleListLambdas({filter: "mot"});

        expect(result.status).toBe("success");
        expect(result.data).toEqual([
            expect.objectContaining({
                id: "motion",
                attributes: ["speed"],
                componentSchema: ["enabled"],
            }),
        ]);
    });

    it("gets lambda config, bindings, and code when available", async () => {
        const {handlers} = createHandlers();

        const result = await handlers.handleGetLambda({lambdaId: "motion", includeCode: true});

        expect(result.status).toBe("success");
        expect(result.data).toEqual(expect.objectContaining({
            assetMeta: {assetId: "lambda-asset", revisionId: "lambda-rev"},
            code: "export default class MotionLambda {}",
            componentBindings: [
                expect.objectContaining({
                    objectName: "Mover",
                    component: expect.objectContaining({lambdaId: "motion"}),
                }),
            ],
            sceneInstances: [
                expect.objectContaining({lambdaId: "motion", instanceId: "scene-motion"}),
            ],
        }));
        expect(mocks.getScriptRevisionData).toHaveBeenCalledWith("lambda-asset", "lambda-rev");
    });

    it("collects component bindings in deep scenes without recursive traversal", async () => {
        const {handlers, scene} = createHandlers();
        let cursor: Object3D = scene;
        for (let i = 0; i < 12_000; i++) {
            const child = new Object3D();
            cursor.add(child);
            cursor = child;
        }
        cursor.name = "Deep Mover";
        cursor.userData.lambdaComponents = [
            {
                lambdaId: "motion",
                instanceId: "deep-component-motion",
                uuid: "deep-component-uuid",
                enabled: true,
                componentData: {enabled: true},
            },
        ];
        const traverseSpy = vi.spyOn(scene, "traverse");

        const result = await handlers.handleGetLambda({lambdaId: "motion"});

        expect(result.status).toBe("success");
        expect(traverseSpy).not.toHaveBeenCalled();
        expect(result.data.componentBindings).toEqual(expect.arrayContaining([
            expect.objectContaining({
                objectName: "Deep Mover",
                component: expect.objectContaining({instanceId: "deep-component-motion"}),
            }),
        ]));
    });
});
