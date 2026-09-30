(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const app = window.app;
  const node = app.graph._nodes.find(n => (n.comfyClass || n.type) === 'FisherQwenFreePose');
  const widget = name => node.widgets.find(w => w.name === name);
  widget('pose_json').value = '{}';  // a brand-new pose: the mannequin should take the person photo's shape
  const report = { env: await (await fetch('/fisher_pose/env')).json() };
  const openEditor = async () => {
    node.widgets.find(w => w.type === 'button').callback();
    let frame;
    for (let i = 0; i < 120; i++) {
      await sleep(500);
      frame = document.querySelector('dialog iframe');
      const fp = frame?.contentWindow?.freePose;
      if (fp && frame.contentDocument.querySelector('#loading').hidden && !frame.contentDocument.querySelector('#apply-editor').disabled) break;
    }
    return frame;
  };
  const applyPose = async (frame, n) => {
    const w = frame.contentWindow;
    await w.freePose.importEntry({ key: `builtin:${n}.png`, name: `${n}.png`, url: `/fisher_pose/builtin_poses/${n}.png` });
    await sleep(600);
    frame.contentDocument.querySelector('#apply-editor').click();
    for (let i = 0; i < 60 && document.querySelector('dialog'); i++) await sleep(250);
    await sleep(800);
    const data = JSON.parse(widget('pose_json').value);
    const { output } = await app.graphToPrompt();
    return { file: data.poseReferenceFile, inline: 'poseReference' in data, size: [data.width, data.height],
             queued: JSON.parse(output[String(node.id)].inputs.pose_json).poseReferenceFile?.filename,
             widgetChars: widget('pose_json').value.length, preview: app.nodeOutputs[node.id]?.images?.[0] };
  };
  let frame = await openEditor();
  const d = frame.contentDocument;
  report.personButtonShown = !d.querySelector('[data-ratio=person]').hidden;
  report.personButtonActive = d.querySelector('[data-ratio=person]').classList.contains('active');
  report.bannerHidden = d.querySelector('#env-banner').hidden;
  report.first = await applyPose(frame, 12);
  frame = await openEditor();
  report.second = await applyPose(frame, 91);
  const check = async f => (await fetch('/view?' + new URLSearchParams({ filename: f.filename, subfolder: f.subfolder, type: 'input' }))).status;
  report.firstServed = await check(report.first.file);
  report.secondServed = await check(report.second.file);
  report.workflowKB = Math.round(JSON.stringify(app.graph.serialize()).length / 1024);
  return JSON.stringify(report, null, 1);
})()
