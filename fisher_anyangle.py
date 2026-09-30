"""New camera angle for a posed result, with the QI2.1 AnyAngle LoRA (huggingface.co/lilylilith/QI_2.1_AnyAngle).

The free-pose editor stores the new camera relative to the people, in units of their height
(pose_json["anyAngle"]["camera"]). The workflow turns the front-view result into a Gaussian splat
(TripoSplat, ComfyUI core); this node places that camera on the splat for RenderSplat.

Image order, measured 2026-09-30: the front result must be image1 and the coarse render image2 (as in
ComfyUI's own AnyAngle workflow and AnyAngle Studio T8); with the model card's order (render = image1)
the camera did not move. Sampling seed 0 burnt this combination (harsh, oversaturated) while seeds 7 and
12345 were clean, so the workflow defaults to seed 42 and randomizes.
"""
import json
import math

import torch

ANYANGLE_PROMPT = "Change the camera angle from <image2> to <image1>."
# TripoSplat reconstructs the input view as seen from world yaw +90° (measured 2026-09-30: an orbit at
# yaw 90 reproduces the input image, unmirrored). The editor's front is yaw 0, so its offsets rotate
# by +90° about +Y: (x, y, z) -> (z, y, -x).
EDITOR_TO_SPLAT = torch.tensor([[0.0, 0.0, 1.0], [0.0, 1.0, 0.0], [-1.0, 0.0, 0.0]])


def splat_points(splat):
    """World-space positions of the first splat in the batch (RenderSplat maps the splat frame as (x, -y, -z))."""
    count = int(splat.counts[0].item()) if getattr(splat, "counts", None) is not None else splat.positions.shape[1]
    points = splat.positions[0, :count].float().cpu()
    return points * torch.tensor([1.0, -1.0, -1.0])


def robust_box(points):
    # 1–99% per axis: a few floaters must not move the centre or inflate the height.
    sample = points[:: max(1, points.shape[0] // 200000)]
    low = torch.quantile(sample, 0.01, dim=0)
    high = torch.quantile(sample, 0.99, dim=0)
    return (low + high) / 2, float(high[1] - low[1])


def render_size(width, height, limit=2048):
    # The coarse render must match image1 (the front result), whose size the output latent takes.
    scale = min(1.0, limit / max(width, height))
    return max(64, round(width * scale / 8) * 8), max(64, round(height * scale / 8) * 8)


def camera_info(angle_camera, center, height, width, image_height):
    position_rel = torch.tensor([float(v) for v in angle_camera["position"]])
    forward = torch.tensor([float(v) for v in angle_camera["forward"]])
    position = center + EDITOR_TO_SPLAT @ position_rel * height
    direction = EDITOR_TO_SPLAT @ forward
    direction = direction / direction.norm().clamp_min(1e-6)
    target = position + direction * float(position_rel.norm()) * height
    fov = float(angle_camera.get("fov", 35.0))
    if width < image_height:
        # RenderSplat applies the field of view across the shorter side; the editor's is vertical.
        fov = math.degrees(2 * math.atan(math.tan(math.radians(fov) / 2) * width / image_height))
    as_dict = lambda v: {"x": float(v[0]), "y": float(v[1]), "z": float(v[2])}
    return {"position": as_dict(position), "target": as_dict(target), "fov": fov, "zoom": 1.0, "cameraType": "perspective"}


def save_preview(image):
    """Temp PNG of the coarse render, shown on the node."""
    try:
        import folder_paths
        from PIL import Image
    except ImportError:  # unit tests run without ComfyUI
        return []
    import os, uuid
    name = f"fisher_anyangle_{uuid.uuid4().hex[:12]}.png"
    Image.fromarray((image[0].numpy() * 255).round().astype("uint8")).save(os.path.join(folder_paths.get_temp_directory(), name))
    return [{"filename": name, "subfolder": "", "type": "temp"}]


def render_coarse(splat, camera, width, height):
    from comfy_extras.nodes_gaussian_splat import RenderSplat
    result = RenderSplat.execute(splat=splat, width=width, height=height, frames=1, splat_scale=1.0, sharpen=2.0,
                                 headlight_shading=0.0, opacity_threshold=0.0, render_style="color",
                                 background="#000000", camera_info=camera)
    return (result.result if hasattr(result, "result") else result)[0]


class FisherAnyAngleCamera:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "splat": ("SPLAT",),
            "pose_json": ("STRING", {"forceInput": True}),
            "image": ("IMAGE", {"tooltip": "第一步的正面结果：粗渲染按它的尺寸出图"}),
        }}

    RETURN_TYPES = ("IMAGE", "STRING", "LOAD3D_CAMERA")
    RETURN_NAMES = ("粗渲染", "AnyAngle提示词", "camera_info")
    FUNCTION = "camera"
    CATEGORY = "Fisher/姿态与机位"
    DESCRIPTION = ("把自由姿势编辑器里设的「新机位 · AnyAngle」放到高斯溅射上并渲出粗图。"
                   "AnyAngle 那一步的 TextEncodeQwenImage21：正面结果接 image1、粗渲染接 image2，提示词接本节点，CFG 1、25 步。")

    def camera(self, splat, pose_json, image):
        angle = (json.loads(pose_json or "{}").get("anyAngle") or {})
        if not angle.get("enabled") or not angle.get("camera"):
            raise ValueError("自由姿势编辑器里没有设置新机位：打开编辑器，在「输出」里启用「新机位 · AnyAngle」，调好角度后点「应用到节点」。")
        center, height = robust_box(splat_points(splat))
        if height <= 1e-6:
            raise ValueError("高斯溅射是空的：检查人物抠图（RemoveBackground）是否抠到了人。")
        width, image_height = render_size(int(image.shape[2]), int(image.shape[1]))
        camera = camera_info(angle["camera"], center, height, width, image_height)
        coarse = render_coarse(splat, camera, width, image_height)[..., :3].float().cpu().clamp(0, 1)
        return {"ui": {"images": save_preview(coarse)}, "result": (coarse, ANYANGLE_PROMPT, camera)}
