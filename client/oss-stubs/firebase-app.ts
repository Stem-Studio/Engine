// OSS stub for `firebase/app`, aliased by vite.config.ts so the Firebase SDK
// never enters the bundle. Any accidental Firebase call is a programming
// error, so throwing on call is safer than silently doing nothing.
/* eslint-disable @typescript-eslint/no-explicit-any */

const unreachable = (name: string): never => {
    throw new Error(`firebase/app.${name}() is not available in OSS builds`);
};

export interface FirebaseApp {
    name: string;
    options: Record<string, unknown>;
}

export const initializeApp = (..._args: any[]): FirebaseApp => unreachable("initializeApp");
export const getApps = (): FirebaseApp[] => [];
export const getApp = (..._args: any[]): FirebaseApp => unreachable("getApp");
export const deleteApp = async (..._args: any[]): Promise<void> => unreachable("deleteApp");
