(async () => {
  const { app } = await import('/scripts/app.js');
  const { sameState } = await import('/extensions/ComfyUI-Fisher-Pose/apply_state.mjs');
  const node = app.graph._nodes.find(n => n.type === 'FisherQwenFreePose');
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  async function open() {
    node.widgets.find(w => w.type === 'button').callback();
    for (let i = 0; i < 200; i++) {
      await sleep(100);
      const frame = document.querySelector('dialog iframe');
      if (frame?.contentWindow.freePose && frame.contentDocument.querySelector('#loading').hidden) return frame;
    }
    throw Error('editor did not open');
  }
  async function apply(frame) {
    frame.contentDocument.querySelector('#apply-editor').click();
    for (let i = 0; i < 100 && document.querySelector('dialog iframe'); i++) await sleep(100);
    assert(!document.querySelector('dialog iframe'), 'apply did not close');
  }
  let frame = await open(), fp = frame.contentWindow.freePose;
  if (!fp.doc.people) fp.addPerson();
  fp.switchPerson(0);
  fp.setAutoFit(true);
  // Finish the initial fit before measuring camera-only edits.
  for (let i = 0; i < 3; i++) await fp.serialize();
  await apply(frame);
  const source = node.widgets.find(w => w.name === 'pose_json').value;
  const cases = [[60, 25], [-65, 40], [90, 0], [0, 55]];
  for (const [yaw, pitch] of cases) {
    frame = await open(); fp = frame.contentWindow.freePose;
    const before = JSON.parse(JSON.stringify(fp.doc.people.map(p => p.transform)));
    fp.setAngle({ yaw, pitch });
    // Let the actual debounced fit and preview render run, as in pointer interaction.
    await sleep(350);
    assert(sameState(before, fp.doc.people.map(p => p.transform)), `camera ${yaw}/${pitch} changed people transforms`);
    await apply(frame);
    assert(node.widgets.find(w => w.name === 'pose_json').value === source, `camera ${yaw}/${pitch} invalidated the front pose cache`);
  }
  frame = await open(); fp = frame.contentWindow.freePose;
  const enabled = JSON.parse(await fp.serialize());
  frame.contentDocument.querySelector('#camera-enabled').click();
  const disabled = JSON.parse(await fp.serialize());
  assert(sameState(enabled.anyAngle, disabled.anyAngle), 'auto fit overwrote the disabled camera');
  await apply(frame);
  frame = await open(); fp = frame.contentWindow.freePose;
  frame.contentDocument.querySelector('#camera-enabled').click();
  assert(sameState(enabled.anyAngle, JSON.parse(await fp.serialize()).anyAngle), 're-enable lost the saved camera');
  await apply(frame);
  assert(node.widgets.find(w => w.name === 'pose_json').value === source, 'camera switch invalidated the front pose cache');
  return { passed: true, cases, checks: ['auto fit', 'debounced interaction', 'apply', 'reopen', 'camera off/on', 'unchanged front pose cache'] };
})()
