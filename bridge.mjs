const $ = selector => document.querySelector(selector);
const studio = window.poseStudio;
const embedded = new URLSearchParams(location.search).has('embedded');
const hints = {
    '仅视角': '只接提示词口；请断开 image_2 的骨架连线。',
    '仅姿态': '骨架接 image_2；文本可用本节点输出，也可自行填写。',
    '视角＋姿态': '提示词接 prompt，骨架图接 image_2。',
};
function prompt(state) {
    const directions = ['正前方','左前方','左侧','左后方','正后方','右后方','右侧','右前方'];
    const angle = ((state.azimuth - state.bodyAngle) % 360 + 360) % 360;
    const direction = directions[Math.floor((angle + 22.5) / 45) % 8];
    const camera = state.elevation > 25 ? '高机位俯拍' : state.elevation < -7 ? '低机位仰拍' : '接近平视的机位';
    const framing = state.distance < 3 ? '近景构图' : '全身构图，完整保留头部与双脚';
    const cameraText = `将拍摄机位调整至人物自身的${direction}，采用${camera}，${framing}。`;
    const mode = $('#output-mode').value;
    let text;
    if (mode === '仅视角') text = '以图1为人物与场景参考，保持人物身份、面部特征、发型、服装及原有身体动作一致。' + cameraText + '背景随新机位呈现合理的透视与遮挡关系，保持原有场景内容和视觉风格。';
    else if (mode === '仅姿态') text = '以图1为人物外观参考，保持人物身份、面部特征、发型和服装一致。图2为姿态骨架参考，按照图2调整人物肢体位置、动作和画面占比。生成完整自然的人体，最终图像不出现骨架线条或关节点。';
    else text = '以图1为人物外观参考，保持人物身份、面部特征、发型和服装一致。图2为目标机位下的姿态骨架参考，按照图2调整人物动作、肢体位置及画面占比。' + cameraText + '人物投影与图2保持一致，背景随机位自然变化，最终图像不出现骨架线条或关节点。';
    const extra = $('#extra-prompt').value.trim();
    return text + (extra ? '\n补充要求：' + extra : '');
}
function sync() {
    $('#mode-help').textContent = hints[$('#output-mode').value];
    studio.setPromptProvider(prompt);
}
$('#output-mode').onchange = sync;
$('#extra-prompt').oninput = sync;
function sizeChanged() {
    const width = Number($('#output-width').value), height = Number($('#output-height').value);
    if ([width, height].every(value => Number.isInteger(value) && value >= 64 && value <= 4096)) studio.setSize(width, height);
}
$('#output-width').onchange = sizeChanged;
$('#output-height').onchange = sizeChanged;
window.addEventListener('fisher-size', event => {
    $('#output-width').value = event.detail.width;
    $('#output-height').value = event.detail.height;
});
window.addEventListener('message', event => {
    if (event.source !== parent || event.origin !== location.origin || event.data?.type !== 'fisher-load') return;
    try {
        const payload = event.data.payload;
        $('#output-mode').value = payload.output_mode;
        $('#extra-prompt').value = payload.extra_prompt;
        studio.load(payload);
        sync();
    } catch (error) {
        $('#save-status').textContent = '场景读取失败：' + error.message;
        $('#apply-editor').disabled = true;
    }
});
$('#cancel-editor').onclick = () => parent.postMessage({type:'fisher-close'},location.origin);
$('#apply-editor').onclick = () => {
    if (!$('#output-width').checkValidity() || !$('#output-height').checkValidity()) {
        $('#output-width').reportValidity();$('#output-height').reportValidity();return;
    }
    sizeChanged();
    parent.postMessage({type:'fisher-apply',payload:{
        scene_json:studio.serialize(),output_mode:$('#output-mode').value,
        width:Number($('#output-width').value),height:Number($('#output-height').value),
        extra_prompt:$('#extra-prompt').value,
    }},location.origin);
};
sync();
if (embedded) parent.postMessage({type:'fisher-ready'},location.origin);
else { $('#apply-editor').hidden=true;$('#cancel-editor').hidden=true; }
