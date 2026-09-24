// Shared local image input for the prototype and ComfyUI editor.
export function setupReference(toast, onReferenceChange=()=>{}) {
    const input=document.querySelector('#reference-file'), area=document.querySelector('#upload-label');
    const image=document.querySelector('#reference-image'), opacity=document.querySelector('#opacity');
    const clear=document.querySelector('#clear-reference'), control=document.querySelector('#opacity-control');
    let currentUrl=null, revision=0;
    area.tabIndex=0;
    area.setAttribute('role','button');
    input.hidden=true;
    area.setAttribute('aria-label','参考图：点击选择、拖入文件，或按 Ctrl+V 粘贴图片');
    area.querySelector('small').textContent='点击选择 · 拖入文件 · Ctrl+V 粘贴';
    async function load(file) {
        if(!file)return;
        if(file.size>20*1024*1024){toast('图片需小于 20 MB');return;}
        const token=++revision, url=URL.createObjectURL(file), probe=new Image();
        try {
            probe.src=url;
            await probe.decode();
            if(token!==revision){URL.revokeObjectURL(url);return;}
            const previous=currentUrl;currentUrl=url;
            image.src=url;image.hidden=false;image.style.opacity=Number(opacity.value)/100;
            area.style.backgroundImage=`linear-gradient(#ffffffaa,#ffffffaa),url("${url}")`;
            area.querySelector('b').textContent=file.name||'已放入参考图';
            area.querySelector('small').textContent=`${probe.naturalWidth} × ${probe.naturalHeight} · 点击替换 / Ctrl+V`;
            control.hidden=false;clear.hidden=false;
            if(previous)URL.revokeObjectURL(previous);
            toast('参考图已载入，可调整透明度');
            onReferenceChange(probe);
        } catch {
            URL.revokeObjectURL(url);
            if(token===revision)toast('无法读取这张图片，请改用 PNG、JPG 或 WebP');
        }
    }
    input.onchange=()=>{const file=input.files[0];input.value='';void load(file);};
    function chooseReference() {
        try {
            const chooseInHost=window.frameElement?.fisherChooseReference;
            if(chooseInHost)chooseInHost(file=>void load(file));
            else input.click();
        } catch { toast('文件窗口未能打开，请拖入图片或 Ctrl+V 粘贴'); }
    }
    area.onclick=e=>{
        if(e.target===input)return;
        e.preventDefault();e.stopPropagation();chooseReference();
    };
    area.onkeydown=e=>{if(e.target===area&&(e.key==='Enter'||e.key===' ')){e.preventDefault();chooseReference();}};
    area.ondragover=e=>{e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='copy';};
    area.ondrop=e=>{
        e.preventDefault();e.stopPropagation();
        const file=e.dataTransfer.files[0]||[...e.dataTransfer.items].find(item=>item.kind==='file')?.getAsFile();
        if(file)void load(file);else toast('这次拖入的不是图片文件，请复制图片后 Ctrl+V，或选择本地图片');
    };
    document.addEventListener('paste',e=>{
        if(e.target.matches('input:not([type=file]),textarea,[contenteditable=true]'))return;
        const file=[...(e.clipboardData?.items||[])].find(item=>item.kind==='file'&&item.type.startsWith('image/'))?.getAsFile();
        if(file){e.preventDefault();e.stopPropagation();void load(file);}
    });
    opacity.oninput=()=>image.style.opacity=Number(opacity.value)/100;
    clear.onclick=()=>{
        revision++;onReferenceChange(null);image.hidden=true;image.removeAttribute('src');area.style.backgroundImage='none';
        area.querySelector('b').textContent='放入人物参考图';area.querySelector('small').textContent='点击选择 · 拖入文件 · Ctrl+V 粘贴';
        control.hidden=true;clear.hidden=true;input.value='';
        if(currentUrl)URL.revokeObjectURL(currentUrl);currentUrl=null;
    };
}
