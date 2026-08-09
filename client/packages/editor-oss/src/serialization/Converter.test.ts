vi.mock('three', async (importOriginal) => {
    const actual = await importOriginal<typeof import('three')>();
    return {
        ...actual,
        Audio: vi.fn(),
        AudioListener: vi.fn(),
    };
});

vi.mock('../assets/js/loaders/ModelLoader', () => ({
    default: vi.fn(),
}));

vi.mock('../global', () => ({
    default: {
        app: {
            call: vi.fn(),
        },
    },
}));

import { Mesh, Object3D, PerspectiveCamera, Scene } from 'three';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import Converter from './Converter';
import ModelLoader from '../assets/js/loaders/ModelLoader';

const makeServerObject = () => {
    const obj = new Object3D();
    obj.userData.Server = true;
    obj.userData.Url = '/model1.glb';
    return obj;
};

const makeScene = () => {
    const scene = new Scene();
    scene.name = "ConverterTestScene";
    scene.add(makeServerObject());
    return scene;
};

const addDeepChain = (root: Object3D, depth = 12_000) => {
    let cursor = root;
    for (let i = 0; i < depth; i++) {
        const child = new Object3D();
        child.name = `deep-${i}`;
        cursor.add(child);
        cursor = child;
    }
    return cursor;
};

describe('Converter', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    describe('toJSON', () => {
        // Test absolute / relative URL handling
        [
            {
                convertServerObjUrls: true,
                originalUrl: '/model1.glb',
                expectedUrl: 'https://mocked.com/model1.glb',
            },
            {
                convertServerObjUrls: false,
                originalUrl: '/model1.glb',
                expectedUrl: '/model1.glb',
            },
            {
                convertServerObjUrls: true,
                originalUrl: 'https://mocked.com/model1.glb',
                expectedUrl: 'https://mocked.com/model1.glb',
            },
            {
                convertServerObjUrls: false,
                originalUrl: 'https://mocked.com/model1.glb',
                expectedUrl: '/model1.glb',
            },
        ].forEach(({ convertServerObjUrls, originalUrl, expectedUrl }) => {
            it(`should convert ${originalUrl} to ${expectedUrl} with convertServerObjUrls=${convertServerObjUrls}`, () => {
                vi.stubGlobal('location', {
                    origin: 'https://mocked.com',
                });

                const scene = makeScene();
                scene.children[0]!.userData.Url = originalUrl;

                const output = new Converter(undefined, convertServerObjUrls).toJSON({
                    options: {},
                    camera: new PerspectiveCamera(),
                    scripts: [],
                    scene: makeScene(),
                });

                // Find server objects in the exported data
                const serverObjects = output.filter((item: any) =>
                    item.metadata?.generator === 'ServerObject' && item.userData?.Server,
                );

                expect(serverObjects).toHaveLength(1);
                expect(serverObjects[0].userData.Url.toString()).toEqual(expectedUrl);
            });
        });

        it('serializes deep hierarchies without recursive converter traversal', () => {
            const scene = new Scene();
            const leaf = addDeepChain(scene);
            const runtimeOnly = new Object3D();
            runtimeOnly.userData.isRuntimeOnly = true;
            leaf.add(runtimeOnly);
            const converter = new Converter();
            const traverse = vi.spyOn(converter as any, 'traverse');

            const output = converter.toJSON({
                options: {},
                camera: new PerspectiveCamera(),
                scripts: [],
                scene,
            });

            expect(traverse).toHaveBeenCalledTimes(1);
            expect(output.some((item: any) => item.uuid === runtimeOnly.uuid)).toBe(false);

            const sceneJson = output.find((item: any) => item.uuid === scene.uuid);
            let children = sceneJson?.userData?.children;
            for (let i = 0; i < 12_000; i++) {
                expect(children).toHaveLength(1);
                children = children[0].children;
            }
            expect(children).toHaveLength(0);
        });
    });

    describe('fromJson', () => {
        it('hydrates production-minified scene metadata by shape', async () => {
            const json = [{
                metadata: {generator: 'Sn'},
                uuid: 'scene-minified',
                name: 'Minified Playground Scene',
                userData: {children: []},
            }];

            const result = await new Converter().fromJson(json, {
                camera: new PerspectiveCamera(),
                server: '',
                domWidth: 100,
                domHeight: 100,
                assetResolutionContext: {},
                assetLoader: undefined,
            });

            expect(result.scene?.name).toBe('Minified Playground Scene');
        });

        // Test absolute / relative URL handling
        // fromJson always converts to relative URLs
        [
            {
                server: 'https://other.com',
                originalUrl: '/model1.glb',
                expectedUrl: '/model1.glb',
            },
            {
                server: 'https://other.com',
                originalUrl: 'https://mocked.com/model1.glb',
                expectedUrl: '/model1.glb',
            },
        ].forEach(({ server, originalUrl, expectedUrl }) => {
            it(`should convert ${originalUrl} to ${expectedUrl} with server=${server}`, () => {
                vi.stubGlobal('location', {
                    origin: 'https://mocked.com',
                    host: 'mocked.com',
                });

                const json = [
                    {
                        metadata: { generator: 'OptionsSerializer' },
                        server,
                    },
                    {
                        metadata: { generator: 'SceneSerializer' },
                        userData: {},
                        uuid: 'scene-1',
                    },
                    {
                        metadata: { generator: 'ServerObject' },
                        userData: {
                            Server: true,
                            Url: originalUrl,
                        },
                        uuid: 'mesh-1',
                        parent: 'scene-1',
                    },
                ];

                const options = {
                    camera: new PerspectiveCamera(),
                    scripts: [],
                    server,
                    domWidth: 100,
                    domHeight: 100,
                    assetResolutionContext: {},
                    assetLoader: undefined,
                };

                const mockLoad = vi.fn().mockResolvedValue(new Object3D());
                (ModelLoader as any).mockImplementation(function() {
                    return {
                        load: mockLoad,
                    };
                });

                new Converter(undefined, true).fromJson(json, options);

                expect(mockLoad.mock.calls[0]?.[0]).toBe(expectedUrl);
            });
        });
    });

    describe('deserializeObject', () => {
        it('returns the resolved object when mesh geometry deserialization is async', async () => {
            const { TeapotGeometry } = await import('three/addons/geometries/TeapotGeometry.js');
            const geometry = new TeapotGeometry(2, 4, true, true, true, true, true);
            (geometry as any).type = 'TeapotGeometry';
            (geometry as any).parameters = {
                size: 2,
                segments: 4,
                bottom: true,
                lid: true,
                body: true,
                fitLid: true,
                blinn: true,
            };

            const scene = new Scene();
            const mesh = new Mesh(geometry);
            mesh.name = 'Lazy Teapot';
            scene.add(mesh);

            const [meshJson] = new Converter().toJSON({
                options: {},
                camera: new PerspectiveCamera(),
                scripts: [],
                scene,
            }).filter((item: any) => item.metadata?.generator === 'MeshSerializer');

            const data = new Converter().deserializeObject(meshJson, {
                options: {},
                camera: new PerspectiveCamera(),
                scripts: [],
            });

            await data.promise;

            expect(data.object).toBeInstanceOf(Mesh);
            expect(data.object.name).toBe('Lazy Teapot');
            expect(data.object.geometry.type).toBe('TeapotGeometry');
        });
    });

    describe('parseScene', () => {
        it('reuses scene lookup maps while rebuilding nested children', () => {
            const converter = new Converter();
            const scene = new Scene();
            scene.uuid = 'scene-root';
            const parent = new Object3D();
            parent.uuid = 'parent';
            const child = new Object3D();
            child.uuid = 'child';
            const grandchild = new Object3D();
            grandchild.uuid = 'grandchild';
            const parts = [scene, parent, child, grandchild];
            const children = [
                {
                    uuid: parent.uuid,
                    children: [
                        {
                            uuid: child.uuid,
                            children: [
                                {
                                    uuid: grandchild.uuid,
                                    children: [],
                                },
                            ],
                        },
                    ],
                },
            ];
            const createSceneLookupMaps = vi.spyOn(converter as any, 'createSceneLookupMaps');

            (converter as any).parseScene(scene, children, parts, [], {options: {}});

            expect(createSceneLookupMaps).toHaveBeenCalledTimes(1);
            expect(parent.parent).toBe(scene);
            expect(child.parent).toBe(parent);
            expect(grandchild.parent).toBe(child);
        });

        it('rebuilds deep children arrays without recursive scene assembly', () => {
            const converter = new Converter();
            const scene = new Scene();
            const parts: Object3D[] = [scene];
            const children: Array<{uuid: string; children: unknown[]}> = [];
            let currentChildren = children;
            for (let i = 0; i < 12_000; i++) {
                const object = new Object3D();
                object.uuid = `deep-${i}`;
                parts.push(object);
                const child = {uuid: object.uuid, children: []};
                currentChildren.push(child);
                currentChildren = child.children;
            }
            const parseSceneBasedOnChildrenArr = vi.spyOn(converter as any, 'parseSceneBasedOnChildrenArr');

            (converter as any).parseSceneBasedOnChildrenArr(scene, children, parts, [], {options: {}});

            expect(parseSceneBasedOnChildrenArr).toHaveBeenCalledTimes(1);
            let cursor: Object3D = scene;
            for (let i = 0; i < 12_000; i++) {
                expect(cursor.children).toHaveLength(1);
                cursor = cursor.children[0]!;
            }
        });
    });

    describe('legacy unsupported object metadata', () => {
        it('serializes Globe-tagged generic objects without requiring a removed serializer', () => {
            const scene = new Scene();
            const globe = new Object3D();
            globe.uuid = 'legacy-globe-object';
            globe.userData.type = 'Globe';
            scene.add(globe);
            let output: any[] = [];

            expect(() => {
                output = new Converter().toJSON({
                    options: {},
                    camera: new PerspectiveCamera(),
                    scripts: [],
                    scene,
                });
            }).not.toThrow();

            const globeJson = output.find(item => item.uuid === globe.uuid);
            expect(globeJson?.metadata?.generator).toBe('Object3DSerializer');
            expect(globeJson?.userData?.type).toBe('Globe');
        });
    });

    describe('getPhysicsSettings', () => {
        it('returns engine + gravity from SceneSerializer userData.physics', () => {
            const jsons = [
                { metadata: { generator: "OptionsSerializer" } },
                {
                    metadata: { generator: "SceneSerializer" },
                    userData: { physics: { engine: "rapier", gravity: -12 } },
                },
            ];
            expect(Converter.getPhysicsSettings(jsons)).toEqual({
                engine: "rapier",
                gravity: -12,
            });
        });

        it('falls back to legacy userData.game.gravity when physics.gravity is missing', () => {
            const jsons = [
                {
                    metadata: { generator: "SceneSerializer" },
                    userData: { physics: { engine: "ammo" }, game: { gravity: -9.8 } },
                },
            ];
            expect(Converter.getPhysicsSettings(jsons)).toEqual({
                engine: "ammo",
                gravity: -9.8,
            });
        });

        it('returns both undefined when SceneSerializer entry has no physics or game block', () => {
            const jsons = [
                {
                    metadata: { generator: "SceneSerializer" },
                    userData: { lives: 3 },
                },
            ];
            expect(Converter.getPhysicsSettings(jsons)).toEqual({
                engine: undefined,
                gravity: undefined,
            });
        });

        it('returns both undefined when there is no SceneSerializer entry', () => {
            const jsons = [
                { metadata: { generator: "OptionsSerializer" } },
                { metadata: { generator: "CamerasSerializer" } },
            ];
            expect(Converter.getPhysicsSettings(jsons)).toEqual({
                engine: undefined,
                gravity: undefined,
            });
        });

        it('returns both undefined when input is not an array', () => {
            const empty = { engine: undefined, gravity: undefined };
            expect(Converter.getPhysicsSettings(undefined as unknown as unknown[])).toEqual(empty);
            expect(Converter.getPhysicsSettings(null as unknown as unknown[])).toEqual(empty);
            expect(Converter.getPhysicsSettings({} as unknown as unknown[])).toEqual(empty);
        });
    });
});
