// Everyday poses (常用姿势), written as segment directions instead of joint positions so that the
// same pose fits any body shape or limb proportion: the editor measures the current mannequin's
// bone lengths and walks each limb along these directions, then the VNCCS IK solves the rest.
//
// World frame of the mannequin as it faces the front camera: +x = the person's LEFT (screen right),
// +y = up, +z = toward the camera. Limb vectors are given for the left side; `sym` mirrors them.

const norm = v => { const l = Math.hypot(...v) || 1; return v.map(c => c / l); };
const add = (a, b) => a.map((c, i) => c + b[i]);
const sub = (a, b) => a.map((c, i) => c - b[i]);
const scale = (v, s) => v.map(c => c * s);
const dot = (a, b) => a.reduce((s, c, i) => s + c * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = v => Math.hypot(...v);
const mirror = v => [-v[0], v[1], v[2]];

// Rodrigues rotation that takes unit vector `from` onto unit vector `to`, applied to v.
function rotateOnto(from, to, v) {
    const axis = cross(from, to), sin = length(axis), cos = dot(from, to);
    if (sin < 1e-6) return cos > 0 ? v : [-v[0], -v[1], v[2]];
    const k = scale(axis, 1 / sin);
    return add(add(scale(v, cos), scale(cross(k, v), sin)), scale(k, dot(k, v) * (1 - cos)));
}

const ARM_DOWN = [[0.14, -1, 0.02], [0.08, -1, 0.14]];
const LEG_DOWN = [[0.05, -1, 0], [0, -1, -0.02]];
// Same limb on both sides; the right one is the mirror image.
const sym = (upper, lower) => ({ l: [upper, lower], r: [mirror(upper), mirror(lower)] });
const only = (side, upper, lower, other = ARM_DOWN) => side === 'l'
    ? { l: [upper, lower], r: [mirror(other[0]), mirror(other[1])] }
    : { l: other, r: [mirror(upper), mirror(lower)] };

export const COMMON_POSES = [
    { id: 'stand', name: '自然站立', arms: sym(...ARM_DOWN) },
    { id: 'stand-relaxed', name: '放松站姿', legs: { l: [[0.12, -0.97, 0.16], [-0.04, -1, -0.12]], r: [[-0.03, -1, 0], [0, -1, 0]] }, arms: sym([0.1, -1, -0.02], [0.05, -1, 0.1]), turn: -12 },
    { id: 'hands-on-hips', name: '双手叉腰', arms: sym([0.72, -0.62, -0.18], [-0.62, -0.62, 0.3]) },
    { id: 'arms-crossed', name: '双臂抱胸', arms: { l: [[0.3, -0.9, 0.34], [-0.95, 0.2, 0.3]], r: [[-0.3, -0.9, 0.28], [0.95, 0.24, 0.42]] } },
    { id: 'hands-in-pockets', name: '双手插兜', arms: sym([0.22, -0.96, -0.12], [-0.12, -0.96, 0.26]) },
    { id: 'wave', name: '挥手打招呼', arms: only('r', [0.92, 0.25, 0.2], [0.18, 1, 0.08]) },
    { id: 'point', name: '指向一侧', arms: only('r', [0.78, 0.12, 0.6], [0.74, 0.12, 0.66]), head: [-0.15, 1, 0.05] },
    { id: 'think', name: '托腮思考', arms: { l: [[0.22, -0.92, 0.32], [-0.98, 0.12, 0.3]], r: [[-0.1, -0.86, 0.5], [0.3, 0.92, 0.15]] }, head: [0.08, 1, 0.1] },
    { id: 'phone', name: '打电话', arms: only('r', [0.18, -0.8, 0.28], [0.3, 0.95, -0.02]), head: [-0.12, 1, 0.05] },
    { id: 'salute', name: '敬礼', arms: only('r', [0.95, 0.12, 0.28], [-0.62, 0.72, 0.22]) },
    { id: 'pray', name: '双手合十', arms: sym([0.3, -0.85, 0.42], [-0.62, 0.62, 0.48]) },
    { id: 'open-arms', name: '张开双臂', arms: sym([1, 0.08, 0.26], [0.72, 0.12, 0.68]) },
    { id: 'hands-up', name: '举起双手', arms: sym([0.22, 1, 0.02], [0.05, 1, 0]) },
    { id: 'bow', name: '鞠躬', torso: [0, 0.72, 0.7], head: [0, 0.6, 0.8], arms: sym([0.06, -0.9, 0.42], [0.02, -0.8, 0.6]) },
    { id: 'walk', name: '行走', legs: { l: [[0.03, -0.95, 0.3], [0, -1, -0.06]], r: [[-0.03, -0.95, -0.3], [0, -0.88, -0.48]] }, arms: { l: [[0.1, -1, -0.3], [0.05, -1, -0.05]], r: [[-0.1, -1, 0.3], [-0.05, -0.8, 0.6]] } },
    { id: 'run', name: '奔跑', torso: [0, 0.97, 0.22], legs: { l: [[0.02, -0.45, 0.9], [0, -1, -0.1]], r: [[-0.03, -0.9, -0.45], [0, -0.35, -0.94]] }, arms: { l: [[0.1, -0.8, -0.6], [0.05, 0.15, 0.99]], r: [[-0.1, -0.55, 0.82], [0.05, 0.5, 0.86]] } },
    { id: 'jump', name: '欢呼跳起', arms: sym([0.5, 0.86, 0.05], [0.25, 0.97, 0]), legs: { l: [[0.12, -0.82, 0.3], [0, -0.5, -0.87]], r: [[-0.12, -0.82, 0.3], [0, -0.5, -0.87]] } },
    { id: 'sit-chair', name: '坐在椅子上', legs: { l: [[0.1, 0, 1], [0, -1, 0.05]], r: [[-0.1, 0, 1], [0, -1, 0.05]] }, arms: sym([0.16, -0.9, 0.38], [0.05, -0.3, 1]) },
    { id: 'sit-cross', name: '盘腿坐', legs: { l: [[0.9, -0.18, 0.42], [-0.92, -0.1, 0.38]], r: [[-0.9, -0.18, 0.42], [0.92, -0.08, 0.4]] }, arms: sym([0.32, -0.85, 0.42], [0.3, -0.5, 0.82]) },
    { id: 'sit-hug-knees', name: '抱膝坐', torso: [0, 0.95, 0.3], legs: { l: [[0.12, 0.6, 0.8], [0, -1, 0.1]], r: [[-0.12, 0.6, 0.8], [0, -1, 0.1]] }, arms: sym([0.18, -0.45, 0.88], [-0.72, -0.12, 0.68]) },
    { id: 'kneel', name: '双膝跪地', legs: { l: [[0.08, -1, 0.05], [0, -0.05, -1]], r: [[-0.08, -1, 0.05], [0, -0.05, -1]] }, arms: sym([0.1, -1, 0.1], [0.04, -0.7, 0.72]) },
    { id: 'kneel-one', name: '单膝跪地', legs: { l: [[0.1, 0, 1], [0, -1, 0]], r: [[-0.08, -1, 0], [0, -0.05, -1]] }, arms: { l: [[0.15, -0.6, 0.78], [0.05, -0.85, 0.5]], r: [[-0.12, -1, 0.05], [-0.05, -1, 0.12]] } },
    { id: 'squat', name: '蹲下', torso: [0, 0.85, 0.52], legs: { l: [[0.42, -0.05, 0.9], [0, -1, -0.22]], r: [[-0.42, -0.05, 0.9], [0, -1, -0.22]] }, arms: sym([0.3, -0.55, 0.78], [0.05, -0.5, 0.86]) },
    { id: 'guard', name: '格斗架势', turn: -25, legs: { l: [[0.28, -0.93, 0.22], [0, -1, 0]], r: [[-0.28, -0.93, -0.22], [0, -1, 0]] }, arms: { l: [[0.28, -0.6, 0.75], [-0.18, 0.95, 0.25]], r: [[-0.25, -0.75, 0.6], [0.2, 0.92, 0.35]] } },
    { id: 'kick', name: '侧踢', torso: [0.25, 0.97, 0], legs: { l: [[0.06, -1, 0], [0, -1, 0]], r: [[-0.95, 0.3, 0.05], [-0.97, 0.22, 0.05]] }, arms: { l: [[0.3, -0.6, 0.75], [-0.15, 0.95, 0.25]], r: [[-0.25, -0.75, 0.6], [0.2, 0.92, 0.35]] } },
    { id: 'lean', name: '单手叉腰', legs: { l: [[0.1, -0.97, 0.18], [0, -1, -0.12]], r: [[-0.03, -1, 0], [0, -1, 0]] }, arms: only('r', [0.72, -0.62, -0.18], [-0.62, -0.62, 0.3]), turn: 15 },
    { id: 'back', name: '背面站立', turn: 180, arms: sym(...ARM_DOWN) },
    { id: 'three-quarter', name: '45° 侧身', turn: 40, arms: sym([0.12, -1, 0.05], [0.06, -1, 0.16]) },
    { id: 'side', name: '侧身站', turn: 90, arms: sym(...ARM_DOWN) },
];

/**
 * Joint positions (relative to the hip midpoint, same keys as openpose-lift's output) for a pose
 * spec, measured on the current mannequin: `rest` holds its standing joint world positions
 * (ls, le, lw, rs, re, rw, lh, lk, la, rh, rk, ra, neck, hipMid) and `restHead` its head bone.
 */
export function directionKeypoints(spec, rest, restHead) {
    const at = key => sub(rest[key], rest.hipMid);
    const kps = { hipMid: [0, 0, 0], lh: at('lh'), rh: at('rh') };
    const torso = norm(spec.torso || [0, 1, 0]);
    const restNeck = at('neck');
    const up = norm(restNeck);
    kps.neck = scale(torso, length(restNeck));
    // Shoulders and head ride on the torso: rotate their standing offsets with it.
    for (const key of ['ls', 'rs']) kps[key] = add(kps.neck, rotateOnto(up, torso, sub(at(key), restNeck)));
    const headOffset = sub(sub(restHead, rest.hipMid), restNeck);
    kps.head = add(kps.neck, spec.head ? scale(norm(spec.head), length(headOffset)) : rotateOnto(up, torso, headOffset));
    const limb = (root, mid, end, [a, b]) => {
        kps[mid] = add(kps[root], scale(norm(a), length(sub(rest[mid], rest[root]))));
        kps[end] = add(kps[mid], scale(norm(b), length(sub(rest[end], rest[mid]))));
    };
    const arms = spec.arms || sym(...ARM_DOWN), legs = spec.legs || sym(...LEG_DOWN);
    limb('ls', 'le', 'lw', arms.l); limb('rs', 're', 'rw', arms.r);
    limb('lh', 'lk', 'la', legs.l); limb('rh', 'rk', 'ra', legs.r);
    return kps;
}
