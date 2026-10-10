import { ORDER, LIMBS, COLORS } from './state.mjs';

// DWPose's POSE_KEYPOINT output uses original-image pixels, not preview PNG pixels.
export function readPoseKeypoints(data) {
    const frames = typeof data === 'string' ? JSON.parse(data) : data;
    const frame = Array.isArray(frames) ? frames[0] : frames;
    if (!frame || !Array.isArray(frame.people) || !(frame.canvas_width > 0 && frame.canvas_height > 0)) {
        throw Error('没有得到有效的关节点数据');
    }
    const people = frame.people.map(person => {
        const values = person.pose_keypoints_2d || [];
        const triples = Array.isArray(values[0]) ? values : Array.from({ length: Math.floor(values.length / 3) }, (_, i) => values.slice(i * 3, i * 3 + 3));
        // COCO-18 body (DWPose) and BODY_25 differ starting at the mid-hip slot.
        const indices = triples.length === 25 ? [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14] : ORDER.map((_, i) => i);
        const points = Object.fromEntries(ORDER.flatMap((key, i) => {
            const p = triples[indices[i]];
            return p && p[2] > 0 && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? [[key, p.slice(0, 2)]] : [];
        }));
        if (!points.neck && points.ls && points.rs) points.neck = points.ls.map((v, i) => (v + points.rs[i]) / 2);
        return points;
    }).filter(points => Object.keys(points).length);
    if (!people.length) throw Error('未识别到人物关节点，请换清晰的人物图');
    return { people, width: frame.canvas_width, height: frame.canvas_height };
}

export function largestBody(people) {
    const height = p => Math.max(...Object.values(p).map(v => v[1])) - Math.min(...Object.values(p).map(v => v[1]));
    return people.slice().sort((a, b) => height(b) - height(a))[0];
}

export function requireBody(points) {
    const missing = ORDER.filter(key => !points[key]);
    if (missing.length) throw Error('身体关节不完整，请使用头、手腕和脚踝都可见的参考图；当前人偶未改变');
    return points;
}

export const BODY_SEGMENTS = [
    ['ls', 'le', 'upperarm_l', 'lowerarm_l'], ['le', 'lw', 'lowerarm_l', 'hand_l'],
    ['rs', 're', 'upperarm_r', 'lowerarm_r'], ['re', 'rw', 'lowerarm_r', 'hand_r'],
    ['lh', 'lk', 'thigh_l', 'calf_l'], ['lk', 'la', 'calf_l', 'foot_l'],
    ['rh', 'rk', 'thigh_r', 'calf_r'], ['rk', 'ra', 'calf_r', 'foot_r'],
];

export function applicableBody(points) {
    const segments = BODY_SEGMENTS.filter(([a, b]) => points?.[a] && points?.[b]
        && Math.hypot(points[b][0] - points[a][0], points[b][1] - points[a][1]) > 1e-3);
    if (!segments.length) throw Error('未检测到可用的手臂或腿部，请换一张能看清肢体的参考图');
    return { segments, complete: ORDER.every(key => points[key]) };
}

export function poseOverlay(photo, detection) {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1200 / Math.max(detection.width, detection.height));
    canvas.width = Math.round(detection.width * scale);
    canvas.height = Math.round(detection.height * scale);
    const ctx = canvas.getContext('2d');
    if (photo) ctx.drawImage(photo, 0, 0, canvas.width, canvas.height);
    else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.lineWidth = Math.max(2, canvas.width / 220);
    ctx.lineCap = 'round';
    for (const points of detection.people) {
        LIMBS.forEach(([a, b], i) => {
            const from = points[ORDER[a]], to = points[ORDER[b]];
            if (!from || !to) return;
            ctx.strokeStyle = COLORS[i]; ctx.beginPath();
            ctx.moveTo(from[0] * scale, from[1] * scale);
            ctx.lineTo(to[0] * scale, to[1] * scale); ctx.stroke();
        });
        for (const point of Object.values(points)) {
            ctx.beginPath(); ctx.arc(point[0] * scale, point[1] * scale, Math.max(3, canvas.width / 150), 0, Math.PI * 2);
            ctx.fillStyle = '#ffcc42'; ctx.fill(); ctx.strokeStyle = '#222'; ctx.lineWidth = 1; ctx.stroke();
            ctx.lineWidth = Math.max(2, canvas.width / 220);
        }
    }
    return canvas.toDataURL('image/png');
}
