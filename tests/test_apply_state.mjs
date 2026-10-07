// node tests/test_apply_state.mjs
import assert from 'node:assert/strict';
import { keepIfSame, sameState } from '../web/apply_state.mjs';

const j = value => JSON.stringify(value);
const stored = new Set(['old.png']);
const exists = async file => stored.has(file.filename);
const base = { transform: { x: 0.0009698752218064495 }, bones: [1, 2], poseReferenceFile: { filename: 'old.png', subfolder: 'fisher_pose', type: 'input' } };
const bare = { transform: { x: 0.0009698752218064495 }, bones: [1, 2] };
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('float noise and a re-rendered mannequin keep the saved string', async () => {
    const next = j({ ...base, transform: { x: 0.0009698752218062525 }, poseReferenceFile: { filename: 'new.png' } });
    assert.equal(await keepIfSame(j(base), next, exists), j(base));
});
test('a real pose change is applied', async () => {
    const next = j({ ...base, bones: [1, 3], poseReferenceFile: { filename: 'new.png' } });
    assert.equal(await keepIfSame(j(base), next, exists), next);
});
test('a missing saved mannequin file is replaced', async () => {
    const next = j({ ...base, poseReferenceFile: { filename: 'new.png' } });
    assert.equal(await keepIfSame(j({ ...base, poseReferenceFile: { filename: 'gone.png' } }), next, exists), next);
});
test('a saved pose without a mannequin reference takes the fresh capture', async () => {
    const stored_ = j({ ...bare, poseReferenceFile: { filename: 'new.png' } });
    assert.equal(await keepIfSame(j(bare), stored_, exists), stored_);
    const inline = j({ ...bare, poseReference: 'data:image/png;base64,AA' });
    assert.equal(await keepIfSame(j(bare), inline, exists), inline);
});
test('a new shot preview is not dropped', async () => {
    const before = j({ ...base, anyAngle: { enabled: true } });
    const next = j({ ...base, anyAngle: { enabled: true }, shotPreviewFile: { filename: 's.png' } });
    assert.equal(await keepIfSame(before, next, exists), next);
});
test('switches such as outputSkeleton count as changes', async () => {
    const next = j({ ...base, outputSkeleton: false });
    assert.equal(await keepIfSame(j({ ...base, outputSkeleton: true }), next, exists), next);
});
test('unreadable or empty saved data is replaced', async () => {
    assert.equal(await keepIfSame('', j(base), exists), j(base));
    assert.equal(await keepIfSame('null', j(base), exists), j(base));
    assert.equal(await keepIfSame('{}', '{}', exists), '{}');
});
test('sameState distinguishes types', () => {
    assert.equal(sameState({ x: null }, { x: 0 }), false);
    assert.equal(sameState({ a: [1] }, { a: { 0: 1 } }), false);
    assert.equal(sameState({ a: 1 }, { a: 1 + 1e-9 }), true);
});

let failed = 0;
for (const [name, fn] of cases) {
    try { await fn(); } catch (error) { failed++; console.error(`FAIL ${name}\n${error.message}`); }
}
if (failed) process.exit(1);
console.log(`apply-state: all ${cases.length} tests passed`);
