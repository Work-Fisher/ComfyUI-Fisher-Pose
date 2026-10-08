(async () => {
  const { app } = await import('/scripts/app.js');
  // The shipped workflow starts in pose-only mode. Enable the real scalar control
  // so graph serialization includes the camera branch; do not queue generation.
  const control = app.graph._nodes.find(n => n.type === 'PrimitiveBoolean').widgets.find(w => w.name === 'value');
  control.value = true;
  control.callback?.(true);
  await new Promise(resolve => setTimeout(resolve, 800));
  const check = async () => {
    const { output } = await app.graphToPrompt();
    const encoder = Object.values(output).find(n => n.class_type === 'FisherAnyAngleEncode');
    if (!encoder) throw new Error('Missing fixed camera encoder');
    for (const key of ['clip', 'vae', 'front_image', 'camera_image']) {
      const edge = encoder.inputs[key];
      if (!Array.isArray(edge) || !output[edge[0]]) throw new Error('Disconnected camera input: ' + key);
    }
    const camera = output[encoder.inputs.camera_image[0]];
    if (camera.class_type !== 'FisherAnyAngleCamera') throw new Error('Camera reference is not a coarse render');
    const sourceCamera = camera.inputs.camera_latent;
    const splatDecode = output[camera.inputs.splat[0]];
    if (!sourceCamera || JSON.stringify(sourceCamera) !== JSON.stringify(splatDecode.inputs.samples)) {
      throw new Error('Camera must use the same sampled TripoSplat latent as the geometry decoder');
    }
  };
  await check();
  const graph = app.graph.serialize();
  await app.loadGraphData(graph, true, true, 'Fisher-Pose-Studio');
  await new Promise(resolve => setTimeout(resolve, 800));
  await check();
  return { passed: true, checks: ['all four required inputs', 'camera reference source', 'save and reload preserves inputs'] };
})()
