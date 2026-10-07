// Deciding whether an editor "apply" really changed the node data (imported by fisher_pose.js).
//
// Reopening the editor recomputes the fit and the bone angles (they differ from the saved ones in the
// last float digits) and re-renders the mannequin (a few pixels differ by GPU rounding, so the file
// name hash changes). ComfyUI caches by the exact string, so such a re-apply would rerun the front
// pass and count as "changed" for the seed policy. Keep the saved string when nothing really changed.

const RENDERED_KEYS = ["poseReference", "poseReferenceFile", "shotPreview", "shotPreviewFile"];

export function sameState(a, b) {
    if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
    if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a === b;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) if (!sameState(a[key], b[key])) return false;
    return true;
}

const withoutRenders = data => { const copy = { ...data }; for (const key of RENDERED_KEYS) delete copy[key]; return copy; };

// A render the new state has (stored file or inline fallback) must exist in the saved one too:
// a saved pose without a mannequin reference is never kept over a fresh capture.
const hasRender = (data, base) => Boolean(data[base + "File"]?.filename || data[base]);

// `fileExists(file)` resolves whether a stored { filename, subfolder, type } is still there.
export async function keepIfSame(previous, next, fileExists) {
    let before, after;
    try { before = JSON.parse(previous); after = JSON.parse(next); } catch { return next; }
    if (!before || !after || typeof before !== "object" || typeof after !== "object") return next;
    if (!sameState(withoutRenders(before), withoutRenders(after))) return next;
    if (["poseReference", "shotPreview"].some(base => hasRender(after, base) && !hasRender(before, base))) return next;
    for (const key of ["poseReferenceFile", "shotPreviewFile"]) {
        if (before[key]?.filename && !(await fileExists(before[key]).catch(() => false))) return next;
    }
    return previous;
}
