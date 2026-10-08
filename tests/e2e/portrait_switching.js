// Real ComfyUI serialization and rendering, no queueing. Use a two-photo workflow.
(async () => {
  const app = window.app, sleep = ms => new Promise(r => setTimeout(r, ms));
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const getPose = () => app.graph._nodes.find(n => n.type === 'FisherQwenFreePose');
  const poseValue = () => JSON.parse(getPose().widgets.find(w => w.name === 'pose_json').value);
  const photoIds = ['reference_image', 'reference_image_2'].map(name => app.graph.links[getPose().inputs.find(i => i.name === name).link].origin_id);
  const snapshots = [];
  const initial = poseValue();
  // IK handles are in world space and move during auto fit. Compare the rig's
  // local bone rotations/translations and model rotation, which define its pose.
  const shape = pose => Object.fromEntries(['bones','bonePositions','modelRotation','hipBonePosition'].map(key => [key, pose?.[key]]));
  const shapes = state => (state.people ? state.people.map(p => p.pose) : [state.pose]).map(shape);
  const same = (a,b) => {
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a-b) < 0.00001;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return a === b;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every(k => same(a[k], b[k]));
  };
  for (const [name, modes, active] of [
    ['both', [0,0], [1,2]], ['only_first', [0,4], [1]],
    ['only_second', [4,0], [2]], ['restored_both', [0,0], [1,2]],
    ['muted_first', [2,0], [2]], ['muted_second', [0,2], [1]],
    ['restored_again', [0,0], [1,2]],
  ]) {
    photoIds.forEach((id,index) => { app.graph.getNodeById(id).mode = modes[index]; });
    let serialized;
    try { serialized = await app.graphToPrompt(); } catch (error) { throw new Error(`${name}: ${error.message}`); }
    const { output, workflow } = serialized;
    const node = getPose(), inputs = output[node.id].inputs, state = JSON.parse(inputs.pose_json);
    assert(state.people?.length === (active.length === 2 ? 2 : undefined), `${name}: mannequin count`);
    assert(same(state.portraitState.activeSlots, active), `${name}: source binding`);
    assert(inputs.reference_image[0] == photoIds[active[0]-1], `${name}: first encoded identity`);
    assert(Boolean(inputs.reference_image_2) === (active.length === 2), `${name}: image count`);
    if (active.length === 2) assert(inputs.reference_image_2[0] == photoIds[1], `${name}: second encoded identity`);
    const currentShapes = shapes(state);
    active.forEach((slot,index) => {
      if (!same(currentShapes[index], shape(initial.people[slot-1].pose))) {
        const changes = [];
        const diff = (a,b,path='pose') => {
          if (same(a,b)) return;
          if (a && b && typeof a === 'object' && typeof b === 'object') {
            for (const key of new Set([...Object.keys(a),...Object.keys(b)])) diff(a[key], b[key], path+'.'+key);
          } else changes.push([path,a,b]);
        };
        diff(currentShapes[index],shape(initial.people[slot-1].pose));
        throw new Error(`${name}: slot ${slot}: ${JSON.stringify(changes.slice(0,6))}`);
      }
    });
    assert(state.poseReference || state.poseReferenceFile?.filename, `${name}: no capture`);
    const stored = workflow.nodes.find(n => String(n.id) === String(node.id));
    assert(stored.widgets_values.some(v => typeof v === 'string' && v === inputs.pose_json), `${name}: saved metadata differs`);
    snapshots.push({ name, active, output });
    await app.loadGraphData(workflow);
    await sleep(100);
  }
  photoIds.forEach(id => { app.graph.getNodeById(id).mode = 4; });
  let blocked = false;
  try { await app.graphToPrompt(); } catch (error) { blocked = /至少启用一张/.test(error.message); }
  assert(blocked, 'Both disabled must block');
  return JSON.stringify({ passed: true, blockedEmpty: blocked, snapshots });
})()
