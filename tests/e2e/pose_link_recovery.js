// Run in the isolated ComfyUI page with a saved mannequin reference.
// Reproduce backend validation first, then queue the repaired three-node CPU workflow.
(async () => {
  const { app } = await import('/scripts/app.js');
  const backup = app.graph.serialize();
  const pose = app.graph._nodes.find(n => n.type === 'FisherQwenFreePose').widgets.find(w => w.name === 'pose_json').value;
  const bad = {
    '1': { class_type: 'FisherPoseImage', inputs: { extra_prompt: '', pose_json: pose } },
    '2': { class_type: 'FisherShot', inputs: { pose_json: ['1', 5], shot_json: '{}' } },
    '3': { class_type: 'PreviewAny', inputs: { source: ['2', 0] } },
  };
  const post = async prompt => {
    const response = await fetch('/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) });
    return { status: response.status, body: await response.json() };
  };
  const broken = await post(bad);
  if (broken.status !== 400 || !JSON.stringify(broken.body).includes('tuple index out of range')) throw Error('Original validation failure not reproduced');
  try {
    app.graph.clear();
    const source = LiteGraph.createNode('FisherPoseImage');
    const shot = LiteGraph.createNode('FisherShot');
    const preview = LiteGraph.createNode('PreviewAny');
    for (const node of [source, shot, preview]) app.graph.add(node);
    source.widgets.find(w => w.name === 'pose_json').value = pose;
    source.connect(2, shot, 0); shot.connect(0, preview, 0);
    const link = app.graph.links[shot.inputs[0].link];
    link.origin_slot = 5;
    const output = (await app.graphToPrompt()).output;
    if (link.origin_slot !== 2 || output[shot.id].inputs.pose_json[1] !== 2) throw Error('Stale link was not corrected during serialization');
    const repaired = await post(output);
    if (!repaired.body.prompt_id) throw Error(JSON.stringify(repaired));
    window.__poseLinkRecovery = { validationStatus: broken.status, repairedSlot: link.origin_slot, job: repaired.body };
    return window.__poseLinkRecovery;
  } finally { app.graph.configure(backup); }
})()
