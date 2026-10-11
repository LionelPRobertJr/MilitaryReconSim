export class FocusTracker {
    log;
    context;
    hiddenSince = null;
    blurredSince = null;
    off = [];
    constructor(log, context = () => ({})) {
        this.log = log;
        this.context = context;
    }
    start(doc = document, win = window) {
        const vis = () => this.change(doc.visibilityState === "hidden" ? "hidden" : "visible");
        const blur = () => this.change("blur");
        const focus = () => this.change("focus");
        doc.addEventListener("visibilitychange", vis);
        win.addEventListener("blur", blur);
        win.addEventListener("focus", focus);
        this.off.push(() => doc.removeEventListener("visibilitychange", vis), () => win.removeEventListener("blur", blur), () => win.removeEventListener("focus", focus));
    }
    stop() {
        for (const f of this.off.splice(0))
            f();
    }
    /** Public for tests. */
    change(to) {
        const now = this.log.now();
        let awaySeconds = null;
        if (to === "hidden") {
            if (this.hiddenSince !== null)
                return;
            this.hiddenSince = now;
        }
        else if (to === "visible") {
            if (this.hiddenSince === null)
                return;
            awaySeconds = now - this.hiddenSince;
            this.hiddenSince = null;
        }
        else if (to === "blur") {
            if (this.blurredSince !== null)
                return;
            this.blurredSince = now;
        }
        else {
            if (this.blurredSince === null)
                return;
            awaySeconds = now - this.blurredSince;
            this.blurredSince = null;
        }
        this.log.record({ type: "focus_change", to, awaySeconds: awaySeconds === null ? null : Math.round(awaySeconds * 1000) / 1000, ...this.context() });
    }
}
