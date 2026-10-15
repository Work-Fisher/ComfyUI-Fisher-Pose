// The pose reference is always the front capture, so a limb folded along that view axis projects
// to a stub there: a kneeling shin hides behind the thigh, the front reference reads as a standing
// person, and the model keeps the pose from image2.
//
// Measured 2026-10-14 through the real pipeline (same photo, same seed, only the reference view
// changing): 双膝跪地 transferred at 60° and 90° but not at 0° or 45°, and at those angles the
// generated person faced the way the mannequin was turned; the front reference plus one sentence
// describing the fold ("both knees touch the floor, his lower legs are folded back behind his
// thighs") transferred the pose with the person still facing the camera. Turning the mannequin
// trades the facing away, so this module only names the joints the front view cannot read — the
// editor shows the user the choice instead of making it.
//
// The threshold below is the geometric one (a limb pointing at the camera), not the model's: a
// 45° turn already projects the kneeling shins at 0.66–0.71 and clears the warning, yet that run
// still drew a standing person. So the warning only claims the front view cannot read the fold;
// the advice it carries (turn to the side, or describe the fold) is what was actually measured.

export const MIN_SEGMENT_VISIBILITY = 0.35; // a segment within ~20° of the camera axis

/** How much of a limb segment survives the front capture: projected length over true length.
 * Near 0 the segment points straight at the camera and reads as a stub. */
export function segmentVisibility([x, y, z]) {
    const length = Math.hypot(x, y, z);
    return length > 1e-6 ? Math.hypot(x, y) / length : 1;
}

/** The least visible segment of a pose — logged so a "the pose did not follow" can be traced. */
export function worstVisibility(parts) {
    return parts.length ? Math.min(...parts.map(({ segment }) => segmentVisibility(segment))) : 1;
}

/**
 * The joints the front reference cannot read.
 *
 * @param parts [{name, segment}]: world-space bone → child deltas of every mannequin, already
 *   carrying the turn the user set.
 * @returns the hidden parts with their visibility, least visible first; empty when the front
 *   view is readable.
 */
export function hiddenParts(parts, { minVisibility = MIN_SEGMENT_VISIBILITY } = {}) {
    return parts
        .map(({ name, segment }) => ({ name, visibility: segmentVisibility(segment) }))
        .filter(part => part.visibility < minVisibility)
        .sort((a, b) => a.visibility - b.visibility);
}
