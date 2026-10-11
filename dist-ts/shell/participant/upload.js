// Per-stage automatic upload (Study 2 brief sections 10 and 12): at the end
// of every stage the shell posts the WHOLE session so far (events.jsonl,
// summary.json, metrics.csv) to the deployment's endpoint, so a participant
// who drops out still leaves usable data. Every upload is cumulative and
// numbered, so a failed upload loses nothing: the next one carries the same
// data and more, and the server keeps the highest-numbered copy.
// Demographics travel in their own payload kind and are stored apart from the
// logs (brief section 12: "demographics stored separately from logs").
export class Uploader {
    opts;
    fetchImpl;
    sleep;
    constructor(opts) {
        this.opts = opts;
        this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
        this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    }
    /** Posts one payload, retrying on network errors and 5xx/429. Never throws. */
    async send(payload) {
        const attempts = this.opts.attempts ?? 3;
        const backoff = this.opts.backoffMs ?? [1000, 3000];
        let status = null;
        let error = null;
        for (let k = 1; k <= attempts; k++) {
            try {
                const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
                const timer = ctrl ? setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 20000) : null;
                const res = await this.fetchImpl(this.opts.endpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                    ...(ctrl ? { signal: ctrl.signal } : {})
                });
                if (timer)
                    clearTimeout(timer);
                status = res.status;
                if (res.ok)
                    return { ok: true, attempts: k, status, error: null };
                error = `HTTP ${res.status}`;
                // 4xx (other than 429) will not get better by retrying.
                if (res.status < 500 && res.status !== 429)
                    return { ok: false, attempts: k, status, error };
            }
            catch (err) {
                status = null;
                error = err instanceof Error ? err.message || err.name : String(err);
            }
            if (k < attempts)
                await this.sleep(backoff[Math.min(k - 1, backoff.length - 1)] ?? 1000);
        }
        return { ok: false, attempts, status, error };
    }
}
