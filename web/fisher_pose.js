import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { keepIfSame as keepIfUnchanged } from "./apply_state.mjs";
import { scalarInput, cameraEnabled } from "./workflow_controls.mjs";
import { verifyBindingRuntime } from "./binding_runtime.mjs";
import { photoSlots, reconcilePortraits, routePortraitInputs } from "./portrait_inputs.mjs";

const EDITORS = {
    studio: { url: new URL("./editor/studio.html", import.meta.url), version: "20260922-preview2", title: "Fisher 机位与姿态编辑器",
              fields: ["scene_json", "output_mode", "width", "height", "extra_prompt"], data: "scene_json", image: "reference_image_1" },
    freePose: { url: new URL("./editor/freepose.html", import.meta.url), version: "20261008-portrait-inputs", title: "Fisher 姿势与镜头",
                fields: ["pose_json", "extra_prompt"], data: "pose_json", image: "reference_image" },
};
const FREE_POSE_NODES = ["FisherQwenFreePose", "FisherPoseImage"];
const editorFor = node => FREE_POSE_NODES.includes(node.comfyClass || node.type) ? EDITORS.freePose : EDITORS.studio;
const widget = (node, name) => node?.widgets?.find(item => item.name === name);
let activeEditor = null;
let serializeGraph;

function styleWorkflowControl(node) {
    const role = node.properties?.fisherControl;
    if (!role) return;
    const control = widget(node, "value");
    if (!control) return;
    if (role === "enable_camera") control.options = { ...control.options, on: "开启 · 全流程", off: "关闭 · 仅姿势" };
    if (role === "width" || role === "height") control.options = { ...control.options, min: 64, max: 4096, step: 160 };
}

// Prefer the actual upstream image preview, falling back to LoadImage's file name.
function upstreamPreview(node,inputName){
    const input=node.inputs?.find(i=>i.name===inputName);
    let link=input?.link,seen=new Set();
    for(let depth=0;link!=null&&depth<12;depth++){
        const edge=(node.graph || app.graph).links[link];if(!edge)return null;
        const source=(node.graph || app.graph).getNodeById(edge.origin_id);if(!source||seen.has(source.id))return null;seen.add(source.id);
        const preview=source.imgs?.[source.imageIndex||0]?.src;if(preview)return preview;
        if(source.comfyClass==='LoadImage'||source.type==='LoadImage'){
            const file=source.widgets?.find(w=>w.name==='image')?.value;
            if(typeof file==='string'&&file){const cleaned=file.replace(/ \[(input|output|temp)\]$/,'');const slash=cleaned.lastIndexOf('/');return new URL('/view?'+new URLSearchParams({filename:cleaned.slice(slash+1),subfolder:slash>=0?cleaned.slice(0,slash):'',type:'input'}),location.origin).href;}
        }
        link=source.inputs?.find(i=>i.type==='IMAGE'&&i.link!=null)?.link;
    }
    return null;
}

// Content hash for file names (crypto.subtle is missing when ComfyUI is opened over a LAN IP).
async function contentHash(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let a = 2166136261, b = 0x9e3779b9;
    for (let i = 0; i < bytes.length; i++) { a = Math.imul(a ^ bytes[i], 16777619); b = Math.imul(b ^ bytes[i], 0x85ebca6b); }
    return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0") + bytes.length.toString(16);
}

async function uploadPng(dataUrl, prefix, type, subfolder = "") {
    const blob = await (await fetch(dataUrl)).blob();
    const form = new FormData();
    form.append("image", blob, `${prefix}_${await contentHash(blob)}.png`);
    form.append("type", type);
    form.append("subfolder", subfolder);
    form.append("overwrite", "true");
    const response = await api.fetchApi("/upload/image", { method: "POST", body: form });
    if (!response.ok) throw new Error(`upload failed: HTTP ${response.status}`);
    const { name, subfolder: savedFolder } = await response.json();
    return { filename: name, subfolder: savedFolder ?? subfolder, type };
}

// The mannequin PNG goes to input/fisher_pose/ instead of riding in the workflow as base64
// (a workflow shrinks from ~900KB to ~100KB). The name is a content hash, so a new pose is a new
// file and therefore a new node input. AIFISHER Canvas still sends base64, which the node accepts.
async function storePoseReference(poseJson) {
    const data = JSON.parse(poseJson);
    if (typeof data.poseReference !== "string" || !data.poseReference.startsWith("data:image/png;base64,")) return poseJson;
    data.poseReferenceFile = await uploadPng(data.poseReference, "pose", "input", "fisher_pose");
    delete data.poseReference;
    if (typeof data.shotPreview === "string" && data.shotPreview.startsWith("data:image/png;base64,")) {
        data.shotPreviewFile = await uploadPng(data.shotPreview, "shot", "input", "fisher_pose");
        delete data.shotPreview;
    }
    return JSON.stringify(data);
}

// Show the applied mannequin image right away (on the node and on PreviewImage nodes fed by
// its 人偶姿态图 output) without running the workflow. The frontend draws previews from
// app.nodeOutputs, which must point at a served file.
async function showPoseImage(node, shotData = null) {
    let data;
    try { data = JSON.parse(widget(node, "pose_json")?.value || "{}"); } catch { return; }
    if (shotData) data = { ...data, ...shotData };
    let image = data.poseReferenceFile;
    if (!image?.filename) {
        if (typeof data.poseReference !== "string" || !data.poseReference.startsWith("data:image/png;base64,")) return;
        image = await uploadPng(data.poseReference, "fisher_freepose", "temp");  // older workflows keep base64
    }
    const images = [{ filename: image.filename, subfolder: image.subfolder || "", type: image.type || "input" }];
    const graph = node.graph || app.graph;
    const slot = node.outputs?.findIndex(output => output.type === "IMAGE") ?? -1;
    const previews = (node.outputs?.[slot]?.links || []).map(id => graph.getNodeById(graph.links[id]?.target_id))
        .filter(target => target?.type === "PreviewImage");
    const useShot = cameraEnabled(shotNodeFor(node)) && data.anyAngle?.enabled && data.anyAngle?.camera;
    let shot = useShot ? data.shotPreviewFile : null;
    if (useShot && !shot && data.shotPreview) shot = await uploadPng(data.shotPreview, "fisher_shot", "temp");
    app.nodeOutputs[node.id] = { ...(app.nodeOutputs[node.id] || {}), images: shot ? [shot] : images };
    for (const target of previews) app.nodeOutputs[target.id] = { ...(app.nodeOutputs[target.id] || {}), images };
    app.graph.setDirtyCanvas(true, true);
}

// --- Studio workflow wiring --------------------------------------------------------------------
// The pose node's 姿势数据 output feeds a FisherShot node (the camera shot is kept there, so changing
// only the shot keeps the front result cached), which feeds the camera branch and FisherPoseResult.
// Older workflows wire 姿势数据 straight to those nodes and keep the shot inside pose_json.
const SHOT_KEYS = ["anyAngle", "shotPreviewFile", "shotPreview"];
const graphOf = node => node.graph || app.graph;
const outputTargets = (node, name) => {
    const graph = graphOf(node), slot = node.outputs?.findIndex(o => o.name === name) ?? -1;
    return (node.outputs?.[slot]?.links || []).map(id => graph.getNodeById(graph.links[id]?.target_id)).filter(Boolean);
};
const shotNodeFor = node => outputTargets(node, "姿势数据").find(n => n.type === "FisherShot") || null;
const shotConsumers = node => { const shot = shotNodeFor(node); return shot ? outputTargets(shot, "姿势与镜头") : outputTargets(node, "姿势数据"); };
const resultNodeFor = node => shotConsumers(node).find(n => n.type === "FisherPoseResult") || null;
const parseJson = text => { try { return JSON.parse(text || "{}"); } catch { return {}; } };

function splitShot(poseJson) {
    const pose = parseJson(poseJson), shot = {};
    for (const key of SHOT_KEYS) if (key in pose) { shot[key] = pose[key]; delete pose[key]; }
    return { pose: JSON.stringify(pose), shot: JSON.stringify(shot), shotData: shot };
}

async function inputFileExists(file) {
    const query = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder || "", type: file.type || "input" });
    return (await api.fetchApi(`/view?${query}`, { method: "HEAD" })).ok;
}
const keepIfSame = (previous, next) => keepIfUnchanged(previous, next, inputFileExists);

function upstream(graph, node, inputName, seen = new Set()) {
    const stack = [];
    for (const input of node.inputs || []) if ((inputName == null || input.name === inputName) && input.link != null) stack.push(input.link);
    while (stack.length) {
        const source = graph.getNodeById(graph.links[stack.pop()]?.origin_id);
        if (!source || seen.has(source.id)) continue;
        seen.add(source.id);
        for (const input of source.inputs || []) if (input.link != null) stack.push(input.link);
    }
    return seen;
}

// Mute (LiteGraph NEVER = 2) every node that only serves the camera result when the shot is front:
// ComfyUI then neither runs nor validates them, so front-only users need no TripoSplat / AnyAngle files.
function setCameraBranch(node, on) {
    const result = resultNodeFor(node);
    if (!result) return;
    const graph = graphOf(node);
    on = on && cameraEnabled(shotNodeFor(node));
    const keep = new Set([result.id, ...upstream(graph, result, "front_image"), ...upstream(graph, result, "pose_json")]);
    const branch = new Set([...upstream(graph, result, "camera_image")].filter(id => !keep.has(id)));
    // Previews and other leaves that only read from the branch go with it.
    for (let grew = true; grew;) {
        grew = false;
        for (const other of graph._nodes) {
            if (branch.has(other.id) || keep.has(other.id)) continue;
            const linked = (other.inputs || []).filter(i => i.link != null).map(i => graph.links[i.link]?.origin_id);
            if (linked.length && linked.every(id => branch.has(id))) { branch.add(other.id); grew = true; }
        }
    }
    for (const id of branch) { const n = graph.getNodeById(id); if (n) n.mode = on ? 0 : 2; }
}

function syncCameraBranches(graph = app.graph, preview = false) {
    for (const node of graph?._nodes || []) {
        if (node.type !== "FisherQwenFreePose") continue;
        const shot = shotNodeFor(node);
        const shotData = shot ? parseJson(widget(shot, "shot_json")?.value) : null;
        const data = { ...parseJson(widget(node, "pose_json")?.value), ...shotData };
        setCameraBranch(node, Boolean(data.anyAngle?.enabled && data.anyAngle?.camera));
        if (preview) void showPoseImage(node, shotData).catch(() => {});
    }
    graph?.setDirtyCanvas(true, true);
}

// The front pass's samplers (fed by the pose node's conditioning).
function frontSamplers(node) {
    const graph = graphOf(node);
    return graph._nodes.filter(n => /KSampler/.test(n.type) && (n.inputs || []).some(i => i.name === "positive" && i.link != null && graph.links[i.link]?.origin_id === node.id));
}

async function openEditor(node, { autoApply = false, inputSlots = null } = {}) {
    if (node.type === 'FisherQwenFreePose' && !inputSlots) {
        const raw = await serializeGraph.call(app);
        inputSlots = photoSlots(raw.output[node.id]?.inputs || {});
        if (!inputSlots.length) throw new Error('请至少启用一张人物照片，再打开编辑器。');
    }
    activeEditor?.();
    let resolveEditor, rejectEditor, applyTimeout, applied = false;
    const completed = new Promise((resolve, reject) => { resolveEditor = resolve; rejectEditor = reject; });
    const editor = editorFor(node);
    const overlay = document.createElement("dialog");
    overlay.style.cssText = "width:96vw;max-width:1700px;height:94vh;max-height:1100px;padding:0;border:1px solid #dce3ed;border-radius:12px;background:#f4f6f8;box-shadow:0 20px 90px #0007;overflow:hidden;";
    const frame = document.createElement("iframe");
    frame.title = editor.title;
    frame.style.cssText = "border:0;width:100%;height:100%;display:block";
    frame.src = editor.url.href + "?embedded=1&v=" + editor.version;
    const referencePicker = document.createElement("input");
    referencePicker.type = "file";
    referencePicker.accept = "image/*";
    referencePicker.hidden = true;
    referencePicker.addEventListener("click", event => event.stopPropagation());
    // Keep the picker inside the active modal, invoked synchronously by the user click.
    frame.fisherChooseReference = onFile => {
        referencePicker.value = "";
        referencePicker.onchange = () => {
            const file = referencePicker.files[0];
            if (file) onFile(file);
        };
        referencePicker.click();
    };
    // Multi-file / folder variant for the free-pose OpenPose gallery.
    frame.fisherChooseFiles = (onFiles, { directory = false } = {}) => {
        const picker = document.createElement("input");
        picker.type = "file";
        picker.accept = "image/*";
        picker.multiple = true;
        picker.webkitdirectory = directory;
        picker.hidden = true;
        picker.addEventListener("click", event => event.stopPropagation());
        picker.onchange = () => { if (picker.files.length) onFiles([...picker.files]); picker.remove(); };
        overlay.append(picker);
        picker.click();
    };
    overlay.append(frame, referencePicker);
    const oldFocus = document.activeElement;
    function close() {
        clearTimeout(applyTimeout);
        window.removeEventListener("message", receive);
        frame.contentWindow?.freePose?.dispose?.();
        overlay.close();
        overlay.remove();
        oldFocus?.focus();
        activeEditor = null;
        if (autoApply && !applied) rejectEditor(new Error('人物输入切换未完成，本次未排队。'));
        else resolveEditor();
    }
    let applying = false;
    async function receive(event) {
        if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
        if (event.data?.type === 'fisher-editor-error' && autoApply) { rejectEditor(new Error(event.data.message)); close(); return; }
        if (event.data?.type === "fisher-ready") {
            const payload = Object.fromEntries(
                editor.fields.map(name => [name, widget(node, name).value])
            );
            if (node.comfyClass === "FisherQwenPose" || node.type === "FisherQwenPose") {
                payload.qwenBinding = {
                    peEnabled: node.inputs?.find(input => input.name === "pe_clip")?.link != null,
                    count: [1, 2, 3].filter(i => node.inputs?.find(input => input.name === `reference_image_${i}`)?.link != null).length,
                    assignments: [1, 2, 3].map(i => widget(node, `person_${i}_reference`).value),
                };
            }
            if (editor === EDITORS.freePose) {
                const targets = shotConsumers(node);
                const shotNode = shotNodeFor(node);
                if (shotNode) payload.pose_json = JSON.stringify({ ...parseJson(payload.pose_json), ...parseJson(widget(shotNode, "shot_json")?.value) });
                if (inputSlots) {
                    const reconciled = reconcilePortraits(parseJson(payload.pose_json), inputSlots);
                    payload.pose_json = JSON.stringify(reconciled.data);
                    payload.referenceSlots = inputSlots;
                    payload.inputsChanged = reconciled.needsCapture;
                }
                payload.autoApply = autoApply;
                payload.studio = {
                    camera: targets.some(n => n?.type === "FisherAnyAngleCamera") && targets.some(n => n?.type === "FisherPoseResult"),
                    canGenerate: node.type === "FisherQwenFreePose",
                    canOpenWorkflow: true,
                    cameraEnabled: cameraEnabled(shotNode),
                    outputWidth: scalarInput(node, "width", 1024),
                    outputHeight: scalarInput(node, "height", 1024),
                };
            }
            payload.referencePreview=upstreamPreview(node,editor.image);
            payload.referencePreview2=editor===EDITORS.freePose?upstreamPreview(node,"reference_image_2"):null;
            payload.referenceImage2Connected = Boolean(node.inputs?.find(input => input.name === "reference_image_2")?.link != null);
            if (inputSlots) {
                const previews = [payload.referencePreview, payload.referencePreview2];
                payload.referencePreview = previews[inputSlots[0] - 1];
                payload.referencePreview2 = inputSlots.length === 2 ? previews[1] : null;
                payload.referenceImage2Connected = inputSlots.length === 2;
            }
            frame.contentWindow.postMessage({ type: "fisher-load", payload }, location.origin);
        }
        if (event.data?.type === "fisher-close") close();
        if (event.data?.type === "fisher-open-workflow") {
            try {
                const response = await api.fetchApi("/fisher_pose/studio_workflow");
                if (!response.ok) throw new Error("请重启 ComfyUI，加载新版插件后重试。");
                await app.loadGraphData(await response.json(), true, true, "【Work-Fisher】无限姿势+无限视角（支持双人）.json");
                close();
            } catch (error) {
                frame.contentWindow.postMessage({ type: "fisher-error", message: error.message }, location.origin);
            }
        }
        if (event.data?.type === "fisher-apply") {
            if (applying) return;
            const payload = { ...event.data.payload };
            if (typeof payload[editor.data] !== "string") return;
            applying = true;
            try {
                const shotNode = editor === EDITORS.freePose ? shotNodeFor(node) : null;
                const before = { pose: widget(node, editor.data).value, shot: shotNode ? widget(shotNode, "shot_json")?.value : null };
                let shotData = null;
                if (editor === EDITORS.freePose) {
                    try { payload.pose_json = await storePoseReference(payload.pose_json); }
                    catch (error) { console.warn("Fisher: mannequin kept inline in the workflow", error); }
                    if (shotNode) {
                        const parts = splitShot(payload.pose_json);
                        payload.pose_json = parts.pose;
                        shotData = parts.shotData;
                        const item = widget(shotNode, "shot_json");
                        item.value = await keepIfSame(before.shot, parts.shot);
                        item.callback?.(item.value);
                    }
                    payload.pose_json = await keepIfSame(before.pose, payload.pose_json);
                    const angle = (shotData || parseJson(payload.pose_json)).anyAngle || {};
                    setCameraBranch(node, Boolean(angle.enabled && angle.camera));
                }
                for (const name of editor.fields) {
                    const item = widget(node, name);
                    item.value = payload[name];
                    item.callback?.(item.value);
                }
                node.setDirtyCanvas(true, true);
                (node.graph || app.graph).change();
                if (editor === EDITORS.freePose) {
                    // A preview that fails to upload must not stop the generation.
                    showPoseImage(node, shotData).catch(error => console.warn("Fisher: preview not shown", error));
                }
                if (event.data.generate) {
                    // Same pose and shot again = "another one": new front seed. A changed shot alone
                    // keeps the seed, so the cached front result and its 3D reconstruction are reused.
                    const unchanged = before.pose === widget(node, editor.data).value && (!shotNode || before.shot === widget(shotNode, "shot_json")?.value);
                    if (unchanged) for (const sampler of frontSamplers(node)) {
                        const seed = widget(sampler, "seed");
                        if (seed) seed.value = Math.floor(Math.random() * 2 ** 48) + 1;
                    }
                    const queued = await app.queuePrompt(0, 1);
                    if (queued === false) throw new Error("未能加入队列，请检查工作流的图片、模型和节点连接。姿势已保存。");
                }
                applied = true;
                close();
            } catch (error) {
                frame.contentWindow.postMessage({ type: "fisher-error", message: error.message }, location.origin);
                if (autoApply) { rejectEditor(error); close(); }
            } finally { applying = false; }
        }
    }
    window.addEventListener("message", receive);
    overlay.addEventListener("cancel", event => { event.preventDefault(); close(); });
    document.body.append(overlay);
    overlay.showModal();
    activeEditor = close;
    if (autoApply) applyTimeout = setTimeout(() => {
        const status = frame.contentDocument?.querySelector('#loading-text')?.textContent || '';
        rejectEditor(new Error(`人物切换超时，请打开编辑器检查人偶后重试。${status}`)); close();
    }, 60000);
    return completed;
}

app.registerExtension({
    name: "Fisher.PoseStudio",
    setup() {
        const graphToPrompt = app.graphToPrompt;
        serializeGraph = graphToPrompt;
        app.graphToPrompt = async function (...args) {
            // Also cover programmatic widget changes and workflows loaded before this extension.
            syncCameraBranches();
            let result = await graphToPrompt.apply(this, args);
            for (const node of app.graph._nodes) {
                if (node.type !== 'FisherQwenFreePose' || !result.output[node.id]) continue;
                const slots = photoSlots(result.output[node.id].inputs);
                const { data, needsCapture } = reconcilePortraits(parseJson(widget(node, 'pose_json').value), slots);
                if (needsCapture) {
                    await openEditor(node, { autoApply: true, inputSlots: slots });
                } else if (data.portraitState) {
                    const item = widget(node, 'pose_json'), value = JSON.stringify(data);
                    if (item.value !== value) { item.value = value; item.callback?.(value); graphOf(node).change(); }
                }
            }
            // Capture both API inputs and saved workflow metadata after reconciliation.
            result = await graphToPrompt.apply(this, args);
            for (const value of Object.values(result.output)) if (value.class_type === 'FisherQwenFreePose') routePortraitInputs(value.inputs);
            await verifyBindingRuntime(result.output, async () => {
                const response = await api.fetchApi("/fisher_pose/env", { cache: "no-store" });
                if (!response.ok) throw new Error("Backend unavailable");
                return response.json();
            }, location.origin);
            return result;
        };
    },
    afterConfigureGraph() {
        for (const node of app.graph._nodes) styleWorkflowControl(node);
        syncCameraBranches();
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (["PrimitiveBoolean", "FisherShot"].includes(nodeData.name)) {
            const created = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const result = created?.apply(this, arguments);
                const control = widget(this, nodeData.name === "FisherShot" ? "enable_camera" : "value");
                if (control) {
                    const callback = control.callback;
                    control.callback = (...args) => {
                        const result = callback?.apply(control, args);
                        syncCameraBranches(this.graph, true);
                        return result;
                    };
                }
                return result;
            };
            const connectionsChanged = nodeType.prototype.onConnectionsChange;
            nodeType.prototype.onConnectionsChange = function () {
                const result = connectionsChanged?.apply(this, arguments);
                setTimeout(() => syncCameraBranches(this.graph, true), 0);
                return result;
            };
        }
        if (!["FisherPoseStudio", "FisherQwenPose", ...FREE_POSE_NODES].includes(nodeData.name)) return;
        const freePose = FREE_POSE_NODES.includes(nodeData.name);
        const original = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = original?.apply(this, arguments);
            const scene = widget(this, freePose ? "pose_json" : "scene_json");
            scene.type = "fisher_hidden";
            scene.computeSize = () => [0, -4];
            if (scene.element) scene.element.style.display = "none";
            this.addWidget("button", freePose ? "编辑姿势与镜头" : "打开机位与姿态编辑器", null, () => { void openEditor(this).catch(error => app.extensionManager.toast.add({ severity: 'error', summary: 'Fisher Pose', detail: error.message, life: 6000 })); }, { serialize: false });
            this.size = freePose ? [380, 300] : nodeData.name === "FisherQwenPose" ? [420, 470] : [350, 290];
            return result;
        };
        if (!freePose) return;
        // Workflows saved with a pose show it again on load; outputs are reset while loading, so wait a tick.
        const configure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const result = configure?.apply(this, arguments);
            setTimeout(() => syncCameraBranches(this.graph, true), 600);
            return result;
        };
    },
});
