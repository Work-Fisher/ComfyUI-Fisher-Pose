// Does a capture taken right after a pose change show the new pose, or the previous one?
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const node = window.app.graph._nodes.find(n => (n.comfyClass || n.type) === 'FisherQwenFreePose');
  node.widgets.find(w => w.name === 'pose_json').value = '{}';
  node.widgets.find(w => w.type === 'button').callback();
  let frame;
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    frame = document.querySelector('dialog iframe');
    if (frame?.contentWindow?.freePose && frame.contentDocument.querySelector('#loading').hidden && !frame.contentDocument.querySelector('#apply-editor').disabled) break;
  }
  const fp = frame.contentWindow.freePose;
  const shot = async () => JSON.parse(await fp.serialize()).poseReference;
  const load = n => fp.importEntry({ key: `builtin:${n}.png`, name: `${n}.png`, url: `/fisher_pose/builtin_poses/${n}.png` });
  const results = {};
  await load(12); await sleep(800);
  const a = await shot();
  await load(91);
  const bImmediate = await shot();          // what 应用到节点 sends if clicked right away
  await sleep(1500);
  const bLater = await shot();
  // The same through a bone slider: change a rotation, capture at once.
  const v = fp.viewer;
  v.bones.upperarm_l.rotation.z += 1.2; v.bones.upperarm_l.updateMatrixWorld(true);
  const cImmediate = await shot();
  await sleep(1500);
  const cLater = await shot();
  results.importImmediateEqualsPrevious = bImmediate === a;
  results.importLaterEqualsPrevious = bLater === a;
  results.importImmediateEqualsLater = bImmediate === bLater;
  results.sliderImmediateEqualsBefore = cImmediate === bLater;
  results.sliderImmediateEqualsLater = cImmediate === cLater;
  results.sliderLaterEqualsBefore = cLater === bLater;
  document.querySelector('dialog')?.close();
  return JSON.stringify(results, null, 1);
})()
