export const DEFAULT_FRAMING = { zoom: 1, offsetX: 0, offsetY: 0 };
export const isTurned = angle => Math.abs(angle?.yaw || 0) > 0.01 || Math.abs(angle?.pitch || 0) > 0.01;

// A front crop belongs to the pose pass, even when the optional camera pass is off.
export function frontFraming(saved) {
    const value = saved.framing || (!isTurned(saved.anyAngle) && saved.autoFit === false ? saved.anyAngle : null);
    return { ...DEFAULT_FRAMING, ...Object.fromEntries(Object.keys(DEFAULT_FRAMING)
        .filter(key => Number.isFinite(value?.[key])).map(key => [key, value[key]])) };
}

export function outputShot(doc, cameraEnabled = true) {
    return cameraEnabled && isTurned(doc.anyAngle)
        ? doc.anyAngle : { ...DEFAULT_FRAMING, ...doc.framing, yaw: 0, pitch: 0 };
}
