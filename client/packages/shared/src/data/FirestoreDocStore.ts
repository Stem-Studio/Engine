import {
    collection,
    deleteDoc as fbDeleteDoc,
    doc,
    getDoc,
    getDocs,
    query,
    setDoc,
    updateDoc as fbUpdateDoc,
    where,
    type Firestore,
    type WhereFilterOp,
} from "firebase/firestore";

import type {IRemoteDocStore, WhereClause} from "@stem/editor-oss/data";

import {db as defaultDb} from "../firebase";

/**
 * Firestore-backed implementation of `IRemoteDocStore`. Retained as an
 * optional adapter for forks that wire Firebase aliases to the real SDK.
 */
export class FirestoreDocStore implements IRemoteDocStore {
    private readonly db: Firestore | null;

    constructor(db: Firestore | null = defaultDb) {
        this.db = db;
    }

    async getDoc<T = Record<string, unknown>>(collectionName: string, id: string): Promise<T | null> {
        if (!this.db) return null;
        const snap = await getDoc(doc(this.db, collectionName, id));
        return snap.exists() ? (snap.data() as T) : null;
    }

    async setDoc(collectionName: string, id: string, data: object): Promise<void> {
        if (!this.db) return;
        await setDoc(doc(this.db, collectionName, id), data as Record<string, unknown>);
    }

    async updateDoc(collectionName: string, id: string, partial: object): Promise<void> {
        if (!this.db) return;
        await fbUpdateDoc(doc(this.db, collectionName, id), partial as Record<string, unknown>);
    }

    async deleteDoc(collectionName: string, id: string): Promise<void> {
        if (!this.db) return;
        await fbDeleteDoc(doc(this.db, collectionName, id));
    }

    async queryDocs<T = Record<string, unknown>>(
        collectionName: string,
        clauses: readonly WhereClause[],
    ): Promise<Array<T & {id: string}>> {
        if (!this.db) return [];
        const ref = collection(this.db, collectionName);
        const constraints = clauses.map(([field, op, value]) => where(field, op as WhereFilterOp, value));
        const q = constraints.length > 0 ? query(ref, ...constraints) : query(ref);
        const snap = await getDocs(q);
        return snap.docs.map(d => ({id: d.id, ...(d.data() as T)}));
    }
}
