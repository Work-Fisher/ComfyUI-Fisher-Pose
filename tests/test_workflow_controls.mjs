import test from 'node:test';
import assert from 'node:assert/strict';
import { scalarInput, cameraEnabled } from '../web/workflow_controls.mjs';

function connected(type, inputName, value) {
    const source = { type, widgets: [{ name: 'value', value }] };
    const graph = { links: new Map([[8, { origin_id: 1 }]]), getNodeById: id => id === 1 ? source : null };
    source.graph = graph;
    return { source, node: { graph, inputs: [{ name: inputName, link: 8 }], widgets: [{ name: inputName, value: 1024 }] } };
}

test('linked width follows integer constant instead of stale hidden widget', () => {
    const { node, source } = connected('PrimitiveInt', 'width', 768);
    assert.equal(scalarInput(node, 'width', 1024), 768);
    source.widgets[0].value = 1536;
    assert.equal(scalarInput(node, 'width', 1024), 1536);
});

test('connected false wins over default and can be restored without disconnecting', () => {
    const { node, source } = connected('PrimitiveBoolean', 'enable_camera', false);
    assert.equal(cameraEnabled(node), false);
    source.widgets[0].value = true;
    assert.equal(cameraEnabled(node), true);
});

test('old workflows without switch keep camera support', () => {
    assert.equal(cameraEnabled(null), true);
    assert.equal(cameraEnabled({ widgets: [] }), true);
});

test('unknown computed values do not reuse stale connected widget', () => {
    const { node } = connected('SomeCalculatedSize', 'width', 768);
    assert.equal(scalarInput(node, 'width', undefined), undefined);
});

test('reroute forwards constants and cycles stop', () => {
    const { node, source } = connected('PrimitiveInt', 'height', 1280);
    const reroute = { type: 'Reroute', graph: node.graph, inputs: [{ name: '', link: 9 }] };
    node.graph.links.set(9, { origin_id: 2 });
    node.graph.getNodeById = id => id === 1 ? reroute : source;
    assert.equal(scalarInput(node, 'height', 1024), 1280);
    node.graph.links.set(9, { origin_id: 1 });
    assert.equal(scalarInput(node, 'height', 1024), 1024);
});
