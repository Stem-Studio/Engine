import type {BYOKKeyStore} from "./BYOKKeyStore";
import type {AIProvider} from "./types";

const AES_GCM_KEY_LENGTH_BITS = 256;
const AES_GCM_IV_LENGTH = 12;

/**
 * Optional passphrase-encrypted wrapper around any underlying
 * {@link BYOKKeyStore}. When a passphrase is set, provider keys are
 * encrypted with AES-GCM 256 using a key derived from PBKDF2-SHA-256
 * before being written to the underlying store. Without a passphrase
 * set, calls pass through unchanged so this wrapper is a safe drop-in
 * replacement.
 *
 * Schema (all stored via the underlying store):
 *
 *   {provider}              → either a plaintext string (no passphrase
 *                            configured) or a base64-encoded EncryptedBlob
 *                            wrapped with a magic prefix
 *                            "${ENCRYPTED_PREFIX}{base64}". The prefix
 *                            lets us detect at read time whether a value
 *                            was written under a passphrase or not.
 *   __byok_meta             → JSON {salt, iter, verifier} — only present
 *                            when a passphrase has been set. The verifier
 *                            is a known plaintext encrypted with the
 *                            derived key, so we can detect wrong-passphrase
 *                            on `unlock()` without round-tripping a real
 *                            provider key.
 *
 * Threat model:
 *   - Defends against another user with read access to this browser's
 *     IDB (shared dev profile, leaked backup) — they see ciphertext only.
 *   - Does NOT defend against malicious code running in the same origin —
 *     a script with `await get(provider)` can extract the key after
 *     unlock. That's true of any in-browser secret store.
 */
export class EncryptedBYOKKeyStore implements BYOKKeyStore {
    private static readonly META_KEY = "__byok_meta";
    private static readonly ENCRYPTED_PREFIX = "enc:";
    private static readonly VERIFIER_PLAINTEXT = "stemstudio-byok-verifier-v1";
    private static readonly KDF_ITERATIONS = 210_000;
    private static readonly SALT_LENGTH = 16;

    /** Derived AES key, present only when `unlock()` has succeeded. */
    private derivedKey: CryptoKey | undefined;

    constructor(private readonly underlying: BYOKKeyStore) {}

    /** True if a passphrase has ever been configured for this store. */
    async hasPassphrase(): Promise<boolean> {
        const meta = await this.readMeta();
        return meta !== null;
    }

    /** True if the store is currently unlocked (passphrase entered this session). */
    isUnlocked(): boolean {
        return this.derivedKey !== undefined;
    }

    /**
     * Configure a passphrase for the first time (or change to a new one
     * after `unlock()`). Re-encrypts every existing key under the new
     * passphrase.
     */
    async setPassphrase(passphrase: string): Promise<void> {
        const trimmed = passphrase.trim();
        if (!trimmed) throw new Error("Passphrase cannot be empty");

        // Snapshot existing keys (need to read them in their current state
        // before we change the meta). If a previous passphrase was set, the
        // store must already be unlocked.
        const existing = await this.all();

        const salt = crypto.getRandomValues(new Uint8Array(EncryptedBYOKKeyStore.SALT_LENGTH));
        const key = await deriveKey(trimmed, salt);
        const verifier = await encryptString(key, EncryptedBYOKKeyStore.VERIFIER_PLAINTEXT);

        // Stash meta before re-writing entries so a partial write at least
        // marks the store as encrypted (next session prompts for passphrase).
        await this.underlying.set(
            EncryptedBYOKKeyStore.META_KEY as AIProvider,
            JSON.stringify({
                salt: toBase64(salt),
                iter: EncryptedBYOKKeyStore.KDF_ITERATIONS,
                verifier: toBase64(verifier),
            }),
        );

        this.derivedKey = key;

        for (const [provider, plaintext] of Object.entries(existing) as Array<[AIProvider, string]>) {
            await this.set(provider, plaintext);
        }
    }

    /**
     * Try to unlock the store with the given passphrase. Returns true on
     * success, false if the passphrase is wrong (or no passphrase has
     * been set — the store is already "unlocked" in plain mode).
     */
    async unlock(passphrase: string): Promise<boolean> {
        const meta = await this.readMeta();
        if (!meta) {
            // No passphrase configured — plain mode is always "unlocked".
            this.derivedKey = undefined;
            return true;
        }
        const trimmed = passphrase.trim();
        if (!trimmed) return false;
        try {
            const salt = fromBase64(meta.salt);
            const key = await deriveKey(trimmed, salt, meta.iter);
            const verifier = fromBase64(meta.verifier);
            const decoded = await decryptBytes(key, verifier);
            if (decoded !== EncryptedBYOKKeyStore.VERIFIER_PLAINTEXT) {
                return false;
            }
            this.derivedKey = key;
            return true;
        } catch {
            return false;
        }
    }

    /** Forget the in-memory derived key. Existing ciphertext stays in IDB. */
    lock(): void {
        this.derivedKey = undefined;
    }

    /**
     * Wipe the passphrase configuration AND every encrypted key. After
     * this, the store is back in plain mode. Useful for "I forgot my
     * passphrase" recovery — at the cost of all stored keys.
     */
    async resetPassphrase(): Promise<void> {
        await this.underlying.clear();
        this.derivedKey = undefined;
    }

    async get(provider: AIProvider): Promise<string | undefined> {
        const raw = await this.underlying.get(provider);
        if (raw === undefined) return undefined;
        if (!raw.startsWith(EncryptedBYOKKeyStore.ENCRYPTED_PREFIX)) {
            return raw;
        }
        if (!this.derivedKey) {
            throw new Error("EncryptedBYOKKeyStore is locked. Call unlock(passphrase) first.");
        }
        const cipher = fromBase64(raw.slice(EncryptedBYOKKeyStore.ENCRYPTED_PREFIX.length));
        return decryptBytes(this.derivedKey, cipher);
    }

    async set(provider: AIProvider, key: string): Promise<void> {
        const meta = await this.readMeta();
        if (!meta) {
            // Plain mode — no transform.
            await this.underlying.set(provider, key);
            return;
        }
        if (!this.derivedKey) {
            throw new Error("EncryptedBYOKKeyStore is locked. Call unlock(passphrase) first.");
        }
        const cipher = await encryptString(this.derivedKey, key);
        await this.underlying.set(provider, EncryptedBYOKKeyStore.ENCRYPTED_PREFIX + toBase64(cipher));
    }

    async delete(provider: AIProvider): Promise<void> {
        await this.underlying.delete(provider);
    }

    async all(): Promise<Partial<Record<AIProvider, string>>> {
        const raw = await this.underlying.all();
        const out: Partial<Record<AIProvider, string>> = {};
        for (const [provider, value] of Object.entries(raw) as Array<[AIProvider, string]>) {
            if (provider === (EncryptedBYOKKeyStore.META_KEY as string)) continue;
            if (!value.startsWith(EncryptedBYOKKeyStore.ENCRYPTED_PREFIX)) {
                out[provider] = value;
                continue;
            }
            if (!this.derivedKey) continue; // Locked — skip ciphertext entries.
            try {
                const cipher = fromBase64(value.slice(EncryptedBYOKKeyStore.ENCRYPTED_PREFIX.length));
                out[provider] = await decryptBytes(this.derivedKey, cipher);
            } catch {
                // Corrupted entry — skip.
            }
        }
        return out;
    }

    async clear(): Promise<void> {
        await this.underlying.clear();
        this.derivedKey = undefined;
    }

    private async readMeta(): Promise<{salt: string; iter: number; verifier: string} | null> {
        const raw = await this.underlying.get(EncryptedBYOKKeyStore.META_KEY as AIProvider);
        if (!raw) return null;
        try {
            return JSON.parse(raw) as {salt: string; iter: number; verifier: string};
        } catch {
            return null;
        }
    }
}

// ─── Crypto helpers ─────────────────────────────────────────────────────────

async function deriveKey(
    passphrase: string,
    salt: Uint8Array,
    iterations = 210_000,
): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
        "raw",
        enc.encode(passphrase),
        "PBKDF2",
        false,
        ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
        {name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256"},
        baseKey,
        {name: "AES-GCM", length: AES_GCM_KEY_LENGTH_BITS},
        false,
        ["encrypt", "decrypt"],
    );
}

async function encryptString(key: CryptoKey, plaintext: string): Promise<Uint8Array> {
    const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_LENGTH));
    const cipher = new Uint8Array(
        await crypto.subtle.encrypt({name: "AES-GCM", iv}, key, new TextEncoder().encode(plaintext)),
    );
    // Prepend IV so decrypt can read it without a separate field.
    const out = new Uint8Array(iv.length + cipher.length);
    out.set(iv, 0);
    out.set(cipher, iv.length);
    return out;
}

async function decryptBytes(key: CryptoKey, payload: Uint8Array): Promise<string> {
    const iv = payload.slice(0, AES_GCM_IV_LENGTH);
    const cipher = payload.slice(AES_GCM_IV_LENGTH);
    const plain = await crypto.subtle.decrypt(
        {name: "AES-GCM", iv: iv as BufferSource},
        key,
        cipher as BufferSource,
    );
    return new TextDecoder().decode(plain);
}

function toBase64(bytes: Uint8Array): string {
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
    return btoa(s);
}

function fromBase64(s: string): Uint8Array {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
