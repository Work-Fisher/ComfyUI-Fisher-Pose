// Read the core scalar controls without queueing the workflow. Unknown computed values stay
// unresolved so backend lazy selection remains authoritative for custom workflows.
export function scalarInput(node, name, fallback, seen = new Set()) {
    if (!node || seen.has(node)) return fallback;
    seen.add(node);
    const input = node.inputs?.find(item => item.name === name);
    if (input?.link == null) return node.widgets?.find(item => item.name === name)?.value ?? fallback;
    const graph = node.graph;
    const link = graph?.links?.get?.(input.link) ?? graph?.links?.[input.link];
    const source = graph?.getNodeById(link?.origin_id);
    if (!source) return fallback;
    const type = source.comfyClass || source.type;
    if (['PrimitiveBoolean', 'PrimitiveInt', 'PrimitiveNode'].includes(type)) {
        return scalarInput(source, 'value', fallback, seen);
    }
    if (type === 'Reroute' && source.inputs?.length === 1) {
        return scalarInput(source, source.inputs[0].name, fallback, seen);
    }
    return fallback;
}

export function cameraEnabled(shotNode) {
    return scalarInput(shotNode, 'enable_camera', true) !== false;
}
