import assert from 'node:assert/strict';
import { hiddenParts, segmentVisibility, worstVisibility } from '../web/editor/reference-view.mjs';

// A segment in the screen plane keeps its length; one pointing at the camera reads as a stub.
assert.equal(segmentVisibility([1, 0, 0]), 1);
assert.equal(segmentVisibility([0, 1, 0]), 1);
assert.equal(segmentVisibility([0, 0, 1]), 0);
assert.equal(segmentVisibility([0, 0, 0]), 1, 'a zero-length segment must not fail the view');
assert.equal(worstVisibility([]), 1);

const part = (name, segment) => ({ name, segment });
const names = parts => parts.map(item => item.name);

// Standing: every limb lies in the screen plane, so the front capture is already readable.
const standing = [part('左大臂', [0, -0.95, 0.3]), part('左小腿', [0, -1, -0.06]), part('躯干', [0, 1, 0.05])];
assert.deepEqual(hiddenParts(standing), []);
assert.equal(worstVisibility(standing), segmentVisibility([0, -0.95, 0.3]), 'the least visible segment');

// 双膝跪地: the shins point at the camera ([0, -0.05, -1] in common-poses), which is what makes
// the front reference read as a standing person.
const kneel = [...standing, part('左小腿', [0, -0.05, -1]), part('右小腿', [0, -0.2, -1])];
const hidden = hiddenParts(kneel);
assert.deepEqual(names(hidden), ['左小腿', '右小腿'], 'least visible first');
assert.ok(hidden[0].visibility < 0.1, `a kneeling shin should be nearly invisible, got ${hidden[0].visibility}`);
assert.ok(hidden.every(item => item.visibility < 0.35));

// Once the user turns the mannequin to the side, the same shin shows its length again: the
// warning has to disappear on its own.
const side = [...standing, part('左小腿', [-1, -0.05, 0]), part('右小腿', [-1, -0.2, 0])];
assert.deepEqual(hiddenParts(side), [], 'turning the mannequin fixes the read, so it is not reported');

// Two mannequins carry the person they belong to.
const two = [part('人物 1 · 左小腿', [0, -0.05, -1]), part('人物 2 · 左大臂', [0, 0.1, -1])];
assert.deepEqual(names(hiddenParts(two)), ['人物 1 · 左小腿', '人物 2 · 左大臂']);

// A lower threshold reports only the worse folds; a higher one also reports mild ones.
const mild = [part('左大臂', [0, 0.3, -1])]; // ≈0.29, inside the default threshold
assert.equal(names(hiddenParts(mild)).length, 1);
assert.deepEqual(hiddenParts(mild, { minVisibility: 0.2 }), [], 'a mildly folded limb is not worth a warning');
assert.deepEqual(names(hiddenParts(two, { minVisibility: 0.08 })), ['人物 1 · 左小腿'], 'a lower threshold keeps only the worst');

// An editor state with no bones yet (model still loading) must not throw.
assert.deepEqual(hiddenParts([]), []);

console.log('reference view: occluded joint detection and thresholds passed');
