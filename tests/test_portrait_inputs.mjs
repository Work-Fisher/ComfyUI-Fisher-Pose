import test from 'node:test';
import assert from 'node:assert/strict';
import { photoSlots, reconcilePortraits, routePortraitInputs } from '../web/portrait_inputs.mjs';

const pair = () => ({ referenceMode: 'separate', people: [
    { pose: { id: 'arms' }, transform: { x: -4, y: 0, z: 0, zoom: 1 } },
    { pose: { id: 'wave' }, transform: { x: 4, y: 0, z: 0, zoom: 1 } },
], poseReferenceFile: { filename: 'pair.png' } });

for (const slot of [1, 2]) test(`pair -> only photo ${slot} -> pair preserves identity and poses`, () => {
    const initial = pair();
    const single = reconcilePortraits(initial, [slot]);
    assert.equal(single.needsCapture, true);
    assert.equal(single.data.people, null);
    assert.deepEqual(single.data.pose, initial.people[slot - 1].pose);
    assert.equal(single.data.poseReferenceFile, undefined);
    single.data.pose = { id: 'edited' };
    single.data.transform = { x: 0, y: 1, z: 0, zoom: 2 }; // single auto fit
    const restored = reconcilePortraits(single.data, [1, 2]);
    assert.equal(restored.needsCapture, true);
    assert.equal(restored.data.people[slot - 1].pose.id, 'edited');
    assert.equal(restored.data.people[2 - slot].pose.id, initial.people[2 - slot].pose.id);
    assert.deepEqual(restored.data.people.map(p => p.transform.x), [-4, 4]);
    assert.deepEqual(initial, pair()); // never mutate the saved workflow during planning
});

test('switching directly between single photos uses each saved pose', () => {
    const first = reconcilePortraits(pair(), [1]).data;
    first.pose = { id: 'new-first' };
    const second = reconcilePortraits(first, [2]).data;
    assert.equal(second.pose.id, 'wave');
    second.pose = { id: 'new-second' };
    const firstAgain = reconcilePortraits(second, [1]).data;
    assert.equal(firstAgain.pose.id, 'new-first');
    const both = reconcilePortraits(firstAgain, [1, 2]).data;
    assert.deepEqual(both.people.map(p => p.pose.id), ['new-first', 'new-second']);
});

test('unchanged inputs keep the capture and repeated normalization is stable', () => {
    const state = reconcilePortraits(pair(), [1, 2]);
    assert.equal(state.needsCapture, false);
    assert.equal(state.data.poseReferenceFile.filename, 'pair.png');
    assert.deepEqual(reconcilePortraits(state.data, [1, 2]).data, state.data);
});

test('group photo keeps two mannequins and no per-photo bank', () => {
    const group = { ...pair(), referenceMode: 'group' };
    const result = reconcilePortraits(group, [1]);
    assert.equal(result.needsCapture, false);
    assert.deepEqual(result.data, group);
});

test('legacy single portrait can restore a new second rig without overlap', () => {
    const legacy = { referenceMode: 'separate', pose: { id: 'single' }, transform: { x: 0, zoom: 1 } };
    const result = reconcilePortraits(legacy, [1, 2]);
    assert.equal(result.needsCapture, true);
    assert.equal(result.data.people.length, 2);
    assert.ok(result.data.people[0].transform.x < result.data.people[1].transform.x);
});

test('no photos blocks instead of silently reusing a previous person', () => {
    assert.throws(() => reconcilePortraits(pair(), []), /至少启用一张/);
});

test('API routing promotes photo2 only when photo1 is absent', () => {
    for (const inputs of [{reference_image:['5',0]}, {reference_image_2:['35',0]}, {reference_image:['5',0],reference_image_2:['35',0]}]) {
        const before = structuredClone(inputs), slots = photoSlots(inputs);
        routePortraitInputs(inputs);
        assert.deepEqual(inputs.reference_image, before.reference_image || before.reference_image_2);
        assert.equal(Boolean(inputs.reference_image_2), slots.length === 2);
    }
});
