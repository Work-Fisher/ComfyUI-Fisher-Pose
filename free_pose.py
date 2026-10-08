"""Free-pose mode: VNCCS Pose Studio LoRA convention for Qwen Image 2.1.

The VNCCS_QI2_PoseStudio LoRA was trained with the mannequin render as image1,
the character photo as image2 and the fixed instruction below, so this node
keeps that order and trigger, followed by explicit single-person identity/pose constraints.
"""
import json

import numpy as np
import torch

from .env_check import require_qwen21
from .pose_reference import reference_image

VNCCS_INSTRUCTION = "Draw character from image2"
SINGLE_PERSON_INSTRUCTION = VNCCS_INSTRUCTION + "\n" + 'Generate exactly one person. Use image1 only for the body pose and body orientation. Render the person from image2 in that pose, replacing the original pose completely. Preserve the same facial identity, hairstyle, glasses, clothing, garment lengths, footwear and overall appearance from image2. Do not add another person or keep a second copy of the original pose.'


def people_sides(pose_json):
    """For a two-person editor state: ('left'|'right') of person 1 and person 2 in the capture, else None."""
    try:
        people = json.loads(pose_json or "{}").get("people")
    except (ValueError, AttributeError):
        return None
    if not isinstance(people, list) or len(people) < 2:
        return None
    xs = [float((person.get("transform") or {}).get("x", 0)) for person in people[:2]]
    return ("left", "right") if xs[0] <= xs[1] else ("right", "left")


def instruction(pose_json=None, reference_mode=None):
    # Whole-photo edits and separate portraits need different instructions.
    # Text mapping guides generation; it is not a hard per-person identity constraint.
    sides = people_sides(pose_json)
    if not sides:
        return SINGLE_PERSON_INSTRUCTION
    first, second = sides
    data = json.loads(pose_json or '{}')
    mode = reference_mode or data.get('referenceMode', 'group')
    if mode == 'group':
        # Match the identity binding shown in the editor. A model result that ignores
        # this instruction must not invert the meaning for every subsequent pose.
        source_first, source_second = ('right', 'left') if data.get('swapPeople') else ('left', 'right')
        left_source, right_source = (source_first, source_second) if first == 'left' else (source_second, source_first)
        order = 'Keep' if left_source == 'left' else 'Exchange'
        # Keep the VNCCS trigger, and edit the existing pair as one scene. The former
        # pair of "Draw the person ... and ..." clauses duplicated the group in a
        # captured raised-leg case. Seeded image regressions are recorded in docs.
        return (f"{VNCCS_INSTRUCTION}. Repose the existing two people in image2 to match image1. "
                f"{order} their left-to-right order: the person on the viewer's {left_source} in image2 takes the left mannequin pose in image1; "
                f"the person on the viewer's {right_source} takes the right mannequin pose. Preserve their appearances and the scene.")
    return (f"Draw the {first} character from image2 in the pose of the {first} mannequin in image1, "
            f"and the {second} character from image3 in the pose of the {second} mannequin in image1.")


def free_pose_prompt(extra="", pose_json=None, reference_mode=None):
    lines = [instruction(pose_json, reference_mode)] + [line.strip() for line in str(extra or "").splitlines()]
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

    RETURN_TYPES = ("IMAGE", "STRING", "STRING")
    RETURN_NAMES = ("人偶姿态图", "提示词", "姿势数据")
    FUNCTION = "render"
    CATEGORY = "Fisher/姿态与机位"
    DESCRIPTION = "只输出人偶姿态图和提示词，不需要 clip / vae，可以接到任何图像编辑工作流里当姿势参考（例如 Qwen Image 2511）。人偶图接 image1、完整人物图接 image2（两张单人照模式才将第二张接 image3），提示词会按人数自动写好。"

    def render(self, extra_prompt, pose_json, reference_image=None):
        prompt = free_pose_prompt(extra_prompt, pose_json)
        return {"ui": {"fisher_prompt": [prompt]}, "result": (mannequin_tensor(pose_json), prompt, pose_json)}


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
        }, "optional": {
            # Person 2's photo (image3) when the editor has two people.
            "reference_image_2": ("IMAGE",),
        }}

    RETURN_TYPES = ("CONDITIONING", "CONDITIONING", "LATENT", "STRING", "IMAGE", "STRING")
    RETURN_NAMES = ("正向", "负向", "latent", "实际提示词", "人偶姿态图", "姿势数据")
    FUNCTION = "encode"
    CATEGORY = "Fisher/姿态与机位"
    DESCRIPTION = "Qwen Image 2.1 自由姿势（1–2 人）。配合 VNCCS_QI2_PoseStudio LoRA：人偶图为 image1、人物图为 image2；两人默认使用完整合照（不裁切）：原图左人绑定人偶1、右人绑定人偶2，可交换对应。两张单人照模式才接 reference_image_2（image3）。人偶图尺寸在编辑器里设置；节点 width/height 只决定输出图尺寸，可接分辨率节点，两者无需一致。"

    def encode(self, clip, vae, reference_image, width, height, reference_resolution, extra_prompt, pose_json, reference_image_2=None):
        if not (64 <= width <= 4096 and 64 <= height <= 4096):
            raise ValueError("Qwen 输出宽高须在64到4096之间，请调整宽度、 高度整数常量。")
        if width % 16 or height % 16:
            raise ValueError("Qwen 输出宽高须为16的倍数，请调整节点的 width/height。")
        for image in (reference_image, reference_image_2):
            if image is not None and (image.ndim != 4 or image.shape[0] != 1):
                raise ValueError("每个人物图口只接一张图，请不要接入图片批次。")
        two = people_sides(pose_json) is not None
        data = json.loads(pose_json or '{}')
        mode = data.get('referenceMode', 'separate' if reference_image_2 is not None else 'group')
        if two and mode == 'group' and reference_image_2 is not None:
            raise ValueError('合照模式只需要 reference_image；请断开 reference_image_2，或在编辑器切换为两张单人照。')
        if two and mode == 'separate' and reference_image_2 is None:
            raise ValueError("编辑器里有 2 个人：请把人物 2 的照片接到 reference_image_2（对应 image3）。")
        if reference_image_2 is not None and not two:
            raise ValueError("接了 reference_image_2，但编辑器里只有 1 个人：请在编辑器里点「＋ 第二个人」，或断开 reference_image_2。")
        require_qwen21()
        mannequin = mannequin_tensor(pose_json)
        prompt = free_pose_prompt(extra_prompt, pose_json, mode)
        images = {"image_1": mannequin, "image_2": reference_image}
        if two and mode == 'separate':
            images["image_3"] = reference_image_2
        from comfy_extras.nodes_qwen import TextEncodeQwenImage21
        result = TextEncodeQwenImage21.execute(clip=clip, prompt=prompt, negative_prompt="", vae=vae,
                    resolution=reference_resolution, images=images)
        positive, negative, encoded_latent = result.result
        # Output size comes from the node, independent of the mannequin (the encoder would size it from image1).
        latent = {"samples": encoded_latent["samples"].new_zeros((1, 64, height // 16, width // 16))}
        return {"ui": {"fisher_prompt": [prompt]}, "result": (positive, negative, latent, prompt, mannequin, pose_json)}
