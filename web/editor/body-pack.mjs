import { loadMorphPack } from '../vnccs/vnccs_pose_morph_runtime.mjs?v=20261010-body-timeout';

export function bodyPackError(error) {
    const message = String(error?.message || error);
    if (/HTTP 404/.test(message)) return '人体数据文件不存在。请补齐插件 web/vnccs/assets/pose_studio_makehuman.v2.bin（约 86MB），或从 GitHub 重新下载完整插件。';
    if (/HTTP \d+/.test(message)) return `人体数据请求失败：${message}。请检查 ComfyUI 服务或代理是否拦截。`;
    if (/fetch|network|aborted|timeout/i.test(message)) return '人体数据请求被中断。若文件已在插件目录，请关闭 IDM 等下载器对此站点的接管后刷新；同时确认 ComfyUI 服务仍在运行。';
    return `人体数据读取失败：${message}。文件可能不完整，或返回内容被下载器/代理替换；请先关闭拦截，再核对文件完整性。`;
}

export async function loadBodyPack(loader = loadMorphPack, timeoutMs = 90000) {
    // No download extension: browser download managers must not steal the runtime asset.
    const urls = ['/fisher_pose/body_pack', ...['pose_studio_makehuman.v2.bin', 'pose_studio_makehuman.v2.bin.gz']
        .map(name => new URL(`../vnccs/assets/${name}`, import.meta.url))];
    for (const url of urls) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error('Body pack request timeout')), timeoutMs);
        try { return await loader(url, { signal: controller.signal }); }
        catch (error) {
            // Only an absent route/file warrants trying an older installation's static copy.
            if (!/HTTP 404/.test(String(error.message))) throw Error(bodyPackError(error));
        }
        finally { clearTimeout(timer); }
    }
    throw Error(bodyPackError(Error('HTTP 404')));
}
