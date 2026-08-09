// Firebase compatibility module. The editor uses the local
// "stemstudio-token" auth identity accepted by the ai-server, so Firebase
// services are intentionally null-shaped.
import type {Auth} from "firebase/auth";
import type {Firestore} from "firebase/firestore";
import type {Analytics} from "firebase/analytics";

export const firebaseConfig = {} as const;
export const analytics: Analytics | null = null;
export const auth: Auth | null = null;
export const db: Firestore | null = null;
export default null;
