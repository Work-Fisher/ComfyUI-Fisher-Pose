import { ORDER, LIMBS, COLORS, JOINT_NAMES } from './state.mjs';
import { readPoseKeypoints, poseOverlay } from './pose-keypoints.mjs';
const clone = value => JSON.parse(JSON.stringify(value));
const NS = 'http://www.w3.org/2000/svg';
export function openPoseJSON(detection) {
    return { canvas_width: detection.width, canvas_height: detection.height, people: detection.people.map(points => ({
        pose_keypoints_2d: Array.from({ length: 18 }, (_, i) => points[ORDER[i]] ? [...points[ORDER[i]], 1] : [0, 0, 0]).flat(),
    })) };
}
export function editKeypoints(detection, photoURL, selected = 0) {
    return new Promise(resolve => {
        const dialog = document.createElement('dialog'); dialog.className = 'fp-keypoint-dialog';
        dialog.innerHTML = `<header><b>修正身体骨架</b><button data-action="cancel">取消</button><button data-action="apply" class="primary">保存修正</button></header>
          <div class="fp-keypoint-tools"><label>人物 <select data-person></select></label><label>关节 <select data-joint></select></label><button data-action="place">补点</button><button data-action="delete">删点</button><button data-action="undo">撤销</button><button data-action="reset">还原</button><button data-action="import">导入 JSON</button><button data-action="export">导出 JSON</button><button data-action="png">下载骨架</button><input data-file type="file" accept=".json,application/json" hidden></div>
          <p role="status">拖动圆点修正位置。缺失关节：选择关节后点「补点」，再点击图中位置。保存后需应用到人偶。</p><div class="fp-keypoint-canvas"></div>`;
        const $ = s => dialog.querySelector(s), svg = document.createElementNS(NS, 'svg');
        svg.style.touchAction = 'none'; $('.fp-keypoint-canvas').append(svg);
        let state = clone({ people: detection.people, width: detection.width, height: detection.height }), index = selected, joint = 'lw', placing = false, drag = null, history = [];
        function remember() { history.push(clone(state)); if (history.length > 40) history.shift(); }
        const option = (value, text) => { const el = document.createElement('option'); el.value = value; el.textContent = text; return el; };
        function menus() {
            index = Math.min(index, state.people.length - 1);
            $('[data-person]').replaceChildren(...state.people.map((_, i) => option(i, `人物 ${i + 1}`))); $('[data-person]').value = index;
            $('[data-joint]').replaceChildren(...ORDER.map(key => option(key, (JOINT_NAMES[key] || key) + (state.people[index][key] ? '' : ' · 缺失')))); $('[data-joint]').value = joint;
        }
        function element(type, attrs) { const el = document.createElementNS(NS, type); for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value); svg.append(el); return el; }
        function draw() {
            svg.replaceChildren(); svg.setAttribute('viewBox', `0 0 ${state.width} ${state.height}`);
            if (photoURL) element('image', { href: photoURL, width: state.width, height: state.height, opacity: 0.65, preserveAspectRatio: 'none' });
            state.people.forEach((points, person) => {
                LIMBS.forEach(([a, b], i) => { const from = points[ORDER[a]], to = points[ORDER[b]]; if (from && to) element('line', { x1: from[0], y1: from[1], x2: to[0], y2: to[1], stroke: COLORS[i], 'stroke-width': Math.max(2, state.width / 200), opacity: person === index ? 1 : 0.35 }); });
                for (const [key, p] of Object.entries(points)) {
                    const circle = element('circle', { cx: p[0], cy: p[1], r: Math.max(6, state.width / 80), fill: person === index && key === joint ? '#ffffff' : '#ffc54b', stroke: '#3157d5', 'stroke-width': Math.max(1, state.width / 450), 'data-key': key, 'data-person': person });
                    circle.style.cursor = 'grab';
                }
            });
        }
        function coordinates(event) { const matrix = svg.getScreenCTM(); if (!matrix) return null; const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()); return [Math.max(0, Math.min(state.width, point.x)), Math.max(0, Math.min(state.height, point.y))]; }
        svg.onpointerdown = event => {
            if (event.button !== 0) return;
            const key = event.target.dataset.key;
            if (!key && !placing) return;
            if (key) { index = Number(event.target.dataset.person); joint = key; }
            remember(); drag = event.pointerId; placing = false; svg.setPointerCapture(event.pointerId);
            state.people[index][joint] = coordinates(event); menus(); draw(); event.preventDefault();
        };
        svg.onpointermove = event => { if (drag !== event.pointerId) return; state.people[index][joint] = coordinates(event); draw(); };
        svg.onpointerup = svg.onpointercancel = () => { drag = null; };
        $('[data-person]').onchange = e => { index = Number(e.target.value); menus(); draw(); };
        $('[data-joint]').onchange = e => { joint = e.target.value; draw(); };
        function download(text, name, type) { const a = document.createElement('a'); const url = URL.createObjectURL(new Blob([text], { type })); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
        const finish = value => { dialog.close(); dialog.remove(); resolve(value); };
        const actions = {
            cancel: () => finish(null), apply: () => finish({ ...state, selected: index }),
            place: () => { placing = true; $('[role=status]').textContent = `点击图片放置：${JOINT_NAMES[joint] || joint}`; },
            delete: () => { remember(); delete state.people[index][joint]; menus(); draw(); },
            undo: () => { if (history.length) { state = history.pop(); menus(); draw(); } },
            reset: () => { remember(); state = clone({ people: detection.people, width: detection.width, height: detection.height }); menus(); draw(); },
            import: () => { $('[data-file]').value = ''; $('[data-file]').click(); },
            export: () => download(JSON.stringify(openPoseJSON(state), null, 2), 'pose-keypoints.json', 'application/json'),
            png: () => { const a = document.createElement('a'); a.href = poseOverlay(null, state); a.download = 'pose-skeleton.png'; a.click(); },
        };
        for (const button of dialog.querySelectorAll('[data-action]')) button.onclick = () => actions[button.dataset.action]();
        $('[data-file]').onchange = async event => {
            try {
                const file = event.target.files[0]; if (!file) return;
                if (file.size > 2_000_000) throw Error('JSON 文件过大');
                const raw = JSON.parse(await file.text());
                const frame = Array.isArray(raw) ? raw[0] : raw;
                const next = readPoseKeypoints({ ...frame, canvas_width: frame.canvas_width || frame.width, canvas_height: frame.canvas_height || frame.height });
                if (next.people.length > 20 || next.width > 16384 || next.height > 16384) throw Error('画布或人物数量超出范围');
                remember(); state = next; index = 0; menus(); draw();
            } catch (error) { $('[role=status]').textContent = `导入失败：${error.message}`; }
        };
        dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
        dialog.addEventListener('keydown', event => {
            event.stopPropagation();
            if (event.key === 'Delete') { event.preventDefault(); actions.delete(); }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); actions.undo(); }
        });
        document.body.append(dialog); menus(); draw(); dialog.showModal();
    });
}
