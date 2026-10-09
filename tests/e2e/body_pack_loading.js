// Playwright scenario: call this async function with an isolated browser page.
// Interception is confined to test pages; no files/download-manager settings change.
async (page) => {
  const results = [];
  for (const mode of ['block-binary-extension', 'network-abort', 'http-500', 'invalid-body', 'missing-file']) {
    const testPage = await page.context().newPage();
    const requests = [];
    try {
      testPage.on('request', r => { if (/body_pack|\.bin(?:\.gz)?$/.test(r.url())) requests.push(r.url()); });
      await testPage.route('**/vnccs/assets/*.bin*', route => mode === 'missing-file'
        ? route.fulfill({ status: 404, body: 'Not found' }) : route.abort('blockedbyclient'));
      if (mode !== 'block-binary-extension') await testPage.route('**/fisher_pose/body_pack', route => {
        if (mode === 'network-abort') return route.abort('blockedbyclient');
        if (mode === 'missing-file') return route.fulfill({ status: 404, body: 'Not found' });
        if (mode === 'http-500') return route.fulfill({ status: 500, body: 'Server error' });
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Download intercepted</html>' });
      });
      await testPage.goto(new URL('/extensions/ComfyUI-Fisher-Pose/editor/freepose.html?test=body-pack', page.url()).href);
      await testPage.waitForFunction(() => document.querySelector('#loading')?.hidden || document.querySelector('#loading-text')?.textContent.startsWith('加载失败'), { timeout: 45000 });
      const state = await testPage.evaluate(() => ({ ready: document.querySelector('#loading').hidden, message: document.querySelector('#loading-text').textContent }));
      const expected = { 'network-abort': /请求被中断/, 'http-500': /HTTP 500/, 'invalid-body': /读取失败/, 'missing-file': /不存在/ }[mode];
      if (mode === 'block-binary-extension' ? !state.ready : state.ready || !expected.test(state.message)) throw Error(mode + ': ' + JSON.stringify(state));
      if (mode !== 'missing-file' && requests.some(url => /\.bin(?:\.gz)?$/.test(url))) throw Error(mode + ': unexpected static asset fallback');
      results.push({ mode, ...state, requests });
    } finally { await testPage.close(); }
  }
  return { passed: true, results };
}
