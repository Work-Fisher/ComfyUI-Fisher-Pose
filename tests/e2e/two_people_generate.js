// Two people end to end: wire a second person photo, pose both in the editor, apply, and queue a real
// generation (needs the Qwen 2.1 models + VNCCS LoRA). Person photos are taken from the workflow's
// LoadImage plus `window.__secondPerson` (an input-folder file name) set by the caller, or a default.
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const app = window.app;
  const node = app.graph._nodes.find(n => (n.comfyClass || n.type) === 'FisherQwenFreePose');
  const first = app.graph._nodes.find(n => n.type === 'LoadImage');
  first.widgets.find(w => w.name === 'image').value = 'pasted/image (2).png';
  const second = LiteGraph.createNode('LoadImage');
  app.graph.add(second);
  second.widgets.find(w => w.name === 'image').value = window.__secondPerson || 'ComfyUI_00001_ugqsg_1788686764.png';
  second.connect(0, node, node.inputs.findIndex(i => i.name === 'reference_image_2'));
  node.widgets.find(w => w.name === 'pose_json').value = '{}';
  for (const [name, value] of [['width', 1536], ['height', 1024]]) node.widgets.find(w => w.name === name).value = value;
  node.widgets.find(w => w.type === 'button').callback();
  let frame;
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    frame = document.querySelector('dialog iframe');
    if (frame?.contentWindow?.freePose && frame.contentDocument.querySelector('#loading').hidden) break;
  }
  const fp = frame.contentWindow.freePose, byId = id => fp.galleries.common.find(e => e.spec.id === id);
  fp.applyCommonPose(byId('hands-up'));
  fp.addPerson(); await sleep(300);
  fp.applyCommonPose(byId('point')); await sleep(200);
  fp.frameEveryone(); await sleep(300);
  const report = { preview2: !!frame.contentDocument.querySelector('#detect-person') };
  frame.contentDocument.querySelector('#apply-editor').click();
  for (let i = 0; i < 60 && document.querySelector('dialog'); i++) await sleep(250);
  await sleep(800);
  const data = JSON.parse(node.widgets.find(w => w.name === 'pose_json').value);
  report.people = data.people?.length;
  report.file = data.poseReferenceFile?.filename;
  const { output } = await app.graphToPrompt();
  const response = await fetch('/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: output }) });
  const queued = await response.json();
  if (!queued.prompt_id) return JSON.stringify({ ...report, queueError: queued });
  let result;
  for (let i = 0; i < 400 && !result; i++) { await sleep(2000); result = (await (await fetch(`/history/${queued.prompt_id}`)).json())[queued.prompt_id]; }
  report.status = result?.status?.status_str;
  report.messages = result?.status?.messages?.filter(m => m[0] === 'execution_error').map(m => m[1].exception_message);
  const outputs = Object.values(result?.outputs || {});
  report.images = outputs.flatMap(o => o.images || []).filter(i => i.type === 'output').map(i => `${i.subfolder}/${i.filename}`);
  report.prompt = outputs.map(o => o.fisher_prompt?.[0] || o.text?.[0]).filter(Boolean)[0];
  return JSON.stringify(report, null, 1);
})()
