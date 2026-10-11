export class SessionStore {
    key;
    storage;
    constructor(key, storage = safeLocalStorage()) {
        this.key = key;
        this.storage = storage;
    }
    load() {
        try {
            const raw = this.storage?.getItem(this.key);
            if (!raw)
                return null;
            const s = JSON.parse(raw);
            return s.version === 1 ? s : null;
        }
        catch {
            return null;
        }
    }
    /** Returns false if the browser refused (quota, blocked storage); the session carries on regardless. */
    save(s) {
        try {
            this.storage?.setItem(this.key, JSON.stringify(s));
            return !!this.storage;
        }
        catch {
            return false;
        }
    }
    clear() {
        try {
            this.storage?.removeItem(this.key);
        }
        catch {
            /* nothing to do */
        }
    }
}
function safeLocalStorage() {
    try {
        const s = globalThis.localStorage;
        if (!s)
            return null;
        const probe = "__probe__";
        s.setItem(probe, "1");
        s.removeItem(probe);
        return s;
    }
    catch {
        return null;
    }
}
