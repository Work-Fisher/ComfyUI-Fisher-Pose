(async () => {
  const { app } = await import('/scripts/app.js');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const node = app.graph._nodes.find(n => n.type === 'FisherQwenFreePose');
  const shot = app.graph._nodes.find(n => n.type === 'FisherShot');
  async function open() {
    let openError;
    Promise.resolve(node.widgets.find(w => w.type === 'button').callback()).catch(error => { openError = error; });
    for (let i = 0; i < 200; i++) {
      await sleep(200);
      if (openError) throw openError;
      const frame = document.querySelector('dialog iframe');
      if (frame?.contentWindow.freePose && frame.contentDocument.querySelector('#loading').hidden) return frame;
    }
    const frame = document.querySelector('dialog iframe');
    if (window.__testErrors?.length) throw Error(JSON.stringify({parentErrors:window.__testErrors, messages:window.__testMessages, child:frame?.contentWindow.__testMessages}));
    throw Error('editor load timed out: ' + JSON.stringify({status:frame?.contentDocument?.querySelector('#loading-text')?.textContent, doc:frame?.contentWindow.freePose?.doc?.kind, resources:frame?.contentWindow.performance.getEntriesByType('resource').filter(x=>/body_pack|\.bin/.test(x.name)).map(x=>({url:x.name,ms:x.duration,bytes:x.transferSize})), errors:frame?.contentWindow.__testErrors}));
  }
  async function apply(frame) {
    frame.contentDocument.querySelector('#apply-editor').click();
    for (let i = 0; i < 100 && document.querySelector('dialog iframe'); i++) await sleep(100);
    assert(!document.querySelector('dialog iframe'), frame.contentDocument?.querySelector('#save-status')?.textContent || 'apply did not close');
  }
  let frame = await open(), fp = frame.contentWindow.freePose, d = frame.contentDocument;
  if (!fp.doc.people) fp.addPerson();
  fp.switchPerson(0);
  d.querySelector('#fit-frame').click();
  fp.setAngle({ yaw: 0, pitch: 0, zoom: 1, offsetX: 0, offsetY: 0 });
  const full = JSON.parse(await fp.serialize());
  fp.setAngle({ zoom: 1.7, offsetY: -2 });
  const crop = JSON.parse(await fp.serialize());
  assert(full.poseReference !== crop.poseReference, 'front crop ignored by model reference');
  assert(!crop.anyAngle.enabled, 'front crop requires camera pass');
  fp.applyCommonPose(fp.galleries.common.find(p => p.spec.id === 'wave'));
  assert(fp.doc.framing.zoom === 1.7 && !fp.doc.autoFit, 'preset reset crop');
  const z = d.querySelector('#tz'); z.value = '1.5'; z.dispatchEvent(new frame.contentWindow.Event('input'));
  fp.switchPerson(1);
  z.value = '-1.5'; z.dispatchEvent(new frame.contentWindow.Event('input'));
  fp.switchPerson(0);
  assert(fp.doc.transform.z === 1.5, 'switch lost person depth');
  const toggle = d.querySelector('#camera-enabled'); toggle.checked = false; toggle.dispatchEvent(new frame.contentWindow.Event('change'));
  await apply(frame);
  let prompt = (await app.graphToPrompt()).output;
  assert(!Object.values(prompt).some(n => n.class_type === 'FisherAnyAngleCamera'), 'disabled camera branch queued');
  frame = await open(); fp = frame.contentWindow.freePose; d = frame.contentDocument;
  assert(fp.doc.framing.zoom === 1.7 && fp.doc.people[0].transform.z === 1.5 && fp.doc.people[1].transform.z === -1.5, 'reopen lost framing/depth');
  fp.setAngle({ yaw: 45, pitch: 15 });
  const disabled = JSON.parse(await fp.serialize());
  const before = disabled.poseReference;
  d.querySelector('#camera-enabled').click();
  const angled = JSON.parse(await fp.serialize());
  assert(angled.anyAngle.enabled && angled.anyAngle.camera, 'angle missing');
  assert(angled.poseReference === before, 'camera toggle changed source pose');
  assert(JSON.stringify(angled.anyAngle.camera) === JSON.stringify(disabled.anyAngle.camera), 'disabled switch overwrote saved rotated camera');
  await apply(frame);
  prompt = (await app.graphToPrompt()).output;
  assert(Object.values(prompt).some(n => n.class_type === 'FisherAnyAngleCamera'), 'editor toggle did not enable linked canvas switch');
  assert(prompt[shot.id].inputs.enable_camera, 'camera switch missing in API');
  const shotData = JSON.parse(shot.widgets.find(w => w.name === 'shot_json').value);
  assert(shotData.anyAngle.yaw === 45, 'saved camera differs from selected camera');
  const poseData = JSON.parse(node.widgets.find(w => w.name === 'pose_json').value);
  assert(poseData.framing.zoom === 1.7, 'split camera state lost crop');
  return { passed: true, checks: ['front crop capture', 'pose-only crop', 'preset preserves crop', 'duo depth', 'reopen', 'camera switch both directions', 'API camera branch', 'camera/pose separation'] };
})()
