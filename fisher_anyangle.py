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
    fov = math.degrees(2 * math.atan(math.tan(math.radians(float(angle_camera.get("fov", 35.0))) / 2)
                                    / max(float(angle_camera.get("zoom", 1.0)), 0.01)))
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
        angle = shot_of(pose_json)
        if not angle:
            raise ValueError("尚未设置新机位。请使用完整工作流，在编辑器「定镜头」中调整角度后应用；正面应由「Fisher 最终图像」自动跳过此分支。")
        center, height = robust_box(splat_points(splat))
        if height <= 1e-6:
            raise ValueError("高斯溅射是空的：检查人物抠图（RemoveBackground）是否抠到了人。")
        width, image_height = render_size(int(image.shape[2]), int(image.shape[1]))
        camera = camera_info(angle["camera"], center, height, width, image_height)
        coarse = render_coarse(splat, camera, width, image_height)[..., :3].float().cpu().clamp(0, 1)
        return {"ui": {"images": save_preview(coarse)}, "result": (coarse, ANYANGLE_PROMPT, camera)}


def shot_of(pose_json):
    """The saved camera shot when it needs the camera branch (turned on and placed), else {}."""
    try:
        angle = json.loads(pose_json or "{}").get("anyAngle") or {}
    except (ValueError, AttributeError):
        return {}
    return angle if angle.get("enabled") and angle.get("camera") else {}


SHOT_KEYS = ("anyAngle", "shotPreviewFile")


class FisherShot:
    """Holds the camera shot apart from the pose (the editor's host writes both).

    The pose node's inputs only change when the pose does, so trying another camera angle reuses
    the cached front result and its 3D reconstruction instead of generating a new front image.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "pose_json": ("STRING", {"forceInput": True}),
            "shot_json": ("STRING", {"default": "{}", "multiline": True}),
        }, "optional": {
            "enable_camera": ("BOOLEAN", {"default": True,
                "tooltip": "关闭：只生成正面人物姿势图；开启：按编辑器镜头执行完整流程。关闭不会清除保存的镜头。"}),
        }}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("姿势与镜头",)
    FUNCTION = "merge"
    CATEGORY = "Fisher/姿态与机位"
    DESCRIPTION = "保存编辑器镜头。enable_camera 关闭时只输出正面人物姿势图，开启后恢复镜头流程；不清除镜头，也不改变正面生成参数。"

    def merge(self, pose_json, shot_json, enable_camera=True):
        data = json.loads(pose_json or "{}")
        shot = json.loads(shot_json or "{}")
        for key in SHOT_KEYS:
            if key in shot:
                data[key] = shot[key]
        if not enable_camera:
            data["anyAngle"] = {**(data.get("anyAngle") or {}), "enabled": False}
        return (json.dumps(data, ensure_ascii=False),)


class FisherPoseResult:
    """Only evaluate the camera branch when the saved shot actually needs it."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "pose_json": ("STRING", {"forceInput": True}),
            "front_image": ("IMAGE", {"lazy": True}),
        }, "optional": {
            # Optional: with a front shot the editor's host mutes the whole camera branch, so the
            # TripoSplat / AnyAngle models are not needed (nor validated) for front-only runs.
            "camera_image": ("IMAGE", {"lazy": True}),
        }, "hidden": {"prompt": "PROMPT", "unique_id": "UNIQUE_ID"}}

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("最终图像",)
    FUNCTION = "select"
    CATEGORY = "Fisher/姿态与机位"
    DESCRIPTION = "按编辑器保存的镜头自动选择结果。正面直接出图，调整镜头后自动换机位，无需手动切换工作流。"

    @staticmethod
    def camera_linked(prompt, unique_id):
        try:
            return "camera_image" in prompt[str(unique_id)]["inputs"]
        except (KeyError, TypeError):
            return True

    def check_lazy_status(self, pose_json, front_image=None, camera_image=None, prompt=None, unique_id=None):
        if shot_of(pose_json):
            # Never ask for an unlinked input: ComfyUI would wait for it forever.
            return ["camera_image"] if camera_image is None and self.camera_linked(prompt, unique_id) else []
        return ["front_image"] if front_image is None else []

    def select(self, pose_json, front_image=None, camera_image=None, prompt=None, unique_id=None):
        if not shot_of(pose_json):
            return (front_image,)
        if camera_image is None:
            raise ValueError("保存的是新机位镜头，但换机位分支被关闭或没有连线：打开编辑器点一次「应用」，或在「定镜头」里点「恢复正面」。")
        return (camera_image,)


class FisherAnyAngleEncode:
    """Fixed required inputs prevent autogrow image slots from dropping camera conditioning."""
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "clip": ("CLIP",), "vae": ("VAE",),
            "front_image": ("IMAGE",), "camera_image": ("IMAGE",),
            # 0 = keep the front result's output size; reference encodings may still round to 32.
            "resolution": ("INT", {"default": 0, "min": 0, "max": 2048, "step": 32}),
        }}

    RETURN_TYPES = ("CONDITIONING", "CONDITIONING", "LATENT")
    RETURN_NAMES = ("正向", "负向", "latent")
    FUNCTION = "encode"
    CATEGORY = "Fisher/姿态与机位"

    def encode(self, clip, vae, front_image, camera_image, resolution):
        from comfy_extras.nodes_qwen import TextEncodeQwenImage21
        positive, negative, latent = TextEncodeQwenImage21.execute(
            clip=clip, vae=vae, prompt=ANYANGLE_PROMPT, negative_prompt="",
            resolution=resolution, images={"image_1": front_image, "image_2": camera_image},
        ).result
        if resolution == 0:
            height, width = front_image.shape[1:3]
            latent = {"samples": latent["samples"].new_zeros((1, 64, height // 16, width // 16))}
        return positive, negative, latent
