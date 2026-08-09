import type {IAuthUser} from "../../../auth";
import type {IForm} from "../RegisterPage/RegisterPage";

const OSS_DUMMY_TOKEN = "stemstudio-token";

const localUser: IAuthUser = {
    uid: "stemstudio-local-user",
    email: "local@stemstudio.invalid",
    displayName: "Local User",
    photoURL: null,
    isAnonymous: false,
    emailVerified: true,
    async getIdToken() {
        return OSS_DUMMY_TOKEN;
    },
};

type SignInResult =
    | {status: "logged_in"; user: IAuthUser}
    | {status: "verification_required"; user: IAuthUser}
    | {status: "error"; message: string; code?: string};

type SignUpResult =
    | {status: "verification_required"; user: IAuthUser}
    | {status: "error"; message: string; code?: string};

export async function signInWithEmail(_email: string, _password: string): Promise<SignInResult> {
    return {status: "logged_in", user: localUser};
}

export async function signUpWithEmail(_form: IForm, _password: string): Promise<SignUpResult> {
    return {
        status: "error",
        message: "Accounts are not available in this local app.",
        code: "oss/accounts-unavailable",
    };
}

export async function resetPassword(_email: string) {
    return {
        status: "error",
        message: "Password reset is not available in this local app.",
        code: "oss/accounts-unavailable",
    };
}
