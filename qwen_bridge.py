from .prompt_format import format_prompt_json
from .pose_reference import reference_image
"""Keep Qwen image order, actor identity and positive conditioning together."""
import numpy as np
import torch

from .pose_core import scene_prompt, MODES, camera_terms, project_points, read_scene, render_pose, person_constraints, person_description


def mapped_prompt(state, mode, source_count, assignments, extra=""):
    if mode not in MODES:
        raise ValueError("请选择有效的输出模式。")
    people = state["people"]
    if not people:
        if source_count != 1:
            raise ValueError('纯场景视角请只连接reference_image_1作为场景原图。')
        return scene_prompt(state, extra).replace('图1', '<image1>')
    sources = []
    for index, person in enumerate(people):
        choice = assignments[index]
        source = (1 if source_count == 1 else index + 1) if choice == "自动" else int(choice[-1])
        if not 1 <= source <= source_count:
            raise ValueError(f"{person.get('name', f'人物{index + 1}')} 对应图{source}，但只接入了 {source_count} 张参考图。请调整人物参考图选项。")
        sources.append(source)
    unused = set(range(1, source_count + 1)) - set(sources)
    if unused:
        raise ValueError(f"参考图 {sorted(unused)} 尚未分配给人物，请添加人物或调整对应关系。")
    labels = []
    for index, person in enumerate(people):
        source = sources[index]
        identity = person.get("identity", "").strip()
        if not identity:
            same_source = [i for i, value in enumerate(sources) if value == source]
            identity = f"从左到右第{same_source.index(index) + 1}个人物" if len(same_source) > 1 else "人物"
        labels.append(f"<image{source}>中的{identity}")
    text = ("调整人物的拍摄视角。" if mode == "仅视角" else "将人物的原有身体动作替换为目标人偶姿势。")
    text += f"最终画面共{len(people)}个人物。"
    text += "；".join(f"人物{i + 1}的身份、面部特征、发型和服装来自{label}" for i, label in enumerate(labels)) + "。"
    if source_count == 1:
        text += "以<image1>为编辑底图，保留未要求改变的场景与视觉风格。"
    else:
        text += "将各参考图的人物组成同一画面，各参考图仅提供对应人物的外观，背景统一协调，不拼接原图。"
    if mode != "仅视角":
        skeleton = f"<image{source_count + 1}>"
        projected = [(i, project_points(state, 1000, 1000, p)[1]) for i, p in enumerate(people)]
        if any(point is None for _, point in projected):
            raise ValueError("人物位于相机后方，请在编辑器中框住所有人后再输出。")
        ordered = sorted(projected, key=lambda item: item[1][0])
        text += f"{skeleton}是拍摄框人偶姿态参考，只参考动作和朝向，不复制人偶外观、材质或背景；最终画幅按输出设置，不按参考图比例。人偶从左到右依次对应：" + "；".join(labels[i] for i, _ in ordered) + "。"
        text += ''.join(person_description(state, person, i, True) for i, person in enumerate(people, 1))
        text += "按对应人偶替换各人物躯干、双臂和双腿的位置、弯曲方向及画面占比，保留各自外观，不交换身份。清除原姿势留下的手臂和手，原位置合理补全衣物或背景，每人仅一套符合人体结构的肢体。若原手持物与目标动作冲突且未明确要求保留，则移除该物体及原持握动作。最终不显示骨架线、关节点或参考图边框。"
    else:
        text += "保持各人物原有身体动作。" + ''.join(person_description(state, person, i, False) for i, person in enumerate(people, 1))
    if mode != "仅姿态":
        framing = '，'.join(camera_terms(state)['zh'].split('，')[1:])
        text += f"将拍摄机位调整为{framing}，人物相对镜头的方向按上述逐人描述呈现，背景随新机位形成合理透视与遮挡。"
    text += '人物朝向以逐人描述为准，肢体左右指人物自身左右；背对镜头的人按真实遮挡呈现，不强行展示正脸。服装随新姿势自然形成褶皱与遮挡，保持原图的光照和视觉风格。'
    return text + ("补充要求：" + extra.strip() if extra.strip() else "")


class FisherQwenPose:
    @classmethod
    def INPUT_TYPES(cls):
        choices = (["自动", "图1", "图2", "图3"],)
        return {"required": {
            "clip": ("CLIP",), "vae": ("VAE",), "reference_image_1": ("IMAGE",),
            "output_mode": (MODES, {"default": MODES[0]}),
            "width": ("INT", {"default": 768, "min": 64, "max": 4096, "step": 16}),
            "height": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 16}),
            "reference_resolution": ("INT", {"default": 1024, "min": 256, "max": 2048, "step": 32}),
            "person_1_reference": choices, "person_2_reference": choices, "person_3_reference": choices,
            "extra_prompt": ("STRING", {"default": "", "multiline": True}),
            "scene_json": ("STRING", {"default": "{}", "multiline": True}),
        }, "optional": {"reference_image_2": ("IMAGE",), "reference_image_3": ("IMAGE",), "pe_clip": ("CLIP",),
                        "pe_max_tokens": ("INT", {"default": 8192, "min": 1024, "max": 24000, "step": 1024}),
                        "presence_penalty": ("FLOAT", {"default": 1.5, "min": 0.0, "max": 5.0, "step": 0.01}),
                        "thinking": ("BOOLEAN", {"default": False, "label_on": "思考模式：开", "label_off": "思考模式：关"}),
                        "use_default_template": ("BOOLEAN", {"default": True, "tooltip": "使用默认PE扩写系统模板；关闭后仅保留JSON输出格式约定。"}),
                        "mtp": (["auto", "off", "2", "3", "4", "5"], {"default": "auto"})}}

    RETURN_TYPES = ("CONDITIONING", "CONDITIONING", "LATENT", "STRING", "IMAGE", "IMAGE")
    RETURN_NAMES = ("正向", "负向", "latent", "实际提示词", "人偶姿态图", "镜头预览图")
    FUNCTION = "encode"
    CATEGORY = "Fisher/姿态与机位"
    DESCRIPTION = "Qwen Image 2.1 专用。人物参考图连续接入1–3；内部将人偶参考图放在最后一张并绑定正向提示词。自动：单图多人共用图1，多图按人物列表顺序对应。编辑器内上传仅用于骨架适配，不代替这些图像输入。"

    def encode(self, clip, vae, reference_image_1, output_mode, width, height,
               reference_resolution, person_1_reference, person_2_reference,
               person_3_reference, extra_prompt, scene_json, reference_image_2=None,
               reference_image_3=None, pe_clip=None, pe_max_tokens=8192,
               presence_penalty=1.5, thinking=False, use_default_template=True, mtp="auto"):
        if width % 16 or height % 16:
            raise ValueError("Qwen 输出宽高须为16的倍数，请调整编辑器画幅。")
        if reference_image_3 is not None and reference_image_2 is None:
            raise ValueError("请连续接入参考图：使用图3时必须同时连接图2。")
        refs = [image for image in (reference_image_1, reference_image_2, reference_image_3) if image is not None]
        for i, image in enumerate(refs):
            if image.ndim != 4 or image.shape[0] != 1:
                raise ValueError(f"图{i + 1}必须是单张图像；请将不同人物分别接入图1、图2、图3，不能合成图片批次。")
        state = read_scene(scene_json)
        if not state["people"]:
            output_mode = "仅视角"
        prompt = mapped_prompt(state, output_mode, len(refs),
                               [person_1_reference, person_2_reference, person_3_reference], extra_prompt)
        skeleton = torch.from_numpy(np.asarray((reference_image(scene_json) if output_mode != "仅视角" else render_pose(state, 1536, 864))).astype(np.float32) / 255).unsqueeze(0)
        images = refs + ([skeleton] if output_mode != "仅视角" else [])
        if pe_clip is not None:
            from .pe_rewrite import rewrite
            facts = [fact for i, person in enumerate(state['people'], 1)
                     for fact in person_constraints(state, person, i, output_mode != '仅视角')]
            prompt = rewrite(pe_clip, prompt, images, width, height, max_tokens=pe_max_tokens, required_facts=facts, pose_reference=output_mode != "仅视角",
                             presence_penalty=presence_penalty, thinking=thinking, use_default_template=use_default_template, mtp=mtp)
        try:
            from comfy_extras.nodes_qwen import TextEncodeQwenImage21
        except ImportError as error:
            raise RuntimeError("此节点需要包含 TextEncodeQwenImage21 的新版 ComfyUI。") from error
        prompt = format_prompt_json(prompt, state, output_mode, width, height)
        result = TextEncodeQwenImage21.execute(clip=clip, prompt=prompt, negative_prompt="", vae=vae,
                    resolution=reference_resolution, images={f"image_{i + 1}": image for i, image in enumerate(images)})
        positive, negative, encoded_latent = result.result
        # Output framing is the editor's framing, independent of source image aspect ratios.
        latent = {"samples": encoded_latent["samples"].new_zeros((1, 64, height // 16, width // 16))}
        from .pose_reference import camera_preview
        preview=torch.from_numpy(np.asarray(camera_preview(scene_json)).astype(np.float32)/255).unsqueeze(0)
        return {"ui": {"fisher_prompt": [prompt]}, "result": (positive, negative, latent, prompt, skeleton, preview)}
