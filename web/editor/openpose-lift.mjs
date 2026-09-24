// Lift a single 2D OpenPose body (pixels, from pose-import.mjs readSkeletonImage)
// into 3D keypoints for the VNCCS mannequin. A 2D skeleton has no depth, so each
// segment's depth comes from foreshortening: |dz| = sqrt(L² - l²), where L is the
// mannequin's bone length and l the projected length. The front/back sign is a
// heuristic (knees, elbows, hands forward; shins back) that the user can flip.

// [key, from, to, default forward sign, flip group]
export const LIFT_SEGMENTS = [
    ['torso', 'hipMid', 'neck', 1, 'torso'],
    ['lUpperArm', 'ls', 'le', 1, 'lArmUpper'], ['lForearm', 'le', 'lw', 1, 'lArmLower'],
    ['rUpperArm', 'rs', 're', 1, 'rArmUpper'], ['rForearm', 're', 'rw', 1, 'rArmLower'],
    ['lThigh', 'lh', 'lk', 1, 'lLegUpper'], ['lShin', 'lk', 'la', -1, 'lLegLower'],
    ['rThigh', 'rh', 'rk', 1, 'rLegUpper'], ['rShin', 'rk', 'ra', -1, 'rLegLower'],
];
// A flipped upper segment mirrors the whole limb, like folding it to the other side.
const LIMB_OF = { lArmLower: 'lArmUpper', rArmLower: 'rArmUpper', lLegLower: 'lLegUpper', rLegLower: 'rLegUpper' };

const sub = (a, b) => a.map((v, i) => v - b[i]);
const add = (a, b) => a.map((v, i) => v + b[i]);
const mid = (a, b) => a.map((v, i) => (v + b[i]) / 2);
const length = v => Math.hypot(...v);

export function isFacingAway(points) {
    // In a front view the subject's right shoulder is on the image's left.
    const shoulders = points.rs[0] - points.ls[0];
    const hips = points.rh[0] - points.lh[0];
    return (Math.abs(shoulders) >= Math.abs(hips) ? shoulders : hips) > 0;
}

/**
 * @param points {head(nose), neck, ls, le, lw, rs, re, rw, lh, lk, la, rh, rk, ra}: [x, y] image pixels
 * @param rest same keys plus hipMid, as [x, y, z] mannequin rest positions (neck = shoulder midpoint)
 * @param flips {torso, body, lArmUpper, lArmLower, ...}: true = invert that depth guess
 * @returns {kps, facingAway, scale} with kps relative to the hip midpoint, y up, +z toward the camera
 */
export function liftOpenPose(points, rest, flips = {}) {
    const p2 = Object.fromEntries(Object.entries(points).map(([key, [x, y]]) => [key, [x, -y]]));
    p2.hipMid = mid(p2.lh, p2.rh);
    const restLength = ([, a, b]) => length(sub(rest[b], rest[a]));
    const imageLength = ([, a, b]) => length(sub(p2[b], p2[a]));
    // The second-least foreshortened segment sets pixels→world, tolerating one odd proportion.
    const ratios = LIFT_SEGMENTS.filter(seg => imageLength(seg) > 1e-3).map(seg => restLength(seg) / imageLength(seg)).sort((a, b) => a - b);
    if (!ratios.length) throw Error('骨架关节重合，无法换算成人偶姿势');
    const scale = ratios[Math.min(1, ratios.length - 1)];
    const depth = seg => Math.sqrt(Math.max(0, restLength(seg) ** 2 - (scale * imageLength(seg)) ** 2));
    const sign = key => {
        const [, , , forward, group] = LIFT_SEGMENTS.find(seg => seg[0] === key);
        const flipped = Boolean(flips[group]) !== Boolean(LIMB_OF[group] && flips[LIMB_OF[group]]);
        return flipped ? -forward : forward;
    };
    const planar = (from, to) => [...sub(p2[to], p2[from]).map(v => v * scale), 0];
    const segment = key => LIFT_SEGMENTS.find(seg => seg[0] === key);
    const step = (base, key) => {
        const seg = segment(key);
        const offset = planar(seg[1], seg[2]);
        offset[2] = depth(seg) * sign(key);
        return add(base, offset);
    };

    // Body turn: a narrowed shoulder/hip line means the torso rotated about the vertical axis.
    // The nose leaning to the image right means the subject turned toward its own left,
    // which pulls the left side back and the right side forward.
    const turn = Math.sign(p2.head[0] - p2.neck[0]) || 1;
    const halfDepth = (a, b, restA, restB) => Math.sqrt(Math.max(0, length(sub(rest[restA], rest[restB])) ** 2 - (scale * length(sub(p2[a], p2[b]))) ** 2)) / 2;
    const shoulderTurn = halfDepth('ls', 'rs', 'ls', 'rs') * turn;
    const hipTurn = halfDepth('lh', 'rh', 'lh', 'rh') * turn;

    const kps = { hipMid: [0, 0, 0] };
    kps.lh = [...planar('hipMid', 'lh').slice(0, 2), -hipTurn];
    kps.rh = [...planar('hipMid', 'rh').slice(0, 2), hipTurn];
    kps.neck = step(kps.hipMid, 'torso');
    if (flips.torso) kps.neck[2] = -kps.neck[2];
    kps.ls = add(kps.neck, [...planar('neck', 'ls').slice(0, 2), -shoulderTurn]);
    kps.rs = add(kps.neck, [...planar('neck', 'rs').slice(0, 2), shoulderTurn]);
    kps.head = add(kps.neck, planar('neck', 'head'));
    kps.le = step(kps.ls, 'lUpperArm'); kps.lw = step(kps.le, 'lForearm');
    kps.re = step(kps.rs, 'rUpperArm'); kps.rw = step(kps.re, 'rForearm');
    kps.lk = step(kps.lh, 'lThigh'); kps.la = step(kps.lk, 'lShin');
    kps.rk = step(kps.rh, 'rThigh'); kps.ra = step(kps.rk, 'rShin');

    // A back view is the depth mirror of the same picture seen from the front.
    const facingAway = isFacingAway(points) !== Boolean(flips.body);
    if (facingAway) for (const point of Object.values(kps)) point[2] = -point[2];
    return { kps, facingAway, scale };
}

// Keys expected by PoseViewerCore.applyWorldKeypointImport.
export const WORLD_KEYPOINT_NAMES = {
    hipMid: 'pelvis', neck: 'neck', head: 'head',
    ls: 'left_shoulder', le: 'left_elbow', lw: 'left_wrist', rs: 'right_shoulder', re: 'right_elbow', rw: 'right_wrist',
    lh: 'left_hip', lk: 'left_knee', la: 'left_ankle', rh: 'right_hip', rk: 'right_knee', ra: 'right_ankle',
};
