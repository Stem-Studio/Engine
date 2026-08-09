import * as UIKit from "@ni2khanna/uikit";
import {CSS3DObject, CSS3DSprite} from "three/addons/renderers/CSS3DRenderer.js";
import type * as THREE from "three";

import type {Lambda, LambdaConstructor, LambdaOptions} from "./Lambda";
import {LambdaBase} from "./LambdaBase";
import type GameManager from "@stem/editor-oss/behaviors/game/GameManager";
import UIKitPointerEvents from "@stem/editor-oss/behaviors/uikit/UIKitPointerEvents";
import {CesiumTool} from "@stem/editor-oss/cesium/CesiumTool";
import {breakpointManager, injectDebuggerStatements} from "@stem/editor-oss/editor/assets/v2/BehaviorEditor/breakpoints";
import global from "@stem/editor-oss/global";
import {removeDebuggerStatements, shouldFilterDebuggers} from "@stem/editor-oss/utils/DebuggerUtils";
import {buildScriptImportAliases} from "@stem/editor-oss/script-runtime/scriptImportAliases";
import {parseScriptImportsCached, type ScriptImportRevisionMap} from "@stem/editor-oss/script-runtime/scriptImportCore";
import {RuntimeTHREE, TSL} from "@stem/editor-oss/script-runtime/runtimeThreeEndowment";
import "ses";
import type {ReadonlyAssetResolutionContext} from "@stem/editor-oss/asset-management/AssetResolutionContext";
import {ScriptResourceScope} from "@stem/editor-oss/script-runtime/ScriptResourceScope";

/**
 *
 */
function isCompartmentsEnabled(): boolean {
    return global.app?.editor?.scene?.userData?.compartmentsEnabled ?? false;
}

class LambdaScriptInjector {
    parse(
        scriptName: string,
        scriptString: string,
        options?: {
            context?: ReadonlyAssetResolutionContext;
            importRevisionMap?: ScriptImportRevisionMap;
        },
    ): LambdaConstructor {
        const productionMode = global.app?.editor?.scene?.userData?.productionMode;
        if (shouldFilterDebuggers({productionMode})) {
            scriptString = removeDebuggerStatements(scriptString);
        }

        // Inject debugger statements at breakpoint lines
        const breakpoints = breakpointManager.get(`lambda-code-${scriptName}`);
        if (breakpoints.size > 0) {
            scriptString = injectDebuggerStatements(scriptString, breakpoints);
        }

        const parsedScript = parseScriptImportsCached(scriptString);
        if (parsedScript.errors.length > 0) {
            throw new Error(parsedScript.errors[0]!.message);
        }

        const buildImportAliases = (runtimeEndowments: Record<string, unknown>) =>
            buildScriptImportAliases({
                source: scriptString,
                context: options?.context,
                importRevisionMap: options?.importRevisionMap,
                runtimeEndowments,
                useCompartment: isCompartmentsEnabled(),
            });

        if (!isCompartmentsEnabled()) {
            return class ScriptLambda extends LambdaBase {
                private readonly resourceScope = new ScriptResourceScope({label: `lambda:direct:${scriptName}`});

                constructor(id: string, options: LambdaOptions) {
                    super(id, options);

                    const baseEndowments = {
                        THREE: RuntimeTHREE,
                        TSL,
                        CSS3DObject,
                        CSS3DSprite,
                        UIKit,
                        UIKitPointerEvents,
                        CesiumTool,
                        window: undefined,
                        document: undefined,
                        performance: undefined,
                        requestAnimationFrame: undefined,
                        cancelAnimationFrame: undefined,
                        setTimeout: undefined,
                        clearTimeout: undefined,
                        setInterval: undefined,
                        clearInterval: undefined,
                        Audio: undefined,
                        AudioContext: undefined,
                    };
                    const runtimeEndowments = {
                        ...baseEndowments,
                        window: this.resourceScope.getWindow(),
                        document: this.resourceScope.getDocument(),
                        performance,
                        requestAnimationFrame: this.resourceScope.requestAnimationFrame.bind(this.resourceScope),
                        cancelAnimationFrame: this.resourceScope.cancelAnimationFrame.bind(this.resourceScope),
                        setTimeout: this.resourceScope.setTimeout.bind(this.resourceScope),
                        clearTimeout: this.resourceScope.clearTimeout.bind(this.resourceScope),
                        setInterval: this.resourceScope.setInterval.bind(this.resourceScope),
                        clearInterval: this.resourceScope.clearInterval.bind(this.resourceScope),
                        Audio: this.resourceScope.getAudioConstructor(),
                        AudioContext: this.resourceScope.getAudioContextConstructor(),
                    };
                    const importAliases = buildImportAliases(runtimeEndowments);
                    const script = `
                        (function() {
                            ${parsedScript.code}

                            var _self = this;
                            if (typeof init === "function")           _self.init = init;
                            if (typeof dispose === "function")        _self.dispose = dispose;
                            if (typeof update === "function")         _self.update = update;
                            if (typeof fixedUpdate === "function")    _self.fixedUpdate = fixedUpdate;
                            if (typeof onObjectAdded === "function")  _self.onObjectAdded = onObjectAdded;
                            if (typeof onObjectRemoved === "function") _self.onObjectRemoved = onObjectRemoved;
                            if (typeof onEvent === "function")        _self.onEvent = onEvent;
                        }).call(this);
                        //# sourceURL=lambda://${scriptName}
                    `;

                    try {
                        // eslint-disable-next-line @typescript-eslint/no-implied-eval
                        new Function(
                            ...Object.keys(runtimeEndowments),
                            ...Object.keys(importAliases),
                            script,
                        ).call(this, ...Object.values(runtimeEndowments), ...Object.values(importAliases));
                    } catch (error) {
                        console.error(`[ScriptLambda] Initialisation error in ${scriptName}:`, error);
                        console.error(`[ScriptLambda] Lambda Script ${scriptName}: ${script}`);
                    }

                    // Wrap user-defined init to ensure base init (sets _game) runs first
                    const userInit = this.init;
                    if (userInit !== LambdaBase.prototype.init) {
                        this.init = (game: GameManager): void | Promise<void> => {
                            LambdaBase.prototype.init.call(this, game);
                            return userInit.call(this, game);
                        };
                    }

                    const userDispose = this.dispose;
                    this.dispose = (): void => {
                        try {
                            if (userDispose !== LambdaBase.prototype.dispose) {
                                userDispose.call(this);
                            } else {
                                LambdaBase.prototype.dispose.call(this);
                            }
                        } finally {
                            this.resourceScope.dispose();
                        }
                    };
                }
            };
        }

        return class ScriptLambda extends LambdaBase {
            private compartment: Compartment | null = null;
            private script: Partial<Lambda> = {};
            private readonly resourceScope = new ScriptResourceScope({label: `lambda:compartment:${scriptName}`});

            constructor(id: string, options: LambdaOptions) {
                super(id, options);
            }

            private initializeCompartment() {
                if (this.compartment) {
                    return;
                }

                try {
                    const baseEndowments = {
                        THREE: RuntimeTHREE,
                        TSL,
                        CSS3DObject,
                        CSS3DSprite,
                        UIKit,
                        UIKitPointerEvents,
                        CesiumTool,
                        console: {
                            log: (...args: any[]) => console.log(...args),
                            error: (...args: any[]) => console.error(...args),
                            warn: (...args: any[]) => console.warn(...args),
                            info: (...args: any[]) => console.info(...args),
                            debug: (...args: any[]) => console.debug(...args),
                        },
                        document: this.resourceScope.getDocument(),
                        window: this.resourceScope.getWindow(), // host window — exposed for legacy DOM access. Prefer scoped element handlers.
                        performance,
                        requestAnimationFrame: this.resourceScope.requestAnimationFrame.bind(this.resourceScope),
                        cancelAnimationFrame: this.resourceScope.cancelAnimationFrame.bind(this.resourceScope),
                        setTimeout: this.resourceScope.setTimeout.bind(this.resourceScope),
                        clearTimeout: this.resourceScope.clearTimeout.bind(this.resourceScope),
                        setInterval: this.resourceScope.setInterval.bind(this.resourceScope),
                        clearInterval: this.resourceScope.clearInterval.bind(this.resourceScope),
                        Audio: this.resourceScope.getAudioConstructor(),
                        AudioContext: this.resourceScope.getAudioContextConstructor(),
                        Image: window.Image,
                        fetch: window.fetch.bind(window),
                        URL: window.URL,
                        URLSearchParams: window.URLSearchParams,
                        eval: undefined,
                        harden: undefined,
                        lockdown: undefined,
                    };

                    const importAliases = buildImportAliases(baseEndowments);
                    const endowments = {
                        ...baseEndowments,
                        ...importAliases,
                    };

                    this.compartment = new Compartment(endowments);

                    const productionMode = global.app?.editor?.scene?.userData?.productionMode;
                    const filteredScriptString = shouldFilterDebuggers({productionMode})
                        ? removeDebuggerStatements(parsedScript.code)
                        : parsedScript.code;

                    const wrapperCode = `
                    (function() {
                        return function() {
                            const lambda = {
                                game: undefined,
                                attributes: undefined,
                                id: undefined,
                                uuid: undefined,
                                registeredObjects: undefined,
                                entityCount: 0,
                                requestAttributeChange: undefined,
                                getComponentData: undefined,
                                setComponentData: undefined,
                                processObjects: undefined,
                            };

                            (function() {
                                ${filteredScriptString}

                                if (typeof init === "function")           lambda.init = init;
                                if (typeof dispose === "function")        lambda.dispose = dispose;
                                if (typeof update === "function")         lambda.update = update;
                                if (typeof fixedUpdate === "function")    lambda.fixedUpdate = fixedUpdate;
                                if (typeof onObjectAdded === "function")  lambda.onObjectAdded = onObjectAdded;
                                if (typeof onObjectRemoved === "function") lambda.onObjectRemoved = onObjectRemoved;
                                if (typeof onEvent === "function")        lambda.onEvent = onEvent;
                            }).call(lambda);

                            return lambda;
                        };
                    })()
                    //# sourceURL=lambda://${scriptName}
                    `;

                    const factory = this.compartment.evaluate(wrapperCode);
                    if (factory) {
                        this.script = factory();
                    }
                } catch (error) {
                    console.error(`[ScriptLambda] Initialisation error in ${scriptName}:`, error);
                    this.compartment = null;
                    this.script = {};
                }
            }

            private syncScript() {
                (this.script as any).game = this._game;
                (this.script as any).attributes = this.attributes;
                (this.script as any).id = this.id;
                (this.script as any).uuid = this.uuid;
                (this.script as any).registeredObjects = this._registeredObjects;
                Object.defineProperty(this.script, "entityCount", {
                    get: () => this._registeredObjects.size,
                    configurable: true,
                });
                (this.script as any).requestAttributeChange = (key: string, value: any, options?: any) =>
                    this.requestAttributeChange(key, value, options);
                (this.script as any).getComponentData = (target: THREE.Object3D) => this.getComponentData(target);
                (this.script as any).setComponentData = (target: THREE.Object3D, key: string, value: any) => this.setComponentData(target, key, value);
                (this.script as any).processObjects = (deltaTime: number, callback: any, isCritical?: boolean) => (this as any).processObjects(deltaTime, callback, isCritical);
            }

            init(game: GameManager): void | Promise<void> {
                try {
                    LambdaBase.prototype.init.call(this, game);
                    this.initializeCompartment();
                    this.syncScript();
                    if (this.script.init) {
                        return this.script.init(game);
                    }
                } catch (error) {
                    console.error(`Error in "${scriptName}" lambda init:`, error);
                }
            }

            update(deltaTime: number): void {
                try {
                    if (this.script.update) {
                        this.script.update(deltaTime);
                    }
                } catch (error) {
                    console.error(`Error in "${scriptName}" lambda update:`, error);
                }
            }

            fixedUpdate(fixedDeltaTime: number): void {
                try {
                    if (this.script.fixedUpdate) {
                        this.script.fixedUpdate(fixedDeltaTime);
                    }
                } catch (error) {
                    console.error(`Error in "${scriptName}" lambda fixedUpdate:`, error);
                }
            }

            dispose(): void {
                try {
                    if (this.script.dispose) {
                        this.script.dispose();
                    }
                } catch (error) {
                    console.error(`Error in "${scriptName}" lambda dispose:`, error);
                } finally {
                    this.resourceScope.dispose();
                }
            }

            onObjectAdded(target: THREE.Object3D, componentData: Record<string, any>): void {
                try {
                    if (this.script.onObjectAdded) {
                        this.script.onObjectAdded(target, componentData);
                    }
                } catch (error) {
                    console.error(`Error in "${scriptName}" lambda onObjectAdded:`, error);
                }
            }

            onObjectRemoved(object: THREE.Object3D): void {
                try {
                    if (this.script.onObjectRemoved) {
                        this.script.onObjectRemoved(object);
                    }
                } catch (error) {
                    console.error(`Error in "${scriptName}" lambda onObjectRemoved:`, error);
                }
            }

            onEvent(msg: string, data: any): void {
                try {
                    if (this.script.onEvent) {
                        this.script.onEvent(msg, data);
                    }
                } catch (error) {
                    console.error(`Error in "${scriptName}" lambda onEvent:`, error);
                }
            }
        };
    }
}

export default LambdaScriptInjector;
