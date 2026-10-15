"""Rewrite a Qwen Image 2.1 LoRA written for the fused ``img_mlp.gate_up`` layout into the
unfused ``img_mlp.gate_layer`` / ``img_mlp.proj`` naming.

    python tools/split_fused_mlp_lora.py <lora.safetensors> [<out.safetensors>]

Qwen Image 2.1 checkpoints exist in both layouts: ComfyUI-saved and quantized files fuse the
gated image-stream MLP into one ``img_mlp.gate_up`` linear, while the original weights keep
``img_mlp.gate_layer`` and ``img_mlp.proj`` apart (``comfy/model_detection.py`` reads
``fused_mlp`` from whichever is present). ``comfy/lora.py`` maps the fused-model + split-LoRA
pair only; a LoRA that addresses ``gate_up`` against an unfused checkpoint loses every one of
those weights with ``lora key not loaded: ...img_mlp.gate_up...`` — a sixth of this LoRA.

The fused layout is ``[gate; up]`` (``comfy/ops.py::_swiglu_eager``) and the unfused forward is
``out(silu(gate_layer(x)) * proj(x))``, so the split is by LoRA-B rows: ``gate_layer`` takes
rows [0:half), ``proj`` takes [half:2*half). lora_A acts on the input and is shared, so it is
copied to both halves. The deltas are numerically unchanged.
"""
import argparse
import sys
from pathlib import Path

from safetensors import safe_open
from safetensors.torch import load_file, save_file

FUSED = ".img_mlp.gate_up."
DEFAULT_SUFFIX = "_unfused_mlp"


def split(tensors):
    """Return (new tensors, split key count). Raises if a fused A/B pair is incomplete."""
    out = dict(tensors)
    splits = 0
    for key in list(tensors):
        if FUSED not in key or not key.endswith(".weight"):
            continue
        if key.endswith(".lora_B.weight"):
            base = key[: -len(".img_mlp.gate_up.lora_B.weight")]
            a_key = base + ".img_mlp.gate_up.lora_A.weight"
            if a_key not in tensors:
                raise ValueError(f"{key} 缺少配对的 lora_A：{a_key}")
            b = tensors[key]
            if b.shape[0] % 2:
                raise ValueError(f"{key} 输出维 {b.shape[0]} 不是偶数，无法对半分。")
            half = b.shape[0] // 2
            out[base + ".img_mlp.gate_layer.lora_B.weight"] = b[:half].contiguous()
            out[base + ".img_mlp.proj.lora_B.weight"] = b[half:].contiguous()
            del out[key]
            splits += 1
        elif key.endswith(".lora_A.weight"):
            base = key[: -len(".img_mlp.gate_up.lora_A.weight")]
            # Cloned: safetensors refuses to save two keys that share one storage.
            out[base + ".img_mlp.gate_layer.lora_A.weight"] = tensors[key].clone()
            out[base + ".img_mlp.proj.lora_A.weight"] = tensors[key].clone()
            del out[key]
    if not splits:
        raise ValueError("没有找到 img_mlp.gate_up LoRA，这个文件不需要转换。")
    return out, splits


def verify(source, converted, splits):
    """The half deltas must rebuild the fused delta: B @ A == concat(B_gate @ A, B_up @ A)."""
    import torch

    for key in source:
        if f"{FUSED}lora_B.weight" not in key:
            continue
        base = key[: -len(".img_mlp.gate_up.lora_B.weight")]
        a, b = source[base + ".img_mlp.gate_up.lora_A.weight"], source[key]
        fused = b.float() @ a.float()
        half = b.shape[0] // 2
        pairs = [(".img_mlp.gate_layer.", fused[:half]), (".img_mlp.proj.", fused[half:])]
        for suffix, expected in pairs:
            got = (converted[base + suffix + "lora_B.weight"].float()
                   @ converted[base + suffix + "lora_A.weight"].float())
            if got.shape != expected.shape or not torch.allclose(got, expected, atol=1e-2, rtol=1e-2):
                raise AssertionError(f"{base}{suffix} 与原融合权重不一致")
    return splits


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("lora", type=Path, help="源 LoRA（img_mlp.gate_up 写法）")
    parser.add_argument("out", type=Path, nargs="?", help="输出文件，默认在源文件旁加 " + DEFAULT_SUFFIX)
    args = parser.parse_args()
    source_path = args.lora
    out_path = args.out or source_path.with_name(source_path.stem + DEFAULT_SUFFIX + ".safetensors")
    tensors = load_file(str(source_path))
    with safe_open(str(source_path), framework="pt") as handle:
        metadata = handle.metadata()
    converted, splits = split(tensors)
    verify(tensors, converted, splits)
    save_file(converted, str(out_path), metadata=metadata)
    print(f"{source_path.name}: {len(tensors)} 个权重 -> {len(converted)} 个（拆开 {splits} 个 gate_up）")
    print(f"已写入 {out_path}")


if __name__ == "__main__":
    sys.exit(main())
