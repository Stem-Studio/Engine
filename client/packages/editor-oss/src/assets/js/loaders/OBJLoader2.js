import {
    DefaultLoadingManager,
    FileLoader,
    Group,
    LoaderUtils,
} from "three";
import {MTLLoader} from "three/addons/loaders/MTLLoader.js";
import {OBJLoader} from "three/addons/loaders/OBJLoader.js";

const isValid = value => value !== null && value !== undefined;
const verifyInput = (value, fallback) => isValid(value) ? value : fallback;

const decodeObjContent = content => {
    if (!isValid(content)) return null;
    if (typeof content === "string" || content instanceof String) return String(content);

    if (content instanceof ArrayBuffer) {
        return LoaderUtils.decodeText(new Uint8Array(content));
    }

    if (ArrayBuffer.isView(content)) {
        return LoaderUtils.decodeText(new Uint8Array(content.buffer, content.byteOffset, content.byteLength));
    }

    return null;
};

const isMaterialCreator = materials => !!materials && typeof materials.create === "function";

const createMaterialCreator = materials => {
    if (!isValid(materials)) return null;
    if (isMaterialCreator(materials)) return materials;

    return {
        materials,
        preload() {},
        create(name) {
            return materials?.[name] ?? null;
        },
    };
};

const makeLoadEvent = (loader, loaderRootNode) => ({
    detail: {
        loaderRootNode,
        modelName: loader.modelName,
        instanceNo: loader.instanceNo,
    },
});

const findResource = (resources = [], extension) => {
    const lowerExtension = extension.toLowerCase();
    return resources.find(resource => (
        resource?.extension?.toLowerCase?.() === lowerExtension ||
        resource?.name?.toLowerCase?.().endsWith(`.${lowerExtension}`) ||
        resource?.url?.toLowerCase?.().endsWith(`.${lowerExtension}`)
    )) ?? null;
};

export const OBJLoader2 = function (manager) {
    this.manager = verifyInput(manager, DefaultLoadingManager);
    this.logging = {
        enabled: true,
        debug: false,
    };

    this.modelName = "";
    this.instanceNo = 0;
    this.path = undefined;
    this.resourcePath = undefined;
    this.useIndices = false;
    this.disregardNormals = false;
    this.materialPerSmoothingGroup = false;
    this.useOAsMesh = false;
    this.loaderRootNode = new Group();
    this.materials = null;
    this.materialCreator = null;
    this.callbacks = {
        onProgress: null,
        onReportError: null,
        onMeshAlter: null,
        onLoad: null,
        onLoadMaterials: null,
    };
    this.terminateWorkerOnLoad = true;
};

OBJLoader2.OBJLOADER2_VERSION = "2.5.0-compat";

OBJLoader2.prototype = {
    constructor: OBJLoader2,

    setLogging(enabled, debug) {
        this.logging.enabled = enabled === true;
        this.logging.debug = debug === true;
        return this;
    },

    setModelName(modelName) {
        this.modelName = verifyInput(modelName, this.modelName);
        return this;
    },

    setPath(path) {
        this.path = verifyInput(path, this.path);
        return this;
    },

    setResourcePath(resourcePath) {
        this.resourcePath = verifyInput(resourcePath, this.resourcePath);
        return this;
    },

    setStreamMeshesTo(streamMeshesTo) {
        this.loaderRootNode = verifyInput(streamMeshesTo, this.loaderRootNode);
        return this;
    },

    setMaterials(materials) {
        this.materials = materials;
        this.materialCreator = createMaterialCreator(materials);
        return this;
    },

    setUseIndices(useIndices) {
        this.useIndices = useIndices === true;
        return this;
    },

    setDisregardNormals(disregardNormals) {
        this.disregardNormals = disregardNormals === true;
        return this;
    },

    setMaterialPerSmoothingGroup(materialPerSmoothingGroup) {
        this.materialPerSmoothingGroup = materialPerSmoothingGroup === true;
        return this;
    },

    setUseOAsMesh(useOAsMesh) {
        this.useOAsMesh = useOAsMesh === true;
        return this;
    },

    _setCallbacks(callbacks = {}) {
        if (isValid(callbacks.onProgress)) this.callbacks.onProgress = callbacks.onProgress;
        if (isValid(callbacks.onReportError)) this.callbacks.onReportError = callbacks.onReportError;
        if (isValid(callbacks.onMeshAlter)) this.callbacks.onMeshAlter = callbacks.onMeshAlter;
        if (isValid(callbacks.onLoad)) this.callbacks.onLoad = callbacks.onLoad;
        if (isValid(callbacks.onLoadMaterials)) this.callbacks.onLoadMaterials = callbacks.onLoadMaterials;
        return this;
    },

    onProgress(type, text, numericalValue) {
        const event = {
            detail: {
                type,
                modelName: this.modelName,
                instanceNo: this.instanceNo,
                text: verifyInput(text, ""),
                numericalValue,
            },
        };

        if (isValid(this.callbacks.onProgress)) this.callbacks.onProgress(event);
        if (this.logging.enabled && this.logging.debug) console.debug(event.detail.text);
    },

    _onError(event) {
        let output = "Error occurred while downloading!";

        if (event?.currentTarget?.statusText !== null && event?.currentTarget?.statusText !== undefined) {
            output += `\nurl: ${event.currentTarget.responseURL}\nstatus: ${event.currentTarget.statusText}`;
        }

        this.onProgress("error", output, -1);
        this._throwError(output);
    },

    _throwError(errorMessage) {
        if (isValid(this.callbacks.onReportError)) {
            this.callbacks.onReportError(errorMessage);
            return;
        }

        throw errorMessage;
    },

    createOBJLoader() {
        const loader = new OBJLoader(this.manager);
        if (this.path) loader.setPath(this.path);
        if (this.materialCreator) loader.setMaterials(this.materialCreator);
        return loader;
    },

    useParsedGroup(group) {
        if (this.loaderRootNode === group) {
            return this.loaderRootNode;
        }

        while (group.children.length > 0) {
            this.loaderRootNode.add(group.children[0]);
        }

        return this.loaderRootNode;
    },

    load(url, onLoad, onProgress, onError, onMeshAlter, useAsync) {
        const resource = {url, name: url, extension: "OBJ", content: null};
        this._loadObj(resource, onLoad, onProgress, onError, onMeshAlter, useAsync);
    },

    _loadObj(resource, onLoad, onProgress, onError, onMeshAlter, useAsync) {
        const reportError = error => {
            if (isValid(onError)) {
                onError(error);
            } else {
                this._onError(error);
            }
        };

        if (!isValid(resource)) {
            reportError("An invalid ResourceDescriptor was provided. Unable to continue!");
            return;
        }

        const complete = group => {
            const event = makeLoadEvent(this, group);
            if (isValid(onLoad)) onLoad(event);
        };

        if (isValid(onMeshAlter)) {
            this.callbacks.onMeshAlter = onMeshAlter;
        }

        if (isValid(resource.content)) {
            if (useAsync) {
                this.parseAsync(resource.content, complete);
                return;
            }

            complete(this.parse(resource.content));
            return;
        }

        const url = resource.url ?? resource.name;
        if (!isValid(url)) {
            complete(this.parse(null));
            return;
        }

        const loader = this.createOBJLoader();
        if (resource.path) loader.setPath(resource.path);
        loader.load(
            resource.path && resource.name ? resource.name : url,
            group => complete(this.useParsedGroup(group)),
            onProgress,
            reportError,
        );
    },

    run(prepData, workerSupportExternal) {
        this._applyPrepData(prepData);

        if (isValid(workerSupportExternal)) {
            this.workerSupport = workerSupportExternal;
            this.logging.enabled = workerSupportExternal.logging?.enabled ?? this.logging.enabled;
            this.logging.debug = workerSupportExternal.logging?.debug ?? this.logging.debug;
        }

        const available = typeof prepData?.checkResourceDescriptorFiles === "function"
            ? prepData.checkResourceDescriptorFiles(prepData.resources, [
                {ext: "obj", type: "ArrayBuffer", ignore: false},
                {ext: "mtl", type: "String", ignore: true},
            ])
            : {
                obj: findResource(prepData?.resources, "obj"),
                mtl: findResource(prepData?.resources, "mtl"),
            };

        const onMaterialsLoaded = (materials, materialCreator) => {
            this.setMaterials(materialCreator ?? materials);
            this._loadObj(
                available?.obj,
                this.callbacks.onLoad,
                null,
                this.callbacks.onReportError,
                this.callbacks.onMeshAlter,
                prepData?.useAsync,
            );
        };

        this._loadMtl(
            available?.mtl,
            onMaterialsLoaded,
            null,
            this.callbacks.onReportError,
            prepData?.crossOrigin,
            prepData?.materialOptions,
        );
    },

    _applyPrepData(prepData) {
        if (!isValid(prepData)) return this;

        this.setLogging(prepData.logging?.enabled, prepData.logging?.debug);
        this.setModelName(prepData.modelName);
        this.setStreamMeshesTo(prepData.streamMeshesTo);
        this.setMaterials(prepData.materials);
        this.setUseIndices(prepData.useIndices);
        this.setDisregardNormals(prepData.disregardNormals);
        this.setMaterialPerSmoothingGroup(prepData.materialPerSmoothingGroup);
        this.setUseOAsMesh(prepData.useOAsMesh);

        if (typeof prepData.getCallbacks === "function") {
            this._setCallbacks(prepData.getCallbacks());
        } else if (prepData.callbacks) {
            this._setCallbacks(prepData.callbacks);
        }

        return this;
    },

    parse(content) {
        const text = decodeObjContent(content);
        if (text === null) {
            console.warn("Provided content is not a valid ArrayBuffer or String.");
            return this.loaderRootNode;
        }

        if (this.logging.enabled) console.time(`OBJLoader2 parse: ${this.modelName}`);
        const group = this.createOBJLoader().parse(text);
        const root = this.useParsedGroup(group);
        if (this.logging.enabled) console.timeEnd(`OBJLoader2 parse: ${this.modelName}`);
        return root;
    },

    parseAsync(content, onLoad) {
        Promise.resolve()
            .then(() => this.parse(content))
            .then(root => {
                if (isValid(onLoad)) onLoad(makeLoadEvent(this, root));
            })
            .catch(error => {
                this._throwError(error);
            });
    },

    loadMtl(url, content, onLoad, onProgress, onError, crossOrigin, materialOptions) {
        const resource = {url, name: url, extension: "MTL", content};
        this._loadMtl(resource, onLoad, onProgress, onError, crossOrigin, materialOptions);
    },

    _loadMtl(resource, onLoad, onProgress, onError, crossOrigin, materialOptions) {
        const processCreator = materialCreator => {
            if (materialCreator) {
                materialCreator.preload();
                this.setMaterials(materialCreator);
            }

            if (isValid(onLoad)) onLoad(materialCreator?.materials ?? [], materialCreator ?? null);
        };

        if (!isValid(resource) || (!isValid(resource.content) && !isValid(resource.url))) {
            processCreator(null);
            return;
        }

        const loader = new MTLLoader(this.manager);
        if (typeof loader.setCrossOrigin === "function") loader.setCrossOrigin(verifyInput(crossOrigin, "anonymous"));
        if (typeof loader.setResourcePath === "function") loader.setResourcePath(resource.resourcePath || resource.path || this.resourcePath || this.path || "");
        if (typeof loader.setMaterialOptions === "function" && isValid(materialOptions)) loader.setMaterialOptions(materialOptions);

        if (isValid(resource.content)) {
            const text = decodeObjContent(resource.content);
            if (text === null) {
                const error = "Unable to parse mtl as it seems to be neither a String, an Array or an ArrayBuffer.";
                if (isValid(onError)) onError(error);
                else this._throwError(error);
                return;
            }

            processCreator(loader.parse(text));
            return;
        }

        loader.load(resource.url, processCreator, onProgress, onError);
    },
};

OBJLoader2.Parser = function () {
    this.callbackProgress = null;
    this.callbackMeshBuilder = null;
    this.materials = null;
    this.useAsync = false;
    this.materialPerSmoothingGroup = false;
    this.useOAsMesh = false;
    this.useIndices = false;
    this.disregardNormals = false;
    this.logging = {
        enabled: true,
        debug: false,
    };
};

OBJLoader2.Parser.prototype = {
    constructor: OBJLoader2.Parser,

    setUseAsync(useAsync) {
        this.useAsync = useAsync === true;
    },

    setMaterialPerSmoothingGroup(materialPerSmoothingGroup) {
        this.materialPerSmoothingGroup = materialPerSmoothingGroup === true;
    },

    setUseOAsMesh(useOAsMesh) {
        this.useOAsMesh = useOAsMesh === true;
    },

    setUseIndices(useIndices) {
        this.useIndices = useIndices === true;
    },

    setDisregardNormals(disregardNormals) {
        this.disregardNormals = disregardNormals === true;
    },

    setMaterials(materials) {
        this.materials = materials;
    },

    setCallbackMeshBuilder(callbackMeshBuilder) {
        this.callbackMeshBuilder = callbackMeshBuilder;
    },

    setCallbackProgress(callbackProgress) {
        this.callbackProgress = callbackProgress;
    },

    setLogging(enabled, debug) {
        this.logging.enabled = enabled === true;
        this.logging.debug = debug === true;
    },

    configure() {},

    parse(content) {
        return this.parseText(decodeObjContent(content));
    },

    parseText(text) {
        if (text === null) {
            throw new Error("Provided content was neither of type String nor Uint8Array.");
        }

        const loader = new OBJLoader();
        const materialCreator = createMaterialCreator(this.materials);
        if (materialCreator) loader.setMaterials(materialCreator);
        const group = loader.parse(String(text));

        if (this.callbackMeshBuilder) {
            this.callbackMeshBuilder({cmd: "meshData", object: group}, []);
        }

        if (this.callbackProgress) {
            this.callbackProgress("OBJ parsed", 1);
        }

        return group;
    },

    processLine() {},
    pushSmoothingGroup() {},
    checkFaceType() {},
    checkSubGroup() {},
    buildFace() {},
    createRawMeshReport() {},
    finalizeRawMesh() {},
    processCompletedMesh() {},
    buildMesh() {},
    finalizeParsing() {},
};

export default OBJLoader2;
