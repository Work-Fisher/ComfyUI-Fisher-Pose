export const SDPOSE_DOWNLOAD = 'https://huggingface.co/Comfy-Org/SDPose/tree/main/checkpoints';

export async function detectorOptions() {
    const read = async name => {
        try { const response = await fetch(`/object_info/${name}`, { cache: 'no-store' }); return response.ok ? (await response.json())[name] : null; }
        catch { return null; }
    };
    const [dwpose, extractor, draw, loader] = await Promise.all(['DWPreprocessor', 'SDPoseKeypointExtractor', 'SDPoseDrawKeypoints', 'CheckpointLoaderSimple'].map(read));
    const checkpoints = (loader?.input?.required?.ckpt_name?.[0] || []).filter(name => /sdpose/i.test(name));
    return { dwpose: Boolean(dwpose), sdpose: Boolean(extractor && draw && checkpoints.length), checkpoints, dwposeSchema: dwpose };
}

export function detectionPrompt(method, filename, options, checkpoint) {
    const prompt = { 1: { class_type: 'LoadImage', inputs: { image: filename } } };
    if (method === 'sdpose') {
        if (!options.sdpose || !options.checkpoints.includes(checkpoint)) throw Error('请先安装 SDPose checkpoint 并重新检查模型');
        prompt[6] = { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } };
        prompt[2] = { class_type: 'SDPoseKeypointExtractor', inputs: { model: ['6', 0], vae: ['6', 2], image: ['1', 0], batch_size: 1 } };
        prompt[5] = { class_type: 'SDPoseDrawKeypoints', inputs: { keypoints: ['2', 0], draw_body: true, draw_hands: false, draw_face: false, draw_feet: false, draw_head: true, stick_width: 4, face_point_size: 3, score_threshold: 0.3 } };
        prompt[3] = { class_type: 'PreviewImage', inputs: { images: ['5', 0] } };
        prompt[4] = { class_type: 'PreviewAny', inputs: { source: ['2', 0] } };
    } else {
        if (!options.dwpose) throw Error('请安装 comfyui_controlnet_aux 的 DWPose 节点');
        const info = options.dwposeSchema.input.optional;
        const pick = (key, preferred) => info[key]?.[0]?.includes(preferred) ? preferred : info[key]?.[0]?.find(v => v !== 'None') || preferred;
        prompt[2] = { class_type: 'DWPreprocessor', inputs: { image: ['1', 0], detect_hand: 'disable', detect_body: 'enable', detect_face: 'disable', resolution: 1024,
            bbox_detector: pick('bbox_detector', 'yolox_l.torchscript.pt'), pose_estimator: pick('pose_estimator', 'dw-ll_ucoco_384_bs5.torchscript.pt') } };
        prompt[3] = { class_type: 'PreviewImage', inputs: { images: ['2', 0] } };
        prompt[4] = { class_type: 'PreviewAny', inputs: { source: ['2', 1] } };
    }
    return prompt;
}
