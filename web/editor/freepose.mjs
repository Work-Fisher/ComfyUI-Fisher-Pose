import { loadBodyPack } from './body-pack.mjs?v=20261010-feedback2';
// Free-pose editor: one VNCCS MakeHuman mannequin. Editing uses a free orbit view;
// the output is always the VNCCS front capture (yaw 0 / pitch 0, white background,
// flat white ambient light), which is what the VNCCS_QI2_PoseStudio LoRA was trained on.
import { PoseViewerCore } from '../vnccs/vnccs_pose_studio_core.mjs?v=20261005-skeleton1';
import { solveMorph, buildStaticModelData } from '../vnccs/vnccs_pose_morph_runtime.mjs';
import { HAND_PRESETS } from '../vnccs/vnccs_hand_presets.mjs';
import { readSkeletonImage } from './pose-import.mjs';
import { readPoseKeypoints, largestBody, applicableBody, poseOverlay } from './pose-keypoints.mjs?v=20261010-feedback2';
import { liftOpenPose, WORLD_KEYPOINT_NAMES } from './openpose-lift.mjs';
import { COMMON_POSES, directionKeypoints } from './common-poses.mjs';
import { isGroupPose, bindingRuntimeProblem } from '../binding_runtime.mjs';
import { reconcilePortraits } from '../portrait_inputs.mjs';
import { DEFAULT_FRAMING, frontFraming, isTurned, outputShot } from './framing.mjs?v=20261010-feedback2';

const $ = selector => document.querySelector(selector);
const embedded = new URLSearchParams(location.search).has('embedded');
const INSTRUCTION = 'Draw character from image2. Repose the person in image2 to match image1. Preserve their appearance and the scene.';
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
const NO_NEW_ANGLE = { enabled: false, yaw: 0, pitch: 0, zoom: 1, offsetX: 0, offsetY: 0 };
let studio = { camera: false, canGenerate: false, canOpenWorkflow: false };
let editMode = 'pose';
let previewRevision = 0;
let autoFitTimer = null;
let fitting = false;
let doc = { mesh: { ...DEFAULT_MESH }, proportions: { ...DEFAULT_PROPORTIONS }, pose: null, transform: { ...NEUTRAL_TRANSFORM }, width: 1024, height: 1024, openpose: null, referenceMode: 'group', swapPeople: false, outputSkeleton: true, autoFit: true, framing: { ...DEFAULT_FRAMING }, anyAngle: { ...NO_NEW_ANGLE } };
let extraPrompt = '';
let pack = null;
let ready = false;
let selectedBoneName = null;
let previewTimer = null;
let morphTimer = null;
let personAspect = null; // width / height of the connected person photo, when known
let posePhoto = null;
let detectingPose = false;
let secondReferenceConnected = false;
let personPreviewUrls = [null, null]; // person photos wired to image2 / image3, when the node has them

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round16 = value => clamp(Math.round(value / 16) * 16, 64, 4096);
// Mirrors free_pose.py instruction(): two people are named by the side they stand on.
function instructionText() {
    if (!doc.people) return INSTRUCTION;
    const xs = doc.people.map((person, index) => (index === doc.active ? doc.transform : person.transform).x);
    const [first, second] = xs[0] <= xs[1] ? ['left', 'right'] : ['right', 'left'];
    if (doc.referenceMode === 'group') {
        // Keep the prompt consistent with the visible source-photo identity labels.
        const [sourceFirst, sourceSecond] = doc.swapPeople ? ['right', 'left'] : ['left', 'right'];
        const [leftSource, rightSource] = first === 'left' ? [sourceFirst, sourceSecond] : [sourceSecond, sourceFirst];
        const order = leftSource === 'left' ? 'Keep' : 'Exchange';
        return `Draw character from image2. Repose the existing two people in image2 to match image1. ${order} their left-to-right order: the person on the viewer's ${leftSource} in image2 takes the left mannequin pose in image1; the person on the viewer's ${rightSource} takes the right mannequin pose. Preserve their appearances and the scene.`;
    }
    return `Draw the ${first} character from image2 in the pose of the ${first} mannequin in image1, and the ${second} character from image3 in the pose of the ${second} mannequin in image1.`;
}
const SKELETON_GUIDE_INSTRUCTION = 'The colored skeleton lines and joint markers in image1 are pose guides only; omit them from the finished image.';
const promptText = () => [instructionText(), doc.outputSkeleton ? SKELETON_GUIDE_INSTRUCTION : '', ...extraPrompt.split('\n').map(line => line.trim())].filter(Boolean).join('\n');

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

// Preview the enabled output; serialization can explicitly retain the inactive camera.
function shotArgs(width = studio.outputWidth || doc.width, height = studio.outputHeight || doc.height, cameraEnabled = studio.cameraEnabled !== false) {
    const angle = outputShot(doc, cameraEnabled);
    return [width, height, angle.zoom, angle.offsetX, angle.offsetY, angle.yaw, -angle.pitch];
}

function updateCamera(snap) {
    if (snap) viewer.snapToCaptureCamera(...shotArgs());
    else viewer.updateCaptureCamera(...shotArgs());
    refreshControls();
    schedulePreview();
}

// Coalesce drag updates; fitting never recursively schedules another fit.
function requestAutoFit() {
    if (!ready || !doc.autoFit || fitting || autoFitTimer) return;
    autoFitTimer = setTimeout(() => { autoFitTimer = null; autoFrame(); }, 90);
}

function autoFrame() {
    if (!ready || !doc.autoFit || fitting) return;
    fitting = true;
    try {
        // Keep the trained front reference fully framed, then fit the chosen shot.
        doc.framing = { ...DEFAULT_FRAMING };
        frameEveryone(false);
        if (studio.camera && doc.anyAngle.enabled) {
            const THREE = viewer.THREE, angle = doc.anyAngle;
            angle.zoom = 1; angle.offsetX = 0; angle.offsetY = 0;
            const bounds = () => {
                // Fit the saved shot even when its generation branch is disabled.
                viewer.updateCaptureCamera(...shotArgs(undefined, undefined, true));
                viewer.captureCamera.updateMatrixWorld(true);
                return measurePeople().ndc;
            };
            for (let pass = 0; pass < 6; pass++) {
                const box = bounds(), size = box.getSize(new THREE.Vector2());
                if (![size.x, size.y].every(Number.isFinite)) break;
                angle.zoom = clamp(angle.zoom * 1.68 / Math.max(size.x, size.y, 0.001), 0.1, 7);
                const mid = bounds().getCenter(new THREE.Vector2());
                const epsilon = 0.1;
                angle.offsetX += epsilon;
                const dx = bounds().getCenter(new THREE.Vector2()).sub(mid).divideScalar(epsilon);
                angle.offsetX -= epsilon; angle.offsetY += epsilon;
                const dy = bounds().getCenter(new THREE.Vector2()).sub(mid).divideScalar(epsilon);
                angle.offsetY -= epsilon;
                // Damped least squares stays finite at side-on views (world X is then depth).
                const a = dx.dot(dx) + 0.001, b = dx.dot(dy), c = dy.dot(dy) + 0.001;
                const u = -dx.dot(mid), v = -dy.dot(mid), det = a * c - b * b;
                angle.offsetX += clamp((u * c - v * b) / det, -10, 10);
                angle.offsetY += clamp((v * a - u * b) / det, -10, 10);
            }
            const finalBounds = bounds();
            const edge = Math.max(Math.abs(finalBounds.min.x), Math.abs(finalBounds.max.x), Math.abs(finalBounds.min.y), Math.abs(finalBounds.max.y));
            if (Number.isFinite(edge) && edge > 0.84) angle.zoom *= 0.84 / edge;
        }
        updateCamera(editMode === 'camera');
        refreshAngle();
    } finally { fitting = false; }
}

function setAutoFit(enabled) {
    doc.autoFit = Boolean(enabled);
    doc.anyAngle = normalizeShot(doc.anyAngle);
    $('#auto-fit').checked = doc.autoFit;
    if (!doc.autoFit) { clearTimeout(autoFitTimer); autoFitTimer = null; }
    else { autoFrame(); schedulePreview(); }
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
    const framing = doc.framing;
    return viewer.capture(width, height, framing.zoom, CAPTURE_BACKGROUND, framing.offsetX, framing.offsetY, FRONT.yaw, FRONT.pitch, doc.outputSkeleton);
}

function schedulePreview() {
    if (!ready) return;
    requestAutoFit();
    if (previewTimer) return;
    const revision = ++previewRevision;
    previewTimer = setTimeout(async () => {
        previewTimer = null;
        try {
            await viewer.waitForCaptureReady();
            if (revision !== previewRevision) return;
            const scale = Math.min(1, 480 / Math.max(doc.width, doc.height));
            const front = capture(Math.round(doc.width * scale), Math.round(doc.height * scale));
            if (front) $('#capture-preview').src = front;
            const width = studio.outputWidth || doc.width, height = studio.outputHeight || doc.height;
            const previewScale = Math.min(1, 480 / Math.max(width, height));
            const args = shotArgs(Math.round(width * previewScale), Math.round(height * previewScale));
            const shot = viewer.capture(args[0], args[1], args[2], CAPTURE_BACKGROUND, ...args.slice(3), doc.outputSkeleton);
            if (shot) { $('#inset-preview').src = shot; $('#angle-preview').src = shot; }
        } catch (error) { toast('预览未完成：' + error.message); }
        finally { viewer.updateCaptureCamera(...shotArgs()); }
    }, 180);
}

// --- OpenPose one-click posing ---------------------------------------------

const worldOf = name => viewer.bones[name].getWorldPosition(new viewer.THREE.Vector3()).toArray();

function restJoints() {
    const rest = Object.fromEntries(Object.entries(JOINT_BONES).map(([key, bone]) => [key, worldOf(bone)]));
    rest.neck = rest.ls.map((v, i) => (v + rest.rs[i]) / 2);
    rest.hipMid = rest.lh.map((v, i) => (v + rest.rh[i]) / 2);
    return { rest, head: worldOf('head'), pelvis: worldOf('pelvis') };
}

// Back to neutral framing and the standing pose, then IK the mannequin onto keypoints that
// `build(rest, head)` returns relative to the hip midpoint (as {kps, ...extra}); returns extra.
function importKeypoints(build) {
    viewer.recordState();
    const keep = doc.people || !doc.autoFit ? { ...doc.transform } : null; // with two people, a new pose must not move anyone
    doc.transform = { ...NEUTRAL_TRANSFORM };
    viewer.setActiveCharacterAppearance({ transform: doc.transform });
    resetPose();
    viewer.skinnedMesh.updateMatrixWorld(true);
    const { rest, head, pelvis } = restJoints();
    const { kps, ...extra } = build(rest, head);
    const THREE = viewer.THREE;
    const worldKps = Object.fromEntries(Object.entries(WORLD_KEYPOINT_NAMES).map(([key, name]) => [name, new THREE.Vector3(...kps[key].map((v, i) => v + pelvis[i]))]));
    // Hip sockets, head, hands and feet have no reliable source; keep the mannequin's own.
    viewer.applyWorldKeypointImport(worldKps, { drawFigure: false, placeHipRoots: false, alignHead: false, alignHands: false, alignFeet: false, dispatchPoseChange: false });
    if (keep) { doc.transform = keep; viewer.setActiveCharacterAppearance({ transform: keep }); }
    return extra;
}

// After a new pose: one person is re-framed; two people keep their layout.
const refit = snap => (doc.people || !doc.autoFit ? updateCamera(snap) : fitFrame(snap));

function applyOpenPose() {
    const { points, flips } = doc.openpose;
    if (doc.openpose.key === 'photo' && !applicableBody(points).complete) {
        applyVisibleSegments(points);
        refreshFlips();
        return false;
    }
    const { facingAway } = importKeypoints((rest, head) => {
        const lifted = liftOpenPose(points, rest, flips, doc.openpose.depthMode);
        // The spine IK target is the head bone origin, not the nose: keep the nose direction at head-bone distance.
        const headDistance = Math.hypot(...head.map((v, i) => v - rest.neck[i]));
        const direction = lifted.kps.head.map((v, i) => v - lifted.kps.neck[i]);
        const norm = Math.hypot(...direction) || 1;
        lifted.kps.head = lifted.kps.neck.map((v, i) => v + direction[i] / norm * headDistance);
        return lifted;
    });
    refit(true);
    refreshFlips(facingAway);
    return facingAway;
}

// Cropped/occluded photos can still supply useful limbs. Only rotate observed segments;
// keep the torso, unobserved joints, body lengths and the other mannequin as they were.
function applyVisibleSegments(points) {
    const { segments } = applicableBody(points);
    const THREE = viewer.THREE;
    viewer.recordState();
    for (const [a, b, boneName, childName] of segments) {
        const bone = viewer.bones[boneName], child = viewer.bones[childName];
        const from = bone.getWorldPosition(new THREE.Vector3());
        const current = child.getWorldPosition(new THREE.Vector3()).sub(from).normalize();
        const target = new THREE.Vector3(points[b][0] - points[a][0], points[a][1] - points[b][1], 0).normalize();
        const delta = new THREE.Quaternion().setFromUnitVectors(current, target);
        const world = bone.getWorldQuaternion(new THREE.Quaternion());
        const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
        bone.quaternion.copy(parent.multiply(delta).multiply(world));
        bone.updateMatrixWorld(true);
    }
    viewer.skeleton?.update();
    viewer.updateIKEffectorPositions?.(); viewer.updateMarkers?.(); viewer.requestRender();
    refit(true);
}

// 常用姿势: direction specs (common-poses.mjs) solved on the current body, so they fit any shape.
function applyCommonPose(entry) {
    importKeypoints((rest, head) => ({ kps: directionKeypoints(entry.spec, rest, head) }));
    if (entry.spec.turn) viewer.setModelRotation(0, entry.spec.turn, 0);
    doc.openpose = null;
    refreshFlips();
    refit(true);
    for (const button of document.querySelectorAll('.fp-thumb')) button.classList.toggle('active', button.dataset.key === entry.key);
    $('#import-status').textContent = `已摆成「${entry.name}」。可以再拖关节微调。`;
}

// Returns a short note for the status line.
function poseFromSkeleton(image, key, label) {
    const people = readSkeletonImage(image);
    // Single-person editor: take the tallest skeleton.
    const height = person => Math.max(...Object.values(person).map(p => p[1])) - Math.min(...Object.values(person).map(p => p[1]));
    const person = people.slice().sort((a, b) => height(b) - height(a))[0];
    doc.openpose = { key, name: label, points: person, flips: {} };
    const notes = [applyOpenPose() ? '识别为背面' : '识别为正面'];
    if (people.length > 1) notes.push(`图中 ${people.length} 人，已取最大的一个`);
    if (people.warnings?.length) notes.push('遮挡关节已近似补全');
    return notes.join('，');
}

// 从人物图识别姿势: DWPose (comfyui_controlnet_aux) runs on the person photo through ComfyUI's own
// queue. Apply original POSE_KEYPOINT coordinates, never re-detect them from the rendered PNG.
// Body only; hands and face are left to the hand presets.
const DWPOSE_MODELS = { bbox_detector: 'yolox_l.torchscript.pt', pose_estimator: 'dw-ll_ucoco_384_bs5.torchscript.pt' };

async function dwposeAvailable() {
    try {
        const response = await fetch('/object_info/DWPreprocessor', { cache: 'no-store' });
        return response.ok && Boolean((await response.json()).DWPreprocessor);
    } catch { return false; }
}

function pickOption(options, preferred) {
    return options?.includes(preferred) ? preferred : options?.find(option => option !== 'None') ?? preferred;
}

async function detectPersonPose() {
    const status = $('#detection-status');
    const button = $('#detect-person');
    if (!posePhoto || detectingPose || !dwposeReady) return;
    const source = { ...posePhoto };
    detectedPose = null;
    $('#detected-pose').hidden = true;
    $('#apply-detected-pose').disabled = true;
    detectingPose = true;
    refreshPosePhoto();
    button.disabled = true;
    try {
        status.textContent = `正在上传姿势参考图：${source.name}…`;
        const response = await fetch(source.url);
        if (!response.ok) throw new Error('参考图片读取失败');
        const blob = await response.blob();
        const form = new FormData();
        // Named by content, so detecting the same photo again reuses one copy in input/fisher_pose.
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let hash = 2166136261;
        for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i], 16777619);
        form.append('image', blob, `person_${(hash >>> 0).toString(16)}_${bytes.length.toString(16)}.png`);
        form.append('overwrite', 'true');
        form.append('subfolder', 'fisher_pose');
        form.append('type', 'input');
        const upload = await (await fetch('/upload/image', { method: 'POST', body: form })).json();
        const info = (await (await fetch('/object_info/DWPreprocessor')).json()).DWPreprocessor.input.optional;
        const prompt = {
            1: { class_type: 'LoadImage', inputs: { image: `${upload.subfolder ? upload.subfolder + '/' : ''}${upload.name}` } },
            2: { class_type: 'DWPreprocessor', inputs: { image: ['1', 0], detect_hand: 'disable', detect_body: 'enable', detect_face: 'disable', resolution: 1024,
                bbox_detector: pickOption(info.bbox_detector?.[0], DWPOSE_MODELS.bbox_detector), pose_estimator: pickOption(info.pose_estimator?.[0], DWPOSE_MODELS.pose_estimator) } },
            3: { class_type: 'PreviewImage', inputs: { images: ['2', 0] } },
            4: { class_type: 'PreviewAny', inputs: { source: ['2', 1] } },
        };
        const queued = await (await fetch('/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) })).json();
        if (!queued.prompt_id) throw new Error(queued.error?.message || 'ComfyUI 没有接受识别任务');
        status.textContent = '正在识别姿势（ComfyUI 队列里有别的任务时会等它跑完）…';
        let result = null;
        for (let i = 0; i < 600 && !result; i++) {
            await new Promise(resolve => setTimeout(resolve, 500));
            result = (await (await fetch(`/history/${queued.prompt_id}`, { cache: 'no-store' })).json())[queued.prompt_id];
        }
        if (!result) throw new Error('等待超时');
        if (result.status?.status_str === 'error') throw new Error('DWPose 运行出错，请看 ComfyUI 控制台');
        const output = result.outputs?.['3']?.images?.[0];
        if (!output) throw new Error('没有得到骨架图');
        const image = new Image();
        image.src = '/view?' + new URLSearchParams({ filename: output.filename, subfolder: output.subfolder || '', type: output.type || 'temp' });
        await image.decode();
        // An output node keeps the JSON in history even when the detector was cached.
        const keypoints = result.outputs?.['4']?.text?.[0];
        if (!keypoints) throw new Error('没有得到原始关节点，请更新 ComfyUI 后重新识别');
        const detection = readPoseKeypoints(keypoints);
        const body = applicableBody(largestBody(detection.people));
        const photo = new Image(); photo.src = source.url; await photo.decode();
        detectedPose = { image, name: source.name, ...detection, overlay: poseOverlay(photo, detection) };
        $('#pose-preview-overlay').checked = true;
        $('#detected-pose-preview').src = detectedPose.overlay;
        $('#download-detected-pose').href = image.src;
        $('#detected-pose').hidden = false;
        status.textContent = body.complete ? '识别完成，请点击下方「应用」。手指需单独调整。'
            : `识别完成：可应用 ${body.segments.length} 段肢体。未识别的部位保持人偶现有姿势。`;
        $('#apply-detected-pose').disabled = false;
    } catch (error) {
        status.textContent = `识别失败：${error.message}`;
    } finally { detectingPose = false; refreshPosePhoto(); }
}

async function importEntry(entry) {
    const status = $('#import-status');
    for (const button of document.querySelectorAll('.fp-thumb')) button.classList.toggle('active', button.dataset.key === entry.key);
    const label = entry.key.startsWith('builtin:') ? `${SOURCE_NAMES.builtin} ${entryLabel(entry)}` : entry.name;
    try {
        const image = new Image();
        image.src = entry.url;
        await image.decode();
        status.textContent = `已按「${label}」摆好：${poseFromSkeleton(image, entry.key, label)}。前后不对可用下方深度修正。`;
    } catch (error) {
        entry.failed = true;
        document.querySelector(`.fp-thumb[data-key="${CSS.escape(entry.key)}"]`)?.classList.add('failed');
        status.textContent = `「${label}」无法识别：${error.message}`;
    }
}

function refreshFlips(facingAway) {
    $('#depth-section').hidden = !doc.openpose;
    const flips = doc.openpose?.flips || {};
    const planar = doc.openpose?.depthMode === 'planar';
    const partial = doc.openpose?.key === 'photo' && !applicableBody(doc.openpose.points).complete;
    $('[data-depth-mode="estimate"]').disabled = partial;
    for (const button of document.querySelectorAll('[data-depth-mode]')) button.classList.toggle('active', button.dataset.depthMode === (planar ? 'planar' : 'estimate'));
    $('#depth-flips').hidden = planar;
    for (const button of document.querySelectorAll('[data-flip]')) button.classList.toggle('on', Boolean(flips[button.dataset.flip]));
    if (facingAway !== undefined) $('[data-flip=body]').textContent = facingAway ? '背面 → 改正面' : '正面 → 改背面';
}

for (const button of document.querySelectorAll('[data-depth-mode]')) {
    button.onclick = () => {
        if (!doc.openpose) return;
        doc.openpose.depthMode = button.dataset.depthMode;
        applyOpenPose();
    };
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
const SOURCE_NAMES = { common: '常用姿势', builtin: 'FISHER小彩蛋', library: '我的图库' };
const galleries = {
    common: COMMON_POSES.map(spec => ({ key: 'common:' + spec.id, name: spec.name, url: new URL(`common-poses/${spec.id}.webp`, import.meta.url).href, spec })),
    builtin: [], library: [],
};
let gallerySource = 'common';
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
        button.className = 'fp-thumb' + (entry.spec ? ' fp-mannequin' : '') + (entry.failed ? ' failed' : '') + (doc.openpose?.key === entry.key ? ' active' : '');
        button.dataset.key = entry.key;
        button.title = entry.name;
        button.innerHTML = `<img loading="lazy" alt=""><span></span>`;
        button.querySelector('img').src = entry.url;
        button.querySelector('span').textContent = entryLabel(entry);
        button.onclick = () => (entry.spec ? applyCommonPose(entry) : importEntry(entry));
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
        doc: { ...doc, pose: savedPose(), people: doc.people ? peopleNow() : undefined, active: undefined },
        grips: gripsNow(),
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
        setGrips(record.doc.people?.[0]?.grips || record.grips);
        rebuildPassives();
        refreshAngle();
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
let detectedPose = null;
function refreshPosePhoto() {
    $('#detect-person').disabled = !posePhoto || !dwposeReady || detectingPose;
    $('#detect-person').textContent = detectingPose ? '正在识别骨骼…' : posePhoto ? '识别骨骼图' : '先选择姿势参考图';
    $('#apply-detected-pose').textContent = doc.people ? `应用到人物 ${(doc.active ?? 0) + 1}` : '应用到当前人偶';
    $('#choose-pose-photo').disabled = detectingPose;
    $('#use-person-photo').disabled = detectingPose;
    $('#use-person-photo').hidden = !personPreviewUrls[doc.active ?? 0] || Boolean(doc.people && doc.referenceMode === 'group');
    $('#pose-detector-hint').textContent = dwposeReady ? '仅提取动作，不替换工作流中的人物照片。' : '识别需要 DWPose（comfyui_controlnet_aux）；预设和骨架导入仍可使用。';
}
function selectPosePhoto(url, name, owned = false) {
    if (detectingPose) return;
    if (posePhoto?.owned) URL.revokeObjectURL(posePhoto.url);
    posePhoto = { url, name, owned };
    detectedPose = null;
    $('#detection-status').textContent = '';
    $('#detected-pose').hidden = true;
    $('#pose-photo-preview').src = url;
    $('#pose-photo-name').textContent = name;
    $('#pose-photo-selection').hidden = false;
    $('#import-status').textContent = '已选择参考图，先识别骨骼，再应用到人偶。';
    refreshPosePhoto();
}
const onPosePhotoFile = file => {
    if (file && (!file.type || file.type.startsWith('image/'))) selectPosePhoto(URL.createObjectURL(file), file.name, true);
};
$('#choose-pose-photo').onclick = () => {
    const choose = window.frameElement?.fisherChooseReference;
    if (choose) choose(onPosePhotoFile);
    else { $('#pose-photo-file').value = ''; $('#pose-photo-file').click(); }
};
$('#pose-photo-file').onchange = event => onPosePhotoFile(event.target.files[0]);
$('#use-person-photo').onclick = () => selectPosePhoto(personPreviewUrls[doc.active ?? 0], `已接人物图 ${(doc.active ?? 0) + 1}`);
$('#detect-person').onclick = detectPersonPose;
$('#pose-preview-overlay').onchange = event => {
    if (detectedPose) $('#detected-pose-preview').src = event.target.checked ? detectedPose.overlay : detectedPose.image.src;
};
$('#apply-detected-pose').onclick = () => {
    if (!detectedPose) return;
    try {
        const points = largestBody(detectedPose.people);
        const body = applicableBody(points);
        doc.openpose = { key: 'photo', name: detectedPose.name, points, flips: {}, depthMode: 'planar' };
        applyOpenPose();
        const count = detectedPose.people.length > 1 ? `图中有 ${detectedPose.people.length} 人，已取最大的一个。` : '';
        $('#import-status').textContent = body.complete ? `已按原图关节点贴合动作。${count}当前保留二维方向；需要前后深度可在下方切换「估算立体」。手势需单独调整。`
            : `已应用可见肢体。${count}未识别的部位保持原姿势，手势需单独调整。`;
        $('#detection-status').textContent = body.complete ? `已应用到人物 ${(doc.active ?? 0) + 1}。${count}`
            : `已应用 ${body.segments.length} 段可见肢体；未识别部位保持原姿势。${count}`;
        toast($('#detection-status').textContent);
    } catch (error) { $('#detection-status').textContent = `应用失败：${error.message}`; toast($('#detection-status').textContent); }
};

// --- Two people -------------------------------------------------------------
// The VNCCS core edits one rig; everybody else is a passive clone that still renders in the capture.
// Switching snapshots the edited person into a clone and loads the other one as the editable rig.

const MAX_PEOPLE = 2;
const PERSON_COLOR = '#ffffff';
const passiveId = index => `person-${index}`;
let dwposeReady = false;

const gripsNow = () => ({ l: Number($('#grip-l').value), r: Number($('#grip-r').value) });
function setGrips(grips) { for (const side of ['l', 'r']) $(`#grip-${side}`).value = grips?.[side] ?? 0; }

function snapshotActive() {
    return { mesh: { ...doc.mesh }, proportions: { ...doc.proportions }, pose: savedPose(), transform: { ...doc.transform }, openpose: doc.openpose, grips: gripsNow() };
}

function peopleNow() {
    const people = doc.people.slice();
    people[doc.active] = snapshotActive();
    return people;
}

// Load person `index` of doc.people as the editable rig (the caller handles its old clone).
function loadPerson(index) {
    const person = doc.people[index];
    doc.active = index;
    Object.assign(doc, { mesh: { ...person.mesh }, proportions: { ...person.proportions }, pose: person.pose, transform: { ...person.transform }, openpose: person.openpose });
    loadModel(person.pose);
    setGrips(person.grips);
}

// Clones for everyone but the edited person, built from their own body shape and pose.
function rebuildPassives() {
    viewer.clearPassiveCharacters();
    if (!doc.people) return;
    const active = doc.active;
    doc.people[active] = snapshotActive();
    doc.people.forEach((person, index) => {
        if (index === active) return;
        loadPerson(index);
        viewer.upsertPassiveCharacterFromActive(passiveId(index), { pose: person.pose, transform: person.transform, color: PERSON_COLOR });
    });
    loadPerson(active);
}

function forgetHistory() {
    // The core keeps one undo stack for "the" rig; replaying it on another person would pose the wrong body.
    viewer.history = [];
    viewer.future = [];
}

function switchPerson(index) {
    if (!doc.people || index === doc.active || !doc.people[index]) return;
    doc.people[doc.active] = snapshotActive();
    const left = doc.people[doc.active];
    viewer.upsertPassiveCharacterFromActive(passiveId(doc.active), { pose: left.pose, transform: left.transform, color: PERSON_COLOR });
    viewer.removePassiveCharacter(passiveId(index));
    loadPerson(index);
    forgetHistory();
    selectedBoneName = null;
    refreshPeople(); refreshFlips(); refreshControls(); updateCamera(false);
    $('#import-status').textContent = `正在编辑人物 ${index + 1}（使用人物 ${index + 1} 的照片）。`;
}

function addPerson() {
    if (doc.people) return;
    // Explicitly adding a second mannequin with one active photo selects group-photo mode.
    if (doc.portraitState?.activeSlots.length === 1) { doc.referenceMode = 'group'; delete doc.portraitState; }
    const first = snapshotActive();
    // Room for two: side by side at the current size, on a landscape frame.
    const shift = 4.4 * first.transform.zoom;
    first.transform = { ...first.transform, x: first.transform.x - shift };
    doc.people = [first, { mesh: { ...DEFAULT_MESH }, proportions: { ...DEFAULT_PROPORTIONS }, pose: null, transform: { ...doc.transform, x: doc.transform.x + shift }, openpose: null, grips: { l: 0, r: 0 } }];
    doc.active = 0;
    doc.transform = { ...first.transform };
    viewer.setActiveCharacterAppearance({ transform: doc.transform });
    viewer.upsertPassiveCharacterFromActive(passiveId(0), { pose: first.pose, transform: first.transform, color: PERSON_COLOR });
    loadPerson(1);
    forgetHistory();
    if (doc.width / doc.height < 1.2) { setSize(...sizeForAspect(4 / 3)); toast('两个人时人偶图改成了 4:3 横图，可在「人偶图尺寸」里改'); }
    frameEveryone();
    refreshPeople(); refreshControls();
    $('#import-status').textContent = '已添加人物 2，请在节点接入它的照片。给它选一个姿势，或点画面里的人偶切换编辑对象。';
}

function removePerson() {
    if (!doc.people) return;
    if (doc.portraitState?.activeSlots.length === 2) { toast('在工作流里关闭对应照片，会自动切换到单人；重新开启可恢复姿势。'); return; }
    if (doc.active !== 0) switchPerson(0);
    doc.people = null;
    doc.active = 0;
    viewer.clearPassiveCharacters();
    forgetHistory();
    fitFrame(false);
    refreshPeople();
    $('#import-status').textContent = '已删除人物 2。';
}

// Everybody's skinned vertices (sampled): world bounding box and extent in the capture camera's NDC.
function measurePeople() {
    const THREE = viewer.THREE;
    const camera = viewer.captureCamera, v = new THREE.Vector3(), box = new THREE.Box3(), ndc = new THREE.Box2();
    // Fitting switches between front and shot cameras before a render occurs.
    // Project against the current camera, not the previous rendered view.
    camera.updateMatrixWorld(true);
    const meshes = [viewer.skinnedMesh, ...[...viewer.passiveCharacters.values()].map(entry => entry.mesh)].filter(Boolean);
    for (const mesh of meshes) {
        mesh.updateMatrixWorld(true);
        mesh.skeleton?.update();
        const count = mesh.geometry.attributes.position.count;
        for (let i = 0; i < count; i += 23) {
            mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
            box.expandByPoint(v);
            const p = v.clone().project(camera);
            ndc.expandByPoint(new THREE.Vector2(p.x, p.y));
        }
    }
    return { box, ndc };
}

// --- New camera angle (AnyAngle) ---------------------------------------------
// The pose is still generated from the front; the workflow then turns the result into a 3D splat
// (TripoSplat), renders it from this camera and lets the QI2.1 AnyAngle LoRA redraw it. The camera is
// stored relative to the people, in units of their height, so fisher_anyangle.py can place it on
// the splat whatever its scale.
function anyAngleCamera() {
    const THREE = viewer.THREE;
    viewer.updateCaptureCamera(...shotArgs(undefined, undefined, true));
    const camera = viewer.captureCamera;
    camera.updateMatrixWorld(true);
    const { box } = measurePeople();
    const center = box.getCenter(new THREE.Vector3());
    const height = Math.max(box.max.y - box.min.y, 1e-3);
    return {
        position: camera.position.clone().sub(center).divideScalar(height).toArray(),
        forward: camera.getWorldDirection(new THREE.Vector3()).toArray(),
        fov: camera.fov, zoom: camera.zoom, aspect: camera.aspect,
    };
}

function refreshAngle() {
    const angle = doc.anyAngle;
    $('#camera-switch-wrap').hidden = !studio.camera;
    $('#camera-enabled').checked = studio.cameraEnabled !== false;
    $('#camera-switch-hint').textContent = studio.cameraEnabled === false ? '当前只生成姿势；开启后才执行旋转镜头。' : '转动镜头时执行多角度；正面缩放直接生成特写。';
    $('#auto-fit').checked = doc.autoFit;
    $('#output-skeleton').checked = doc.outputSkeleton;
    for (const key of ['yaw', 'pitch', 'zoom']) {
        $(`#angle-${key}`).value = angle[key];
        setOutput(`angle-${key}`, key === 'zoom' ? `${angle[key].toFixed(2)}×` : `${Math.round(angle[key])}°`);
    }
    $('#camera-unavailable').hidden = studio.camera;
    $('#open-studio').hidden = studio.camera || !studio.canOpenWorkflow;
    $('#angle-controls').hidden = !studio.camera;
    $('#mode-camera').disabled = !studio.camera;
    $('#generate-editor').hidden = !studio.canGenerate;
    $('#shot-status').textContent = studio.cameraEnabled === false
        ? '仅生成姿势 · 预览为实际输出构图'
        : angle.enabled ? '按当前镜头生成' : '正面镜头';
    $('#final-size').textContent = `${studio.outputWidth || doc.width} × ${studio.outputHeight || doc.height}`;
    if (!studio.camera && angle.enabled) $('#camera-unavailable').textContent = '此工作流无法生成已保存的镜头。请打开完整工作流，或恢复正面镜头后应用。';
}

// Only rotation requires reconstruction. A front crop is part of the pose reference.
function normalizeShot(angle) {
    const shot = { ...NO_NEW_ANGLE, ...angle };
    shot.yaw = clamp(Number(shot.yaw) || 0, -180, 180);
    shot.pitch = clamp(Number(shot.pitch) || 0, -60, 60);
    shot.zoom = clamp(Number(shot.zoom) || 1, 0.1, 7);
    shot.offsetX = Number(shot.offsetX) || 0;
    shot.offsetY = Number(shot.offsetY) || 0;
    const turned = Math.abs(shot.yaw) > 0.01 || Math.abs(shot.pitch) > 0.01;
    shot.enabled = turned;
    return shot;
}

function setAngle(values) {
    if (!studio.camera) return;
    if ('zoom' in values || 'offsetX' in values || 'offsetY' in values) setAutoFit(false);
    doc.anyAngle = normalizeShot({ ...doc.anyAngle, ...values });
    if (!isTurned(doc.anyAngle)) doc.framing = frontFraming({ framing: doc.anyAngle });
    refreshAngle();
    updateCamera(editMode === 'camera');
    requestAutoFit();
}

function setEditMode(mode) {
    if (mode === 'camera' && !studio.camera) return;
    editMode = mode;
    $('#mode-pose').classList.toggle('active', mode === 'pose');
    $('#mode-camera').classList.toggle('active', mode === 'camera');
    $('#mode-help').textContent = mode === 'camera'
        ? '拖动画面定拍摄角度，滚轮调远近，右键拖动调构图。橙框内是拍摄范围。'
        : '拖关节摆动作，拖空白处换方向观察。观察方向不改变已定好的镜头。';
    $('#selection-hint').textContent = mode === 'camera' ? '定镜头 · 拖动转镜头，滚轮调远近' : '摆姿势 · 拖关节调整，Shift+拖动移动人物';
    viewer.orbit.enabled = mode === 'pose';
    updateCamera(true);
    viewer.orbit.enabled = mode === 'pose';
}

$('#camera-enabled').onchange = event => {
    studio.cameraEnabled = event.target.checked;
    refreshAngle(); updateCamera(true);
};
$('#mode-pose').onclick = () => setEditMode('pose');
$('#mode-camera').onclick = () => setEditMode('camera');
for (const key of ['yaw', 'pitch', 'zoom']) $('#angle-' + key).oninput = event => setAngle({ [key]: Number(event.target.value) });
for (const button of document.querySelectorAll('[data-angle-yaw]')) button.onclick = () => setAngle({ yaw: Number(button.dataset.angleYaw) });
$('#reset-camera').onclick = () => {
    doc.framing = { ...DEFAULT_FRAMING };
    doc.anyAngle = { ...NO_NEW_ANGLE };
    refreshAngle(); updateCamera(true);
};
$('#open-studio').onclick = () => parent.postMessage({ type: 'fisher-open-workflow' }, location.origin);
$('#angle-from-view').onclick = () => {
    const THREE = viewer.THREE;
    const pivot = viewer.sceneCameraTarget || viewer.orbit.target;
    const d = viewer.camera.position.clone().sub(pivot);
    setAngle({ yaw: THREE.MathUtils.radToDeg(Math.atan2(d.x, d.z)), pitch: THREE.MathUtils.radToDeg(Math.atan2(d.y, Math.hypot(d.x, d.z))) });
    setEditMode('camera');
};

// 撑满 for two: scale and centre the whole group in the capture frame, keeping who stands where.
function frameEveryone(snap = false) {
    if (!doc.people) { fitFrame(snap); return; }
    const THREE = viewer.THREE;
    doc.people[doc.active] = snapshotActive();
    const apply = () => doc.people.forEach((person, index) => {
        if (index === doc.active) { doc.transform = { ...person.transform }; viewer.setActiveCharacterAppearance({ transform: doc.transform }); }
        else viewer.setPassiveCharacterState(passiveId(index), { pose: person.pose, transform: person.transform, color: PERSON_COLOR });
    });
    const measure = () => { viewer.updateCaptureCamera(doc.width, doc.height, 1, 0, 0, 0, 0); return measurePeople(); };
    for (let pass = 0; pass < 3; pass++) {
        const { box, ndc } = measure();
        const size = ndc.getSize(new THREE.Vector2());
        const s = pass === 2 ? 1 : Math.min(1.68 / Math.max(size.x, 1e-3), 1.68 / Math.max(size.y, 1e-3));
        const center = box.getCenter(new THREE.Vector3());
        const projected = center.clone().project(viewer.captureCamera);
        const mid = ndc.getCenter(new THREE.Vector2());
        const target = new THREE.Vector3(projected.x - mid.x, projected.y - mid.y, projected.z).unproject(viewer.captureCamera);
        const delta = target.sub(center);
        for (const person of doc.people) {
            const t = person.transform;
            person.transform = {
                x: clamp(center.x + (t.x - center.x) * s + delta.x, -50, 50),
                y: clamp(center.y + (t.y - center.y) * s + delta.y, -50, 50),
                z: clamp(center.z + (t.z - center.z) * s, -40, 40),
                zoom: t.zoom * s,
            };
        }
        apply();
    }
    updateCamera(snap);
}

function refreshPeople() {
    const two = Boolean(doc.people);
    $('#people-source').hidden = !two;
    $('#reference-mode').value = doc.referenceMode;
    for (const button of document.querySelectorAll('[data-reference-mode]')) button.setAttribute('aria-pressed', String(button.dataset.referenceMode === doc.referenceMode));
    $('#group-photo-wrap').hidden = doc.referenceMode !== 'group' || !personPreviewUrls[0];
    $('#group-left-tag').textContent = doc.swapPeople ? '人物 2' : '人物 1';
    $('#group-right-tag').textContent = doc.swapPeople ? '人物 1' : '人物 2';
    $('#group-photo-wrap').classList.toggle('swapped', doc.swapPeople);
    $('#swap-people').hidden = doc.referenceMode !== 'group';
    $('#group-photo-preview').hidden = doc.referenceMode !== 'group' || !personPreviewUrls[0];
    if (personPreviewUrls[0]) $('#group-photo-preview').src = personPreviewUrls[0];
    $('#people-mapping').textContent = doc.referenceMode === 'group'
        ? (doc.swapPeople ? '1 ← 原图右侧\n2 ← 原图左侧' : '1 ← 原图左侧\n2 ← 原图右侧')
        : '人物 1 用第一张照片\n人物 2 用第二张照片';
    for (const button of document.querySelectorAll('[data-person]')) {
        const index = Number(button.dataset.person);
        button.hidden = index >= (two ? MAX_PEOPLE : 1) || (!two && index > 0);
        button.classList.toggle('active', index === doc.active);
    }
    const singleSlot = doc.portraitState?.activeSlots?.[0];
    $('#people [data-person="0"]').hidden = !two && !singleSlot;
    $('#people [data-person="0"]').textContent = `人物 ${!two && singleSlot ? singleSlot : 1}`;
    $('#remove-person').hidden = doc.portraitState?.activeSlots.length === 2;
    $('#add-person').hidden = two;
    refreshPosePhoto();
}

for (const button of document.querySelectorAll('[data-person]')) {
    button.onclick = event => (event.target.closest('#remove-person') ? removePerson() : switchPerson(Number(button.dataset.person)));
}
$('#add-person').onclick = addPerson;
$('#reference-mode').onchange = event => { doc.referenceMode = event.target.value; if (doc.referenceMode === 'group') delete doc.portraitState; refreshPeople(); refreshControls(); };
for (const button of document.querySelectorAll('[data-reference-mode]')) button.onclick = () => {
    $('#reference-mode').value = button.dataset.referenceMode;
    $('#reference-mode').dispatchEvent(new Event('change'));
};
$('#swap-people').onclick = () => { doc.swapPeople = !doc.swapPeople; refreshPeople(); refreshControls(); };

// Clicking the other mannequin (a click, not an orbit drag, and not on a joint) edits that person.
function pickPassive(event) {
    if (!doc.people) return;
    const THREE = viewer.THREE;
    const rect = canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, viewer.camera);
    let best = null;
    for (const [key, entry] of viewer.passiveCharacters) {
        const hit = raycaster.intersectObject(entry.mesh, false)[0];
        if (hit && (!best || hit.distance < best.distance)) best = { distance: hit.distance, index: Number(key.split('-')[1]) };
    }
    const own = raycaster.intersectObject(viewer.skinnedMesh, false)[0];
    if (best && (!own || best.distance < own.distance)) switchPerson(best.index);
}

// --- Viewport interaction: our editor's feel on top of the VNCCS core -------

function setupInteraction() {
    const THREE = viewer.THREE;
    window.addEventListener('pointermove', event => { if (event.buttons && stage.contains(event.target)) requestAutoFit(); });
    window.addEventListener('pointerup', () => { if (doc.autoFit) schedulePreview(); });
    canvas.addEventListener('pointerdown', event => {
        if (editMode !== 'camera' || !ready) return;
        event.stopImmediatePropagation(); event.preventDefault();
        const start = { x: event.clientX, y: event.clientY, ...doc.anyAngle };
        const pan = event.button !== 0 || event.shiftKey;
        const move = e => {
            const x = e.clientX - start.x, y = e.clientY - start.y;
            setAngle(pan ? { offsetX: start.offsetX + x * 0.035 / start.zoom, offsetY: start.offsetY - y * 0.035 / start.zoom }
                         : { yaw: start.yaw - x * 0.35, pitch: start.pitch + y * 0.25 });
        };
        const end = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
    }, { capture: true });
    canvas.addEventListener('wheel', event => {
        if (editMode !== 'camera') return;
        event.stopImmediatePropagation(); event.preventDefault();
        setAngle({ zoom: doc.anyAngle.zoom * Math.exp(-event.deltaY * 0.001) });
    }, { capture: true, passive: false });
    viewer.orbit.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
    // Shift+drag moves the person inside the front frame; it must pre-empt orbit and bone picking.
    canvas.addEventListener('pointerdown', event => {
        if (event.button !== 0 || !event.shiftKey || !ready) return;
        event.stopImmediatePropagation();
        event.preventDefault();
        manualPlacement();
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
        const grabbed = viewer.directDrag?.active || viewer.selectedIKEffector || viewer.selectedPoleTarget || viewer.transform?.dragging;
        if (grabbed || viewer.selectedBone) {
            viewer.orbit.enabled = false;
            window.addEventListener('pointerup', () => { viewer.orbit.enabled = true; }, { once: true });
        }
        if (grabbed) return;
        const start = { x: event.clientX, y: event.clientY };
        window.addEventListener('pointerup', up => {
            if (Math.hypot(up.clientX - start.x, up.clientY - start.y) < 5) pickPassive(up);
        }, { once: true });
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
    $('#tz').value = doc.transform.z; setOutput('tz', doc.transform.z.toFixed(1));
    const turn = Math.round(viewer.modelRotation?.y || 0);
    $('#turn').value = turn; setOutput('turn', `${turn}°`);
    $('#output-width').value = doc.width;
    $('#output-height').value = doc.height;
    $('#preview-size').textContent = `${doc.width}×${doc.height}`;
    for (const button of document.querySelectorAll('#ratios button')) button.classList.toggle('active', Math.abs(doc.width / doc.height - ratioOf(button)) < 0.02);
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

// Hand placement and 自动撑满 cannot both win: the fit would redo the framing 90ms later.
function manualPlacement() {
    if (!doc.autoFit) return;
    setAutoFit(false);
    toast('已关闭「自动撑满」，保留手动调整的位置和大小');
}

for (const [id, key] of [['zoom', 'zoom'], ['tx', 'x'], ['ty', 'y'], ['tz', 'z']]) {
    bindSlider($(`#${id}`), value => {
        manualPlacement();
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
$('#output-skeleton').onchange = event => { doc.outputSkeleton = event.target.checked; schedulePreview(); };
$('#auto-fit').onchange = event => setAutoFit(event.target.checked);
$('#fit-frame').onclick = $('#fit-frame-2').onclick = () => {
    viewer.recordState();
    const enabled = doc.autoFit;
    doc.autoFit = true; autoFrame(); doc.autoFit = enabled;
    if (!isTurned(doc.anyAngle)) doc.anyAngle = { ...NO_NEW_ANGLE };
    refreshAngle(); updateCamera(true);
};
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
// Viewers found that a mannequin image shaped like the person photo gives fewer extra hands and legs.
const ratioOf = button => button.dataset.ratio === 'person' ? personAspect || 1 : button.dataset.ratio.split(':').map(Number).reduce((a, b) => a / b);
function sizeForAspect(aspect) {
    const longSide = Math.max(doc.width, doc.height);
    return aspect >= 1 ? [longSide, longSide / aspect] : [longSide * aspect, longSide];
}
for (const button of document.querySelectorAll('#ratios button')) button.onclick = () => setSize(...sizeForAspect(ratioOf(button)));

async function loadPersonAspect(url) {
    if (!url) return null;
    try {
        const image = new Image();
        image.src = url;
        await image.decode();
        return image.naturalWidth / image.naturalHeight || null;
    } catch { return null; }
}

// Old ComfyUI cores cannot run Qwen Image 2.1 at all (see env_check.py): say so before anyone poses.
async function checkEnvironment() {
    if (!studio.canGenerate) return;
    try {
        const env = await (await fetch('/fisher_pose/env', { cache: 'no-store' })).json();
        const problem = !env.qwen21 ? `${env.updateHint}（当前版本 ${env.version}）`
            : isGroupPose(doc, secondReferenceConnected) ? bindingRuntimeProblem(env, location.origin) : '';
        $('#env-banner').textContent = problem;
        $('#env-banner').hidden = !problem;
    } catch { /* standalone preview, or AIFISHER Canvas which does not proxy this route */ }
}

const bodyContainer = $('#body-sliders');
for (const [key, label, min, max, step] of BODY_SLIDERS) {
    bodyContainer.insertAdjacentHTML('beforeend', `<label class="slider-label">${label}<output id="body-${key}-value"></output></label><input id="body-${key}" type="range" min="${min}" max="${max}" step="${step}">`);
    $(`#body-${key}`).addEventListener('input', event => {
        doc.mesh = { ...doc.mesh, [key]: Number(event.target.value) };
        refreshControls();
        clearTimeout(morphTimer);
        morphTimer = setTimeout(() => { morphTimer = null; loadModel(rotationsOnly(viewer.getPose())); updateCamera(false); }, 120);
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
const stageObserver = new ResizeObserver(() => viewer.resize(stage.clientWidth, stage.clientHeight));
stageObserver.observe(stage);

// --- Node bridge ------------------------------------------------------------

async function serialize() {
    if (morphTimer) { clearTimeout(morphTimer); morphTimer = null; loadModel(rotationsOnly(viewer.getPose())); }
    clearTimeout(autoFitTimer); autoFitTimer = null;
    autoFrame();
    await viewer.waitForCaptureReady();
    const poseReference = capture(doc.width, doc.height);
    updateCamera(false);
    doc.pose = savedPose();
    const people = doc.people ? peopleNow() : undefined;
    const anyAngle = doc.anyAngle.enabled ? { ...doc.anyAngle, camera: anyAngleCamera() } : { ...doc.anyAngle };
    let shotPreview;
    if (anyAngle.enabled) {
        const width = studio.outputWidth || doc.width, height = studio.outputHeight || doc.height;
        const scale = Math.min(1, 512 / Math.max(width, height));
        const args = shotArgs(Math.round(width * scale), Math.round(height * scale), true);
        shotPreview = viewer.capture(args[0], args[1], args[2], CAPTURE_BACKGROUND, ...args.slice(3), doc.outputSkeleton);
        viewer.updateCaptureCamera(...shotArgs());
    }
    let data = { version: 2, kind: 'vnccs-free-pose', ...doc, people, active: undefined, anyAngle, camera: FRONT, poseReference, shotPreview };
    if (doc.portraitState) data = reconcilePortraits(data, doc.portraitState.activeSlots).data;
    return JSON.stringify(data);
}

function personFrom(saved) {
    return {
        mesh: { ...DEFAULT_MESH, ...saved.mesh, breast_size: 0 }, pose: saved.pose || null, // flat chest is fixed
        proportions: { ...DEFAULT_PROPORTIONS, ...saved.proportions },
        transform: { ...NEUTRAL_TRANSFORM, ...saved.transform },
        openpose: saved.openpose || null,
        grips: { l: Number(saved.grips?.l) || 0, r: Number(saved.grips?.r) || 0 },
    };
}

// Shared by the node payload and 我的姿势: any saved editor state → a complete doc.
// The top-level person fields are always the person being edited; `people` holds everyone when
// there are two (older single-person saves have no `people`).
function docFrom(saved) {
    const people = Array.isArray(saved.people) && saved.people.length > 1 ? saved.people.slice(0, 2).map(personFrom) : null;
    const { grips, ...first } = people ? people[0] : personFrom(saved);
    return {
        ...first, people, active: 0, portraitState: saved.portraitState, referenceMode: saved.referenceMode || (secondReferenceConnected ? 'separate' : 'group'), swapPeople: saved.swapPeople === true, outputSkeleton: saved.outputSkeleton === true, autoFit: saved.autoFit !== false,
        // The mannequin size lives only here; the node's width/height are the separate output size.
        width: round16(Number(saved.width) || doc.width), height: round16(Number(saved.height) || doc.height),
        framing: frontFraming(saved),
        anyAngle: normalizeShot({ ...saved.anyAngle, camera: undefined }),
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
    studio = { camera: false, canGenerate: false, canOpenWorkflow: false, ...payload?.studio };
    personPreviewUrls = [payload?.referencePreview || null, payload?.referencePreview2 || null];
    secondReferenceConnected = payload?.referenceImage2Connected ?? Boolean(personPreviewUrls[1]);
    const restored = payload ? applyPayload(payload) : false;
    // Opening the editor always starts with source-left as person 1, as requested.
    doc.swapPeople = false;
    doc.outputSkeleton = true;
    if (!restored && secondReferenceConnected) doc.referenceMode = 'separate';
    personAspect = await loadPersonAspect(payload?.referencePreview);
    $('[data-ratio=person]').hidden = !personAspect;
    if (!restored && personAspect) [doc.width, doc.height] = sizeForAspect(personAspect).map(round16);
    void checkEnvironment();
    personPreviewUrls = [payload?.referencePreview || null, payload?.referencePreview2 || null];
    void dwposeAvailable().then(available => { dwposeReady = available; refreshPeople(); });
    loadModel(doc.pose);
    rebuildPassives();
    setupInteraction();
    ready = true;
    if (restored) updateCamera(true);
    else fitFrame(true);
    refreshFlips();
    refreshPeople();
    refreshAngle();
    setEditMode('pose');
    void loadBuiltin();
    void loadLibrary();
    void loadSavedList();
    await viewer.waitForCaptureReady();
    if (payload?.inputsChanged && doc.autoFit) frameEveryone(true);
    $('#loading').hidden = true;
    $('#apply-editor').disabled = false;
    $('#save-status').textContent = restored ? '已恢复姿势与镜头' : '先选姿势，再定镜头';
    schedulePreview();
    if (payload?.autoApply) await applyEditor(false);
}

window.addEventListener('message', event => {
    if (event.source !== parent || event.origin !== location.origin || event.data?.type !== 'fisher-load') return;
    if (pack) start(event.data.payload).catch(showError);
    else pendingPayload = event.data.payload;
});
$('#cancel-editor').onclick = () => parent.postMessage({ type: 'fisher-close' }, location.origin);
async function applyEditor(generate = false) {
    if (!studio.camera && doc.anyAngle.enabled) { toast('当前工作流不支持此镜头，请打开完整工作流，或恢复正面镜头'); return; }
    $('#apply-editor').disabled = $('#generate-editor').disabled = true;
    $('#save-status').textContent = generate ? '正在保存姿势并加入生成队列…' : '正在保存姿势…';
    try {
        const pose_json = await serialize();
        parent.postMessage({ type: 'fisher-apply', payload: { pose_json, extra_prompt: extraPrompt, cameraEnabled: studio.cameraEnabled !== false }, generate }, location.origin);
        if (!studio.canGenerate) $('#apply-editor').disabled = false;
    } catch (error) { applicationError(error.message); }
}
function applicationError(message) {
    if (embedded) parent.postMessage({ type: 'fisher-editor-error', message }, location.origin);
    $('#apply-editor').disabled = $('#generate-editor').disabled = false;
    $('#save-status').textContent = message;
    toast(message);
}
$('#apply-editor').onclick = () => applyEditor(false);
$('#generate-editor').onclick = () => applyEditor(true);
window.addEventListener('message', event => {
    if (event.source === parent && event.origin === location.origin && event.data?.type === 'fisher-error') applicationError(event.data.message);
});

function showError(error) {
    if (embedded) parent.postMessage({ type: 'fisher-editor-error', message: error?.message || String(error) }, location.origin);
    console.error(error);
    $('#loading-text').textContent = '加载失败：' + (error?.message || error);
    $('#loading').hidden = false;
}

if (!embedded) { $('#apply-editor').hidden = true; $('#cancel-editor').hidden = true; }
function dispose() {
    ready = false;
    clearTimeout(autoFitTimer); clearTimeout(previewTimer); clearTimeout(morphTimer);
    previewRevision++;
    stageObserver.disconnect();
    viewer.renderer?.forceContextLoss();
    viewer.dispose();
    pack = null;
}
window.freePose = { viewer, get doc() { return doc; }, serialize, prompt: promptText, fitFrame, importEntry, addFiles, saveCurrentPose, loadSavedPose, deleteSavedPose, applyCommonPose, galleries, detectPersonPose, addPerson, removePerson, switchPerson, frameEveryone, setAngle, setEditMode, setAutoFit, dispose };

(async () => {
    await viewer.init();
    if (!viewer.initialized) throw new Error('WebGL 初始化失败');
    // The official QI2.1 workflow runs with the skydome disabled; it would otherwise be captured.
    viewer.setDirectionalSkydomeVisible(false);
    refreshControls();
    if (embedded) parent.postMessage({ type: 'fisher-ready' }, location.origin);
    pack = await loadBodyPack();
    if (embedded && !pendingPayload) return; // start() runs when the node payload arrives
    await start(pendingPayload);
})().catch(showError);
