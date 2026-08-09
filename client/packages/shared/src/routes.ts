export enum ROUTES {
    HOME = "/",
    DASHBOARD = "/dashboard",
    MY_AVATARS = "/my-avatars",
    MY_AVATARS_NEW = "/my-avatars/new",
    MY_AVATARS_EDIT = "/my-avatars/edit/:id",
    DISCOVER = "/discover",
    BROWSE = "/browse",
    REMIX = "/remix",
    FORUM = "/forum",
    NEWS = "/news",
    LEARN = "/learn",
    ABOUT = "/about",
    SETTINGS = "/settings",
    PLAY = "/play/:projectID",
    VIEW_MORE = "/view-more/:category",
    LOGIN = "/login",
    FORGOT_PASSWORD = "/forgot-password",
    WAITLIST = "/waitlist",
    SIGN_UP = "/signup",
    REGISTER = "/register",
    CREATE_PROJECT = "/create/project",
    CREATE_PROJECT_WITH_ID = "/create/project/:projectID",
    CREATE_PROJECT_WITH_MODE = "/create/project/:projectID/:mode",
    // Backward-compatible Playground route. New links use CREATE_PROJECT_WITH_MODE
    // and carry the readable scene slug in the `scene` query parameter.
    CREATE_PROJECT_WITH_SCENE_MODE = "/create/project/:projectID/:sceneName/:mode",
    TERMS_OF_SERVICE = "/legal/terms-of-service",
    PRIVACY_POLICY = "/legal/privacy-policy",
    THIRD_PARTY_ATTRIBUTIONS = "/3rd-party-attributions",
    CONTACT_US = "/contact-us",
    SEARCH_RESULTS = "/search/results",
    STEM_EDITOR = "/stem-editor/:assetId",
    ADMIN_PANEL = "/admin-panel",
    GAME_OVERVIEW = "/game/:id",
}

export function isSignUpRoutePath(pathname: string) {
    return pathname === ROUTES.SIGN_UP || pathname === ROUTES.REGISTER;
}
