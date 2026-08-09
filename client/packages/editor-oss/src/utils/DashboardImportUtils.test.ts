import {describe, it, expect, beforeEach, vi} from "vitest";

vi.mock("../showToast", () => ({
    showToast: vi.fn(),
}));

vi.mock("./ImportUtils", () => ({
    cleanupDefaultTerrainAssets: vi.fn(),
    ImportUtils: {
        reuploadAssets: vi.fn(),
    },
}));

vi.mock("../asset-management/import", () => ({
    importAssets: vi.fn().mockResolvedValue({dependencies: {}}),
    shouldImportAssets: vi.fn().mockResolvedValue(false),
}));

vi.mock("@stem/network/api/scene/v2", () => ({
    createScene: vi.fn(),
    sceneSettingsToCreateRequest: (settings: any, name: string) => ({...settings, name}),
}));

vi.mock("jszip", () => ({
    default: vi.fn().mockImplementation(() => ({
        file: vi.fn(),
        generateAsync: vi.fn().mockResolvedValue(new Blob()),
    })),
}));

vi.mock('three', async (importOriginal) => ({
    ...await importOriginal<typeof import('three')>(),
    Audio: vi.fn(),
    AudioListener: vi.fn(),
}));

import {createScene} from "@stem/network/api/scene/v2";
import {DashboardImportInternal, DashboardImportUtils} from "./DashboardImportUtils";
import {ImportUtils} from "./ImportUtils";
import {importAssets, shouldImportAssets} from "@stem/editor-oss/asset-management/import";

const mockCreateScene = createScene as any;
const mockImportUtils = ImportUtils as any;
const mockShouldImportAssets = shouldImportAssets as any;
const mockImportAssets = importAssets as any;

describe("DashboardImportUtils", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        global.confirm = vi.fn().mockReturnValue(true);
        global.prompt = vi.fn();

        // Setup default mocks
        mockImportUtils.reuploadAssets.mockResolvedValue({
            sceneData: [],
            bannerImage: undefined,
        });

        // Mock FileReader
        global.FileReader = class {
            onload: ((event: any) => void) | null = null;
            onerror: (() => void) | null = null;
            result: string | null = null;

            readAsText() {
                this.result = JSON.stringify([{test: "data"}]);
                if (this.onload) {
                    this.onload({target: {result: this.result}});
                }
            }
        } as any;

        // Mock HTML elements
        global.document.createElement = vi.fn().mockImplementation((tag: string) => {
            if (tag === "input") {
                return {
                    type: "",
                    style: {display: ""},
                    accept: "",
                    value: "",
                    onchange: null as ((event: any) => void) | null,
                    click: vi.fn(),
                    parentNode: {
                        removeChild: vi.fn(),
                    },
                };
            }
            return {};
        });

        global.document.body.appendChild = vi.fn();

        mockShouldImportAssets.mockResolvedValue(false);
        mockImportAssets.mockResolvedValue({dependencies: {}});
    });

    describe("tunnel URL helpers", () => {
        it("should normalize tunnel origin from bare host", () => {
            expect(DashboardImportInternal.normalizeTunnelOrigin("abcd.ngrok-free.app")).toBe("https://abcd.ngrok-free.app");
        });

        it("should rewrite localhost and minio asset URLs to tunnel origin", () => {
            const json = [
                {
                    metadata: {generator: "AssetSerializer"},
                    revisions: [
                        {dataUrl: "http://minio:9000/assets/a.glb"},
                        {dataUrl: "http://localhost:9000/assets/b.glb?x=1"},
                        {dataUrl: "https://cdn.example.com/assets/c.glb"},
                    ],
                    derivatives: [
                        {dataUrl: "http://minio:9000/derivatives/d.glb#frag"},
                    ],
                },
            ];

            const rewritten = DashboardImportInternal.rewriteAssetUrlsToTunnelHost(json, "https://demo.ngrok-free.app");

            expect(rewritten).toBe(3);
            expect(json[0]!.revisions[0]!.dataUrl).toBe("https://demo.ngrok-free.app/assets/a.glb");
            expect(json[0]!.revisions[1]!.dataUrl).toBe("https://demo.ngrok-free.app/assets/b.glb?x=1");
            expect(json[0]!.revisions[2]!.dataUrl).toBe("https://cdn.example.com/assets/c.glb");
            expect(json[0]!.derivatives[0]!.dataUrl).toBe("https://demo.ngrok-free.app/derivatives/d.glb#frag");
        });
    });

    describe("dashboardSceneImport", () => {
        it("should handle successful file processing", async () => {
            const onStart = vi.fn();
            const optionsServer = "http://test.com";

            // Mock successful reuploadAssets
            mockImportUtils.reuploadAssets.mockResolvedValue({
                sceneData: [],
                bannerImage: undefined,
                uploadedAssets: [],
            });

            mockCreateScene.mockResolvedValue({id: "scene-123"});

            const mockInput = {
                type: "",
                style: {display: ""},
                accept: "",
                value: "",
                onchange: null as ((event: any) => void) | null,
                click: vi.fn(),
                parentNode: {removeChild: vi.fn()},
            };

            global.document.createElement = vi.fn().mockReturnValue(mockInput);

            const promise = new Promise((resolve) => {
                DashboardImportUtils.dashboardSceneImport(
                    onStart,
                    (result) => {
                        expect(result).toEqual({success: true, sceneId: "scene-123"});
                        resolve(undefined);
                    },
                    optionsServer,
                );
            });

            // Simulate file selection
            const mockFile = new File(['[{"test": "data"}]'], "test.json", {type: "application/json"});
            const mockEvent = {
                target: {files: [mockFile]},
            };

            // Trigger the onchange event
            if (mockInput.onchange) {
                mockInput.onchange(mockEvent);
            }

            expect(onStart).toHaveBeenCalled();

            await promise;
        });

        it("should handle file processing errors", async () => {
            const onStart = vi.fn();
            const optionsServer = "http://test.com";

            mockImportUtils.reuploadAssets.mockRejectedValue(new Error("Upload failed"));

            const mockInput = {
                type: "",
                style: {display: ""},
                accept: "",
                value: "",
                onchange: null as ((event: any) => void) | null,
                click: vi.fn(),
                parentNode: {removeChild: vi.fn()},
            };

            global.document.createElement = vi.fn().mockReturnValue(mockInput);

            const promise = new Promise((resolve) => {
                DashboardImportUtils.dashboardSceneImport(
                    onStart,
                    (result) => {
                        expect(result.success).toBe(false);
                        expect(result.error).toContain("Error processing assets:");
                        resolve(undefined);
                    },
                    optionsServer,
                );
            });

            // Simulate file selection
            const mockFile = new File(['[{"test": "data"}]'], "test.json", {type: "application/json"});
            const mockEvent = {
                target: {files: [mockFile]},
            };

            // Trigger the onchange event
            if (mockInput.onchange) {
                mockInput.onchange(mockEvent);
            }

            await promise;
        });

        it("should handle invalid JSON files", async () => {
            const onStart = vi.fn();
            const optionsServer = "http://test.com";

            // Mock FileReader to return invalid JSON
            global.FileReader = class {
                onload: ((event: any) => void) | null = null;
                onerror: (() => void) | null = null;
                result: string | null = null;

                readAsText() {
                    setTimeout(() => {
                        this.result = "invalid json";
                        if (this.onload) {
                            this.onload({target: {result: this.result}});
                        }
                    }, 0);
                }
            } as any;

            const mockInput = {
                type: "",
                style: {display: ""},
                accept: "",
                value: "",
                onchange: null as ((event: any) => void) | null,
                click: vi.fn(),
                parentNode: {removeChild: vi.fn()},
            };

            global.document.createElement = vi.fn().mockReturnValue(mockInput);

            const promise = new Promise((resolve) => {
                DashboardImportUtils.dashboardSceneImport(
                    onStart,
                    (result) => {
                        expect(result).toEqual({
                            success: false,
                            error: "Error parsing JSON file.",
                        });
                        resolve(undefined);
                    },
                    optionsServer,
                );
            });

            // Simulate file selection
            const mockFile = new File(["invalid json"], "test.json", {type: "application/json"});
            const mockEvent = {
                target: {files: [mockFile]},
            };

            // Trigger the onchange event
            if (mockInput.onchange) {
                mockInput.onchange(mockEvent);
            }

            await promise;
        });

        it("should handle backend errors", async () => {
            const onStart = vi.fn();
            const optionsServer = "http://test.com";

            // Mock successful reuploadAssets but failed backend response
            mockImportUtils.reuploadAssets.mockResolvedValue({
                sceneData: [],
                bannerImage: undefined,
                uploadedAssets: [],
            });

            mockCreateScene.mockRejectedValue(new Error("Invalid scene data"));

            const mockInput = {
                type: "",
                style: {display: ""},
                accept: "",
                value: "",
                onchange: null as ((event: any) => void) | null,
                click: vi.fn(),
                parentNode: {removeChild: vi.fn()},
            };

            global.document.createElement = vi.fn().mockReturnValue(mockInput);

            const promise = new Promise((resolve) => {
                DashboardImportUtils.dashboardSceneImport(
                    onStart,
                    (result) => {
                        expect(result.success).toBe(false);
                        expect(result.error).toContain("Error saving scene to server:");
                        expect(result.error).toContain("Invalid scene data");
                        resolve(undefined);
                    },
                    optionsServer,
                );
            });

            // Simulate file selection
            const mockFile = new File(['[{"test": "data"}]'], "test.json", {type: "application/json"});
            const mockEvent = {
                target: {files: [mockFile]},
            };

            // Trigger the onchange event
            if (mockInput.onchange) {
                mockInput.onchange(mockEvent);
            }

            await promise;
        });

        it("should keep current behavior when user declines stem export/import prompt", async () => {
            const onStart = vi.fn();
            const optionsServer = "http://test.com";
            mockShouldImportAssets.mockResolvedValue(true);
            mockImportAssets.mockRejectedValue(
                new Error("The server failed to download or process this stem. This usually means the stem revision is unavailable in this environment or its source project cannot be resolved."),
            );
            (global.confirm as any).mockReturnValue(false);

            const mockInput = {
                type: "",
                style: {display: ""},
                accept: "",
                value: "",
                onchange: null as ((event: any) => void) | null,
                click: vi.fn(),
                parentNode: {removeChild: vi.fn()},
            };
            global.document.createElement = vi.fn().mockReturnValue(mockInput);

            const promise = new Promise((resolve) => {
                DashboardImportUtils.dashboardSceneImport(
                    onStart,
                    (result) => {
                        expect(result.success).toBe(false);
                        expect(result.error).toContain("Error importing assets:");
                        resolve(undefined);
                    },
                    optionsServer,
                );
            });

            const mockFile = new File(['[{"metadata":{"generator":"SceneSerializer"}},{"metadata":{"generator":"AssetSerializer"}}]'], "test.json", {type: "application/json"});
            if (mockInput.onchange) {
                mockInput.onchange({target: {files: [mockFile]}});
            }

            await promise;
        });

        it("should block stem export/import prompt flow for non-admin users", async () => {
            const onStart = vi.fn();
            const optionsServer = "http://test.com";
            mockShouldImportAssets.mockResolvedValue(true);
            mockImportAssets.mockRejectedValue(
                new Error("The server failed to download or process this stem. This usually means the stem revision is unavailable in this environment or its source project cannot be resolved."),
            );
            (global.confirm as any).mockReturnValue(true);

            const mockInput = {
                type: "",
                style: {display: ""},
                accept: "",
                value: "",
                onchange: null as ((event: any) => void) | null,
                click: vi.fn(),
                parentNode: {removeChild: vi.fn()},
            };
            global.document.createElement = vi.fn().mockReturnValue(mockInput);

            const promise = new Promise((resolve) => {
                DashboardImportUtils.dashboardSceneImport(
                    onStart,
                    (result) => {
                        expect(result.success).toBe(false);
                        expect(result.error).toContain("Only admins can run stem export/import");
                        resolve(undefined);
                    },
                    optionsServer,
                    undefined,
                    {isAdmin: false},
                );
            });

            const mockFile = new File(['[{"metadata":{"generator":"SceneSerializer"}},{"metadata":{"generator":"AssetSerializer"}}]'], "test.json", {type: "application/json"});
            if (mockInput.onchange) {
                mockInput.onchange({target: {files: [mockFile]}});
            }

            await promise;
        });

        it("should guide admins to export/import stems when they opt in", async () => {
            const onStart = vi.fn();
            const optionsServer = "http://test.com";
            mockShouldImportAssets.mockResolvedValue(true);
            mockImportAssets.mockRejectedValue(
                new Error("The server failed to download or process this stem. This usually means the stem revision is unavailable in this environment or its source project cannot be resolved."),
            );
            (global.confirm as any).mockReturnValue(true);

            const mockInput = {
                type: "",
                style: {display: ""},
                accept: "",
                value: "",
                onchange: null as ((event: any) => void) | null,
                click: vi.fn(),
                parentNode: {removeChild: vi.fn()},
            };
            global.document.createElement = vi.fn().mockReturnValue(mockInput);

            const promise = new Promise((resolve) => {
                DashboardImportUtils.dashboardSceneImport(
                    onStart,
                    (result) => {
                        expect(result.success).toBe(false);
                        expect(result.error).toContain("Please export the missing stems from the source environment");
                        resolve(undefined);
                    },
                    optionsServer,
                    undefined,
                    {isAdmin: true},
                );
            });

            const mockFile = new File(['[{"metadata":{"generator":"SceneSerializer"}},{"metadata":{"generator":"AssetSerializer"}}]'], "test.json", {type: "application/json"});
            if (mockInput.onchange) {
                mockInput.onchange({target: {files: [mockFile]}});
            }

            await promise;
        });

        it("should show a proper prefab revision error and terminate import", async () => {
            const onStart = vi.fn();
            const optionsServer = "http://test.com";
            mockShouldImportAssets.mockResolvedValue(true);
            mockImportAssets.mockRejectedValue(
                new Error(
                    [
                        "Cannot import scene: Prefab revision not found",
                        "",
                        "  • Prefab ID: 699dc289949039b715f4a059",
                        "  • Revision ID: 5d772db7898bf8feabd52272367bec2a761cf9ee85fd7f521d6263e066844ef1",
                        "  • Object: [stem] BoxScreenhalo",
                        "",
                        "  This may happen if the prefab was deleted or is missing from this environment.",
                    ].join("\n"),
                ),
            );

            const mockInput = {
                type: "",
                style: {display: ""},
                accept: "",
                value: "",
                onchange: null as ((event: any) => void) | null,
                click: vi.fn(),
                parentNode: {removeChild: vi.fn()},
            };
            global.document.createElement = vi.fn().mockReturnValue(mockInput);

            const promise = new Promise((resolve) => {
                DashboardImportUtils.dashboardSceneImport(
                    onStart,
                    (result) => {
                        expect(result.success).toBe(false);
                        expect(result.error).toContain("Cannot import scene: missing prefab revision in this environment.");
                        expect(result.error).toContain("Prefab ID: 699dc289949039b715f4a059");
                        expect(result.error).toContain("Revision ID: 5d772db7898bf8feabd52272367bec2a761cf9ee85fd7f521d6263e066844ef1");
                        expect(result.error).toContain("Object: [stem] BoxScreenhalo");
                        resolve(undefined);
                    },
                    optionsServer,
                );
            });

            const mockFile = new File(['[{"metadata":{"generator":"SceneSerializer"}},{"metadata":{"generator":"AssetSerializer"}}]'], "test.json", {type: "application/json"});
            if (mockInput.onchange) {
                mockInput.onchange({target: {files: [mockFile]}});
            }

            await promise;
            expect(mockImportUtils.reuploadAssets).not.toHaveBeenCalled();
            expect(mockCreateScene).not.toHaveBeenCalled();
        });

        it("should handle no file selected", async () => {
            const onStart = vi.fn();
            const optionsServer = "http://test.com";

            const mockInput = {
                type: "",
                style: {display: ""},
                accept: "",
                value: "",
                onchange: null as ((event: any) => void) | null,
                click: vi.fn(),
                parentNode: {removeChild: vi.fn()},
            };

            global.document.createElement = vi.fn().mockReturnValue(mockInput);

            const promise = new Promise((resolve) => {
                DashboardImportUtils.dashboardSceneImport(
                    onStart,
                    (result) => {
                        expect(result).toEqual({
                            success: false,
                            error: "No file selected",
                        });
                        resolve(undefined);
                    },
                    optionsServer,
                );
            });

            // Simulate no file selected
            const mockEvent = {
                target: {files: null},
            };

            // Trigger the onchange event
            if (mockInput.onchange) {
                mockInput.onchange(mockEvent);
            }

            await promise;
        });

        it("should clean up input element after use", async () => {
            const onStart = vi.fn();
            const optionsServer = "http://test.com";

            const mockInput = {
                type: "",
                style: {display: ""},
                accept: "",
                value: "",
                onchange: null as ((event: any) => void) | null,
                click: vi.fn(),
                parentNode: {removeChild: vi.fn()},
            };

            global.document.createElement = vi.fn().mockReturnValue(mockInput);

            const promise = new Promise((resolve) => {
                DashboardImportUtils.dashboardSceneImport(
                    onStart,
                    () => resolve(undefined),
                    optionsServer,
                );
            });

            // Simulate file selection
            const mockEvent = {
                target: {files: null},
            };

            // Trigger the onchange event
            if (mockInput.onchange) {
                mockInput.onchange(mockEvent);
            }

            expect(mockInput.parentNode.removeChild).toHaveBeenCalledWith(mockInput);

            await promise;
        });

        it("should abort import when user declines tunnel setup for localhost/minio assets", async () => {
            (global.confirm as any).mockReturnValue(false);
            (global.prompt as any).mockReturnValue(null);

            const onStart = vi.fn();
            const optionsServer = "http://test.com";

            global.FileReader = class {
                onload: ((event: any) => void) | null = null;
                onerror: (() => void) | null = null;

                readAsText() {
                    setTimeout(() => {
                        const payload = JSON.stringify([{
                            metadata: {generator: "AssetSerializer"},
                            revisions: [{dataUrl: "http://minio:9000/assets/model.glb"}],
                        }]);
                        this.onload?.({target: {result: payload}});
                    }, 0);
                }
            } as any;

            const mockInput = {
                type: "",
                style: {display: ""},
                accept: "",
                value: "",
                onchange: null as ((event: any) => void) | null,
                click: vi.fn(),
                parentNode: {removeChild: vi.fn()},
            };

            global.document.createElement = vi.fn().mockReturnValue(mockInput);

            const promise = new Promise((resolve) => {
                DashboardImportUtils.dashboardSceneImport(
                    onStart,
                    (result) => {
                        expect(result).toEqual({
                            success: false,
                            error: "The resource specified in the project could not be imported.",
                        });
                        resolve(undefined);
                    },
                    optionsServer,
                );
            });

            const mockFile = new File(["[]"], "test.json", {type: "application/json"});
            const mockEvent = {
                target: {files: [mockFile]},
            };

            if (mockInput.onchange) {
                mockInput.onchange(mockEvent);
            }

            await promise;
            expect(mockImportUtils.reuploadAssets).not.toHaveBeenCalled();
        });

        it("should rewrite minio URLs with tunnel host when user provides ngrok domain", async () => {
            (global.confirm as any).mockReturnValue(true);
            (global.prompt as any).mockReturnValue("https://demo.ngrok-free.app");

            const onStart = vi.fn();
            const optionsServer = "http://test.com";

            global.FileReader = class {
                onload: ((event: any) => void) | null = null;
                onerror: (() => void) | null = null;

                readAsText() {
                    setTimeout(() => {
                        const payload = JSON.stringify([{
                            metadata: {generator: "AssetSerializer"},
                            revisions: [{dataUrl: "http://minio:9000/assets/model.glb"}],
                            derivatives: [{dataUrl: "http://localhost:9000/assets/model-lod.glb"}],
                        }]);
                        this.onload?.({target: {result: payload}});
                    }, 0);
                }
            } as any;

            mockImportUtils.reuploadAssets.mockImplementation((sceneData: any[]) =>
                Promise.resolve({
                    sceneData,
                    bannerImage: undefined,
                    uploadedAssets: [],
                }),
            );

            mockCreateScene.mockResolvedValue({id: "scene-123"});

            const mockInput = {
                type: "",
                style: {display: ""},
                accept: "",
                value: "",
                onchange: null as ((event: any) => void) | null,
                click: vi.fn(),
                parentNode: {removeChild: vi.fn()},
            };
            global.document.createElement = vi.fn().mockReturnValue(mockInput);

            const promise = new Promise((resolve) => {
                DashboardImportUtils.dashboardSceneImport(
                    onStart,
                    (result) => {
                        expect(result).toEqual({success: true, sceneId: "scene-123"});
                        resolve(undefined);
                    },
                    optionsServer,
                );
            });

            const mockFile = new File(["[]"], "test.json", {type: "application/json"});
            const mockEvent = {
                target: {files: [mockFile]},
            };

            if (mockInput.onchange) {
                mockInput.onchange(mockEvent);
            }

            await promise;

            const reuploadSceneData = mockImportUtils.reuploadAssets.mock.calls[0][0];
            expect(reuploadSceneData[0].revisions[0].dataUrl).toBe("https://demo.ngrok-free.app/assets/model.glb");
            expect(reuploadSceneData[0].derivatives[0].dataUrl).toBe("https://demo.ngrok-free.app/assets/model-lod.glb");
        });
    });
});
