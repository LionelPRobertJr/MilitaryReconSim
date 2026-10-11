// Browser-only helper shared by every pack's results screen.
/** Triggers a browser download of a text file. UI-only; not used by headless tests. */
export function downloadTextFile(filename, contents, mimeType = "application/octet-stream") {
    const blob = new Blob([contents], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}
