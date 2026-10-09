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

// The editor and the canvas switch edit the same scalar, including linked constants.
export function setScalarInput(node, name, value, seen = new Set()) {
    if (!node || seen.has(node)) return false;
    seen.add(node);
    const input = node.inputs?.find(item => item.name === name);
    if (input?.link != null) {
        const graph = node.graph;
        const link = graph?.links?.get?.(input.link) ?? graph?.links?.[input.link];
        const source = graph?.getNodeById(link?.origin_id);
        const type = source?.comfyClass || source?.type;
        if (['PrimitiveBoolean', 'PrimitiveInt', 'PrimitiveNode'].includes(type)) return setScalarInput(source, 'value', value, seen);
        if (type === 'Reroute' && source.inputs?.length === 1) return setScalarInput(source, source.inputs[0].name, value, seen);
        return false;
    }
    const control = node.widgets?.find(item => item.name === name);
    if (!control) return false;
    control.value = value;
    control.callback?.(value);
    node.graph?.change?.();
    return true;
}
