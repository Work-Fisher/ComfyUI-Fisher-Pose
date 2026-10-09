import assert from 'node:assert/strict';
import { loadBodyPack } from '../web/editor/body-pack.mjs';
const urls = [];
assert.equal(await loadBodyPack(async url => { urls.push(String(url)); return 'pack'; }), 'pack');
assert.deepEqual(urls, ['/fisher_pose/body_pack']);
await assert.rejects(loadBodyPack(async () => { throw Error('Failed to fetch'); }), /IDM/);
await assert.rejects(loadBodyPack(async () => { throw Error('HTTP 404'); }), /不存在/);
await assert.rejects(loadBodyPack(async () => { throw Error('Invalid Pose Studio MakeHuman asset header.'); }), /返回内容/);
let calls = 0;
assert.equal(await loadBodyPack(async () => { if (!calls++) throw Error('HTTP 404'); return 'legacy'; }), 'legacy');
assert.equal(calls, 2);
await assert.rejects(loadBodyPack((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
}), 10), /IDM/);
console.log('body pack: current route, legacy fallback and distinct errors passed');
