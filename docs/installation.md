# 安装、模型下载与升级

[返回首页](../README.md) · [使用指南](usage.md)

[插件安装](#安装与依赖插件) · [基础模型](#基础生图模型单人双人都需要) · [换机位模型](#换机位追加模型) · [姿势识别](#照片识别姿势可选)

### 老用户升级需要重新下载什么？

| 你的情况 | 需要更新或补下载 |
|---|---|
| 已经能用 Qwen Image 2.1 + VNCCS V1.1 正常摆姿 | 更新 Fisher Pose、重新导入上方最新版工作流；已有且完整的同版本模型可继续使用，界面、双人对应、自动撑满、骨骼参考与缓存优化本身不需要重新下载模型 |
| 只有旧版 VNCCS V1 | 下载下方 **V1.1**，在 LoRA 节点重新选择；不要只改旧文件名 |
| 原来用 Qwen Image 2511 或其他版本 | 本文统一工作流使用 **Qwen Image 2.1 主模型 + Qwen3-VL 8B + Qwen Image 2.1 VAE**，按基础模型表补齐，不能直接混用旧版 VAE / LoRA |
| 想使用 45°、90°、俯视等新机位 | 在基础模型之外，再下载“换机位追加模型”表中的 **6 个文件**；已经下载过的同文件无需重复下载 |
| 想上传普通照片识别姿势 | 安装下方 **comfyui_controlnet_aux** 和 DWPose 检测权重；只用内置姿势或导入骨架图不需要 |
| 缺少 TripoSplat、抠图或 Qwen 2.1 节点 | 更新 **ComfyUI 核心及其依赖**，不是只更新 Fisher Pose |

统一工作流已加入镜头独立保存、缓存复用、多角度开关和独立宽高常量，旧工作流不会因插件更新自动获得新连线。请另存自己的旧工作流后导入新版，再选择人物图与模型。下载新文件后重启 ComfyUI，并强制刷新浏览器（Ctrl+F5）。本次开关与尺寸控制不增加模型或第三方插件；若提示 `PrimitiveInt` / `PrimitiveBoolean` 缺失，请更新 ComfyUI 核心。

**2026-10-08 机位校准更新**：换机位现在读取 TripoSplat 为当前图像预测的原始机位，修复部分图片转角很大却几乎不变的问题。必须同时更新插件和工作流：新版已将「TripoSplat 采样」的 `latent` 接到「按新机位渲染参考」的 `camera_latent`。保留旧工作流时也可手动补这根线；不要连接正面采样或重建前的空 latent。此次修复不增加模型。

## 安装与依赖插件

| 项目 | 是否需要 | 链接与用途 |
|---|---|---|
| ComfyUI 核心 | 必需 | [官方仓库](https://github.com/Comfy-Org/ComfyUI) · [安装与更新说明](https://docs.comfy.org/installation/update_comfyui)。本插件检查 Qwen Image 2.1 支持；换机位还需要核心自带的 TripoSplat、Gaussian Splat、背景移除节点 |
| Fisher Pose | 必需 | [插件仓库](https://github.com/Work-Fisher/ComfyUI-Fisher-Pose) · [ZIP 下载](https://github.com/Work-Fisher/ComfyUI-Fisher-Pose/archive/refs/heads/main.zip) |
| comfyui_controlnet_aux | 照片识别姿势时需要 | [插件仓库与安装说明](https://github.com/Fannovel16/comfyui_controlnet_aux#installation) · [ZIP 下载](https://github.com/Fannovel16/comfyui_controlnet_aux/archive/refs/heads/main.zip)，提供 `DWPreprocessor` |
| VNCCS Utils | 无需另装 | [原作者插件](https://github.com/AHEKOT/ComfyUI_VNCCS_Utils)。所需人偶核心和资源已随 Fisher Pose 提供，但 **VNCCS LoRA 仍需下载** |

统一工作流中的 `TripoSplatPreprocessImage`、`TripoSplatConditioning`、`VAEDecodeTripoSplat`、`LoadBackgroundRemovalModel` 和 `RemoveBackground` 来自 ComfyUI 核心。遇到这些缺失节点请更新核心及依赖，不需要另外安装同名第三方插件。

### 安装或更新 Fisher Pose

首次安装，在包含 `ComfyUI` 文件夹的目录执行：

```bash
git clone https://github.com/Work-Fisher/ComfyUI-Fisher-Pose.git ComfyUI/custom_nodes/ComfyUI-Fisher-Pose
```

Git 安装的老用户，在插件目录执行：

```bash
git pull --ff-only
```

ZIP 安装请下载新版，备份旧插件文件夹后替换；不要让 `custom_nodes` 下同时出现两份 Fisher Pose。插件本身没有单独的 Python 依赖安装步骤；ComfyUI 核心和可选的 controlnet_aux 仍需安装各自依赖。controlnet_aux 请按照其官方安装说明，使用 **运行 ComfyUI 的同一个 Python 环境** 安装 `requirements.txt`。

从网盘下载的请确认 `web/vnccs/assets/pose_studio_makehuman.v2.bin`（约 86MB）存在。它是插件附带的人偶资源，不是要放进 models 的生图模型；缺失时从本仓库完整下载插件。

安装完成后重启 ComfyUI、Ctrl+F5 刷新页面，导入 [【Work-Fisher】无限姿势+无限视角（支持双人）.json](../workflows/【Work-Fisher】无限姿势+无限视角（支持双人）.json)。默认接好两张单人照；`person_1.png`、`person_2.png` 是占位文件名，请分别上传自己的照片。工作流已内置人偶参考和镜头预览，不依赖作者电脑上的图片；切换为合照或单人见[人物输入方式](usage.md#人物输入方式)。

### 基础生图模型（单人、双人都需要）

以下是 **当前附带工作流默认选择的确切文件名**。路径均相对于 `ComfyUI/`；模型不随插件 ZIP 提供。

| 文件 | 放置目录 | 下载与来源 |
|---|---|---|
| `qwen_image_2.1_int8_convrot.safetensors` | `models/diffusion_models/` | [下载](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/diffusion_models/qwen_image_2.1_int8_convrot.safetensors?download=true) · [Comfy-Org 模型说明](https://huggingface.co/Comfy-Org/Qwen-Image-2.1) |
| `qwen3vl_8b_bf16.safetensors` | `models/text_encoders/` | [下载](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/text_encoders/qwen3vl_8b_bf16.safetensors?download=true) · [来源](https://huggingface.co/Comfy-Org/Qwen-Image-2.1)。CLIPLoader 类型选 `qwen_image` |
| `qwen_image_2.1_vae_bf16.safetensors` | `models/vae/` | [下载](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/vae/qwen_image_2.1_vae_bf16.safetensors?download=true) · [来源](https://huggingface.co/Comfy-Org/Qwen-Image-2.1) |
| `VNCCS_QI2_PoseStudioV1.1.safetensors` | `models/loras/` | [下载](https://huggingface.co/MIUProject/VNCCS_PoseStudio_QI2.1/resolve/main/VNCCS_QI2_PoseStudioV1.1.safetensors?download=true) · [原作者说明](https://huggingface.co/MIUProject/VNCCS_PoseStudio_QI2.1)。姿势 LoRA，强度 1 |

主模型也可在 [官方文件列表](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/tree/main/diffusion_models) 选择 BF16 版本，选择后需同步修改工作流的加载节点。不要把其他版本重命名成表里的文件。旧文件损坏、下成网页或使用不同版本时，才需要替换对应模型；一次插件更新不代表要把所有权重重下一遍。

插件要求 ComfyUI **0.36.0 或更新**并具有 Qwen Image 2.1 支持。若换机位节点仍缺失，请继续更新到包含这些节点的核心版本，同时更新核心 requirements；仅满足版本号不等于所有节点及依赖都已安装。

### 换机位追加模型

只出正面可以不下载本表；换机位需要本表 **6 个文件**，并保留上方基础模型。路径均相对于 `ComfyUI/`。点击“下载”获取文件，“来源”查看作者说明。

| 文件 | 放置目录 | 下载与来源 |
|---|---|---|
| `QI2.1_AnyAngle.safetensors` | `models/loras/` | [下载](https://huggingface.co/lilylilith/QI_2.1_AnyAngle/resolve/main/QI2.1_AnyAngle.safetensors?download=true) · [来源](https://huggingface.co/lilylilith/QI_2.1_AnyAngle) |
| `triposplat_fp16.safetensors` | `models/diffusion_models/` | [下载](https://huggingface.co/VAST-AI/TripoSplat/resolve/main/diffusion_models/triposplat_fp16.safetensors?download=true) · [来源](https://huggingface.co/VAST-AI/TripoSplat) |
| `triposplat_vae_decoder_fp16.safetensors` | `models/vae/` | [下载](https://huggingface.co/VAST-AI/TripoSplat/resolve/main/vae/triposplat_vae_decoder_fp16.safetensors?download=true) · [来源](https://huggingface.co/VAST-AI/TripoSplat) |
| `flux2-vae.safetensors` | `models/vae/` | [下载](https://huggingface.co/VAST-AI/TripoSplat/resolve/main/vae/flux2-vae.safetensors?download=true) · [来源](https://huggingface.co/VAST-AI/TripoSplat) |
| `dino_v3_vit_h.safetensors` | `models/clip_vision/` | [下载](https://huggingface.co/VAST-AI/TripoSplat/resolve/main/clip_vision/dino_v3_vit_h.safetensors?download=true) · [来源](https://huggingface.co/VAST-AI/TripoSplat) |
| `birefnet.safetensors` | `models/background_removal/` | [下载](https://huggingface.co/VAST-AI/TripoSplat/resolve/main/background_removal/birefnet.safetensors?download=true) · [来源](https://huggingface.co/VAST-AI/TripoSplat) |

`background_removal` 目录不存在时手动创建。注意三个 VAE 的用途不同：Qwen VAE 用于生图，Flux2 VAE 和 TripoSplat decoder 用于重建，不能互相替代。此工作流不使用 `triposplat_vae_encoder_fp16.safetensors`，也无需安装 Blender。

### 照片识别姿势（可选）

操作顺序是 **上传姿势参考图 → 识别骨骼图 → 检查预览 → 应用到当前人偶**。双人时应用到当前选中的人偶；动作参考照片不会替换用于生图的人物照片。内置姿势和导入 OpenPose 骨架图不需要 DWPose。

安装上表的 `comfyui_controlnet_aux` 后，首次点识别会由该插件下载检测权重。Fisher Pose 优先选择以下 TorchScript 文件；断网或自动下载失败时可以手动下载：

| 文件 | 下载 | 默认放置目录（相对于 ComfyUI） |
|---|---|---|
| `yolox_l.torchscript.pt` | [下载](https://huggingface.co/hr16/yolox-onnx/resolve/main/yolox_l.torchscript.pt?download=true) · [来源](https://huggingface.co/hr16/yolox-onnx) | `custom_nodes/comfyui_controlnet_aux/ckpts/hr16/yolox-onnx/` |
| `dw-ll_ucoco_384_bs5.torchscript.pt` | [下载](https://huggingface.co/hr16/DWPose-TorchScript-BatchSize5/resolve/main/dw-ll_ucoco_384_bs5.torchscript.pt?download=true) · [来源](https://huggingface.co/hr16/DWPose-TorchScript-BatchSize5) | `custom_nodes/comfyui_controlnet_aux/ckpts/hr16/DWPose-TorchScript-BatchSize5/` |

若你改过 controlnet_aux 的 `annotator_ckpts_path`，请放到配置指定的目录，保留后面的作者/仓库子目录。不同版本可提供不同检测器选项，以控制台实际请求的文件为准；不要将这些检测权重放进 `models/loras`。本功能只提取身体骨架，遮挡关节与前后深度仍可能需要微调。
