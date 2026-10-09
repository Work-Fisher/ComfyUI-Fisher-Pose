// Playwright function. Requires an open Fisher editor; uses real mouse drags on XYZ handles.
async (page) => {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const state = () => page.evaluate(() => {
    const fp = document.querySelector('dialog iframe').contentWindow.freePose;
    return { transform: { ...fp.doc.transform }, bones: fp.viewer.getPose().bones,
      other: fp.doc.people?.[1 - fp.doc.active], autoFit: fp.doc.autoFit };
  });
  await page.evaluate(async () => {
    const f = document.querySelector('dialog iframe'), fp = f.contentWindow.freePose;
    if (!fp.doc.people) fp.addPerson();
    fp.switchPerson(0);
    await fp.serialize();
    f.contentDocument.querySelector('[data-pose-tool="move"]').click();
    const v = fp.viewer;
    v.camera.position.copy(v.orbit.target).add(new v.THREE.Vector3(28, 18, 36));
    v.orbit.update(); v.requestRender();
  });
  const close = (a, b) => Math.abs(a - b) < 1e-6;
  async function drag(axis) {
    const point = await page.evaluate(axis => {
      const f = document.querySelector('dialog iframe'), v = f.contentWindow.freePose.viewer;
      v.scene.updateMatrixWorld(true); v.camera.updateMatrixWorld(true);
      const rect = v.canvas.getBoundingClientRect(), frame = f.getBoundingClientRect();
      const screen = p => { p.project(v.camera); return { x: frame.x + rect.x + (p.x + 1) * rect.width / 2, y: frame.y + rect.y + (1 - p.y) * rect.height / 2 }; };
      const handle = v.transform._gizmo.gizmo.translate.children.find(h => h.name === axis && h.visible);
      handle.geometry.computeBoundingBox();
      const p = screen(handle.geometry.boundingBox.getCenter(new v.THREE.Vector3()).applyMatrix4(handle.matrixWorld));
      const origin = v.transform.object.position.clone(), next = origin.clone(); next[axis.toLowerCase()] += 1;
      const a = screen(origin), b = screen(next), length = Math.hypot(b.x-a.x, b.y-a.y);
      return { ...p, dx: 35*(b.x-a.x)/length, dy: 35*(b.y-a.y)/length };
    }, axis);
    await page.mouse.move(point.x, point.y);
    assert(await page.evaluate(() => document.querySelector('dialog iframe').contentWindow.freePose.viewer.transform.axis) === axis, axis + ' handle is not selectable');
    await page.mouse.down();
    await page.mouse.move(point.x + point.dx, point.y + point.dy, { steps: 8 });
    await page.mouse.up();
  }
  for (const axis of ['X', 'Y', 'Z']) {
    const before = await state(); await drag(axis); const after = await state();
    assert(!close(before.transform[axis.toLowerCase()], after.transform[axis.toLowerCase()]), axis + ' did not move');
    for (const key of ['x', 'y', 'z'].filter(k => k !== axis.toLowerCase())) assert(close(before.transform[key], after.transform[key]), axis + ' changed ' + key);
    assert(JSON.stringify(before.bones) === JSON.stringify(after.bones), axis + ' changed bone pose');
    for (const key of ['x','y','z','zoom']) assert(close(before.other.transform[key], after.other.transform[key]), axis + ' moved other person');
    assert(JSON.stringify(before.other.pose.bones) === JSON.stringify(after.other.pose.bones), axis + ' changed other pose');
    assert(!after.autoFit, 'auto fit reset manual placement');
  }
  const moved = await state();
  await page.evaluate(() => document.querySelector('dialog iframe').contentWindow.freePose.viewer.undo());
  assert(!close(moved.transform.z, (await state()).transform.z), 'undo did not restore depth');
  await page.evaluate(() => document.querySelector('dialog iframe').contentWindow.freePose.viewer.redo());
  assert(close(moved.transform.z, (await state()).transform.z), 'redo lost depth');
  const render = await page.evaluate(async () => {
    const f = document.querySelector('dialog iframe'), fp = f.contentWindow.freePose;
    const a = JSON.parse(await fp.serialize());
    f.contentDocument.querySelector('[data-pose-tool="joints"]').click();
    const b = JSON.parse(await fp.serialize());
    f.contentDocument.querySelector('[data-pose-tool="move"]').click();
    fp.switchPerson(1);
    return { hiddenFromOutput: a.poseReference === b.poseReference && a.shotPreview === b.shotPreview,
      attached: fp.viewer.transform.object?.name === 'Fisher person movement', active: fp.doc.active };
  });
  assert(render.hiddenFromOutput, 'movement handles leaked into output');
  assert(render.attached && render.active === 1, 'person switch lost movement tool');
  const secondBefore = await state(); await drag('Z'); const secondAfter = await state();
  assert(!close(secondBefore.transform.z, secondAfter.transform.z), 'second person did not move');
  assert(JSON.stringify(secondBefore.other) === JSON.stringify(secondAfter.other), 'second drag moved first person');
  const expected = await page.evaluate(async () => {
    const f = document.querySelector('dialog iframe'), fp = f.contentWindow.freePose;
    const transforms = JSON.parse(await fp.serialize()).people.map(p => p.transform);
    f.contentDocument.querySelector('#apply-editor').click();
    return transforms;
  });
  await page.waitForFunction(() => !document.querySelector('dialog iframe'));
  await page.evaluate(() => app.graph._nodes.find(n => n.type === 'FisherQwenFreePose').widgets.find(w => w.type === 'button').callback());
  await page.waitForFunction(() => document.querySelector('dialog iframe')?.contentDocument.querySelector('#loading')?.hidden);
  const restored = await page.evaluate(() => document.querySelector('dialog iframe').contentWindow.freePose.doc.people.map(p => p.transform));
  for (let i=0; i<2; i++) for (const key of ['x','y','z','zoom']) assert(close(expected[i][key], restored[i][key]), 'reopen lost person ' + i + '/' + key);
  const modes = await page.evaluate(() => {
    const f = document.querySelector('dialog iframe'), d = f.contentDocument, fp = f.contentWindow.freePose;
    d.querySelector('[data-pose-tool="move"]').click();
    const shot = JSON.stringify(fp.doc.anyAngle);
    d.querySelector('#movement-view').click();
    const shotUnchanged = JSON.stringify(fp.doc.anyAngle) === shot;
    d.querySelector('#mode-camera').click();
    const cameraClean = !fp.viewer.transform.object && d.querySelector('#movement-tools').hidden;
    d.querySelector('#mode-pose').click();
    const restored = fp.viewer.transform.object?.name === 'Fisher person movement';
    d.querySelector('[data-pose-tool="joints"]').click();
    const jointsRestored = fp.viewer.options.enablePoseInteraction && fp.viewer.transform.mode === 'rotate';
    return {shotUnchanged, cameraClean, restored, jointsRestored};
  });
  assert(Object.values(modes).every(Boolean), 'mode conflict: ' + JSON.stringify(modes));
  return {passed: true, checks: ['real X/Y/Z drag', 'axis constraints', 'pose unchanged', 'other person unchanged', 'undo/redo', 'clean capture', 'second person drag', 'save/reopen', 'observation only', 'camera/joint mode restoration']};
}
