"""Free-pose mode: VNCCS Pose Studio LoRA convention for Qwen Image 2.1.

The VNCCS_QI2_PoseStudio LoRA was trained with the mannequin render as image1,
the character photo as image2 and the fixed instruction below, so this node
keeps exactly that order and wording instead of our long Chinese edit prompt.
"""
import numpy as np
import torch

from .env_check import require_qwen21
from .pose_reference import reference_image

VNCCS_INSTRUCTION = "Draw character from image2"


def free_pose_prompt(extra=""):
    lines = [VNCCS_INSTRUCTION] + [line.strip() for line in str(extra or "").splitlines()]
    return "\n".join(line for line in lines if line)


def mannequin_tensor(pose_json):
    # The mannequin keeps the size chosen in the editor; the node's width/height only set the output latent.
    return torch.from_numpy(np.asarray(reference_image(pose_json)).astype(np.float32) / 255).unsqueeze(0)


class FisherPoseImage:
    """Only the mannequin render and the LoRA instruction, for any model or hand-built workflow (e.g. Qwen 2511)."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "extra_prompt": ("STRING", {"default": "", "multiline": True}),
            "pose_json": ("STRING", {"default": "{}", "multiline": True}),
        }, "optional": {
            # Only read by the editor: the mannequin takes this photo's aspect ratio.
            "reference_image": ("IMAGE",),
        }}

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("人偶姿态图", "提示词")
    FUNCTION = "render"
    CATEGORY = "Fisher/姿态与机位"
    DESCRIPTION = "只输出人偶姿态图和提示词，不需要 clip / vae，可以接到任何图像编辑工作流里当姿势参考（例如 Qwen Image 2511）。人偶图接 image1、人物图接 image2 时，提示词用 Draw character from image2。"

    def render(self, extra_prompt, pose_json, reference_image=None):
        return {"ui": {"fisher_prompt": [free_pose_prompt(extra_prompt)]},
                "result": (mannequin_tensor(pose_json), free_pose_prompt(extra_prompt))}


class FisherQwenFreePose:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "clip": ("CLIP",), "vae": ("VAE",), "reference_image": ("IMAGE",),
            "width": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 16}),
            "height": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 16}),
            "reference_resolution": ("INT", {"default": 1024, "min": 256, "max": 2048, "step": 32}),
            "extra_prompt": ("STRING", {"default": "", "multiline": True}),
            "pose_json": ("STRING", {"default": "{}", "multiline": True}),
        }}

    RETURN_TYPES = ("CONDITIONING", "CONDITIONING", "LATENT", "STRING", "IMAGE")
    RETURN_NAMES = ("正向", "负向", "latent", "实际提示词", "人偶姿态图")
    FUNCTION = "encode"
    CATEGORY = "Fisher/姿态与机位"
    DESCRIPTION = "Qwen Image 2.1 自由姿势（单人）。配合 VNCCS_QI2_PoseStudio LoRA：人偶图为 image1、人物图为 image2，提示词固定 Draw character from image2。人偶图尺寸在编辑器里设置；节点 width/height 只决定输出图尺寸，可接分辨率节点，两者无需一致。"

    def encode(self, clip, vae, reference_image, width, height, reference_resolution, extra_prompt, pose_json):
        if width % 16 or height % 16:
            raise ValueError("Qwen 输出宽高须为16的倍数，请调整节点的 width/height。")
        if reference_image.ndim != 4 or reference_image.shape[0] != 1:
            raise ValueError("自由姿势只支持单张人物图，请不要接入图片批次。")
        require_qwen21()
        mannequin = mannequin_tensor(pose_json)
        prompt = free_pose_prompt(extra_prompt)
        from comfy_extras.nodes_qwen import TextEncodeQwenImage21
        result = TextEncodeQwenImage21.execute(clip=clip, prompt=prompt, negative_prompt="", vae=vae,
                    resolution=reference_resolution, images={"image_1": mannequin, "image_2": reference_image})
        positive, negative, encoded_latent = result.result
        # Output size comes from the node, independent of the mannequin (the encoder would size it from image1).
        latent = {"samples": encoded_latent["samples"].new_zeros((1, 64, height // 16, width // 16))}
        return {"ui": {"fisher_prompt": [prompt]}, "result": (positive, negative, latent, prompt, mannequin)}
