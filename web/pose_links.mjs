const POSE_OUTPUTS = { FisherQwenFreePose: 5, FisherPoseImage: 2, FisherShot: 0 };

// Saved workflows can retain a slot number from the other Fisher pose node.
// Repair only the semantic pose_json connection; never guess IMAGE/conditioning links.
export function repairPoseLinks(graph) {
    let count = 0;
    for (const target of graph?._nodes || []) {
        if (!(target.type || '').startsWith('Fisher')) continue;
        const input = target.inputs?.find(i => i.name === 'pose_json');
        const link = graph.links?.get?.(input?.link) ?? graph.links?.[input?.link];
        const source = graph.getNodeById(link?.origin_id);
        const slot = POSE_OUTPUTS[source?.comfyClass || source?.type];
        if (slot == null || !link || link.origin_slot === slot) continue;
        const output = source.outputs?.[slot];
        if (output?.type !== 'STRING') continue;
        const old = source.outputs?.[link.origin_slot];
        if (old?.links) old.links = old.links.filter(id => id !== link.id);
        output.links ||= [];
        if (!output.links.includes(link.id)) output.links.push(link.id);
        link.origin_slot = slot;
        link.type = 'STRING';
        count++;
    }
    if (count) graph.change?.();
    return count;
}

export function validateFisherLinks(prompt, schemas) {
    for (const [id, node] of Object.entries(prompt)) {
        for (const [name, value] of Object.entries(node.inputs || {})) {
            if (!Array.isArray(value) || value.length !== 2) continue;
            const source = prompt[value[0]];
            if (!source?.class_type.startsWith('Fisher')) continue;
            const schema = schemas[source.class_type];
            const slot = value[1];
            if (!schema || !Number.isInteger(slot) || slot < 0 || slot >= schema.output.length) {
                throw Error(`节点 ${id} 的 ${name} 连到了 ${source.class_type} 不存在的输出 ${slot}。请保存工作流并重启 ComfyUI；仍有问题时重新连接「姿势数据」输出，或导入最新版工作流。`);
            }
        }
    }
}
