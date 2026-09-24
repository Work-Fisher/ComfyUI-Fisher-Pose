"""Qwen PE-I2I adapter. Incomplete reasoning must never reach image conditioning."""
import hashlib
from collections import OrderedDict
import json
import math
from pathlib import Path
import re

import torch.nn.functional as F


def parse_final(raw, image_count, images, width, height):
    # Non-thinking generation returns JSON directly; tolerate completed legacy blocks.
    if "<think>" in raw and "</think>" not in raw:
        raise ValueError("PE 输出包含未结束的思考块，没有最终编辑指令。")
    answer = raw.rsplit("</think>", 1)[-1].replace("<|im_end|>", "").strip()
    decoder = json.JSONDecoder()
    objects = []
    for match in re.finditer(r"\{", answer):
        try:
            obj, _ = decoder.raw_decode(answer[match.start():])
            if isinstance(obj, dict) and isinstance(obj.get("rewritten_prompt"), str):
                objects.append(obj)
        except json.JSONDecodeError:
            pass
    if len(objects) != 1:
        raise ValueError("PE 未返回唯一完整的 rewritten_prompt JSON；已停止生图，请检查 PE 模型和输出上限。")
    result = objects[0]
    prompt = result["rewritten_prompt"].strip()
    if not prompt or "<think>" in prompt or "</think>" in prompt:
        raise ValueError("PE 最终提示词为空或混入思考标记。")
    for index in re.findall(r"<image(\d+)>", prompt):
        if not 1 <= int(index) <= image_count:
            raise ValueError("PE 引用了不存在的图片，已停止生图。")
    ratio, follow = result.get("wh_ratio", ""), result.get("ratio_follow", "")
    if not isinstance(ratio, str) or not isinstance(follow, str) or bool(ratio.strip()) == bool(follow.strip()):
        raise ValueError("PE 的 wh_ratio 与 ratio_follow 必须且只能填写一个。")
    if follow.strip():
        match = re.fullmatch(r"<image(\d+)>", follow.strip())
        if not match or not 1 <= int(match[1]) <= image_count:
            raise ValueError("PE 画幅引用了不存在的图片。")
        image = images[int(match[1])-1]
        aspect = image.shape[2] / image.shape[1]
    else:
        match = re.fullmatch(r"(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)", ratio.strip())
        if not match or float(match[2]) <= 0:
            raise ValueError("PE 返回的画幅比例无效。")
        aspect = float(match[1]) / float(match[2])
    if not math.isclose(aspect, width / height, rel_tol=.025):
        raise ValueError("PE 建议画幅与编辑器不一致，已停止生图；请在编辑器确认构图后重试，避免裁掉目标动作。")
    return prompt


def rewrite(pe_clip, prompt, images, width, height, max_tokens=8192, required_facts=(), pose_reference=True,
            presence_penalty=1.5, thinking=False, use_default_template=True, mtp="auto"):
    if not str(getattr(pe_clip.tokenizer, "clip_name", "")).startswith("qwen35"):
        raise ValueError("pe_clip 请连接 Qwen Image 2.1 PE-I2I（Qwen3.5）模型，不能连接生图用 Qwen3VL 或 LTX 模型。")
    system = (Path(__file__).parent / "system_prompt_edit.txt").read_text(encoding="utf-8").strip()
    if not use_default_template:
        system = '根据参考图整理用户的图像编辑要求。仅返回JSON对象，包含rewritten_prompt、wh_ratio、ratio_follow三个字符串字段。rewritten_prompt为最终编辑指令；wh_ratio填写用户要求的宽高比，ratio_follow为空。'
    if mtp not in ('auto','off','2','3','4','5'):
        raise ValueError('不支持的MTP选项')
    divisor = math.gcd(width, height)
    request = prompt + f" 最终画幅固定为{width//divisor}:{height//divisor}，不可改变。请看清目标人偶并把姿势具体写成自然语言：分别说明躯干方向、每侧上臂和前臂、髋膝脚踝的位置与弯曲关系。区分膝盖和手肘，不能把弯曲的腿写成额外的手臂。目标人偶已包含最终机位投影，不再额外旋转人偶。身体原姿势必须被完整替换；若原手持物与目标动作冲突且未要求保留，移除该物体及原持握动作。不要新增衣服、配饰或编造不可见的关节动作。"
    if not pose_reference:
        request = prompt + f" 最终画幅固定为{width//divisor}:{height//divisor}。场景机位中的原图基准、摄影机运动方向及角度数值是编辑器的确定输入，请原样保留其含义和数值，以此组织透视与遮挡描述，保持未要求修改的场景内容。"
    vision = "<|vision_start|><|image_pad|><|vision_end|>"
    if required_facts:
        request += '以下是编辑器直接计算的朝向与关节数据，请结合图片将其整理为自然流畅的动作描述：' + ''.join(required_facts)
    # Explicit ChatML bypasses the tokenizer template, so close thinking here too.
    chat = f"<|im_start|>system\n{system}<|im_end|>\n<|im_start|>user\n{vision * len(images)}{request}<|im_end|>\n<|im_start|>assistant\n" + ('<think>\n' if thinking else '<think>\n</think>\n')
    prepared = []
    for image in images:
        rgb = image[..., :3]
        if image.shape[-1] == 4:
            rgb = rgb * image[..., 3:] + (1 - image[..., 3:])
        h, w = rgb.shape[1:3]
        # Apply the same longest-edge limit to every reference and skeleton image.
        if max(h, w) > 1024:
            scale = 1024 / max(h, w)
            size = (max(1, round(h * scale)), max(1, round(w * scale)))
            rgb = F.interpolate(rgb.movedim(-1,1), size=size, mode="bilinear",
                                align_corners=False, antialias=True).movedim(1,-1)
        prepared.append(rgb)
    # Cache belongs to this loaded CLIP instance; changing models cannot reuse it.
    digest = hashlib.sha256((chat + str((width, height, max_tokens, presence_penalty, thinking, use_default_template, mtp))).encode('utf-8'))
    for image in images:
        pixels = image.detach().cpu().contiguous()
        digest.update(str((tuple(pixels.shape), str(pixels.dtype))).encode())
        digest.update(pixels.float().numpy().tobytes())
    key = digest.hexdigest()
    cache = getattr(pe_clip, '_fisher_pe_cache', None)
    if cache is None:
        cache = OrderedDict()
        pe_clip._fisher_pe_cache = cache
    if key in cache:
        cache.move_to_end(key)
        print('[Fisher PE] 复用已完成的扩写结果')
        return cache[key]
    tokens = pe_clip.tokenize(chat, images=prepared, thinking=thinking)
    generated = pe_clip.generate(tokens, do_sample=True, max_length=max_tokens, temperature=1.0,
                    top_k=20, top_p=.95, min_p=0.0, repetition_penalty=1.0,
                    presence_penalty=presence_penalty, seed=42, mtp=False if mtp=='off' else True if mtp=='auto' else int(mtp))
    raw = pe_clip.decode(generated, skip_special_tokens=False)
    final = parse_final(raw, len(images), images, width, height)
    cache[key] = final
    if len(cache) > 16:
        cache.popitem(last=False)
    return final
