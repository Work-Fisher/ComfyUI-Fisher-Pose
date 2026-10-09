"""Tell users when their ComfyUI core is too old for this plugin.

Qwen Image 2.1 support landed in ComfyUI core 0.36.0 (2026-09-20). On older cores the workflow
fails in confusing places — the Qwen 2.1 VAE will not load, or the LoRA logs
"lora key not loaded ... img_mlp.gate_up" and the output simply equals the input photo —
so the editor shows a banner and the node raises a clear message instead.
"""
import logging

MIN_VERSION = "0.36.0"
# Advertise a capability from the loaded process, not the Git checkout on disk.
# Old running instances intentionally do not report this field after a file update.
FREE_POSE_BINDING_VERSION = 2
UPDATE_HINT = (f"ComfyUI 版本太旧，不支持 Qwen Image 2.1（需要 {MIN_VERSION} 或更新）。"
               "会出现「加载VAE 执行失败」「lora key not loaded」、出图和人物图一模一样等问题。"
               "请先更新 ComfyUI：便携版运行 update/update_comfyui.bat，git 安装执行 git pull。")


def comfy_version():
    try:
        import comfyui_version
        return str(comfyui_version.__version__)
    except (ImportError, AttributeError):
        return "unknown"


def qwen21_supported():
    """The Qwen 2.1 model class and its text encoder node both exist only on new enough cores."""
    try:
        import comfy.model_base
        from comfy_extras.nodes_qwen import TextEncodeQwenImage21  # noqa: F401
    except ImportError:
        return False
    return hasattr(comfy.model_base, "QwenImage21")


def splat_supported():
    try:
        from comfy_extras.nodes_gaussian_splat import RenderSplat, CreateCameraInfo  # noqa: F401
        from comfy_extras.nodes_triposplat import VAEDecodeTripoSplat  # noqa: F401
    except ImportError:
        return False
    return True


def status():
    return {"version": comfy_version(), "minVersion": MIN_VERSION, "qwen21": qwen21_supported(),
            "splat": splat_supported(), "updateHint": UPDATE_HINT,
            "freePoseBindingVersion": FREE_POSE_BINDING_VERSION}


def require_qwen21():
    if not qwen21_supported():
        raise RuntimeError(UPDATE_HINT + f"（当前版本 {comfy_version()}）")


def register_routes():
    try:
        from aiohttp import web
        from server import PromptServer
        routes = PromptServer.instance.routes
    except (ImportError, AttributeError):  # unit tests import the package without a running server
        return
    if not qwen21_supported():
        logging.warning("[Fisher Pose] %s（当前版本 %s）", UPDATE_HINT, comfy_version())

    @routes.get("/fisher_pose/env")
    async def get_env(request):
        return web.json_response(status())

    @routes.get("/fisher_pose/studio_workflow")
    async def get_studio_workflow(request):
        from pathlib import Path
        return web.FileResponse(Path(__file__).parent / "workflows" / "【Work-Fisher】无限姿势+无限视角（支持双人）.json")

    @routes.get("/fisher_pose/body_pack")
    async def get_body_pack(request):
        from pathlib import Path
        root = Path(__file__).parent / "web" / "vnccs" / "assets"
        for name in ("pose_studio_makehuman.v2.bin", "pose_studio_makehuman.v2.bin.gz"):
            path = root / name
            if path.is_file():
                return web.FileResponse(path, headers={"Content-Type": "application/x-fisher-pose", "Cache-Control": "no-cache"})
        raise web.HTTPNotFound(text="人体数据文件缺失，请重新安装完整 Fisher Pose 插件。")
