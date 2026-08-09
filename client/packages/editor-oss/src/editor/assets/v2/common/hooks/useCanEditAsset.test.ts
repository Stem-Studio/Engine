import {renderHook} from "@testing-library/react";
import {beforeEach, describe, expect, it, vi} from "vitest";

const hoisted = vi.hoisted(() => ({
    isTemplateScene: vi.fn(),
    checkIsSceneCollaborator: vi.fn(),
    authorizationContext: {
        isAdmin: false,
        dbUser: {id: "user-self"},
    },
    globalMock: {
        app: {
            editor: {
                sceneID: "scene-1",
                projectUserId: "scene-owner",
                isReadOnly: false,
            },
        },
    },
}));

vi.mock("../../../../../utils/isTemplateScene", () => ({
    isTemplateScene: (...args: unknown[]) => hoisted.isTemplateScene(...args),
}));

vi.mock("../../../../..//context", () => ({
    useAuthorizationContext: () => hoisted.authorizationContext,
}));

vi.mock("@stem/network/api/scene", () => ({
    checkIsSceneCollaborator: (...args: unknown[]) => hoisted.checkIsSceneCollaborator(...args),
}));

vi.mock("../../../../../global", () => ({default: hoisted.globalMock}));

import {useCanEditAsset} from "./useCanEditAsset";

const setScene = (overrides: Partial<{
    sceneID: string;
    projectUserId: string;
    isReadOnly: boolean;
}> = {}) => {
    Object.assign(hoisted.globalMock.app.editor, overrides);
};

const setAuth = (overrides: Partial<{isAdmin: boolean; userId: string}> = {}) => {
    if (overrides.isAdmin !== undefined) hoisted.authorizationContext.isAdmin = overrides.isAdmin;
    if (overrides.userId !== undefined) hoisted.authorizationContext.dbUser = {id: overrides.userId};
};

describe("useCanEditAsset", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.isTemplateScene.mockReturnValue(false);
        Object.assign(hoisted.globalMock.app.editor, {
            sceneID: "scene-1",
            projectUserId: "scene-owner",
            isReadOnly: false,
        });
        hoisted.authorizationContext.isAdmin = false;
        hoisted.authorizationContext.dbUser = {id: "scene-owner"};
        hoisted.checkIsSceneCollaborator.mockResolvedValue(false);
    });

    describe("canEdit", () => {
        it("scene owner editing their own asset on their scene → true", () => {
            const {result} = renderHook(() => useCanEditAsset({assetOwnerId: "scene-owner"}));
            expect(result.current.canEdit).toBe(true);
        });

        // In the local app there is no cross-user ownership — assets created via the
        // network adapter are stamped `userId: "local"`, scenes are stamped
        // with the AuthorizationContext dummy id. Remote deployments may gate
        // `canEdit` on those matching and on the viewer being a contributor;
        // this path short-circuits both — owning the scene is
        // sufficient, since "the scene" is the local file/IDB row the user
        // just opened.
        it("OSS: scene owner viewing an asset stamped with a different userId → true", () => {
            const {result} = renderHook(() => useCanEditAsset({assetOwnerId: "other-user"}));
            expect(result.current.canEdit).toBe(true);
        });

        it("OSS: any logged-in user can edit assets in a scene they have open → true", () => {
            setAuth({userId: "random-user"});
            const {result} = renderHook(() => useCanEditAsset({assetOwnerId: "random-user"}));
            expect(result.current.canEdit).toBe(true);
        });

        it("template scene → false even for the scene owner", () => {
            hoisted.isTemplateScene.mockReturnValue(true);
            const {result} = renderHook(() => useCanEditAsset({assetOwnerId: "scene-owner"}));
            expect(result.current.canEdit).toBe(false);
        });

        it("readonly scene → false even for the scene owner", () => {
            setScene({isReadOnly: true});
            const {result} = renderHook(() => useCanEditAsset({assetOwnerId: "scene-owner"}));
            expect(result.current.canEdit).toBe(false);
        });
    });

    describe("canFork", () => {
        it("contributor → true", () => {
            // Scene owner is the default contributor.
            const {result} = renderHook(() => useCanEditAsset({assetOwnerId: "any"}));
            expect(result.current.canFork).toBe(true);
        });

        it("non-contributor → false", () => {
            setAuth({userId: "outsider", isAdmin: false});
            const {result} = renderHook(() => useCanEditAsset({assetOwnerId: "any"}));
            expect(result.current.canFork).toBe(false);
        });

        it("admin (treated as contributor) → true", () => {
            setAuth({userId: "admin-user", isAdmin: true});
            const {result} = renderHook(() => useCanEditAsset({assetOwnerId: "any"}));
            expect(result.current.canFork).toBe(true);
        });

        it("template scene → false", () => {
            hoisted.isTemplateScene.mockReturnValue(true);
            const {result} = renderHook(() => useCanEditAsset({assetOwnerId: "any"}));
            expect(result.current.canFork).toBe(false);
        });

        it("readonly scene → false", () => {
            setScene({isReadOnly: true});
            const {result} = renderHook(() => useCanEditAsset({assetOwnerId: "any"}));
            expect(result.current.canFork).toBe(false);
        });
    });
});
