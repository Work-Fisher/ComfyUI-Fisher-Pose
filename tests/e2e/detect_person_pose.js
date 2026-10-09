// Requires DWPose and a workflow whose first LoadImage contains a full-body photo.
// Only queues detection, never the image-generation workflow.
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const node = app.graph._nodes.find(n => n.type === 'FisherQwenFreePose');
  const widget = node.widgets.find(w => w.name === 'pose_json');
  async function open() {
    node.widgets.find(w => w.type === 'button').callback();
    for (let i = 0; i < 160; i++) {
      await sleep(250);
      const frame = document.querySelector('dialog iframe');
      if (frame?.contentWindow.freePose && frame.contentDocument.querySelector('#loading').hidden) return frame;
    }
    throw Error('Editor did not finish loading');
  }
  const frame = await open(), fp = frame.contentWindow.freePose, d = frame.contentDocument;
  // Finish input-change fitting before isolating detection's effect on the pose.
  await fp.serialize();
  fp.setAutoFit(false);
  d.querySelector('#use-person-photo').click();
  for (let i = 0; i < 30 && d.querySelector('#detect-person').disabled; i++) await sleep(200);
  assert(!d.querySelector('#detect-person').disabled, 'Supply a photo and install DWPose');
  const originalPose = JSON.stringify(fp.viewer.getPose());
  const otherBones = JSON.stringify(fp.doc.people?.[1]?.pose?.bones);
  const nativeFetch = frame.contentWindow.fetch.bind(frame.contentWindow);
  let promptId;
  frame.contentWindow.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    if (args[0] === '/prompt') promptId = (await response.clone().json()).prompt_id;
    return response;
  };
  const cached = [];
  let raw;
  for (let i = 0; i < 2; i++) {
    await fp.detectPersonPose();
    assert(!d.querySelector('#detected-pose').hidden, d.querySelector('#import-status').textContent);
    assert(JSON.stringify(fp.viewer.getPose()) === originalPose, 'Detection must not change the mannequin');
    const history = (await (await fetch('/history/' + promptId)).json())[promptId];
    raw = JSON.parse(history.outputs['4'].text[0]);
    cached.push(history.status.messages.find(m => m[0] === 'execution_cached')?.[1]?.nodes);
  }
  assert(cached[1].includes('2') && cached[1].includes('4'), 'Second detection must test cached detector and output');
  assert(d.querySelector('#detected-pose-preview').src.startsWith('data:image/png'), 'Overlay must be visible');
  d.querySelector('#pose-preview-overlay').click();
  assert(d.querySelector('#detected-pose-preview').src === d.querySelector('#download-detected-pose').href, 'Black skeleton remains available');
  d.querySelector('#apply-detected-pose').click();
  assert(d.querySelector('#import-status').textContent.startsWith('已按原图关节点'), d.querySelector('#import-status').textContent);
  assert(fp.doc.openpose.depthMode === 'planar' && d.querySelector('#depth-flips').hidden, 'Photos default to planar directions');
  const { readPoseKeypoints, largestBody } = await import('/extensions/ComfyUI-Fisher-Pose/editor/pose-keypoints.mjs');
  assert(JSON.stringify(fp.doc.openpose.points) === JSON.stringify(largestBody(readPoseKeypoints(raw).people)), 'Original coordinates must survive exactly');
  await sleep(400);
  assert(JSON.stringify(fp.doc.people?.[1]?.pose?.bones) === otherBones, 'Other person keeps their pose');
  d.querySelector('[data-depth-mode="estimate"]').click();
  assert(fp.doc.openpose.depthMode === 'estimate' && !d.querySelector('#depth-flips').hidden, 'Depth estimation remains selectable');
  d.querySelector('[data-depth-mode="planar"]').click();
  const expected = JSON.stringify(fp.doc.openpose);
  widget.value = await fp.serialize();
  d.querySelector('#cancel-editor').click();
  for (let i = 0; i < 40 && document.querySelector('dialog iframe'); i++) await sleep(100);
  const reopened = await open();
  assert(JSON.stringify(reopened.contentWindow.freePose.doc.openpose) === expected, 'Reopening preserves exact points and mode');
  reopened.contentDocument.querySelector('#cancel-editor').click();
  return JSON.stringify({ passed: true, cached, originalCoordinates: true, reopen: true, otherPersonUnchanged: true });
})()
