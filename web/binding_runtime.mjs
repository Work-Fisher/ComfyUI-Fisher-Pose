// Match env_check.py's capability from the running backend, not files on disk.
const REQUIRED_BINDING_VERSION = 3;

// Both two-person instructions are built by the Python node: the whole-photo wording and the two
// single photos' wording. Any two-person pose therefore needs a backend that has the current
// version, whatever reference mode the editor saved.
export function isTwoPersonPose(data) {
    return Array.isArray(data?.people) && data.people.length > 1;
}

export function requiresBindingCheck(prompt) {
    return Object.values(prompt || {}).some(node => {
        if (node.class_type !== 'FisherQwenFreePose') return false;
        const inputs = node.inputs || {};
        // A linked pose is computed by another node; verify the backend as well.
        if (Array.isArray(inputs.pose_json)) return true;
        try { return isTwoPersonPose(JSON.parse(inputs.pose_json || '{}')); }
        catch { return false; } // Let normal node validation report invalid JSON.
    });
}

export function bindingRuntimeProblem(environment, origin = '') {
    if (Number(environment?.freePoseBindingVersion) >= REQUIRED_BINDING_VERSION) return '';
    return '当前 ComfyUI 后端未加载双人人物对应修复。请先保存工作流，完全退出并重新启动当前 ComfyUI 服务，再刷新网页。'
        + '仅刷新网页或重新导入工作流不会更新后端。' + (origin ? `当前入口：${origin}` : '');
}

export async function verifyBindingRuntime(prompt, fetchEnvironment, origin = '') {
    if (!requiresBindingCheck(prompt)) return;
    let environment;
    try { environment = await fetchEnvironment(); }
    catch { throw new Error('无法确认 Fisher 双人后端版本，请检查 ComfyUI 连接后重试。' + (origin ? `当前入口：${origin}` : '')); }
    const problem = bindingRuntimeProblem(environment, origin);
    if (problem) throw new Error(problem);
}
