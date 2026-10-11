// Draws a Spot Report still (see sim/spotReport.ts) as an aerial-ish
// snapshot: vehicles and people to count, trees and houses as distractors.
export function drawSpotImage(canvas, image, emptyText = "Waiting for the next image") {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = rect.width;
    const H = rect.height;
    g.fillStyle = image?.backdrop === "town" ? "#c3b998" : "#b7c49c";
    g.fillRect(0, 0, W, H);
    if (!image) {
        g.fillStyle = "#5c6a61";
        g.font = `400 13px "IBM Plex Sans", system-ui, sans-serif`;
        g.textAlign = "center";
        g.fillText(emptyText, W / 2, H / 2);
        return;
    }
    // Ground texture, like an aerial photo: patches of lighter and darker vegetation and grit. Seeded by
    // the image id, so every participant sees the same picture.
    let seed = 0;
    for (const ch of image.id)
        seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const town = image.backdrop === "town";
    for (let i = 0; i < 26; i++) {
        g.fillStyle = i % 2 ? (town ? "rgba(120,104,72,0.10)" : "rgba(70,96,48,0.12)") : "rgba(255,255,240,0.10)";
        g.beginPath();
        g.ellipse(rnd() * W, rnd() * H, (0.05 + rnd() * 0.12) * W, (0.04 + rnd() * 0.1) * H, rnd() * Math.PI, 0, Math.PI * 2);
        g.fill();
    }
    for (let i = 0; i < 420; i++) {
        g.fillStyle = i % 3 ? "rgba(60,70,40,0.16)" : "rgba(255,255,255,0.14)";
        g.fillRect(rnd() * W, rnd() * H, 1.2, 1.2);
    }
    // A track across the scene, with darker edges and wheel ruts.
    const trackPath = () => {
        g.beginPath();
        g.moveTo(0, H * 0.62);
        g.bezierCurveTo(W * 0.3, H * 0.5, W * 0.6, H * 0.8, W, H * 0.55);
    };
    g.lineCap = "butt";
    g.strokeStyle = town ? "#988968" : "#b9ae8c";
    g.lineWidth = H * 0.14;
    trackPath();
    g.stroke();
    g.strokeStyle = town ? "#a8987a" : "#cfc6a8";
    g.lineWidth = H * 0.11;
    trackPath();
    g.stroke();
    g.strokeStyle = "rgba(120,100,70,0.35)";
    g.lineWidth = Math.max(1, H * 0.012);
    g.setLineDash([H * 0.05, H * 0.03]);
    trackPath();
    g.stroke();
    g.setLineDash([]);
    const unit = Math.min(W / 10, H / 6);
    const order = ["house", "tree", "vehicle", "person"];
    for (const kind of order) {
        for (const o of image.objects.filter((x) => x.kind === kind)) {
            const x = o.x * W;
            const y = o.y * H;
            const s = unit * o.scale;
            // Soft shadow to the lower right (sun from the upper left).
            g.fillStyle = "rgba(30,34,20,0.25)";
            g.beginPath();
            g.ellipse(x + s * 0.12, y + s * 0.12, s * (kind === "house" ? 0.46 : kind === "tree" ? 0.34 : kind === "vehicle" ? 0.38 : 0.13), s * (kind === "person" ? 0.1 : 0.22), 0, 0, Math.PI * 2);
            g.fill();
            g.save();
            g.translate(x, y);
            if (o.flip)
                g.scale(-1, 1);
            if (kind === "house") {
                g.fillStyle = "#a08f78";
                g.fillRect(-s * 0.38, -s * 0.28, s * 0.76, s * 0.56);
                g.fillStyle = "#7a4e3a";
                g.beginPath();
                g.moveTo(-s * 0.44, -s * 0.28);
                g.lineTo(0, -s * 0.48);
                g.lineTo(s * 0.44, -s * 0.28);
                g.fill();
            }
            else if (kind === "tree") {
                g.fillStyle = "#5d7a45";
                g.beginPath();
                g.arc(0, 0, s * 0.3, 0, Math.PI * 2);
                g.fill();
                g.fillStyle = "#4b6638";
                g.beginPath();
                g.arc(s * 0.08, -s * 0.06, s * 0.16, 0, Math.PI * 2);
                g.fill();
            }
            else if (kind === "vehicle") {
                g.fillStyle = "#4b5a6b";
                g.fillRect(-s * 0.34, -s * 0.15, s * 0.68, s * 0.3);
                g.fillStyle = "#8fa6b8";
                g.fillRect(s * 0.1, -s * 0.12, s * 0.16, s * 0.24);
                g.fillStyle = "#222";
                for (const wx of [-0.22, 0.2]) {
                    g.fillRect(s * wx - s * 0.06, -s * 0.2, s * 0.12, s * 0.06);
                    g.fillRect(s * wx - s * 0.06, s * 0.14, s * 0.12, s * 0.06);
                }
            }
            else {
                g.fillStyle = "#2d3a52";
                g.fillRect(-s * 0.09, -s * 0.12, s * 0.18, s * 0.34);
                g.fillStyle = "#c2563f";
                g.beginPath();
                g.arc(0, -s * 0.22, s * 0.12, 0, Math.PI * 2);
                g.fill();
            }
            g.restore();
        }
    }
}
