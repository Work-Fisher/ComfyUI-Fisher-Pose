// Run after opening an editor with a selected pose photo and one successful detection.
// Replay the real detector history with one output fault at a time; never queue fake jobs.
(async () => {
  const frame = document.querySelector('dialog iframe');
  const win = frame.contentWindow, d = frame.contentDocument, fp = win.freePose;
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const nativeFetch = win.fetch.bind(win);
  const history = await (await fetch('/history')).json();
  const result = Object.values(history).reverse().find(h => h.status?.status_str === 'success'
    && Object.values(h.prompt?.[2] || {}).some(n => n.class_type === 'DWPreprocessor'));
  assert(result, 'Run a real DWPose detection first');
  const original = JSON.stringify(fp.viewer.getPose());
  const faults = [
    ['missing keypoints', h => { delete h.outputs['4']; }],
    ['empty people', h => { h.outputs['4'].text = [JSON.stringify({canvas_width: 1024, canvas_height: 1024, people: []})]; }],
    ['invalid JSON', h => { h.outputs['4'].text = ['{']; }],
    ['backend error', h => { h.status.status_str = 'error'; }],
  ];
  let replay;
  win.fetch = async (url, options) => {
    if (url === '/prompt') return new win.Response(JSON.stringify({prompt_id: 'recovery-fixture'}));
    if (String(url) === '/history/recovery-fixture') return new win.Response(JSON.stringify({'recovery-fixture': replay}));
    return nativeFetch(url, options);
  };
  try {
    for (const [name, mutate] of faults) {
      replay = structuredClone(result); mutate(replay);
      await fp.detectPersonPose();
      assert(d.querySelector('#detection-status').textContent.startsWith('识别失败：'), name + ': missing inline error');
      assert(d.querySelector('#detected-pose').hidden && d.querySelector('#apply-detected-pose').disabled, name + ': stale result remains applicable');
      assert(!d.querySelector('#detect-person').disabled, name + ': retry remains disabled');
      assert(JSON.stringify(fp.viewer.getPose()) === original, name + ': changed pose on failure');
      replay = structuredClone(result);
      await fp.detectPersonPose();
      assert(!d.querySelector('#detected-pose').hidden && !d.querySelector('#apply-detected-pose').disabled, name + ': recovery failed');
    }
    d.querySelector('#apply-detected-pose').click();
    assert(/^(已按原图关节点|已应用可见肢体)/.test(d.querySelector('#import-status').textContent), 'recovered result cannot apply');
    return {passed: true, faults: faults.map(([name]) => name), recoveredApply: true};
  } finally { win.fetch = nativeFetch; }
})()
