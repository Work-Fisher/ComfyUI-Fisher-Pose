// Run with cdp_run.py and a two-portrait workflow. Applies two single-person
// poses and checks real API serialization; does not queue or save a workflow.
(async () => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const app = window.app;
  const findPose = () => app.graph._nodes.find(n => n.type === 'FisherQwenFreePose');
  const poseWidget = node => node.widgets.find(w => w.name === 'pose_json');
  const node = findPose();
  const secondLink = app.graph.links[node.inputs.find(i => i.name === 'reference_image_2').link];
  const second = app.graph.getNodeById(secondLink.origin_id);
  assert(JSON.parse(poseWidget(node).value).people?.length === 2, 'Start with two mannequins');
  second.mode = 4;
  async function openEditor() {
    findPose().widgets.find(w => w.type === 'button').callback();
    for (let i = 0; i < 120; i++) {
      await sleep(250);
      const frame = document.querySelector('dialog iframe');
      if (frame?.contentWindow?.freePose && frame.contentDocument.querySelector('#loading').hidden) return frame;
    }
    const frame = document.querySelector('dialog iframe');
    throw new Error('Editor did not load: ' + JSON.stringify({ frame: !!frame,
      loading: frame?.contentDocument?.querySelector('#loading-text')?.textContent,
      status: frame?.contentDocument?.querySelector('#save-status')?.textContent,
      toast: document.querySelector('[role="alert"]')?.textContent }));
  }
  const snapshots = [];
  for (const id of ['open-arms', 'wave']) {
    const frame = await openEditor(), fp = frame.contentWindow.freePose;
    if (id === 'open-arms') fp.removePerson();
    else assert(!fp.doc.people, 'Single-person state must survive reopening');
    const entry = fp.galleries.common.find(e => e.spec.id === id);
    assert(entry, `Missing preset ${id}`);
    fp.applyCommonPose(entry);
    await sleep(350);
    const instruction = fp.prompt();
    assert(instruction === 'Draw character from image2. Repose the person in image2 to match image1. Preserve their appearance and the scene.', 'Single-person instruction differs');
    frame.contentDocument.querySelector('#apply-editor').click();
    for (let i = 0; i < 100 && document.querySelector('dialog iframe'); i++) await sleep(200);
    assert(!document.querySelector('dialog iframe'), 'Apply did not finish');
    const data = JSON.parse(poseWidget(findPose()).value);
    assert(!data.people && data.poseReferenceFile?.filename, 'Single-person capture was not saved');
    const { output } = await app.graphToPrompt();
    const inputs = output[findPose().id].inputs;
    assert(!('reference_image_2' in inputs), 'Bypassed photo leaked into API request');
    assert(inputs.reference_image, 'First photo disappeared');
    snapshots.push({ id, instruction, file: data.poseReferenceFile.filename, output });
    await app.loadGraphData(app.graph.serialize());
    assert(app.graph.getNodeById(second.id).mode === 4, 'Bypass lost on reload');
  }
  assert(snapshots[0].file !== snapshots[1].file, 'Pose change reused the old capture');
  return JSON.stringify({ passed: true, snapshots });
})()
