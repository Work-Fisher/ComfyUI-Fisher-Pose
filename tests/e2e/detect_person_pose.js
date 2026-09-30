// 从人物图识别姿势: needs comfyui_controlnet_aux and an input image at input/fisher_pose/e2e_person.png.
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const app = window.app;
  const node = app.graph._nodes.find(n => (n.comfyClass || n.type) === 'FisherQwenFreePose');
  const loader = app.graph._nodes.find(n => n.type === 'LoadImage');
  loader.widgets.find(w => w.name === 'image').value = 'fisher_pose/e2e_person.png';
  loader.imgs = undefined;  // make the editor fall back to the LoadImage file name
  node.widgets.find(w => w.name === 'pose_json').value = '{}';
  node.widgets.find(w => w.type === 'button').callback();
  let frame;
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    frame = document.querySelector('dialog iframe');
    if (frame?.contentWindow?.freePose && frame.contentDocument.querySelector('#loading').hidden) break;
  }
  const d = frame.contentDocument;
  for (let i = 0; i < 20 && d.querySelector('#detect-person').hidden; i++) await sleep(250);
  const report = { buttonShown: !d.querySelector('#detect-person').hidden };
  const started = performance.now();
  d.querySelector('#detect-person').click();
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    const text = d.querySelector('#import-status').textContent;
    if (/已按人物图|识别失败/.test(text)) { report.status = text; break; }
  }
  report.seconds = Math.round((performance.now() - started) / 100) / 10;
  const reference = JSON.parse(await frame.contentWindow.freePose.serialize()).poseReference;
  const image = new Image(); image.src = reference; await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = Math.round(300 * image.height / image.width);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  report.thumb = canvas.toDataURL('image/jpeg', 0.85);
  document.querySelector('dialog')?.close();
  return JSON.stringify(report);
})()
