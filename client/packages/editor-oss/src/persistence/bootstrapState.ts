const BOOTSTRAP_FLAG = "stemstudio.bootstrap.complete";

export const isOSSBootstrapped = (): boolean => {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(BOOTSTRAP_FLAG) === "true";
};

export const markOSSBootstrapped = (): void => {
    if (typeof localStorage !== "undefined") {
        localStorage.setItem(BOOTSTRAP_FLAG, "true");
    }
};

export const resetOSSBootstrap = (): void => {
    if (typeof localStorage !== "undefined") {
        localStorage.removeItem(BOOTSTRAP_FLAG);
    }
    void import("./fsHandleStore").then(({clearHandle}) => clearHandle());
};
