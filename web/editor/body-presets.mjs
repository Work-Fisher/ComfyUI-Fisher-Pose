// Separate shape presets: never store identity, pose, position or camera.
const KEY = 'fisher.body-presets.v1';
const copy = value => JSON.parse(JSON.stringify(value));
export function shapeRecord(person) {
    return { mesh: { ...person.mesh }, proportions: { ...person.proportions } };
}
export function createBodyPresets({ storage = localStorage, getPerson, apply, thumbnail, toast, container }) {
    let records = [];
    try { records = JSON.parse(storage.getItem(KEY) || '[]').filter(v => v.name && v.mesh && v.proportions).slice(0, 30); } catch {}
    function persist(next) {
        try { storage.setItem(KEY, JSON.stringify(next)); records = next; render(); return true; }
        catch { toast('身材保存失败：浏览器存储空间不足，请先删除旧预设'); return false; }
    }
    function render() {
        container.replaceChildren();
        if (!records.length) { const note = document.createElement('small'); note.textContent = '只保存体型和比例，不改变姿势、站位或镜头。预设保存在此浏览器。'; container.append(note); }
        for (const record of records) {
            const row = document.createElement('div'); row.className = 'fp-shape-card';
            const use = document.createElement('button'); use.type = 'button'; use.title = `套用到当前人物：${record.name}`;
            if (record.thumbnail) { const img = document.createElement('img'); img.src = record.thumbnail; img.alt = ''; use.append(img); }
            const name = document.createElement('span'); name.textContent = record.name; use.append(name);
            use.onclick = () => apply(copy(record));
            const remove = document.createElement('button'); remove.textContent = '×'; remove.title = `删除 ${record.name}`;
            remove.onclick = () => { if (confirm(`删除身材「${record.name}」？`)) persist(records.filter(item => item !== record)); };
            row.append(use, remove); container.append(row);
        }
    }
    async function save(name) {
        name = (name ?? prompt('给当前人物的身材起个名字') ?? '').trim().slice(0, 60);
        if (!name) return false;
        const exists = records.find(item => item.name === name);
        if (exists && !confirm(`覆盖身材「${name}」？`)) return false;
        if (!exists && records.length >= 30) { toast('最多保存30份身材，请先删除不需要的预设'); return false; }
        const record = { name, ...shapeRecord(getPerson()), thumbnail: await thumbnail() };
        const ok = persist([...records.filter(item => item.name !== name), record]);
        if (ok) toast(`已保存身材「${name}」`);
        return ok;
    }
    render();
    return { save, records: () => copy(records) };
}

const PAIRS = { shoulder: [['ls', 'rs']], spine: [['neck', 'hipMid']], upper_arm: [['ls', 'le'], ['rs', 're']], forearm: [['le', 'lw'], ['re', 'rw']], thigh: [['lh', 'lk'], ['rh', 'rk']], shin: [['lk', 'la'], ['rk', 'ra']] };
// Conservative opt-in estimate. 2D shortening is ambiguous: do not infer head orientation or global placement.
export function estimateProportions(points, rest, current, ranges) {
    const p = copy(points), r = copy(rest);
    for (const item of [p, r]) if (item.lh && item.rh) item.hipMid = item.lh.map((v, i) => (v + item.rh[i]) / 2);
    const length = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
    const measured = Object.entries(PAIRS).flatMap(([key, pairs]) => {
        const lengths = pairs.filter(([a, b]) => p[a] && p[b] && r[a] && r[b]).map(([a, b]) => ({ photo: length(p[a], p[b]), rig: length(r[a], r[b]) }));
        if (!lengths.length) return [];
        const longest = lengths.sort((a, b) => b.photo - a.photo)[0];
        return longest.photo > 1 && longest.rig > 0 ? [{ key, ...longest, ratio: longest.rig / longest.photo }] : [];
    });
    if (measured.length < 3) throw Error('至少需要三类清晰肢体才能估算比例；当前身材未改变');
    const ratios = measured.map(v => v.ratio).sort((a, b) => a - b), median = ratios[Math.floor(ratios.length / 2)];
    const next = { ...current };
    for (const { key, photo, rig, ratio } of measured) {
        if (ratio < median * 0.5 || ratio > median * 2) continue;
        let factor = Math.max(0.85, Math.min(1.15, photo * median / rig));
        if (factor < 1) factor = 1 + (factor - 1) * 0.5;
        next[key] = Math.max(ranges[key][0], Math.min(ranges[key][1], current[key] * factor));
    }
    return next;
}
