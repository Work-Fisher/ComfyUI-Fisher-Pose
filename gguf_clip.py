"""Qwen Image 2.1 GGUF language encoder with explicit vision weights."""
import logging
import re


def load_qwen3vl_mmproj(path):
    """Restore llama.cpp's Qwen3-VL vision names and temporal patch slices."""
    import torch
    import numpy as np
    from gguf import GGUFReader, GGMLQuantizationType
    reader = GGUFReader(path)
    weights, patches = {}, {}
    for tensor in reader.tensors:
        if tensor.tensor_type not in (GGMLQuantizationType.F32, GGMLQuantizationType.F16):
            raise ValueError('视觉mmproj必须使用未量化F16/F32版本。')
        value = torch.from_numpy(np.array(tensor.data, copy=True)).reshape(tuple(reversed(tensor.shape)))
        key = tensor.name
        if key in ('v.patch_embd.weight', 'v.patch_embd.weight.1'):
            patches[key] = value
            continue
        if key.startswith('v.blk.'):
            key = key.replace('v.blk.', 'blocks.', 1)
            for old, new in [('attn_out.', 'attn.proj.'), ('attn_qkv.', 'attn.qkv.'),
                             ('ffn_up.', 'mlp.linear_fc1.'), ('ffn_down.', 'mlp.linear_fc2.'),
                             ('ln1.', 'norm1.'), ('ln2.', 'norm2.')]:
                key = key.replace(old, new)
        elif key.startswith('v.deepstack.'):
            match = re.fullmatch(r'v.deepstack.(8|16|24).(fc1|fc2|norm).(weight|bias)', key)
            if not match:
                raise ValueError('不支持的Qwen3-VL deepstack权重：' + key)
            index = {'8': 0, '16': 1, '24': 2}[match[1]]
            layer = {'fc1': 'linear_fc1', 'fc2': 'linear_fc2', 'norm': 'norm'}[match[2]]
            key = f'deepstack_merger_list.{index}.{layer}.{match[3]}'
        else:
            for old, new in [('mm.0.', 'merger.linear_fc1.'), ('mm.2.', 'merger.linear_fc2.'),
                             ('v.post_ln.', 'merger.norm.'), ('v.patch_embd.', 'patch_embed.proj.'),
                             ('v.position_embd.', 'pos_embed.')]:
                if key.startswith(old):
                    key = new + key[len(old):]
                    break
            else:
                raise ValueError('不支持的视觉权重：' + key)
        weights['model.visual.' + key] = value
    if len(patches) != 2:
        raise ValueError('mmproj缺少Qwen3-VL双帧patch权重。')
    weights['model.visual.patch_embed.proj.weight'] = torch.stack(
        [patches['v.patch_embd.weight'], patches['v.patch_embd.weight.1']], dim=2)
    if len(weights) != 351 or tuple(weights['model.visual.merger.linear_fc2.weight'].shape) != (4096, 4608):
        raise ValueError('mmproj不是匹配的Qwen3-VL-8B视觉模型。')
    return weights


class FisherQwen21GGUFCLIP:
    @classmethod
    def INPUT_TYPES(cls):
        import folder_paths
        # Core text_encoders deliberately filters out .gguf. ComfyUI-GGUF
        # registers the same directories under its separate clip_gguf index.
        files = set(folder_paths.get_filename_list('text_encoders'))
        if 'clip_gguf' in folder_paths.folder_names_and_paths:
            files.update(folder_paths.get_filename_list('clip_gguf'))
        files = sorted(files)
        return {'required': {
            'clip_name': ([name for name in files if name.lower().endswith('.gguf') and 'mmproj' not in name.lower()],),
            'vision_source': ([name for name in files if name.lower().endswith('.safetensors') or ('mmproj' in name.lower() and name.lower().endswith('.gguf'))],
                              {'tooltip': '选择配套mmproj F16 GGUF，或完整Qwen3-VL-8B safetensors的视觉部分。'}),
        }}

    RETURN_TYPES = ('CLIP',)
    FUNCTION = 'load_clip'
    CATEGORY = 'Fisher/加载器'

    def load_clip(self, clip_name, vision_source):
        import nodes
        import folder_paths
        import comfy.sd
        from safetensors import safe_open

        loader_class = nodes.NODE_CLASS_MAPPINGS.get('CLIPLoaderGGUF')
        if loader_class is None:
            raise ValueError('请先安装并启用ComfyUI-GGUF。')
        language_path = folder_paths.get_full_path_or_raise('text_encoders', clip_name)
        vision_path = folder_paths.get_full_path_or_raise('text_encoders', vision_source)
        loader = loader_class()
        weights = loader.load_data([language_path])[0]
        norm = weights.get('model.layers.0.self_attn.q_norm.weight')
        hidden = weights.get('model.layers.0.post_attention_layernorm.weight')
        if norm is None or hidden is None or tuple(hidden.shape) != (4096,):
            raise ValueError('需要Qwen3-VL-8B GGUF语言权重，当前模型结构不匹配。')

        # Selectively read vision tensors; never allocate the BF16 language model.
        if vision_path.lower().endswith('.gguf'):
            vision = load_qwen3vl_mmproj(vision_path)
            keys = list(vision)
            weights.update(vision)
        else:
            with safe_open(vision_path, framework='pt', device='cpu') as source:
                keys = [key for key in source.keys() if key.startswith('model.visual.')]
                required = 'model.visual.deepstack_merger_list.0.norm.weight'
                merger = 'model.visual.merger.linear_fc2.weight'
                if required not in keys or merger not in keys or source.get_slice(merger).get_shape()[0] != 4096:
                    raise ValueError('视觉来源必须是完整Qwen3-VL-8B safetensors，例如qwen3vl_8b_bf16.safetensors。')
                weights.update({key: source.get_tensor(key) for key in keys})
        clip = loader.load_patcher([language_path], comfy.sd.CLIPType.QWEN_IMAGE, [weights])
        from comfy.text_encoders.qwen_image21 import QwenImage21TEModel
        if not isinstance(clip.cond_stage_model, QwenImage21TEModel):
            raise RuntimeError('当前ComfyUI未正确选择Qwen Image 2.1编码器，请更新支持Qwen2.1的核心。')
        logging.info('[Fisher GGUF] Qwen Image 2.1 encoder selected; GGUF language + %d vision tensors', len(keys))
        return (clip,)
