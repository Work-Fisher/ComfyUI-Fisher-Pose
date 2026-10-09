# Installation, Models, and Upgrading

[中文原文](installation.md) · [Home](../README.en.md) · [Usage guide](usage.en.md)

## Upgrading

| Existing setup | What to update or download |
|---|---|
| Qwen Image 2.1 + VNCCS V1.1 posing already works | Update Fisher Pose and import the current workflow. Existing complete models of the same version can be reused. Interface changes, person mapping, Auto Fit, skeleton references, and caching do not themselves require new weights. |
| Only VNCCS V1 is installed | Download **V1.1** below and select it in the LoRA node. Renaming the old file is insufficient. |
| Previously used Qwen Image 2511 or another version | The supplied workflow uses **Qwen Image 2.1 + Qwen3-VL 8B + the Qwen Image 2.1 VAE**. Install the base models below; older VAEs and LoRAs are not interchangeable. |
| Want 45°, 90°, or high-angle shots | Add the **6 camera model files** below. Identical files already downloaded can be reused. |
| Want pose detection from ordinary photos | Install **comfyui_controlnet_aux** and DWPose weights. Built-in poses and skeleton imports do not require them. |
| Missing TripoSplat, background removal, or Qwen 2.1 nodes | Update **ComfyUI core and its dependencies**, as well as Fisher Pose. |

The current workflow separates camera storage from pose data and adds caching, a multi-angle switch, and independent integer width/height controls. Updating the plugin does not add these connections to old workflows. Save your old workflow, import the current one, and reselect photos and models. Restart ComfyUI and hard-refresh the browser with Ctrl+F5 after updates. These controls add no models or third-party plugins. Missing `PrimitiveInt` or `PrimitiveBoolean` nodes mean ComfyUI core needs updating.

**Camera calibration update, 2026-10-08:** new camera rendering uses the original camera predicted by TripoSplat for each image. Update both the plugin and workflow. The current workflow connects the TripoSplat sampler's `latent` output to the camera renderer's `camera_latent`. Add this connection manually if retaining an old workflow; do not use the front-generation latent or an empty latent before reconstruction. No additional models are required for this fix.

**English interface update:** restart ComfyUI to load `locales/` node translations, then refresh the browser. The editors follow **Comfy > Locale > Language** automatically, including changes while open. Chinese settings retain the original Chinese; other languages currently fall back to English. Saved option values, prompts, and user-defined names retain their original text. Existing workflows with custom Chinese node titles keep those titles.

## Installation and dependencies

| Component | Required? | Source and purpose |
|---|---|---|
| ComfyUI core | Yes | [Official repository](https://github.com/Comfy-Org/ComfyUI) · [Update instructions](https://docs.comfy.org/installation/update_comfyui). Qwen Image 2.1 support is required; camera changes also use core TripoSplat, Gaussian Splat, and background-removal nodes. |
| Fisher Pose | Yes | [Repository](https://github.com/Work-Fisher/ComfyUI-Fisher-Pose) · [ZIP](https://github.com/Work-Fisher/ComfyUI-Fisher-Pose/archive/refs/heads/main.zip) |
| comfyui_controlnet_aux | For photo detection | [Installation instructions](https://github.com/Fannovel16/comfyui_controlnet_aux#installation) · [ZIP](https://github.com/Fannovel16/comfyui_controlnet_aux/archive/refs/heads/main.zip). Provides `DWPreprocessor`. |
| VNCCS Utils | No separate installation | [Original plugin](https://github.com/AHEKOT/ComfyUI_VNCCS_Utils). Fisher Pose bundles the needed mannequin core and assets; **download the VNCCS LoRA separately**. |

`TripoSplatPreprocessImage`, `TripoSplatConditioning`, `VAEDecodeTripoSplat`, `LoadBackgroundRemovalModel`, and `RemoveBackground` come from ComfyUI core. If they are missing, update core and its dependencies; separate plugins with matching names are unnecessary.

### Install or update Fisher Pose

For first installation, run from the directory containing your `ComfyUI` folder:

```bash
git clone https://github.com/Work-Fisher/ComfyUI-Fisher-Pose.git ComfyUI/custom_nodes/ComfyUI-Fisher-Pose
```

For an existing Git installation, run from the plugin directory:

```bash
git pull --ff-only
```

For a ZIP installation, back up and replace the old plugin folder. Keep only one Fisher Pose copy under `custom_nodes`. The plugin has no separate Python dependency installation step; ComfyUI core and optional controlnet_aux have their own requirements. Follow the controlnet_aux installation instructions using **the same Python environment that runs ComfyUI**.

Check that `web/vnccs/assets/pose_studio_makehuman.v2.bin` exists (about 86 MB), especially after downloading through file-sharing services. This bundled mannequin resource belongs in the plugin, not `models/`. Download the complete plugin again if it is missing.

Restart ComfyUI, hard-refresh with Ctrl+F5, and import the [current workflow](../workflows/【Work-Fisher】无限姿势+无限视角（支持双人）.json). It connects two separate portraits by default. `person_1.png` and `person_2.png` are placeholders; upload your photos. The mannequin and camera previews are embedded, so the author's input files are unnecessary. See [character inputs](usage.en.md#character-inputs) for other modes.

## Base generation models

These are the **exact filenames selected by the supplied workflow**. All folders are relative to `ComfyUI/`. Model weights are not included in the plugin ZIP.

| File | Folder | Download and source |
|---|---|---|
| `qwen_image_2.1_int8_convrot.safetensors` | `models/diffusion_models/` | [Download](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/diffusion_models/qwen_image_2.1_int8_convrot.safetensors?download=true) · [Comfy-Org model notes](https://huggingface.co/Comfy-Org/Qwen-Image-2.1) |
| `qwen3vl_8b_bf16.safetensors` | `models/text_encoders/` | [Download](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/text_encoders/qwen3vl_8b_bf16.safetensors?download=true) · [Source](https://huggingface.co/Comfy-Org/Qwen-Image-2.1) · Set CLIPLoader type to `qwen_image` |
| `qwen_image_2.1_vae_bf16.safetensors` | `models/vae/` | [Download](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/vae/qwen_image_2.1_vae_bf16.safetensors?download=true) · [Source](https://huggingface.co/Comfy-Org/Qwen-Image-2.1) |
| `VNCCS_QI2_PoseStudioV1.1.safetensors` | `models/loras/` | [Download](https://huggingface.co/MIUProject/VNCCS_PoseStudio_QI2.1/resolve/main/VNCCS_QI2_PoseStudioV1.1.safetensors?download=true) · [Author notes](https://huggingface.co/MIUProject/VNCCS_PoseStudio_QI2.1) · Pose LoRA, strength 1 |

You can also choose a BF16 main model from the [official file list](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/tree/main/diffusion_models), then update the workflow's loader selection. Do not rename a different version to match a listed filename. Replace weights only if they are damaged, downloaded as a webpage, or the wrong version; plugin updates do not require downloading every model again.

The plugin requires **ComfyUI 0.36.0 or later with Qwen Image 2.1 support**. If camera nodes are missing, update to a core version containing them and update core requirements. A version number alone does not guarantee all nodes and dependencies are installed.

## Additional camera models

Front poses do not need these files. New camera angles require all **6 files** below in addition to the base models. Folders are relative to `ComfyUI/`.

| File | Folder | Download and source |
|---|---|---|
| `QI2.1_AnyAngle.safetensors` | `models/loras/` | [Download](https://huggingface.co/lilylilith/QI_2.1_AnyAngle/resolve/main/QI2.1_AnyAngle.safetensors?download=true) · [Source](https://huggingface.co/lilylilith/QI_2.1_AnyAngle) |
| `triposplat_fp16.safetensors` | `models/diffusion_models/` | [Download](https://huggingface.co/VAST-AI/TripoSplat/resolve/main/diffusion_models/triposplat_fp16.safetensors?download=true) · [Source](https://huggingface.co/VAST-AI/TripoSplat) |
| `triposplat_vae_decoder_fp16.safetensors` | `models/vae/` | [Download](https://huggingface.co/VAST-AI/TripoSplat/resolve/main/vae/triposplat_vae_decoder_fp16.safetensors?download=true) · [Source](https://huggingface.co/VAST-AI/TripoSplat) |
| `flux2-vae.safetensors` | `models/vae/` | [Download](https://huggingface.co/VAST-AI/TripoSplat/resolve/main/vae/flux2-vae.safetensors?download=true) · [Source](https://huggingface.co/VAST-AI/TripoSplat) |
| `dino_v3_vit_h.safetensors` | `models/clip_vision/` | [Download](https://huggingface.co/VAST-AI/TripoSplat/resolve/main/clip_vision/dino_v3_vit_h.safetensors?download=true) · [Source](https://huggingface.co/VAST-AI/TripoSplat) |
| `birefnet.safetensors` | `models/background_removal/` | [Download](https://huggingface.co/VAST-AI/TripoSplat/resolve/main/background_removal/birefnet.safetensors?download=true) · [Source](https://huggingface.co/VAST-AI/TripoSplat) |

Create `models/background_removal/` if it does not exist. The three VAEs serve different purposes: Qwen VAE generates images, while Flux2 VAE and the TripoSplat decoder support reconstruction. They cannot substitute for each other. This workflow does not use `triposplat_vae_encoder_fp16.safetensors` and does not require Blender.

## Photo pose detection (optional)

Use **Upload Pose Reference → Detect Skeleton → inspect the original-photo overlay → Apply to Current Mannequin**. For two people, apply to the selected mannequin. The motion reference never replaces the workflow's character photos. Built-in presets and OpenPose skeleton imports do not require DWPose. Core `PreviewAny` preserves raw keypoints, including cached detections. This update does not require new detector weights; update Fisher Pose and refresh the browser.

Install `comfyui_controlnet_aux` using the instructions above. On first detection, that plugin downloads detector weights. Fisher Pose prefers the TorchScript files below; download them manually if automatic downloads fail or the machine is offline.

| File | Download | Default folder (relative to ComfyUI) |
|---|---|---|
| `yolox_l.torchscript.pt` | [Download](https://huggingface.co/hr16/yolox-onnx/resolve/main/yolox_l.torchscript.pt?download=true) · [Source](https://huggingface.co/hr16/yolox-onnx) | `custom_nodes/comfyui_controlnet_aux/ckpts/hr16/yolox-onnx/` |
| `dw-ll_ucoco_384_bs5.torchscript.pt` | [Download](https://huggingface.co/hr16/DWPose-TorchScript-BatchSize5/resolve/main/dw-ll_ucoco_384_bs5.torchscript.pt?download=true) · [Source](https://huggingface.co/hr16/DWPose-TorchScript-BatchSize5) | `custom_nodes/comfyui_controlnet_aux/ckpts/hr16/DWPose-TorchScript-BatchSize5/` |

If you changed controlnet_aux's `annotator_ckpts_path`, use that configured location and retain the author/repository subfolders. Detector options vary by version; follow the actual filenames requested in the console. Do not put detector weights in `models/loras/`. Detection extracts the body skeleton only; occlusion and depth may need manual adjustment.
