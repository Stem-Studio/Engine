import {
    BufferAttribute,
    BufferGeometry,
    DefaultLoadingManager,
    LineBasicMaterial,
    LineSegments,
    MaterialLoader,
    Mesh,
    MeshStandardMaterial,
    Points,
    PointsMaterial,
} from "three";

export const LoaderSupport = {};

LoaderSupport.Validator = {
    isValid(input) {
        return input !== null && input !== undefined;
    },

    verifyInput(input, defaultValue) {
        return input === null || input === undefined ? defaultValue : input;
    },
};

LoaderSupport.Callbacks = function () {
    this.onProgress = null;
    this.onReportError = null;
    this.onMeshAlter = null;
    this.onLoad = null;
    this.onLoadMaterials = null;
};

LoaderSupport.Callbacks.prototype = {
    constructor: LoaderSupport.Callbacks,
    setCallbackOnProgress(callbackOnProgress) {
        this.onProgress = LoaderSupport.Validator.verifyInput(callbackOnProgress, this.onProgress);
    },
    setCallbackOnReportError(callbackOnReportError) {
        this.onReportError = LoaderSupport.Validator.verifyInput(callbackOnReportError, this.onReportError);
    },
    setCallbackOnMeshAlter(callbackOnMeshAlter) {
        this.onMeshAlter = LoaderSupport.Validator.verifyInput(callbackOnMeshAlter, this.onMeshAlter);
    },
    setCallbackOnLoad(callbackOnLoad) {
        this.onLoad = LoaderSupport.Validator.verifyInput(callbackOnLoad, this.onLoad);
    },
    setCallbackOnLoadMaterials(callbackOnLoadMaterials) {
        this.onLoadMaterials = LoaderSupport.Validator.verifyInput(callbackOnLoadMaterials, this.onLoadMaterials);
    },
};

LoaderSupport.LoadedMeshUserOverride = function (disregardMesh, alteredMesh) {
    this.disregardMesh = disregardMesh === true;
    this.alteredMesh = alteredMesh === true;
    this.meshes = [];
};

LoaderSupport.LoadedMeshUserOverride.prototype = {
    constructor: LoaderSupport.LoadedMeshUserOverride,
    addMesh(mesh) {
        this.meshes.push(mesh);
        this.alteredMesh = true;
    },
    isDisregardMesh() {
        return this.disregardMesh;
    },
    providesAlteredMeshes() {
        return this.alteredMesh;
    },
};

LoaderSupport.ResourceDescriptor = function (url, extension) {
    const urlParts = String(url ?? "").split("/");
    this.path = undefined;
    this.resourcePath = undefined;
    this.name = url;
    this.url = url;

    if (urlParts.length >= 2) {
        this.path = urlParts.slice(0, urlParts.length - 1).join("/") + "/";
        this.name = urlParts[urlParts.length - 1];
    }

    this.name = LoaderSupport.Validator.verifyInput(this.name, "Unnamed_Resource");
    this.extension = LoaderSupport.Validator.verifyInput(extension, "default").trim();
    this.content = null;
};

LoaderSupport.ResourceDescriptor.prototype = {
    constructor: LoaderSupport.ResourceDescriptor,
    setContent(content) {
        this.content = LoaderSupport.Validator.verifyInput(content, null);
    },
    setResourcePath(resourcePath) {
        this.resourcePath = LoaderSupport.Validator.verifyInput(resourcePath, this.resourcePath);
    },
};

LoaderSupport.PrepData = function (modelName) {
    this.logging = {
        enabled: true,
        debug: false,
    };
    this.modelName = LoaderSupport.Validator.verifyInput(modelName, "");
    this.resources = [];
    this.callbacks = new LoaderSupport.Callbacks();
};

LoaderSupport.PrepData.prototype = {
    constructor: LoaderSupport.PrepData,
    setLogging(enabled, debug) {
        this.logging.enabled = enabled === true;
        this.logging.debug = debug === true;
    },
    getCallbacks() {
        return this.callbacks;
    },
    addResource(resource) {
        this.resources.push(resource);
    },
    clone() {
        const clone = new LoaderSupport.PrepData(this.modelName);
        clone.logging.enabled = this.logging.enabled;
        clone.logging.debug = this.logging.debug;
        clone.resources = this.resources;
        clone.callbacks = this.callbacks;

        for (const property in this) {
            if (!Object.prototype.hasOwnProperty.call(clone, property) && typeof this[property] !== "function") {
                clone[property] = this[property];
            }
        }

        return clone;
    },
    checkResourceDescriptorFiles(resources, fileDesc) {
        const result = {};

        for (const resource of resources) {
            if (!LoaderSupport.Validator.isValid(resource?.name)) continue;
            const matched = fileDesc.find(desc => (
                resource.extension?.toLowerCase?.() === desc.ext.toLowerCase()
            ));

            if (!matched) {
                throw `Unidentified resource "${resource.name}": ${resource.url}`;
            }

            if (matched.ignore) continue;

            if (LoaderSupport.Validator.isValid(resource.content)) {
                if (
                    matched.type === "ArrayBuffer" &&
                    !(resource.content instanceof ArrayBuffer || resource.content instanceof Uint8Array)
                ) {
                    throw "Provided content is not of type ArrayBuffer! Aborting...";
                }

                if (
                    matched.type === "String" &&
                    !(typeof resource.content === "string" || resource.content instanceof String)
                ) {
                    throw "Provided  content is not of type String! Aborting...";
                }
            }

            result[matched.ext] = resource;
        }

        return result;
    },
};

LoaderSupport.MeshBuilder = function () {
    this.validator = LoaderSupport.Validator;
    this.logging = {
        enabled: true,
        debug: false,
    };
    this.callbacks = new LoaderSupport.Callbacks();
    this.materials = {};
};

LoaderSupport.MeshBuilder.LOADER_MESH_BUILDER_VERSION = "1.3.0-compat";

LoaderSupport.MeshBuilder.prototype = {
    constructor: LoaderSupport.MeshBuilder,
    setLogging(enabled, debug) {
        this.logging.enabled = enabled === true;
        this.logging.debug = debug === true;
    },
    init() {
        const defaultMaterial = new MeshStandardMaterial({color: 0xdcf1ff});
        defaultMaterial.name = "defaultMaterial";

        const defaultVertexColorMaterial = new MeshStandardMaterial({color: 0xdcf1ff});
        defaultVertexColorMaterial.name = "defaultVertexColorMaterial";
        defaultVertexColorMaterial.vertexColors = true;

        const defaultLineMaterial = new LineBasicMaterial();
        defaultLineMaterial.name = "defaultLineMaterial";

        const defaultPointMaterial = new PointsMaterial({size: 1});
        defaultPointMaterial.name = "defaultPointMaterial";

        this.updateMaterials({
            materials: {
                runtimeMaterials: {
                    [defaultMaterial.name]: defaultMaterial,
                    [defaultVertexColorMaterial.name]: defaultVertexColorMaterial,
                    [defaultLineMaterial.name]: defaultLineMaterial,
                    [defaultPointMaterial.name]: defaultPointMaterial,
                },
            },
        });
    },
    setMaterials(materials) {
        const runtimeMaterials = this.validator.isValid(this.callbacks.onLoadMaterials)
            ? this.callbacks.onLoadMaterials(materials)
            : materials;
        this.updateMaterials({materials: {runtimeMaterials}});
    },
    _setCallbacks(callbacks) {
        if (this.validator.isValid(callbacks.onProgress)) this.callbacks.setCallbackOnProgress(callbacks.onProgress);
        if (this.validator.isValid(callbacks.onReportError)) this.callbacks.setCallbackOnReportError(callbacks.onReportError);
        if (this.validator.isValid(callbacks.onMeshAlter)) this.callbacks.setCallbackOnMeshAlter(callbacks.onMeshAlter);
        if (this.validator.isValid(callbacks.onLoad)) this.callbacks.setCallbackOnLoad(callbacks.onLoad);
        if (this.validator.isValid(callbacks.onLoadMaterials)) this.callbacks.setCallbackOnLoadMaterials(callbacks.onLoadMaterials);
    },
    processPayload(payload) {
        if (payload.cmd === "meshData") return this.buildMeshes(payload);
        if (payload.cmd === "materialData") {
            this.updateMaterials(payload);
            return null;
        }
        return null;
    },
    buildMeshes(meshPayload) {
        if (meshPayload.object) return [meshPayload.object];

        const geometry = new BufferGeometry();
        geometry.setAttribute(
            "position",
            new BufferAttribute(new Float32Array(meshPayload.buffers.vertices), 3),
        );

        if (this.validator.isValid(meshPayload.buffers.indices)) {
            geometry.setIndex(new BufferAttribute(new Uint32Array(meshPayload.buffers.indices), 1));
        }

        if (this.validator.isValid(meshPayload.buffers.colors)) {
            geometry.setAttribute("color", new BufferAttribute(new Float32Array(meshPayload.buffers.colors), 3));
        }

        if (this.validator.isValid(meshPayload.buffers.normals)) {
            geometry.setAttribute("normal", new BufferAttribute(new Float32Array(meshPayload.buffers.normals), 3));
        } else {
            geometry.computeVertexNormals();
        }

        if (this.validator.isValid(meshPayload.buffers.uvs)) {
            geometry.setAttribute("uv", new BufferAttribute(new Float32Array(meshPayload.buffers.uvs), 2));
        }

        const materialName = meshPayload.materials?.materialNames?.[0] ?? "defaultMaterial";
        const material = this.materials[materialName] ?? this.materials.defaultMaterial ?? new MeshStandardMaterial();
        const geometryType = this.validator.verifyInput(meshPayload.geometryType, 0);
        let mesh;

        if (geometryType === 1) {
            mesh = new LineSegments(geometry, material);
        } else if (geometryType === 2) {
            mesh = new Points(geometry, material);
        } else {
            mesh = new Mesh(geometry, material);
        }

        mesh.name = meshPayload.params?.meshName ?? "";
        return [mesh];
    },
    updateMaterials(materialPayload) {
        const materials = materialPayload.materials ?? {};

        if (materials.serializedMaterials) {
            const loader = new MaterialLoader();
            for (const materialName in materials.serializedMaterials) {
                this.materials[materialName] = loader.parse(materials.serializedMaterials[materialName]);
            }
        }

        if (materials.runtimeMaterials) {
            Object.assign(this.materials, materials.runtimeMaterials);
        }
    },
    getMaterialsJSON() {
        const materialsJSON = {};
        for (const materialName in this.materials) {
            materialsJSON[materialName] = this.materials[materialName].toJSON();
        }
        return materialsJSON;
    },
    getMaterials() {
        return this.materials;
    },
};

LoaderSupport.WorkerSupport = function () {
    this.logging = {
        enabled: true,
        debug: false,
    };
    this.callbacks = {
        meshBuilder: null,
        onLoad: null,
    };
    this.terminateRequested = false;
    this.forceWorkerDataCopy = false;
    this.loaderWorker = new LoaderSupport.WorkerSupport.LoaderWorker();
};

LoaderSupport.WorkerSupport.WORKER_SUPPORT_VERSION = "2.3.0-compat";

LoaderSupport.WorkerSupport.prototype = {
    constructor: LoaderSupport.WorkerSupport,
    setLogging(enabled, debug) {
        this.logging.enabled = enabled === true;
        this.logging.debug = debug === true;
        this.loaderWorker.setLogging(this.logging.enabled, this.logging.debug);
    },
    setForceWorkerDataCopy(forceWorkerDataCopy) {
        this.forceWorkerDataCopy = forceWorkerDataCopy === true;
        this.loaderWorker.setForceCopy(this.forceWorkerDataCopy);
    },
    validate() {},
    setCallbacks(meshBuilder, onLoad) {
        this.callbacks.meshBuilder = LoaderSupport.Validator.verifyInput(meshBuilder, this.callbacks.meshBuilder);
        this.callbacks.onLoad = LoaderSupport.Validator.verifyInput(onLoad, this.callbacks.onLoad);
        this.loaderWorker.setCallbacks(this.callbacks.meshBuilder, this.callbacks.onLoad);
    },
    run(payload) {
        this.loaderWorker.run(payload);
    },
    setTerminateRequested(terminateRequested) {
        this.terminateRequested = terminateRequested === true;
        this.loaderWorker.setTerminateRequested(this.terminateRequested);
    },
};

LoaderSupport.WorkerSupport.LoaderWorker = function () {
    this._reset();
};

LoaderSupport.WorkerSupport.LoaderWorker.prototype = {
    constructor: LoaderSupport.WorkerSupport.LoaderWorker,
    _reset() {
        this.logging = {
            enabled: true,
            debug: false,
        };
        this.callbacks = {
            meshBuilder: null,
            onLoad: null,
        };
        this.terminateRequested = false;
        this.forceCopy = false;
        this.worker = null;
        this.queuedMessage = null;
    },
    checkSupport() {
        return undefined;
    },
    setLogging(enabled, debug) {
        this.logging.enabled = enabled === true;
        this.logging.debug = debug === true;
    },
    setForceCopy(forceCopy) {
        this.forceCopy = forceCopy === true;
    },
    initWorker() {},
    setCallbacks(meshBuilder, onLoad) {
        this.callbacks.meshBuilder = LoaderSupport.Validator.verifyInput(meshBuilder, this.callbacks.meshBuilder);
        this.callbacks.onLoad = LoaderSupport.Validator.verifyInput(onLoad, this.callbacks.onLoad);
    },
    run(payload) {
        if (this.callbacks.meshBuilder && (payload.cmd === "meshData" || payload.cmd === "materialData")) {
            this.callbacks.meshBuilder(payload);
        }

        if (this.callbacks.onLoad) {
            this.callbacks.onLoad({cmd: "complete", msg: "WorkerSupport compatibility run complete."});
        }
    },
    setTerminateRequested(terminateRequested) {
        this.terminateRequested = terminateRequested === true;
    },
    _postMessage() {},
    _terminate() {
        this._reset();
    },
};

LoaderSupport.WorkerSupport.NodeLoaderWorker = LoaderSupport.WorkerSupport.LoaderWorker;
LoaderSupport.WorkerSupport.NodeLoaderWorker.checkSupport = () => undefined;

LoaderSupport.WorkerSupport.CodeSerializer = {
    serializeObject(fullName, object) {
        return `${fullName} = ${JSON.stringify(object ?? {})};\n`;
    },
    serializeClass(fullName, object) {
        return `${fullName} = ${object?.toString?.() ?? "function () {}"};\n`;
    },
};

LoaderSupport.WorkerRunnerRefImpl = function () {};
LoaderSupport.WorkerRunnerRefImpl.runnerName = "LoaderSupport.WorkerRunnerRefImpl";
LoaderSupport.WorkerRunnerRefImpl.prototype = {
    constructor: LoaderSupport.WorkerRunnerRefImpl,
    getParentScope() {
        return typeof self !== "undefined" ? self : globalThis;
    },
    applyProperties(parser, params = {}) {
        for (const property in params) {
            const funcName = `set${property.substring(0, 1).toLocaleUpperCase()}${property.substring(1)}`;
            if (typeof parser[funcName] === "function") {
                parser[funcName](params[property]);
            } else {
                parser[property] = params[property];
            }
        }
    },
    processMessage() {},
};

LoaderSupport.NodeWorkerRunnerRefImpl = function () {};
LoaderSupport.NodeWorkerRunnerRefImpl.runnerName = "LoaderSupport.NodeWorkerRunnerRefImpl";
LoaderSupport.NodeWorkerRunnerRefImpl.prototype = Object.create(LoaderSupport.WorkerRunnerRefImpl.prototype);
LoaderSupport.NodeWorkerRunnerRefImpl.prototype.constructor = LoaderSupport.NodeWorkerRunnerRefImpl;

LoaderSupport.WorkerDirector = function (classDef) {
    if (!LoaderSupport.Validator.isValid(classDef)) throw `Provided invalid classDef: ${classDef}`;

    this.logging = {
        enabled: true,
        debug: false,
    };
    this.maxQueueSize = LoaderSupport.WorkerDirector.MAX_QUEUE_SIZE;
    this.maxWebWorkers = LoaderSupport.WorkerDirector.MAX_WEB_WORKER;
    this.crossOrigin = null;
    this.workerDescription = {
        classDef,
        globalCallbacks: {},
        forceWorkerDataCopy: true,
    };
    this.instructionQueue = [];
    this.instructionQueuePointer = 0;
    this.callbackOnFinishedProcessing = null;
};

LoaderSupport.WorkerDirector.LOADER_WORKER_DIRECTOR_VERSION = "2.3.0-compat";
LoaderSupport.WorkerDirector.MAX_WEB_WORKER = 16;
LoaderSupport.WorkerDirector.MAX_QUEUE_SIZE = 2048;

LoaderSupport.WorkerDirector.prototype = {
    constructor: LoaderSupport.WorkerDirector,
    setLogging(enabled, debug) {
        this.logging.enabled = enabled === true;
        this.logging.debug = debug === true;
    },
    getMaxQueueSize() {
        return this.maxQueueSize;
    },
    getMaxWebWorkers() {
        return this.maxWebWorkers;
    },
    setCrossOrigin(crossOrigin) {
        this.crossOrigin = crossOrigin;
    },
    setForceWorkerDataCopy(forceWorkerDataCopy) {
        this.workerDescription.forceWorkerDataCopy = forceWorkerDataCopy === true;
    },
    prepareWorkers(globalCallbacks, maxQueueSize = this.maxQueueSize, maxWebWorkers = this.maxWebWorkers) {
        this.workerDescription.globalCallbacks = LoaderSupport.Validator.verifyInput(globalCallbacks, {});
        this.maxQueueSize = Math.min(maxQueueSize, LoaderSupport.WorkerDirector.MAX_QUEUE_SIZE);
        this.maxWebWorkers = Math.min(maxWebWorkers, LoaderSupport.WorkerDirector.MAX_WEB_WORKER);
        this.instructionQueue = [];
        this.instructionQueuePointer = 0;
    },
    enqueueForRun(prepData) {
        if (this.instructionQueue.length < this.maxQueueSize) {
            this.instructionQueue.push(prepData);
        }
    },
    isRunning() {
        return this.instructionQueuePointer < this.instructionQueue.length;
    },
    processQueue() {
        while (this.instructionQueuePointer < this.instructionQueue.length) {
            const prepData = this.instructionQueue[this.instructionQueuePointer++];
            const loader = new this.workerDescription.classDef(DefaultLoadingManager);
            const callbacks = prepData.getCallbacks?.() ?? prepData.callbacks ?? {};
            const globalCallbacks = this.workerDescription.globalCallbacks ?? {};
            const previousOnLoad = callbacks.onLoad;

            callbacks.setCallbackOnLoad?.(event => {
                globalCallbacks.onLoad?.(event);
                previousOnLoad?.(event);
            });
            prepData.callbacks = callbacks;
            loader.run(prepData);
        }

        if (this.callbackOnFinishedProcessing) {
            this.callbackOnFinishedProcessing();
            this.callbackOnFinishedProcessing = null;
        }
    },
    _kickWorkerRun(prepData) {
        this.enqueueForRun(prepData);
        this.processQueue();
    },
    _buildLoader(instanceNo) {
        const loader = new this.workerDescription.classDef(DefaultLoadingManager);
        loader.instanceNo = instanceNo;
        return loader;
    },
    _deregister() {},
    tearDown(callbackOnFinishedProcessing) {
        this.instructionQueuePointer = this.instructionQueue.length;
        this.callbackOnFinishedProcessing = LoaderSupport.Validator.verifyInput(callbackOnFinishedProcessing, null);
    },
};

export default LoaderSupport;
