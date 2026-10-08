import test from 'node:test';
import assert from 'node:assert/strict';
import { requiresBindingCheck, verifyBindingRuntime } from '../web/binding_runtime.mjs';

const group = { people: [{}, {}], referenceMode: 'group' };
const prompt = (data, extras = {}) => ({ 6: { class_type: 'FisherQwenFreePose', inputs: { pose_json: JSON.stringify(data), ...extras } } });

test('updated frontend rejects old running backend even when Qwen is supported', async () => {
    await assert.rejects(verifyBindingRuntime(prompt(group), async () => ({ version: '0.36.0', qwen21: true })), /未加载双人人物对应修复/);
});

test('loaded binding capability allows a group workflow', async () => {
    await verifyBindingRuntime(prompt(group), async () => ({ freePoseBindingVersion: 1 }));
});

test('each run checks the process again after a server restart', async () => {
    let version = 1;
    const fetchEnvironment = async () => ({ freePoseBindingVersion: version });
    await verifyBindingRuntime(prompt(group), fetchEnvironment);
    version = 0;
    await assert.rejects(verifyBindingRuntime(prompt(group), fetchEnvironment), /未加载/);
});

test('single person, separate references and unrelated workflows need no lookup', async () => {
    for (const p of [prompt({}), prompt({ people: [{}, {}] }, { reference_image_2: ['10', 0] }), prompt({ ...group, referenceMode: 'separate' }), {}]) {
        await verifyBindingRuntime(p, () => { throw new Error('Unexpected lookup'); });
    }
});

test('legacy full-photo and connected pose data require the backend check', () => {
    assert.equal(requiresBindingCheck(prompt({ people: [{}, {}] })), true);
    assert.equal(requiresBindingCheck(prompt({}, { pose_json: ['2', 0] })), true);
});

test('network errors prevent use of an unverified group backend', async () => {
    await assert.rejects(verifyBindingRuntime(prompt(group), async () => { throw Error('offline'); }), /无法确认/);
});
