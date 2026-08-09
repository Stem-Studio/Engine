export type SerializedPhysicsSettings = {
    engine: string | undefined;
    gravity: number | undefined;
};

type SerializedSceneJson = {
    metadata?: {
        generator?: string;
    };
    userData?: {
        physics?: {
            engine?: string;
            gravity?: number;
        };
        game?: {
            gravity?: number;
        };
    };
};

export const getPhysicsSettingsFromSceneJson = (jsons: unknown): SerializedPhysicsSettings => {
    if (!Array.isArray(jsons)) return {engine: undefined, gravity: undefined};
    const sceneJson = jsons.find((n): n is SerializedSceneJson => {
        if (!n || typeof n !== "object") return false;
        const metadata = (n as SerializedSceneJson).metadata;
        return metadata?.generator === "SceneSerializer";
    });
    const userData = sceneJson?.userData;
    return {
        engine: userData?.physics?.engine,
        gravity: userData?.physics?.gravity ?? userData?.game?.gravity,
    };
};
