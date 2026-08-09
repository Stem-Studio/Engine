import React, {useCallback, useEffect, useMemo, useState} from "react";
import type {Object3D} from "three";

import global from "../global";
import i18n from "../i18n/config";
import {estimateSceneObjectBytes} from "../utils/estimateSceneObjectBytes";
import {collectObjectSizeMap, deleteObjectSizesFromMap, writeObjectSizesToMap} from "./sceneSizeTracker";

export interface ProjectStateContextValue {
    projectPhase: number;
    setProjectPhase: React.Dispatch<React.SetStateAction<number>>;
    behaviorCount: number;
    setBehaviorCount: React.Dispatch<React.SetStateAction<number>>;
    sceneSize: {sizeMB: number; warning?: string} | null;
    objectSizeMap: Map<string, number>;
}

export const ProjectStateContext = React.createContext<ProjectStateContextValue>(null!);

export interface ProjectStateContextProviderProps {
    children: React.ReactNode;
}

const ProjectStateContextProvider: React.FC<ProjectStateContextProviderProps> = ({children}) => {
    const [projectPhase, setProjectPhase] = useState(1);
    const [behaviorCount, setBehaviorCount] = useState(0);
    const [sceneSize, setSceneSize] = useState<{sizeMB: number; warning?: string} | null>(null);
    const [objectSizeMap, setObjectSizeMap] = useState<Map<string, number>>(new Map());

    const app = global.app;

    const calculateObjectSize = useCallback((object: unknown): number => estimateSceneObjectBytes(object as never), []);

    const updateSceneSize = useCallback(() => {
        const totalBytes = Array.from(objectSizeMap.values()).reduce((sum, size) => sum + size, 0);
        const sizeMB = +(totalBytes / 1048576).toFixed(2);

        if (sizeMB > 5) {
            setSceneSize({
                sizeMB,
                warning: i18n.t("⚠️ Scene size exceeds 5MB. Consider optimizing assets."),
            });
        } else {
            setSceneSize({sizeMB});
        }
    }, [objectSizeMap]);

    const initializeSceneSize = useCallback(() => {
        if (!app?.scene || app.isPlaying) return;

        const newSizeMap = collectObjectSizeMap(app.scene, calculateObjectSize, {includeRoot: false});

        setObjectSizeMap(newSizeMap);
    }, [calculateObjectSize]);

    const handleObjectAdded = useCallback(
        (object: any) => {
            if (!app || !object?.uuid || app.isPlaying) return;

            setObjectSizeMap(prev => {
                const newMap = new Map(prev);
                writeObjectSizesToMap(newMap, object as Object3D, calculateObjectSize);
                return newMap;
            });
        },
        [calculateObjectSize],
    );

    const handleObjectChanged = useCallback(
        (object: any) => {
            if (!app || !object?.uuid || app.isPlaying) return;

            if (object.isObject3D) {
                setObjectSizeMap(prev => {
                    const newMap = new Map(prev);
                    writeObjectSizesToMap(newMap, object as Object3D, calculateObjectSize);
                    return newMap;
                });
            }
        },
        [calculateObjectSize],
    );

    const handleObjectRemoved = useCallback((object: any) => {
        if (!app || !object?.uuid || app.isPlaying) return;

        setObjectSizeMap(prev => {
            const newMap = new Map(prev);
            deleteObjectSizesFromMap(newMap, object as Object3D);
            return newMap;
        });
    }, [app]);

    useEffect(() => {
        if (!app) return;

        if (app.scene) {
            initializeSceneSize();
        }

        app.on("sceneLoaded.ProjectStateContext", initializeSceneSize);
        app.on("objectAdded.ProjectStateContext", handleObjectAdded);
        app.on("objectChanged.ProjectStateContext", handleObjectChanged);
        app.on("objectRemoved.ProjectStateContext", handleObjectRemoved);

        return () => {
            app.on("sceneLoaded.ProjectStateContext", null);
            app.on("objectAdded.ProjectStateContext", null);
            app.on("objectChanged.ProjectStateContext", null);
            app.on("objectRemoved.ProjectStateContext", null);
        };
    }, [app, initializeSceneSize, handleObjectAdded, handleObjectChanged, handleObjectRemoved]);

    useEffect(() => {
        updateSceneSize();
    }, [objectSizeMap]);

    const contextValue = useMemo<ProjectStateContextValue>(
        () => ({
            projectPhase,
            setProjectPhase,
            behaviorCount,
            setBehaviorCount,
            sceneSize,
            objectSizeMap,
        }),
        [projectPhase, behaviorCount, sceneSize, objectSizeMap],
    );

    return <ProjectStateContext.Provider value={contextValue}>{children}</ProjectStateContext.Provider>;
};

export default ProjectStateContextProvider;

export const useProjectStateContext = () => React.useContext(ProjectStateContext);
