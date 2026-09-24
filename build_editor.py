"""Copy the local prototype into an isolated ComfyUI iframe; no external downloads."""
from pathlib import Path
import shutil

root = Path(__file__).resolve().parent
source = root.parent / "pose-studio"
target = root / "web" / "editor"
target.mkdir(parents=True, exist_ok=True)
(target / "vendor").mkdir(exist_ok=True)
for name in ["three.module", "three.core"]:
    text = (source / "vendor" / (name + ".js")).read_text(encoding="utf-8")
    (target / "vendor" / (name + ".mjs")).write_text(text.replace("./three.core.js", "./three.core.mjs"), encoding="utf-8")
shutil.copy2(source / "vendor" / "LICENSE", target / "vendor" / "LICENSE")
html = (source / "index.html").read_text(encoding="utf-8").replace('src="app.js"', 'src="app.mjs"')
html = html.replace('交互原型', 'ComfyUI 节点').replace('本地自动保存', '编辑后应用到节点')
html = html.replace('本版可导出骨架图与场景。<br>尚未连接 ComfyUI 生成工作流。', '提示词 → prompt<br>骨架图 → image_2，原图 → image_1')
html = html.replace('本地预览 · 不调用生成模型', '应用到节点后，运行 ComfyUI 工作流')
html = html.replace('<div id="camera-panel">', '<section class="output-settings"><label>输出用途<select id="output-mode"><option>视角＋姿态</option><option>仅视角</option><option>仅姿态</option></select></label><p id="mode-help" class="muted"></p><div class="dimensions"><label>宽<input id="output-width" type="number" min="64" max="4096" step="8" value="768"></label><label>高<input id="output-height" type="number" min="64" max="4096" step="8" value="1024"></label></div></section><div id="camera-panel">')
html = html.replace('<p id="description"></p>', '<p id="description"></p><label class="extra-label">补充要求<textarea id="extra-prompt" placeholder="例如：保留原图服装与光照"></textarea></label>')
html = html.replace('<span class="description-note">与当前机位实时同步</span>', '<span class="description-note">这段文本会从节点提示词口输出</span>')
html = html.replace('</div></header>', '<button id="cancel-editor">取消</button><button id="apply-editor" class="primary">应用到节点</button></div></header>', 1)
(target / "index.html").write_text(html, encoding="utf-8")
css = (source / "style.css").read_text(encoding="utf-8")
css += '''\n.output-settings label,.extra-label{font-size:11px;color:#667895;display:block}.output-settings select{display:block;width:100%;padding:9px;margin:10px 0;border:1px solid #dce3ed;border-radius:6px;background:white;color:#263347}.output-settings .muted{margin:0 0 14px}.dimensions{display:flex;gap:10px}.dimensions label{flex:1;min-width:0}.dimensions input{width:100%;margin-top:7px;padding:7px;border:1px solid #dce3ed;border-radius:5px;color:#263347}.extra-label textarea{width:100%;resize:vertical;min-height:70px;border:1px solid #dce3ed;border-radius:5px;margin-top:8px;padding:8px;font:inherit}.description-section p{white-space:pre-wrap}.header-actions #export-scene{display:none}.header-actions #export-pose{background:white;color:#263347;border-color:#dce3ed}.output-settings{margin-top:0}.right-panel .panel-tabs{margin-bottom:15px}.output-note{padding-bottom:12px}\n'''
(target / "style.css").write_text(css, encoding="utf-8")
js = (source / "app.js").read_text(encoding="utf-8")

def replace(old, new):
    global js
    if old not in js:
        raise RuntimeError(f"Prototype changed, missing anchor: {old[:90]}")
    js = js.replace(old, new)

replace('./vendor/three.module.js', './vendor/three.module.mjs')
replace("const storageKey='fisher-pose-studio-v1';", "const storageKey='fisher-pose-comfy-v1';const embedded=new URLSearchParams(location.search).has('embedded');let outputWidth=768,outputHeight=1024;let promptProvider=null;")
replace("const saved=JSON.parse(localStorage.getItem(storageKey)||'null')", "const saved=embedded?null:JSON.parse(localStorage.getItem(storageKey)||'null')")
replace("function persist(){try{", "function persist(){if(embedded){$('#save-status').textContent='有修改 · 点击应用到节点';return;}try{")
replace("const [a,b]=state.ratio.split(':').map(Number);frameHeight=", "const a=outputWidth,b=outputHeight;frameHeight=")
replace("$('#output-frame').style.height=frameHeight+'px';", "$('#output-frame').style.height=frameHeight+'px';camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(37)/2)*h/frameHeight));camera.updateProjectionMatrix();")
replace("function description(){const labels=", "function description(){if(promptProvider)return promptProvider(clone(state));const labels=")
replace("state.ratio=el.dataset.ratio;refresh();", "state.ratio=el.dataset.ratio;[outputWidth,outputHeight]=({'1:1':[1024,1024],'3:4':[768,1024],'16:9':[1536,864]})[state.ratio];state.outputWidth=outputWidth;state.outputHeight=outputHeight;window.dispatchEvent(new CustomEvent('fisher-size',{detail:{width:outputWidth,height:outputHeight}}));refresh();")
replace("function refresh(save=true){updateHuman();", "function refresh(save=true){if(state.outputWidth&&state.outputHeight){outputWidth=state.outputWidth;outputHeight=state.outputHeight;window.dispatchEvent(new CustomEvent('fisher-size',{detail:{width:outputWidth,height:outputHeight}}));}updateHuman();")
replace("function projectJoint(name,w,h){const world=human.localToWorld(V(...state.points[name])).project(camera);", "function projectJoint(name,w,h){const point=V(...state.points[name]);if(name==='head')point.add(V(0,-.005,.11));const world=human.localToWorld(point).project(camera);")
replace("const out=document.createElement('canvas'),[a,b]=state.ratio.split(':').map(Number);out.width=a>=b?1024:Math.round(1024*a/b);out.height=a>=b?Math.round(1024*b/a):1024;", "const out=document.createElement('canvas');out.width=outputWidth;out.height=outputHeight;")
replace("[['neck','rs'],['rs','re'],['re','rw'],['neck','ls'],['ls','le'],['le','lw'],['neck','rh'],['rh','rk'],['rk','ra'],['neck','lh'],['lh','lk'],['lk','la'],['neck','head']]", "[['neck','rs'],['neck','ls'],['rs','re'],['re','rw'],['ls','le'],['le','lw'],['neck','rh'],['rh','rk'],['rk','ra'],['neck','lh'],['lh','lk'],['lk','la'],['neck','head']]")
js += '''\nwindow.poseStudio.load=(payload)=>{const scene=JSON.parse(payload.scene_json||'{}');state={...state,...(scene.state||scene)};shots=scene.shots||[];history=[];future=[];selected=null;outputWidth=Number(payload.width);outputHeight=Number(payload.height);state.outputWidth=outputWidth;state.outputHeight=outputHeight;state.ratio=outputWidth+':'+outputHeight;refresh(false);renderShots();$('#save-status').textContent='已载入节点设置';};
window.poseStudio.serialize=()=>JSON.stringify({version:1,state,shots});
window.poseStudio.setPromptProvider=(fn)=>{promptProvider=fn;syncUI();};
window.poseStudio.setSize=(width,height)=>{outputWidth=width;outputHeight=height;state.outputWidth=width;state.outputHeight=height;state.ratio=width+':'+height;refresh(false);};
window.poseStudio.projected=()=>Object.fromEntries(Object.keys(base).map(name=>[name,projectJoint(name,outputWidth,outputHeight)]));
await import('./bridge.mjs');
'''
(target / "app.mjs").write_text(js, encoding="utf-8")
shutil.copy2(root / "bridge.mjs", target / "bridge.mjs")
print("Built iframe editor with local .mjs dependencies")
