// Photo slots are stable identities. Keep inactive people's poses when a source
// is muted/bypassed, and restore their two-person placement when enabled again.
const clone = value => JSON.parse(JSON.stringify(value));
const PERSON_KEYS = ['mesh', 'pose', 'proportions', 'transform', 'openpose', 'grips'];
const person = data => Object.fromEntries(PERSON_KEYS.filter(key => key in data).map(key => [key, clone(data[key])]));
export const photoSlots = inputs => [1, 2].filter(slot => inputs[slot === 1 ? 'reference_image' : 'reference_image_2'] != null);

export function reconcilePortraits(saved, slots) {
    if (!slots.length) throw new Error('请至少启用一张人物照片，再生成。');
    // A complete group photo intentionally drives two mannequins from one input.
    if (slots.length === 1 && slots[0] === 1 && saved.referenceMode !== 'separate' && !saved.portraitState) {
        return { data: saved, needsCapture: false };
    }
    const data = clone(saved), two = data.people?.length === 2;
    const previous = data.portraitState?.activeSlots || (two ? [1, 2] : [1]);
    const bank = clone(data.portraitState?.savedPeople || {});
    if (two) data.people.forEach((value, index) => { bank[previous[index] || index + 1] = person(value); });
    else {
        const value = person(data), slot = previous[0];
        // Single-person auto fit changes placement; retain the pair's arrangement.
        if (bank[slot]?.transform) value.transform = bank[slot].transform;
        bank[slot] = value;
    }
    const changed = previous.join() !== slots.join() || Boolean(two) !== (slots.length === 2);
    for (const slot of slots) if (!bank[slot]) {
        const base = bank[previous[0]] || person(data);
        const zoom = base.transform?.zoom || 1;
        bank[slot] = { mesh: clone(base.mesh || {}), proportions: clone(base.proportions || {}),
            pose: null, openpose: null, grips: { l: 0, r: 0 },
            transform: { x: (slot === 1 ? -4.4 : 4.4) * zoom, y: 0, z: 0, zoom } };
        if (slots.length === 2 && bank[previous[0]]) {
            bank[previous[0]].transform = { ...base.transform, x: (previous[0] === 1 ? -4.4 : 4.4) * zoom };
        }
    }
    if (changed) {
        data.kind = 'vnccs-free-pose';
        data.version = 2;
        Object.assign(data, clone(bank[slots[0]]), { active: 0 });
        data.people = slots.length === 2 ? slots.map(slot => clone(bank[slot])) : null;
        for (const key of ['poseReference', 'poseReferenceFile', 'shotPreview', 'shotPreviewFile']) delete data[key];
    }
    data.referenceMode = 'separate';
    data.portraitState = { activeSlots: [...slots], savedPeople: bank };
    return { data, needsCapture: changed };
}

// ComfyUI's public node keeps its original required primary port. When only
// photo 2 is enabled, route it to image2 for this request; graph links stay intact.
export function routePortraitInputs(inputs) {
    if (inputs.reference_image == null && inputs.reference_image_2 != null) {
        inputs.reference_image = inputs.reference_image_2;
        delete inputs.reference_image_2;
    }
}
