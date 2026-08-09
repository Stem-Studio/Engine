/**
 * Supported `where` filter operators. Mirrors the firestore subset the
 * editor actually uses; if a new operator is needed it should be added
 * here intentionally rather than passed through as a free string.
 */
export type WhereOp = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not-in" | "array-contains";

/** A single `where(field, op, value)` filter. */
export type WhereClause = readonly [field: string, op: WhereOp, value: unknown];

/**
 * IRemoteDocStore is the seam between editor-side persistence call sites and
 * any concrete remote document store. This repository wires
 * `NullRemoteDocStore`: writes are silent no-ops and reads return null because
 * the dummy local user is sufficient and there is no remote backing store.
 *
 * The interface is intentionally narrow: simple key-by-collection-and-id
 * reads, single-level `where` queries. Multi-level nested queries,
 * realtime subscriptions, and transactions are out of scope; if a
 * consumer needs them, extend this interface or build a
 * higher-level domain repository on top.
 */
export interface IRemoteDocStore {
    /**
     * Read a single document by collection + id. Returns null when the
     * document doesn't exist.
     */
    getDoc<T = Record<string, unknown>>(collection: string, id: string): Promise<T | null>;

    /**
     * Write/overwrite a document. Creates the doc if it doesn't exist.
     * Accepts any object shape so callers can pass typed domain structs
     * (e.g., `IEditorUser`) rather than coercing to `Record<string, unknown>`.
     */
    setDoc(collection: string, id: string, data: object): Promise<void>;

    /**
     * Partial update of an existing document. Throws if the doc doesn't
     * exist (matches firestore's updateDoc semantics).
     */
    updateDoc(collection: string, id: string, partial: object): Promise<void>;

    /**
     * Delete a document. Idempotent — no-op if the doc doesn't exist.
     */
    deleteDoc(collection: string, id: string): Promise<void>;

    /**
     * Filter a collection by one or more `where` clauses (AND-combined).
     * Returns the matching documents, each tagged with its `id` field so
     * callers can correlate without an extra mapping.
     */
    queryDocs<T = Record<string, unknown>>(
        collection: string,
        where: readonly WhereClause[],
    ): Promise<Array<T & {id: string}>>;
}

/**
 * Default no-op implementation. Reads return null/empty so consumers fall
 * through to their default-path branches; writes silently succeed so flows
 * like "save pending user form" do not crash.
 */
export class NullRemoteDocStore implements IRemoteDocStore {
    async getDoc<T = Record<string, unknown>>(_collection: string, _id: string): Promise<T | null> {
        return null;
    }
    async setDoc(_collection: string, _id: string, _data: object): Promise<void> {/* no-op */}
    async updateDoc(_collection: string, _id: string, _partial: object): Promise<void> {/* no-op */}
    async deleteDoc(_collection: string, _id: string): Promise<void> {/* no-op */}
    async queryDocs<T = Record<string, unknown>>(
        _collection: string,
        _where: readonly WhereClause[],
    ): Promise<Array<T & {id: string}>> {
        return [];
    }
}
