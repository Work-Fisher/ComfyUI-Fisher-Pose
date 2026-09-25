// Free-pose editor: one VNCCS MakeHuman mannequin. Editing uses a free orbit view;
// the output is always the VNCCS front capture (yaw 0 / pitch 0, white background,
// flat white ambient light), which is what the VNCCS_QI2_PoseStudio LoRA was trained on.
import { PoseViewerCore } from '../vnccs/vnccs_pose_studio_core.mjs';
import { loadMorphPack, solveMorph, buildStaticModelData } from '../vnccs/vnccs_pose_morph_runtime.mjs';
import { HAND_PRESETS } from '../vnccs/vnccs_hand_presets.mjs';
import { readSkeletonImage } from './pose-import.mjs';
import { liftOpenPose, WORLD_KEYPOINT_NAMES } from './openpose-lift.mjs';

const $ = selector => document.querySelector(selector);
const embedded = new URLSearchParams(location.search).has('embedded');
const INSTRUCTION = 'Draw character from image2';
const FRONT = { yaw: 0, pitch: 0 };
const CAPTURE_BACKGROUND = [255, 255, 255];
const CAPTURE_LIGHTS = [{ type: 'ambient', color: '#ffffff', intensity: 1.0 }];
const DEFAULT_MESH = { age: 25, gender: 0.5, weight: 0.5, muscle: 0.5, height: 0.5, breast_size: 0, firmness: 0.5, show_genitals: false };
const BODY_SLIDERS = [
    ['gender', '性别（女 ← → 男）', 0, 1, 0.01], ['age', '年龄', 1, 90, 1], ['height', '身高', 0, 1, 0.01],
    ['weight', '体重', 0, 1, 0.01], ['muscle', '肌肉', 0, 1, 0.01],
];
const NEUTRAL_TRANSFORM = { x: 0, y: 0, z: 0, zoom: 1 };
// Head / neck / torso / limb proportions as scale factors (1 = MakeHuman default).
const PROPORTIONS = [
    ['head', '头部大小', 0.75, 1.3], ['neck', '脖子长度', 0.5, 2],
    ['shoulder', '肩宽', 0.7, 1.4], ['spine', '躯干长度', 0.7, 1.4],
    ['upper_arm', '上臂长度', 0.6, 1.6], ['forearm', '小臂长度', 0.6, 1.6],
    ['thigh', '大腿长度', 0.6, 1.6], ['shin', '小腿长度', 0.6, 1.6],
];
const DEFAULT_PROPORTIONS = Object.fromEntries(PROPORTIONS.map(([key]) => [key, 1]));
// VNCCS bone-length groups (both sides together); the core maps a group value v to scale 0.5 + v.
const PROPORTION_GROUPS = {
    shoulder: ['shoulder_l', 'shoulder_r'], spine: ['spine'],
    upper_arm: ['upper_arm_l', 'upper_arm_r'], forearm: ['forearm_l', 'forearm_r'],
    thigh: ['thigh_l', 'thigh_r'], shin: ['shin_l', 'shin_r'],
};
// Our 2D joint names → MakeHuman bones whose head sits on that joint.
const JOINT_BONES = { ls: 'upperarm_l', le: 'lowerarm_l', lw: 'hand_l', rs: 'upperarm_r', re: 'lowerarm_r', rw: 'hand_r', lh: 'thigh_l', lk: 'calf_l', la: 'foot_l', rh: 'thigh_r', rk: 'calf_r', ra: 'foot_r' };

let doc = { mesh: { ...DEFAULT_MESH }, proportions: { ...DEFAULT_PROPORTIONS }, pose: null, transform: { ...NEUTRAL_TRANSFORM }, width: 1024, height: 1024, openpose: null };
let extraPrompt = '';
let pack = null;
let ready = false;
let selectedBoneName = null;
let previewTimer = null;
let morphTimer = null;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round16 = value => clamp(Math.round(value / 16) * 16, 64, 4096);
const promptText = () => [INSTRUCTION, ...extraPrompt.split('\n').map(line => line.trim())].filter(Boolean).join('\n');

function toast(text) {
    const element = $('#toast');
    element.textContent = text;
    element.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove('show'), 2400);
}

const canvas = $('#viewport-canvas');
const stage = $('#stage');
canvas.width = stage.clientWidth || 800;
canvas.height = stage.clientHeight || 600;
const viewer = new PoseViewerCore(canvas, {
    skinMode: 'naked',
    enableTextureSkinning: true,
    showSkeletonHelper: true,
    showCaptureFrame: true,
    syncMode: 'end',
    useHandControlPopover: false,
    captureHistoryContext: () => ({ transform: { ...doc.transform } }),
    onHistoryRestore: pose => {
        if (pose.editorState) {
            doc.transform = { ...pose.editorState.transform };
            viewer.setActiveCharacterAppearance({ transform: doc.transform });
            updateCamera(false);
        }
        refreshControls();
    },
    onBoneSelectionChange: ({ boneName }) => { selectedBoneName = boneName; refreshBoneSliders(); },
    onPoseChange: () => { refreshControls(); schedulePreview(); },
});
viewer.maxHistory = 60; // match the studio editor; VNCCS keeps only 10

function modelData(morph, staticData) {
    const bones = staticData.bones.map((bone, index) => {
        const headPos = Array.from(morph.bonePositions.subarray(index * 6, index * 6 + 3));
        const tailPos = Array.from(morph.bonePositions.subarray(index * 6 + 3, index * 6 + 6));
        return { name: bone.name, parent: bone.parent || null, headPos, tailPos, length: Math.hypot(...tailPos.map((v, i) => v - headPos[i])) };
    });
    return {
        vertices: morph.vertices, uvs: staticData.uvs, indices: staticData.indices, bones,
        skinIndices: staticData.skinIndices, skinWeights: staticData.skinWeights,
        landmarks: morph.landmarks || {}, landmark_indices: morph.landmarkIndices || {},
    };
}

// Absolute IK positions depend on bone lengths, so a body-shape change keeps only rotations.
function rotationsOnly(pose) {
    const { bonePositions, ikEffectorPositions, poleTargetPositions, hipBonePosition, camera, cameraParams, ...rest } = pose || {};
    return rest;
}

function savedPose() {
    const { camera, cameraParams, ...pose } = viewer.getPose();
    return pose;
}

// The core has no neck group, so the neck scales the head bone's offset from neck_01
// the same way its limb groups scale child offsets, and caches it as the new rest.
function applyNeck() {
    viewer._setBoneOffsetScale('head', doc.proportions.neck);
    for (const bone of viewer.boneList) bone.updateMatrixWorld(true);
    viewer.skeleton?.update();
    viewer._cacheShapedRestBonePositions(['head']);
    viewer.updateIKEffectorPositions?.();
    viewer.requestRender();
}

function setProportion(key, value) {
    doc.proportions = { ...doc.proportions, [key]: value };
    if (key === 'head') viewer.updateHeadScale(value);
    else if (key === 'neck') applyNeck();
    else for (const group of PROPORTION_GROUPS[key]) viewer.updateBoneLengthScale(group, value - 0.5);
}

// resetPose() restores the core's own groups but not our neck offset.
function resetPose() {
    viewer.resetPose();
    applyNeck();
}

function loadModel(pose) {
    const morph = solveMorph(pack, doc.mesh);
    viewer.setSkinMode('naked');
    // loadData() applies these cached scales while it builds the new rig.
    viewer.headScale = doc.proportions.head;
    viewer.boneLengthParams = {
        ...viewer.boneLengthParams,
        ...Object.fromEntries(Object.entries(PROPORTION_GROUPS).flatMap(([key, groups]) => groups.map(group => [group, doc.proportions[key] - 0.5]))),
    };
    viewer.loadData(modelData(morph, buildStaticModelData(pack, morph.includeGenitals)), true);
    applyNeck();
    viewer.updateLights(CAPTURE_LIGHTS);
    if (pose) viewer.setPose(pose, true);
    viewer.setActiveCharacterAppearance({ color: '#ffffff', transform: doc.transform });
}

// The capture camera never moves; `snap` also brings the free editing view back to it.
function updateCamera(snap) {
    const args = [doc.width, doc.height, 1, 0, 0, FRONT.yaw, FRONT.pitch];
    if (snap) viewer.snapToCaptureCamera(...args);
    else viewer.updateCaptureCamera(...args);
    refreshControls();
    schedulePreview();
}

function fitFrame(snap = false) {
    viewer.setActiveCharacterAppearance({ transform: NEUTRAL_TRANSFORM });
    const framing = viewer.computeModelFitFraming(doc.width, doc.height, FRONT.yaw, FRONT.pitch, 0.08);
    const pivot = viewer.sceneCameraTarget;
    if (framing && pivot) {
        const zoom = framing.zoom;
        doc.transform = {
            x: clamp((1 - zoom) * pivot.x + zoom * framing.offsetX, -50, 50),
            y: clamp((1 - zoom) * pivot.y + zoom * framing.offsetY, -50, 50),
            z: clamp((1 - zoom) * pivot.z, -40, 40),
            zoom,
        };
    }
    viewer.setActiveCharacterAppearance({ transform: doc.transform });
    updateCamera(snap);
}

function capture(width, height) {
    viewer.updateLights(CAPTURE_LIGHTS);
    return viewer.capture(width, height, 1, CAPTURE_BACKGROUND, 0, 0, FRONT.yaw, FRONT.pitch);
}

function schedulePreview() {
    if (!ready) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
        await viewer.waitForCaptureReady();
        const scale = Math.min(1, 480 / Math.max(doc.width, doc.height));
        const url = capture(Math.round(doc.width * scale), Math.round(doc.height * scale));
        if (url) { $('#capture-preview').src = url; $('#inset-preview').src = url; }
    }, 300);
}

// --- OpenPose one-click posing ---------------------------------------------

const worldOf = name => viewer.bones[name].getWorldPosition(new viewer.THREE.Vector3()).toArray();

function restJoints() {
    const rest = Object.fromEntries(Object.entries(JOINT_BONES).map(([key, bone]) => [key, worldOf(bone)]));
    rest.neck = rest.ls.map((v, i) => (v + rest.rs[i]) / 2);
    rest.hipMid = rest.lh.map((v, i) => (v + rest.rh[i]) / 2);
    return { rest, head: worldOf('head'), pelvis: worldOf('pelvis') };
}

function applyOpenPose() {
    const { points, flips } = doc.openpose;
    viewer.recordState();
    doc.transform = { ...NEUTRAL_TRANSFORM };
    viewer.setActiveCharacterAppearance({ transform: doc.transform });
    resetPose();
    viewer.skinnedMesh.updateMatrixWorld(true);
    const { rest, head, pelvis } = restJoints();
    const { kps, facingAway } = liftOpenPose(points, rest, flips);
    // The spine IK target is the head bone origin, not the nose: keep the nose direction at head-bone distance.
    const headDistance = Math.hypot(...head.map((v, i) => v - rest.neck[i]));
    const direction = kps.head.map((v, i) => v - kps.neck[i]);
    const norm = Math.hypot(...direction) || 1;
    kps.head = kps.neck.map((v, i) => v + direction[i] / norm * headDistance);
    const THREE = viewer.THREE;
    const worldKps = Object.fromEntries(Object.entries(WORLD_KEYPOINT_NAMES).map(([key, name]) => [name, new THREE.Vector3(...kps[key].map((v, i) => v + pelvis[i]))]));
    // Hip sockets, head, hands and feet have no reliable 2D source; keep the mannequin's own.
    viewer.applyWorldKeypointImport(worldKps, { drawFigure: false, placeHipRoots: false, alignHead: false, alignHands: false, alignFeet: false, dispatchPoseChange: false });
    fitFrame(true);
    refreshFlips(facingAway);
    return facingAway;
}

async function importEntry(entry) {
    const status = $('#import-status');
    for (const button of document.querySelectorAll('.fp-thumb')) button.classList.toggle('active', button.dataset.key === entry.key);
    const label = entry.key.startsWith('builtin:') ? `${SOURCE_NAMES.builtin} ${entryLabel(entry)}` : entry.name;
    try {
        const image = new Image();
        image.src = entry.url;
        await image.decode();
        const people = readSkeletonImage(image);
        // Single-person editor: take the tallest skeleton.
        const height = person => Math.max(...Object.values(person).map(p => p[1])) - Math.min(...Object.values(person).map(p => p[1]));
        const person = people.slice().sort((a, b) => height(b) - height(a))[0];
        doc.openpose = { key: entry.key, name: label, points: person, flips: {} };
        const facingAway = applyOpenPose();
        const notes = [facingAway ? '识别为背面' : '识别为正面'];
        if (people.length > 1) notes.push(`图中 ${people.length} 人，已取最大的一个`);
        if (people.warnings?.length) notes.push('遮挡关节已近似补全');
        status.textContent = `已按「${label}」摆好：${notes.join('，')}。前后不对可用下方深度修正。`;
    } catch (error) {
        entry.failed = true;
        document.querySelector(`.fp-thumb[data-key="${CSS.escape(entry.key)}"]`)?.classList.add('failed');
        status.textContent = `「${label}」无法识别：${error.message}`;
    }
}

function refreshFlips(facingAway) {
    $('#depth-section').hidden = !doc.openpose;
    const flips = doc.openpose?.flips || {};
    for (const button of document.querySelectorAll('[data-flip]')) button.classList.toggle('on', Boolean(flips[button.dataset.flip]));
    if (facingAway !== undefined) $('[data-flip=body]').textContent = facingAway ? '背面 → 改正面' : '正面 → 改背面';
}

for (const button of document.querySelectorAll('[data-flip]')) {
    button.onclick = () => {
        if (!doc.openpose) return;
        const key = button.dataset.flip;
        doc.openpose.flips = { ...doc.openpose.flips, [key]: !doc.openpose.flips[key] };
        applyOpenPose();
    };
}

// Two sources: the plugin's built-in FISHER小彩蛋 skeletons (read-only) and the user's
// library in input/fisher_openpose (see openpose_library.py), which survives reopening
// the editor. Standalone (no ComfyUI server) the library only lasts for this page.
const LIBRARY_URL = '/fisher_pose/openpose_library';
const BUILTIN_URL = '/fisher_pose/builtin_poses';
const SOURCE_NAMES = { builtin: 'FISHER小彩蛋', library: '我的图库' };
const galleries = { builtin: [], library: [] };
let gallerySource = 'builtin';
let libraryAvailable = false;
const byName = (a, b) => a.name.localeCompare(b.name, 'zh', { numeric: true });
const entryLabel = entry => entry.name.replace(/_bone_structure|\.(png|jpe?g|webp)$/gi, '');

function renderGallery() {
    const gallery = galleries[gallerySource];
    const filter = $('#gallery-filter').value.trim().toLowerCase();
    const shown = gallery.filter(entry => entry.name.toLowerCase().includes(filter));
    const container = $('#gallery');
    container.replaceChildren(...shown.map(entry => {
        const button = document.createElement('button');
        button.className = 'fp-thumb' + (entry.failed ? ' failed' : '') + (doc.openpose?.key === entry.key ? ' active' : '');
        button.dataset.key = entry.key;
        button.title = entry.name;
        button.innerHTML = `<img loading="lazy" alt=""><span></span>`;
        button.querySelector('img').src = entry.url;
        button.querySelector('span').textContent = entryLabel(entry);
        button.onclick = () => importEntry(entry);
        return button;
    }));
    for (const button of document.querySelectorAll('#gallery-source button')) {
        button.classList.toggle('active', button.dataset.source === gallerySource);
        button.textContent = `${SOURCE_NAMES[button.dataset.source]} ${galleries[button.dataset.source].length || ''}`.trim();
    }
    $('#gallery-count').textContent = gallery.length && filter ? `${shown.length} / ${gallery.length}` : '';
    $('#gallery-filter').hidden = gallery.length < 2;
    $('#clear-gallery').hidden = gallerySource !== 'library' || !libraryAvailable || !gallery.length;
    if (!gallery.length) container.innerHTML = gallerySource === 'builtin'
        ? '<p class="muted">内置骨架图需要在 ComfyUI 中打开编辑器才能读取。</p>'
        : '<p class="muted">选 OpenPose 骨架图（黑底彩色），点缩略图即摆好姿势。也可把图片拖到这里。选过的图会存入图库，下次打开自动载入。</p>';
}

for (const button of document.querySelectorAll('#gallery-source button')) {
    button.onclick = () => { gallerySource = button.dataset.source; renderGallery(); };
}

async function loadBuiltin() {
    try {
        const response = await fetch(BUILTIN_URL, { cache: 'no-store' });
        if (!response.ok) return;
        const { files } = await response.json();
        galleries.builtin = files.map(name => ({ key: 'builtin:' + name, name, url: `${BUILTIN_URL}/${encodeURIComponent(name)}` }));
        renderGallery();
    } catch { /* standalone preview without the ComfyUI server */ }
}

async function loadLibrary() {
    try {
        const response = await fetch(LIBRARY_URL, { cache: 'no-store' });
        if (!response.ok) return;
        const { subfolder, files } = await response.json();
        libraryAvailable = true;
        galleries.library = files.map(name => ({ key: 'library:' + name, name, url: '/view?' + new URLSearchParams({ filename: name, subfolder, type: 'input' }) })).sort(byName);
        renderGallery();
    } catch { /* standalone preview without the ComfyUI server */ }
}

async function uploadToLibrary(images) {
    const status = $('#import-status');
    let done = 0, failed = 0;
    const queue = images.slice();
    const worker = async () => {
        for (let file = queue.shift(); file; file = queue.shift()) {
            const form = new FormData();
            form.append('image', file, file.name);
            form.append('subfolder', 'fisher_openpose');
            form.append('type', 'input');
            form.append('overwrite', 'true');
            try { if (!(await fetch('/upload/image', { method: 'POST', body: form })).ok) failed++; }
            catch { failed++; }
            status.textContent = `正在存入图库 ${++done} / ${images.length}…`;
        }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    await loadLibrary();
    status.textContent = failed ? `${failed} 张未能存入图库` : '';
    toast(`已存入我的图库 ${images.length - failed} 张，下次打开无需重新选择`);
}

async function addFiles(files) {
    const images = [...files].filter(file => file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name));
    if (!images.length) { toast('没有找到图片'); return; }
    gallerySource = 'library';
    if (libraryAvailable) { await uploadToLibrary(images); return; }
    for (const entry of galleries.library) URL.revokeObjectURL(entry.url);
    galleries.library = images.map(file => ({ key: 'library:' + file.name, name: file.name, url: URL.createObjectURL(file) })).sort(byName);
    renderGallery();
    toast(`已载入 ${galleries.library.length} 张骨架图，点缩略图即可摆姿`);
}

$('#clear-gallery').onclick = async () => {
    if (!libraryAvailable || !confirm(`清空我的图库中的 ${galleries.library.length} 张骨架图？\n（删除 ComfyUI/input/fisher_openpose 里的副本，原文件夹和 FISHER小彩蛋 不受影响）`)) return;
    await fetch(LIBRARY_URL + '/clear', { method: 'POST' });
    await loadLibrary();
    toast('我的图库已清空');
};

for (const id of ['#pick-folder', '#pick-files']) {
    const input = $(id);
    input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });
    // Inside the ComfyUI modal, let the host page open the picker (same as the studio editor).
    input.addEventListener('click', event => {
        const chooseInHost = window.frameElement?.fisherChooseFiles;
        if (!chooseInHost) return;
        event.preventDefault();
        try { chooseInHost(addFiles, { directory: id === '#pick-folder' }); }
        catch { toast('文件窗口未能打开，请把图片拖到左侧'); }
    });
}
$('#gallery-filter').addEventListener('input', renderGallery);
const galleryBox = $('#gallery');
galleryBox.addEventListener('dragover', event => { event.preventDefault(); galleryBox.classList.add('drag'); });
galleryBox.addEventListener('dragleave', () => galleryBox.classList.remove('drag'));
galleryBox.addEventListener('drop', event => { event.preventDefault(); galleryBox.classList.remove('drag'); addFiles(event.dataTransfer.files); });

// --- 我的姿势: whole editor states saved on the server (see saved_poses.py) ---

const SAVED_URL = '/fisher_pose/saved_poses';
let savedPoses = [];
let savedAvailable = false;
let activeSavedName = null;

function renderSaved() {
    const container = $('#saved-poses');
    $('#save-pose').disabled = !savedAvailable;
    $('#saved-count').textContent = savedPoses.length ? `${savedPoses.length} 个` : '';
    if (!savedAvailable) { container.innerHTML = '<p class="muted">在 ComfyUI 中打开编辑器才能保存姿势。</p>'; return; }
    if (!savedPoses.length) { container.innerHTML = '<p class="muted">摆好的姿势点上面的按钮存下来，下次打开点缩略图就能恢复，换工作流也能用。</p>'; return; }
    container.replaceChildren(...savedPoses.map(entry => {
        const button = document.createElement('button');
        button.className = 'fp-thumb' + (entry.name === activeSavedName ? ' active' : '');
        button.title = `${entry.name}\n点击载入`;
        button.innerHTML = '<img alt=""><span></span><i class="fp-delete" title="删除">×</i>';
        button.querySelector('img').src = entry.thumbnail;
        button.querySelector('span').textContent = entry.name;
        button.onclick = event => (event.target.closest('.fp-delete') ? deleteSavedPose(entry) : loadSavedPose(entry));
        return button;
    }));
}

async function loadSavedList() {
    try {
        const response = await fetch(SAVED_URL, { cache: 'no-store' });
        if (response.ok) {
            savedPoses = (await response.json()).poses;
            savedAvailable = true;
        }
    } catch { /* standalone preview without the ComfyUI server */ }
    renderSaved();
}

// Named after the OpenPose image it came from when there is one, else 姿势 N; never an existing name.
function defaultPoseName() {
    const taken = new Set(savedPoses.map(entry => entry.name));
    const base = doc.openpose?.name ? doc.openpose.name.replace(/[\\/:*?"<>|]/g, ' ').trim() : '姿势';
    if (doc.openpose?.name && !taken.has(base)) return base;
    for (let n = savedPoses.length + 1; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

const postPose = (name, record, overwrite) => fetch(SAVED_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, record, overwrite }),
});

async function saveCurrentPose(presetName) {
    if (!savedAvailable || !ready) return;
    const name = (typeof presetName === 'string' ? presetName : prompt('给这个姿势起个名字', defaultPoseName()))?.trim();
    if (!name) return;
    await viewer.waitForCaptureReady();
    const scale = 256 / Math.max(doc.width, doc.height);
    const thumbnail = capture(Math.round(doc.width * scale), Math.round(doc.height * scale));
    updateCamera(false);
    const record = {
        version: 1, thumbnail,
        doc: { ...doc, pose: savedPose() },
        grips: { l: Number($('#grip-l').value), r: Number($('#grip-r').value) },
    };
    try {
        let response = await postPose(name, record, false);
        if (response.status === 409) {
            if (!confirm(`已有名为「${name}」的姿势，要覆盖吗？`)) return;
            response = await postPose(name, record, true);
        }
        const result = await response.json();
        if (!response.ok) { toast(result.error || '保存失败'); return; }
        activeSavedName = result.name;
        await loadSavedList();
        toast(`已保存「${result.name}」`);
    } catch { toast('保存失败：连不上 ComfyUI'); }
}

async function loadSavedPose(entry) {
    try {
        const response = await fetch(`${SAVED_URL}/${encodeURIComponent(entry.name)}`, { cache: 'no-store' });
        if (!response.ok) { toast('这个姿势已经不存在了'); await loadSavedList(); return; }
        const record = await response.json();
        viewer.recordState();
        doc = docFrom(record.doc);
        loadModel(doc.pose);
        for (const side of ['l', 'r']) $(`#grip-${side}`).value = record.grips?.[side] ?? 0;
        updateCamera(true);
        refreshFlips();
        activeSavedName = entry.name;
        for (const button of document.querySelectorAll('#gallery .fp-thumb')) button.classList.toggle('active', button.dataset.key === doc.openpose?.key);
        renderSaved();
        $('#import-status').textContent = `已载入「${entry.name}」。`;
    } catch (error) { toast(`载入失败：${error.message}`); }
}

async function deleteSavedPose(entry, skipConfirm = false) {
    if (!skipConfirm && !confirm(`删除姿势「${entry.name}」？`)) return;
    try {
        await fetch(`${SAVED_URL}/${encodeURIComponent(entry.name)}/delete`, { method: 'POST' });
        if (activeSavedName === entry.name) activeSavedName = null;
        await loadSavedList();
        toast(`已删除「${entry.name}」`);
    } catch { toast('删除失败：连不上 ComfyUI'); }
}

$('#save-pose').onclick = () => saveCurrentPose();

// --- Viewport interaction: our editor's feel on top of the VNCCS core -------

function setupInteraction() {
    const THREE = viewer.THREE;
    viewer.orbit.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
    // Shift+drag moves the person inside the front frame; it must pre-empt orbit and bone picking.
    canvas.addEventListener('pointerdown', event => {
        if (event.button !== 0 || !event.shiftKey || !ready) return;
        event.stopImmediatePropagation();
        event.preventDefault();
        viewer.recordState();
        const camera = viewer.camera;
        const distance = camera.position.distanceTo(viewer.orbit.target);
        const perPixel = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / (canvas.clientHeight * camera.zoom);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
        const start = { x: event.clientX, y: event.clientY, transform: { ...doc.transform } };
        const move = moveEvent => {
            const delta = right.clone().multiplyScalar((moveEvent.clientX - start.x) * perPixel)
                .add(up.clone().multiplyScalar(-(moveEvent.clientY - start.y) * perPixel));
            doc.transform = { ...start.transform, x: clamp(start.transform.x + delta.x, -50, 50), y: clamp(start.transform.y + delta.y, -50, 50) };
            viewer.setActiveCharacterAppearance({ transform: doc.transform });
            refreshControls();
        };
        const end = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); schedulePreview(); };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end);
    }, { capture: true });
    // Runs after the core's own handler: if it grabbed a joint, the drag must not also orbit.
    canvas.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        if (viewer.directDrag?.active || viewer.selectedBone || viewer.selectedIKEffector || viewer.selectedPoleTarget || viewer.transform?.dragging) {
            viewer.orbit.enabled = false;
            window.addEventListener('pointerup', () => { viewer.orbit.enabled = true; }, { once: true });
        }
    });
}

// --- Controls ---------------------------------------------------------------

const setOutput = (id, text) => { $(`#${id}-value`).textContent = text; };

function refreshBoneSliders() {
    const bone = selectedBoneName && viewer.bones?.[selectedBoneName];
    $('#bone-name').textContent = bone ? selectedBoneName : '未选择';
    $('#bone-sliders').classList.toggle('fp-disabled', !bone);
    for (const axis of ['x', 'y', 'z']) {
        const degrees = bone ? Math.round(bone.rotation[axis] * 180 / Math.PI) : 0;
        $(`#r${axis}`).value = degrees;
        setOutput(`r${axis}`, bone ? `${degrees}°` : '—');
    }
}

function refreshControls() {
    $('#zoom').value = doc.transform.zoom; setOutput('zoom', doc.transform.zoom.toFixed(2));
    $('#tx').value = doc.transform.x; setOutput('tx', doc.transform.x.toFixed(1));
    $('#ty').value = doc.transform.y; setOutput('ty', doc.transform.y.toFixed(1));
    const turn = Math.round(viewer.modelRotation?.y || 0);
    $('#turn').value = turn; setOutput('turn', `${turn}°`);
    $('#output-width').value = doc.width;
    $('#output-height').value = doc.height;
    $('#preview-size').textContent = `${doc.width}×${doc.height}`;
    for (const button of document.querySelectorAll('#ratios button')) {
        const [a, b] = button.dataset.ratio.split(':').map(Number);
        button.classList.toggle('active', Math.abs(doc.width / doc.height - a / b) < 0.02);
    }
    for (const [key] of BODY_SLIDERS) {
        const input = $(`#body-${key}`);
        if (input) { input.value = doc.mesh[key]; setOutput(`body-${key}`, key === 'age' ? String(doc.mesh[key]) : Number(doc.mesh[key]).toFixed(2)); }
    }
    for (const side of ['l', 'r']) setOutput(`grip-${side}`, Number($(`#grip-${side}`).value).toFixed(2));
    for (const [key] of PROPORTIONS) {
        const input = $(`#prop-${key}`);
        if (input) { input.value = doc.proportions[key]; setOutput(`prop-${key}`, `${Math.round(doc.proportions[key] * 100)}%`); }
    }
    $('#description').textContent = promptText();
    refreshBoneSliders();
}

// One undo entry per slider gesture: record before the first input event.
function bindSlider(input, onValue) {
    let gesture = false;
    input.addEventListener('input', () => {
        if (!gesture && ready) { viewer.recordState(); gesture = true; }
        onValue(Number(input.value));
    });
    input.addEventListener('change', () => { gesture = false; });
}

for (const [id, key] of [['zoom', 'zoom'], ['tx', 'x'], ['ty', 'y']]) {
    bindSlider($(`#${id}`), value => {
        doc.transform = { ...doc.transform, [key]: value };
        viewer.setActiveCharacterAppearance({ transform: doc.transform });
        refreshControls(); schedulePreview();
    });
}
const turnTo = value => { viewer.setModelRotation(0, value, 0); refreshControls(); schedulePreview(); };
bindSlider($('#turn'), turnTo);
for (const button of document.querySelectorAll('[data-turn]')) button.onclick = () => { viewer.recordState(); turnTo(Number(button.dataset.turn)); };
for (const axis of ['x', 'y', 'z']) {
    bindSlider($(`#r${axis}`), value => {
        const bone = viewer.bones?.[selectedBoneName];
        if (!bone) return;
        bone.rotation[axis] = value * Math.PI / 180;
        bone.updateMatrixWorld(true);
        viewer.updateIKEffectorPositions?.();
        viewer.updateMarkers?.();
        viewer.requestRender();
        setOutput(`r${axis}`, `${value}°`);
        schedulePreview();
    });
}
for (const button of document.querySelectorAll('[data-preset]')) {
    button.onclick = () => {
        viewer.applyHandPreset(button.dataset.hand, HAND_PRESETS[button.dataset.preset]);
        $(`#grip-${button.dataset.hand}`).value = button.dataset.preset === 'FIST' ? 1 : 0;
        refreshControls(); schedulePreview();
    };
}
for (const side of ['l', 'r']) {
    bindSlider($(`#grip-${side}`), value => {
        viewer.interpolateHandPose(HAND_PRESETS.OPEN, HAND_PRESETS.FIST, value, side);
        refreshControls(); schedulePreview();
    });
}
$('#snap-view').onclick = () => updateCamera(true);
$('#fit-frame').onclick = $('#fit-frame-2').onclick = () => { viewer.recordState(); fitFrame(); };
$('#reset-bone').onclick = () => { viewer.recordState(); viewer.resetSelectedBone(); refreshControls(); schedulePreview(); };
$('#reset-pose').onclick = () => { viewer.recordState(); resetPose(); doc.openpose = null; refreshFlips(); refreshControls(); schedulePreview(); };
$('#undo').onclick = () => viewer.undo();
$('#redo').onclick = () => viewer.redo();

function setSize(width, height) {
    doc.width = round16(width);
    doc.height = round16(height);
    updateCamera(false);
}
$('#output-width').onchange = event => setSize(Number(event.target.value) || doc.width, doc.height);
$('#output-height').onchange = event => setSize(doc.width, Number(event.target.value) || doc.height);
for (const button of document.querySelectorAll('#ratios button')) {
    button.onclick = () => {
        const [a, b] = button.dataset.ratio.split(':').map(Number);
        const longSide = Math.max(doc.width, doc.height);
        setSize(a >= b ? longSide : longSide * a / b, a >= b ? longSide * b / a : longSide);
    };
}

const bodyContainer = $('#body-sliders');
for (const [key, label, min, max, step] of BODY_SLIDERS) {
    bodyContainer.insertAdjacentHTML('beforeend', `<label class="slider-label">${label}<output id="body-${key}-value"></output></label><input id="body-${key}" type="range" min="${min}" max="${max}" step="${step}">`);
    $(`#body-${key}`).addEventListener('input', event => {
        doc.mesh = { ...doc.mesh, [key]: Number(event.target.value) };
        refreshControls();
        clearTimeout(morphTimer);
        morphTimer = setTimeout(() => { loadModel(rotationsOnly(viewer.getPose())); updateCamera(false); }, 120);
    });
}
$('#reset-body').onclick = () => { doc.mesh = { ...DEFAULT_MESH }; loadModel(rotationsOnly(viewer.getPose())); updateCamera(false); };

const proportionContainer = $('#proportion-sliders');
for (const [key, label, min, max] of PROPORTIONS) {
    proportionContainer.insertAdjacentHTML('beforeend', `<label class="slider-label">${label}<output id="prop-${key}-value"></output></label><input id="prop-${key}" type="range" min="${min}" max="${max}" step="0.01">`);
    $(`#prop-${key}`).addEventListener('input', event => {
        setProportion(key, Number(event.target.value));
        refreshControls();
        schedulePreview();
    });
}
$('#reset-proportions').onclick = () => {
    for (const [key] of PROPORTIONS) setProportion(key, 1);
    refreshControls();
    schedulePreview();
};

for (const button of document.querySelectorAll('.panel-tabs button')) {
    button.onclick = () => {
        for (const other of document.querySelectorAll('.panel-tabs button')) other.classList.toggle('active', other === button);
        for (const tab of ['output', 'pose', 'body', 'proportion']) $(`#${tab}-panel`).hidden = tab !== button.dataset.tab;
    };
}
$('#extra-prompt').addEventListener('input', event => { extraPrompt = event.target.value; refreshControls(); });
$('#copy-description').onclick = async () => { try { await navigator.clipboard.writeText(promptText()); toast('已复制'); } catch { toast('复制失败'); } };

document.addEventListener('keydown', event => {
    if (event.target.closest?.('textarea, input[type=number], input[type=search]')) return;
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) { event.preventDefault(); viewer.undo(); }
    else if ((key === 'z' && event.shiftKey) || key === 'y') { event.preventDefault(); viewer.redo(); }
});
new ResizeObserver(() => viewer.resize(stage.clientWidth, stage.clientHeight)).observe(stage);

// --- Node bridge ------------------------------------------------------------

async function serialize() {
    await viewer.waitForCaptureReady();
    const poseReference = capture(doc.width, doc.height);
    updateCamera(false);
    doc.pose = savedPose();
    return JSON.stringify({ version: 2, kind: 'vnccs-free-pose', ...doc, camera: FRONT, poseReference });
}

// Shared by the node payload and 我的姿势: any saved editor state → a complete doc.
function docFrom(saved) {
    return {
        mesh: { ...DEFAULT_MESH, ...saved.mesh, breast_size: 0 }, pose: saved.pose || null, // flat chest is fixed
        proportions: { ...DEFAULT_PROPORTIONS, ...saved.proportions },
        transform: { ...NEUTRAL_TRANSFORM, ...saved.transform },
        // The mannequin size lives only here; the node's width/height are the separate output size.
        width: round16(Number(saved.width) || doc.width), height: round16(Number(saved.height) || doc.height),
        openpose: saved.openpose || null,
    };
}

function applyPayload(payload) {
    const saved = JSON.parse(payload.pose_json || '{}');
    const restored = saved.kind === 'vnccs-free-pose';
    if (restored) doc = docFrom(saved);
    extraPrompt = payload.extra_prompt || '';
    $('#extra-prompt').value = extraPrompt;
    if (payload.referencePreview) {
        $('#person-preview').src = payload.referencePreview;
        $('#person-preview-wrap').hidden = false;
    }
    return restored;
}

let pendingPayload = null;
async function start(payload) {
    const restored = payload ? applyPayload(payload) : false;
    loadModel(doc.pose);
    setupInteraction();
    ready = true;
    if (restored) updateCamera(true);
    else fitFrame(true);
    refreshFlips();
    void loadBuiltin();
    void loadLibrary();
    void loadSavedList();
    await viewer.waitForCaptureReady();
    $('#loading').hidden = true;
    $('#apply-editor').disabled = false;
    $('#save-status').textContent = restored ? '已载入节点中的姿势' : '新姿势：可用左侧 OpenPose 图一键摆姿';
    schedulePreview();
}

window.addEventListener('message', event => {
    if (event.source !== parent || event.origin !== location.origin || event.data?.type !== 'fisher-load') return;
    if (pack) start(event.data.payload).catch(showError);
    else pendingPayload = event.data.payload;
});
$('#cancel-editor').onclick = () => parent.postMessage({ type: 'fisher-close' }, location.origin);
$('#apply-editor').onclick = async () => {
    $('#apply-editor').disabled = true;
    try {
        const pose_json = await serialize();
        parent.postMessage({ type: 'fisher-apply', payload: { pose_json, extra_prompt: extraPrompt } }, location.origin);
    } catch (error) { showError(error); }
    finally { $('#apply-editor').disabled = false; }
};

function showError(error) {
    console.error(error);
    $('#loading-text').textContent = '加载失败：' + (error?.message || error);
    $('#loading').hidden = false;
}

if (!embedded) { $('#apply-editor').hidden = true; $('#cancel-editor').hidden = true; }
window.freePose = { viewer, get doc() { return doc; }, serialize, prompt: promptText, fitFrame, importEntry, addFiles, saveCurrentPose, loadSavedPose, deleteSavedPose };

(async () => {
    await viewer.init();
    if (!viewer.initialized) throw new Error('WebGL 初始化失败');
    // The official QI2.1 workflow runs with the skydome disabled; it would otherwise be captured.
    viewer.setDirectionalSkydomeVisible(false);
    refreshControls();
    if (embedded) parent.postMessage({ type: 'fisher-ready' }, location.origin);
    pack = await loadMorphPack();
    if (embedded && !pendingPayload) return; // start() runs when the node payload arrives
    await start(pendingPayload);
})().catch(showError);
