// Legacy two-stage builder for tests/fixtures only. Do not run on 【Work-Fisher】无限姿势+无限视角（支持双人）.json, which
// already includes the camera branch and selects the final image with FisherPoseResult.
(async () => {
  const app = window.app, graph = app.graph;
  if (graph._nodes.some(n => n.type === "FisherAnyAngleCamera")) throw new Error("Camera branch already exists; use the shipped 【Work-Fisher】无限姿势+无限视角（支持双人）.json.");
  const byType = type => graph._nodes.find(n => (n.comfyClass || n.type) === type);
  const unet = byType('UNETLoader'), clip = byType('CLIPLoader'), vae = byType('VAELoader'), pose = byType('FisherQwenFreePose');
  const decoded = byType('VAEDecode');
  const baseBottom = Math.max(...graph._nodes.map(n => n.pos[1] + n.size[1])) + 120;
  const left = Math.min(...graph._nodes.map(n => n.pos[0]));
  const add = (type, x, y, values = {}, title) => {
    const node = LiteGraph.createNode(type);
    graph.add(node);
    node.pos = [left + x, baseBottom + y];
    for (const [name, value] of Object.entries(values)) {
      const widget = node.widgets?.find(w => w.name === name);
      if (!widget) throw new Error(`${type} has no widget ${name}`);
      widget.value = value;
    }
    if (title) node.title = title;
    return node;
  };
  const input = (node, name) => {
    const index = node.inputs.findIndex(i => i.name === name || i.name.endsWith('.' + name) || i.widget?.name === name);
    if (index < 0) throw new Error(`${node.type} has no input ${name}: ${node.inputs.map(i => i.name)}`);
    return index;
  };
  const link = (from, slot, to, name) => from.connect(slot, to, input(to, name));

  // Splat of the posed result.
  const bgModel = add('LoadBackgroundRemovalModel', 0, 0, { bg_removal_name: 'birefnet.safetensors' });
  const bgRemove = add('RemoveBackground', 0, 130);
  link(bgModel, 0, bgRemove, 'bg_removal_model'); link(decoded, 0, bgRemove, 'image');
  const prep = add('TripoSplatPreprocessImage', 340, 0, { erode_radius: 1, size: 1024 });
  link(decoded, 0, prep, 'image'); link(bgRemove, 0, prep, 'mask');
  const dino = add('CLIPVisionLoader', 340, 200, { clip_name: 'dino_v3_vit_h.safetensors' });
  const flux2 = add('VAELoader', 340, 320, { vae_name: 'flux2-vae.safetensors' }, 'Flux2 VAE（TripoSplat 用）');
  const cond = add('TripoSplatConditioning', 700, 0);
  link(dino, 0, cond, 'clip_vision'); link(flux2, 0, cond, 'vae'); link(prep, 0, cond, 'image');
  const tripo = add('UNETLoader', 700, 200, { unet_name: 'triposplat_fp16.safetensors', weight_dtype: 'default' }, 'TripoSplat 模型');
  const splatSampler = add('KSampler', 1040, 0, { seed: 46, control_after_generate: 'fixed', steps: 20, cfg: 3, sampler_name: 'dpmpp_2m', scheduler: 'simple', denoise: 1 }, 'KSampler（生成 3D）');
  link(tripo, 0, splatSampler, 'model'); link(cond, 0, splatSampler, 'positive'); link(cond, 1, splatSampler, 'negative'); link(cond, 2, splatSampler, 'latent_image');
  const splatVae = add('VAELoader', 1040, 330, { vae_name: 'triposplat_vae_decoder_fp16.safetensors' }, 'TripoSplat 解码器');
  const splat = add('VAEDecodeTripoSplat', 1380, 0, { num_gaussians: 262144, seed: 0 });
  link(splatSampler, 0, splat, 'samples'); link(splatVae, 0, splat, 'vae');

  // Camera from the editor; the node renders the coarse view itself (and previews it).
  const camera = add('FisherAnyAngleCamera', 1380, 200, {}, 'Fisher AnyAngle 机位（出粗渲染）');
  link(splatSampler, 0, camera, 'camera_latent');
  link(splat, 0, camera, 'splat'); link(pose, pose.outputs.findIndex(o => o.name === '姿势数据'), camera, 'pose_json'); link(decoded, 0, camera, 'image');
  const render = camera;  // output 0 = 粗渲染
  const coarse = add('PreviewImage', 1720, 0, {}, '粗渲染（新机位）');
  link(camera, 0, coarse, 'images');

  // AnyAngle redraw: posed front result = image1, coarse render = image2, CFG 1 (see fisher_anyangle.py).
  const lora = add('LoraLoaderModelOnly', 2060, 0, { lora_name: 'QI2.1_AnyAngle.safetensors', strength_model: 1 }, 'AnyAngle LoRA');
  link(unet, 0, lora, 'model');
  const encode = add('TextEncodeQwenImage21', 2060, 150, { negative_prompt: '', resolution: 1024 });
  link(clip, 0, encode, 'clip'); link(vae, 0, encode, 'vae'); link(camera, 1, encode, 'prompt');
  link(decoded, 0, encode, 'image_1'); link(render, 0, encode, 'image_2');
  const sampler = add('KSampler', 2400, 0, { seed: 42, control_after_generate: 'randomize', steps: 25, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 }, 'KSampler（换机位）');
  link(lora, 0, sampler, 'model'); link(encode, 0, sampler, 'positive'); link(encode, 1, sampler, 'negative'); link(encode, 2, sampler, 'latent_image');
  const decode2 = add('VAEDecode', 2740, 0);
  link(sampler, 0, decode2, 'samples'); link(vae, 0, decode2, 'vae');
  const save = add('SaveImage', 2740, 120, { filename_prefix: '%date:yyyy-MM-dd%/%date:yyyyMMdd_hhmmss%_AnyAngle' }, '保存（新机位）');
  link(decode2, 0, save, 'images');

  // Two labelled stages.
  const group = (title, nodes, color) => {
    const g = new LiteGraph.LGraphGroup(title);
    g.color = color;
    graph.add(g);
    const xs = nodes.flatMap(n => [n.pos[0], n.pos[0] + n.size[0]]), ys = nodes.flatMap(n => [n.pos[1], n.pos[1] + n.size[1]]);
    g.pos = [Math.min(...xs) - 20, Math.min(...ys) - 70];
    g.size = [Math.max(...xs) - Math.min(...xs) + 40, Math.max(...ys) - Math.min(...ys) + 90];
  };
  const stageOne = graph._nodes.filter(n => n.pos[1] < baseBottom - 60);
  const stageTwo = graph._nodes.filter(n => n.pos[1] >= baseBottom - 60);
  group('① 摆姿势（VNCCS PoseStudio）', stageOne, '#3f789e');
  group('② 换机位（TripoSplat + AnyAngle）：在编辑器「输出」里启用「新机位 · AnyAngle」', stageTwo, '#8a5cf6');
  graph.setDirtyCanvas(true, true);
  return JSON.stringify(graph.serialize());
})()
