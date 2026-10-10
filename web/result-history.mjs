// Read the actual completed prompt so previews and detector jobs cannot become final results.
export function dependsOn(prompt, start, target, seen = new Set()) {
    start = String(start); target = String(target);
    if (start === target) return true;
    if (seen.has(start)) return false;
    seen.add(start);
    return Object.values(prompt[start]?.inputs || {}).some(value => Array.isArray(value) && value.length === 2 && Number.isInteger(value[1]) && dependsOn(prompt, value[0], target, seen));
}
export function resultRecords(history, nodeId) {
    const records = [];
    for (const [id, job] of Object.entries(history)) {
        const prompt = job.prompt?.[2];
        if (!prompt || prompt[nodeId]?.class_type !== 'FisherQwenFreePose' || job.status?.status_str !== 'success') continue;
        for (const [outputId, output] of Object.entries(job.outputs || {})) {
            if (prompt[outputId]?.class_type !== 'SaveImage' || !dependsOn(prompt, outputId, nodeId)) continue;
            const sources = Object.entries(prompt).filter(([key, value]) => value.class_type === 'LoadImage' && dependsOn(prompt, nodeId, key)).map(([, value]) => value.inputs.image);
            for (const file of output.images || []) if (file.filename && file.type === 'output') records.push({ id, file, sources, order: job.prompt[0] });
        }
    }
    return records.sort((a, b) => b.order - a.order).slice(0, 60);
}
export function inputTargets(node) {
    const graph = node.graph;
    return ['reference_image', 'reference_image_2'].flatMap(name => {
        let link = node.inputs?.find(input => input.name === name)?.link;
        const seen = new Set();
        while (link != null) {
            const edge = graph.links[link], source = edge && graph.getNodeById(edge.origin_id);
            if (!source || seen.has(source.id) || source.mode === 2 || source.mode === 4) return [];
            seen.add(source.id);
            if ((source.comfyClass || source.type) === 'LoadImage') return [source];
            const images = source.inputs?.filter(input => input.type === 'IMAGE' && input.link != null) || [];
            if (images.length !== 1) return [];
            link = images[0].link;
        }
        return [];
    });
}
const viewURL = file => '/view?' + new URLSearchParams(file);
function sourceFile(value) {
    const type = value.match(/ \[(input|output|temp)\]$/)?.[1] || 'input';
    value = value.replace(/ \[(input|output|temp)\]$/, '');
    const slash = value.lastIndexOf('/');
    return { filename: value.slice(slash + 1), subfolder: slash < 0 ? '' : value.slice(0, slash), type };
}
export async function openResultHistory(node, api) {
    const dialog = document.createElement('dialog');
    dialog.className = 'fisher-result-history';
    dialog.style.cssText = 'width:min(1100px,94vw);max-height:90vh;padding:24px;border:1px solid #dce2ee;border-radius:18px;background:#f4f6fa;color:#202d43;font:14px system-ui';
    dialog.innerHTML = '<header style="display:flex;justify-content:space-between;align-items:center"><strong style="font-size:20px">生成历史与对照</strong><button data-close>关闭</button></header><p data-status>正在读取 ComfyUI 已完成的结果…</p><main style="display:grid;grid-template-columns:190px 1fr;gap:20px"><nav style="max-height:62vh;overflow:auto" data-list></nav><section><div style="display:flex;gap:10px" data-pictures></div><p data-detail></p><button data-use disabled>用作下轮人物图</button><button data-undo hidden>撤销替换</button></section></main>';
    const $ = selector => dialog.querySelector(selector);
    const style = document.createElement('style');
    style.textContent = '.fisher-result-history::backdrop{background:#101827aa}.fisher-result-history button{font:inherit;border:1px solid #dbe2ef;border-radius:9px;padding:9px 14px;color:#253652;background:#fff;cursor:pointer}.fisher-result-history button:hover{background:#e9efff;border-color:#879fea}.fisher-result-history button:disabled{opacity:.45;cursor:not-allowed}.fisher-result-history [data-use]{background:#3157d5;color:white;margin-right:8px}.fisher-result-history [data-status],.fisher-result-history [data-detail]{color:#5f6e85;line-height:1.6}.fisher-result-history [data-list] button:focus{outline:2px solid #3157d5}';
    dialog.append(style);
    const close = () => { dialog.close(); dialog.remove(); };
    $('[data-close]').onclick = close;
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    document.body.append(dialog); dialog.showModal();
    let selected, undo = null, busy = false;
    function picture(url, label) {
        const figure = document.createElement('figure'); figure.style.cssText = 'margin:0;flex:1;min-width:0';
        const image = document.createElement('img'); image.src = url; image.alt = label; image.style.cssText = 'width:100%;height:45vh;object-fit:contain;background:#e6e9ef;border-radius:12px';
        const caption = document.createElement('figcaption'); caption.textContent = label; caption.style.padding = '8px 0';
        figure.append(image, caption); return figure;
    }
    function select(record) {
        if (busy) return;
        selected = record;
        $('[data-pictures]').replaceChildren(...record.sources.slice(0, 2).map((name, index) => picture(viewURL(sourceFile(name)), `本次输入 ${index + 1}`)), picture(viewURL(record.file), '生成结果'));
        const targets = inputTargets(node);
        $('[data-use]').disabled = targets.length !== 1;
        $('[data-detail]').textContent = targets.length === 1 ? '替换当前启用的人物照片，姿势与镜头保持原设定；不会自动生成。' : '两张单人照分别绑定人物，结果仅供对照；请在工作流里明确选择要替换的输入。';
    }
    $('[data-use]').onclick = async () => {
        const targets = inputTargets(node); if (!selected || busy || targets.length !== 1) return;
        const target = targets[0], control = target.widgets.find(widget => widget.name === 'image'), before = control.value;
        busy = true; $('[data-use]').disabled = true;
        try {
            const response = await api.fetchApi(viewURL(selected.file));
            if (!response.ok) throw Error('结果文件已移动或删除');
            const form = new FormData(); form.append('image', await response.blob(), selected.file.filename); form.append('subfolder', 'fisher_history'); form.append('type', 'input');
            const upload = await api.fetchApi('/upload/image', { method: 'POST', body: form });
            if (!upload.ok) throw Error('无法将结果复制到输入目录');
            const file = await upload.json(), value = (file.subfolder ? file.subfolder + '/' : '') + file.name;
            if (control.value !== before || inputTargets(node).length !== 1 || inputTargets(node)[0] !== target) throw Error('上传期间人物输入发生变化，本次未替换');
            undo = { control, target, before, value };
            control.value = value; control.callback?.(value); target.setDirtyCanvas(true, true); node.graph.change();
            $('[data-undo]').hidden = false; $('[data-status]').textContent = '已作为下轮人物图，可继续编辑姿势后生成。';
        } catch (error) { $('[data-status]').textContent = error.message; }
        finally { busy = false; $('[data-use]').disabled = inputTargets(node).length !== 1; }
    };
    $('[data-undo]').onclick = () => {
        if (!undo || undo.control.value !== undo.value) { $('[data-status]').textContent = '人物输入已另行修改，不覆盖当前选择。'; return; }
        undo.control.value = undo.before; undo.control.callback?.(undo.before); undo.target.setDirtyCanvas(true, true); node.graph.change();
        undo = null; $('[data-undo]').hidden = true; $('[data-status]').textContent = '已恢复替换前的人物照片。';
    };
    try {
        const response = await api.fetchApi('/history?max_items=100');
        if (!response.ok) throw Error('读取历史失败');
        const records = resultRecords(await response.json(), node.id);
        if (!dialog.isConnected) return;
        $('[data-status]').textContent = records.length ? `最近 ${records.length} 张结果 · 来自 ComfyUI 当前保留的历史记录` : '还没有找到此 Fisher 节点的最终保存结果。生成完成后重新打开；重启或清空历史会移除记录。';
        for (const record of records) {
            const button = document.createElement('button'); button.style.cssText = 'display:block;width:100%;padding:6px;margin-bottom:8px;border-radius:10px';
            const image = document.createElement('img'); image.src = viewURL(record.file); image.loading = 'lazy'; image.alt = record.file.filename; image.style.cssText = 'width:100%;height:110px;object-fit:contain';
            button.append(image); button.title = record.file.filename; button.onclick = () => select(record); $('[data-list]').append(button);
        }
        if (records.length) select(records[0]);
    } catch (error) { $('[data-status]').textContent = error.message; }
}
