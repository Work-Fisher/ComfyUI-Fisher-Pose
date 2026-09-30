// The model-free FisherPoseImage node gets the same editor button and opens the free-pose editor.
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const node = LiteGraph.createNode('FisherPoseImage');
  window.app.graph.add(node);
  const button = node.widgets.find(w => w.type === 'button');
  const report = { widgets: node.widgets.map(w => `${w.name}:${w.type}`), outputs: node.outputs.map(o => o.name) };
  button.callback();
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    const frame = document.querySelector('dialog iframe');
    if (frame?.contentWindow?.freePose && frame.contentDocument.querySelector('#loading').hidden) {
      report.editorTitle = frame.contentDocument.title;
      report.commonPoses = frame.contentDocument.querySelectorAll('#gallery .fp-thumb').length;
      break;
    }
  }
  document.querySelector('dialog')?.close();
  return JSON.stringify(report, null, 1);
})()
