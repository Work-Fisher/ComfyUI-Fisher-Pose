import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const EDITORS = {
    studio: { url: new URL("./editor/studio.html", import.meta.url), version: "20260922-preview2", title: "Fisher 机位与姿态编辑器",
              fields: ["scene_json", "output_mode", "width", "height", "extra_prompt"], data: "scene_json", image: "reference_image_1" },
    freePose: { url: new URL("./editor/freepose.html", import.meta.url), version: "20260930-4", title: "Fisher 自由姿势编辑器",
                fields: ["pose_json", "extra_prompt"], data: "pose_json", image: "reference_image" },
};
const FREE_POSE_NODES = ["FisherQwenFreePose", "FisherPoseImage"];
const editorFor = node => FREE_POSE_NODES.includes(node.comfyClass || node.type) ? EDITORS.freePose : EDITORS.studio;
const widget = (node, name) => node.widgets.find(item => item.name === name);
let activeEditor = null;

// Prefer the actual upstream image preview, falling back to LoadImage's file name.
function upstreamPreview(node,inputName){
    const input=node.inputs?.find(i=>i.name===inputName);
    let link=input?.link,seen=new Set();
    for(let depth=0;link!=null&&depth<12;depth++){
        const edge=app.graph.links[link];if(!edge)return null;
        const source=app.graph.getNodeById(edge.origin_id);if(!source||seen.has(source.id))return null;seen.add(source.id);
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
    return JSON.stringify(data);
}

// Show the applied mannequin image right away (on the node and on PreviewImage nodes fed by
// its 人偶姿态图 output) without running the workflow. The frontend draws previews from
// app.nodeOutputs, which must point at a served file.
async function showPoseImage(node) {
    let data;
    try { data = JSON.parse(widget(node, "pose_json")?.value || "{}"); } catch { return; }
    let image = data.poseReferenceFile;
    if (!image?.filename) {
        if (typeof data.poseReference !== "string" || !data.poseReference.startsWith("data:image/png;base64,")) return;
        image = await uploadPng(data.poseReference, "fisher_freepose", "temp");  // older workflows keep base64
    }
    const images = [{ filename: image.filename, subfolder: image.subfolder || "", type: image.type || "input" }];
    const slot = node.outputs?.findIndex(output => output.type === "IMAGE") ?? -1;
    const previews = (node.outputs?.[slot]?.links || []).map(id => app.graph.getNodeById(app.graph.links[id]?.target_id))
        .filter(target => target?.type === "PreviewImage");
    for (const target of [node, ...previews]) app.nodeOutputs[target.id] = { ...(app.nodeOutputs[target.id] || {}), images };
    app.graph.setDirtyCanvas(true, true);
}

function openEditor(node) {
    activeEditor?.();
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
        window.removeEventListener("message", receive);
        overlay.close();
        overlay.remove();
        oldFocus?.focus();
        activeEditor = null;
    }
    async function receive(event) {
        if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
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
            payload.referencePreview=upstreamPreview(node,editor.image);
            payload.referencePreview2=editor===EDITORS.freePose?upstreamPreview(node,"reference_image_2"):null;
            frame.contentWindow.postMessage({ type: "fisher-load", payload }, location.origin);
        }
        if (event.data?.type === "fisher-close") close();
        if (event.data?.type === "fisher-apply") {
            const payload = { ...event.data.payload };
            if (typeof payload[editor.data] !== "string") return;
            if (editor === EDITORS.freePose) {
                try { payload.pose_json = await storePoseReference(payload.pose_json); }
                catch (error) { console.warn("Fisher: mannequin kept inline in the workflow", error); }
            }
            for (const name of editor.fields) {
                const item = widget(node, name);
                item.value = payload[name];
                item.callback?.(item.value);
            }
            node.setDirtyCanvas(true, true);
            app.graph.change();
            close();
            if (editor === EDITORS.freePose) void showPoseImage(node).catch(error => console.warn("Fisher: pose preview failed", error));
        }
    }
    window.addEventListener("message", receive);
    overlay.addEventListener("cancel", event => { event.preventDefault(); close(); });
    document.body.append(overlay);
    overlay.showModal();
    activeEditor = close;
}

app.registerExtension({
    name: "Fisher.PoseStudio",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (!["FisherPoseStudio", "FisherQwenPose", ...FREE_POSE_NODES].includes(nodeData.name)) return;
        const freePose = FREE_POSE_NODES.includes(nodeData.name);
        const original = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = original?.apply(this, arguments);
            const scene = widget(this, freePose ? "pose_json" : "scene_json");
            scene.type = "fisher_hidden";
            scene.computeSize = () => [0, -4];
            if (scene.element) scene.element.style.display = "none";
            this.addWidget("button", freePose ? "打开自由姿势编辑器" : "打开机位与姿态编辑器", null, () => openEditor(this), { serialize: false });
            this.size = freePose ? [380, 300] : nodeData.name === "FisherQwenPose" ? [420, 470] : [350, 290];
            return result;
        };
        if (!freePose) return;
        // Workflows saved with a pose show it again on load; outputs are reset while loading, so wait a tick.
        const configure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const result = configure?.apply(this, arguments);
            setTimeout(() => void showPoseImage(this).catch(() => {}), 600);
            return result;
        };
    },
});
