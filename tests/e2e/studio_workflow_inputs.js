(async () => {
  const { app } = await import('/scripts/app.js');
  const check = async () => {
    const { output } = await app.graphToPrompt();
    const encoder = Object.values(output).find(n => n.class_type === 'FisherAnyAngleEncode');
    if (!encoder) throw new Error('Missing fixed camera encoder');
    for (const key of ['clip', 'vae', 'front_image', 'camera_image']) {
      const edge = encoder.inputs[key];
      if (!Array.isArray(edge) || !output[edge[0]]) throw new Error('Disconnected camera input: ' + key);
    }
    if (output[encoder.inputs.camera_image[0]].class_type !== 'FisherAnyAngleCamera') throw new Error('Camera reference is not a coarse render');
  };
  await check();
  const graph = app.graph.serialize();
  await app.loadGraphData(graph, true, true, 'Fisher-Pose-Studio');
  await check();
  return { passed: true, checks: ['all four required inputs', 'camera reference source', 'save and reload preserves inputs'] };
})()
