// Pose + new camera angle end to end on the AnyAngle workflow (needs all Qwen 2.1, VNCCS, TripoSplat and
// AnyAngle models). Run with --workflow "workflows/Fisher-Pose-Studio.json".
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const app = window.app;
  const node = app.graph._nodes.find(n => (n.comfyClass || n.type) === 'FisherQwenFreePose');
  app.graph._nodes.find(n => n.type === 'LoadImage').widgets.find(w => w.name === 'image').value = 'pasted/image (2).png';
  node.widgets.find(w => w.name === 'pose_json').value = '{}';
  for (const [name, value] of [['width', 1024], ['height', 1024]]) node.widgets.find(w => w.name === name).value = value;
  node.widgets.find(w => w.type === 'button').callback();
  let frame;
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    frame = document.querySelector('dialog iframe');
    if (frame?.contentWindow?.freePose?.viewer?.skinnedMesh && frame.contentDocument.querySelector('#loading').hidden) break;
  }
  const d = frame.contentDocument, fp = frame.contentWindow.freePose;
  if (!fp?.viewer?.skinnedMesh) return JSON.stringify({ editorNotReady: d?.querySelector('#loading-text')?.textContent });
  fp.applyCommonPose(fp.galleries.common.find(e => e.spec.id === (window.__pose || 'hands-up')));
  for (const [id, value] of [['#output-width', 1024], ['#output-height', 1024]]) { const i = d.querySelector(id); i.value = value; i.dispatchEvent(new Event('change')); }
  fp.setEditMode('camera');
  for (const [id, value] of [['#angle-yaw', window.__yaw ?? 40], ['#angle-pitch', window.__pitch ?? 20]]) { const i = d.querySelector(id); i.value = value; i.dispatchEvent(new Event('input')); }
  await sleep(800);
  const report = { anglePreview: !!d.querySelector('#angle-preview').getAttribute('src') };
  d.querySelector('#apply-editor').click();
  for (let i = 0; i < 60 && document.querySelector('dialog'); i++) await sleep(250);
  await sleep(800);
  report.angle = JSON.parse(node.widgets.find(w => w.name === 'pose_json').value).anyAngle;
  const { output } = await app.graphToPrompt();
  const queued = await (await fetch('/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: output }) })).json();
  if (!queued.prompt_id) return JSON.stringify({ ...report, queueError: queued });
  let result;
  for (let i = 0; i < 600 && !result; i++) { await sleep(2000); result = (await (await fetch(`/history/${queued.prompt_id}`)).json())[queued.prompt_id]; }
  report.status = result?.status?.status_str;
  report.errors = result?.status?.messages?.filter(m => m[0] === 'execution_error').map(m => `${m[1].node_type}: ${m[1].exception_message}`);
  report.images = Object.entries(result?.outputs || {}).flatMap(([id, o]) => (o.images || []).map(i => `${id} ${i.type} ${i.subfolder}/${i.filename}`));
  return JSON.stringify(report, null, 1);
})()
