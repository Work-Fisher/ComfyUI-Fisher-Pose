https://github.com/user-attachments/assets/24dc201a-d9dc-4ac7-86a8-acc9d8f6dd7c

<div align="center">

# Fisher Pose · 机位与姿态

**给 Qwen Image 2.1 用的姿势与机位编辑插件：拖一拖 3D 人偶，或者点一张 OpenPose 骨架图，人物就摆成你要的样子。**

*A ComfyUI pose & camera studio for Qwen Image 2.1 — pose a 3D mannequin (or pick an OpenPose skeleton) and redraw your character in that pose.*

![ComfyUI](https://img.shields.io/badge/ComfyUI-custom%20node-6e8cff)
![Qwen Image 2.1](https://img.shields.io/badge/Qwen%20Image-2.1-8a5cf6)
![VNCCS PoseStudio LoRA](https://img.shields.io/badge/LoRA-VNCCS%20PoseStudio%20QI2.1-f59e0b)
![License](https://img.shields.io/badge/license-MIT-22c55e)

![骨架 → 人偶 → 成图](docs/images/hero.jpg)

</div>

## 下载与升级入口

[插件主页](https://github.com/Work-Fisher/ComfyUI-Fisher-Pose) · [下载插件 ZIP](https://github.com/Work-Fisher/ComfyUI-Fisher-Pose/archive/refs/heads/main.zip) · [最新版工作流](workflows/Fisher-Pose-Studio.json) · [直接下载工作流](https://raw.githubusercontent.com/Work-Fisher/ComfyUI-Fisher-Pose/main/workflows/Fisher-Pose-Studio.json)

### 老用户升级需要重新下载什么？

| 你的情况 | 需要更新或补下载 |
|---|---|
| 已经能用 Qwen Image 2.1 + VNCCS V1.1 正常摆姿 | 更新 Fisher Pose、重新导入上方最新版工作流；已有且完整的同版本模型可继续使用，界面、双人对应、自动撑满、骨骼参考与缓存优化本身不需要重新下载模型 |
| 只有旧版 VNCCS V1 | 下载下方 **V1.1**，在 LoRA 节点重新选择；不要只改旧文件名 |
| 原来用 Qwen Image 2511 或其他版本 | 本文统一工作流使用 **Qwen Image 2.1 主模型 + Qwen3-VL 8B + Qwen Image 2.1 VAE**，按基础模型表补齐，不能直接混用旧版 VAE / LoRA |
| 想使用 45°、90°、俯视等新机位 | 在基础模型之外，再下载“换机位追加模型”表中的 **6 个文件**；已经下载过的同文件无需重复下载 |
| 想上传普通照片识别姿势 | 安装下方 **comfyui_controlnet_aux** 和 DWPose 检测权重；只用内置姿势或导入骨架图不需要 |
| 缺少 TripoSplat、抠图或 Qwen 2.1 节点 | 更新 **ComfyUI 核心及其依赖**，不是只更新 Fisher Pose |

统一工作流已加入镜头独立保存与缓存复用，旧工作流不会因插件更新自动获得新连线。请另存自己的旧工作流后导入新版，再选择人物图与模型。下载新文件后重启 ComfyUI，并强制刷新浏览器（Ctrl+F5）。

## 能做什么

| 模式 | 节点 | 一句话 |
|---|---|---|
| **自由姿势** | `Fisher Qwen2.1 自由姿势` | 1–2 人任意摆姿：真人比例 3D 人偶 + VNCCS PoseStudio LoRA，把参考图里的人物重画成新姿势 |
| **姿势 + 新机位** | 自由姿势 + `Fisher AnyAngle 机位` | 先按正面摆好姿势出图，再用 TripoSplat 变成 3D、按编辑器里设的机位重绘（AnyAngle LoRA），按需自动换机位，只保存最终图像 |
| **通用人偶图** | `Fisher 人偶姿态图（通用）` | 只输出人偶图和提示词，不接 clip / vae，可以当姿势参考接进任何编辑模型的工作流（例如 Qwen Image 2511） |
| **自由视角** | `Fisher Qwen2.1 人物与姿态编码` | 1–3 人共用机位：转镜头、改站位与动作，中文编辑指令，可接 PE 扩写（[详细说明](docs/自由视角详细说明.md)） |

### 自由姿势亮点

- **双人优先用合照**：上传一张双人合照，点「＋ 第二个人」。默认原图左侧人物绑定人偶 1、右侧人物绑定人偶 2；在「人物对应」里可交换。完整合照作为 image2 送入模型，不裁切；通过提示词指定原图左右人物与人偶的对应关系。移动人偶或转镜头不会重新分配身份。两张单人照是可选模式，此时才连接 `reference_image_2`。合照人物的对应依赖模型理解提示词，并非人脸锁定。
- **真人比例人偶**：采用 [VNCCS Pose Studio](https://github.com/AHEKOT/ComfyUI_VNCCS_Utils) 的 MakeHuman 人偶，和 LoRA 训练时用的人偶一致，模型认得出。
- **上传姿势参考图**：先上传动作照片，点「识别骨骼图」，检查骨架预览后再点「应用到当前人偶」（双人时为「应用到人物 1 / 2」）。也可选择「使用已接人物图」。动作参考不会替换工作流的人物照片；下方骨架导入入口仅用于 OpenPose 图。识别需要 [comfyui_controlnet_aux](https://github.com/Fannovel16/comfyui_controlnet_aux)，缺少时会提示。
- **OpenPose 一键摆姿**：点一张彩色骨架图就能摆好。2D 骨架没有前后信息，插件按骨长缩短量推算深度；估错时，躯干和四肢各段都能一键在前后之间翻转。
- **常用姿势**：29 个日常姿势（站、坐、跪、蹲、走、跑、叉腰、抱胸、挥手、敬礼、侧身、背面等），直接按 3D 方向定义，按当前骨长适配，避免从 2D 骨架猜前后深度。
- **FISHER小彩蛋**：内置 209 张骨架图，涵盖站、坐、跪、蹲、躺、劈叉、悬空等姿势，打开就能点。
- **我的图库**：自己的骨架图选一次就会保存下来，下次打开自动载入。
- **我的姿势**：摆好的姿势一键保存，连同体型、比例、画面位置和手势一起存下来，下次点缩略图就能恢复，换工作流也能用。保存在 `ComfyUI/user/default/fisher_pose/poses/`，每个姿势一个 JSON 文件，可以直接拷给别人。
- **输出骨骼**：勾选编辑器画面下方的「输出骨骼」，人偶姿态图与镜头预览会保留黄色关节点、彩色骨骼连线；每次打开编辑器默认开启，本次编辑中可以手动关闭。这张人偶图也用于模型姿势参考。
- **自动撑满**：默认开启，拖动和调整动作、拍摄角度时自动适配人物范围，保留边距。手动调整镜头远近或平移构图会关闭，也可随时重新勾选；开关随姿势保存。
- **摆姿势 / 定镜头**：摆姿势时绕人偶观察不会改变镜头；定镜头时拖动调整拍摄方向、滚轮调整远近、右键拖动构图，预览显示最终机位的人偶示意。程序内部保留 VNCCS 正面姿势参考，转镜头后自动使用换机位链路。
- **手势预设**：张开、并拢、握拳，外加握紧程度滑杆。
- **比例调整**：头部大小、脖子、肩宽、躯干、上臂、小臂、大腿、小腿都可以单独拉长或缩短，姿势保持不变。
- **两个尺寸互不影响**：人偶图尺寸在编辑器里设；输出尺寸由节点的 width/height 决定，可以直接接分辨率节点。
- **应用即预览**：点「仅应用」或「应用并生成」后，人偶图立刻显示在节点上，不用先跑一遍工作流。
- **工作流很小**：人偶图存成 `ComfyUI/input/fisher_pose/` 里的文件，不再以 base64 塞进工作流，避免把整张 PNG 嵌进工作流。
- **人偶图比例跟随人物图**：新建姿势时人偶图自动取人物图的比例，也可以在「人偶图尺寸」里点「人物图」恢复。

## 效果

![效果展示](docs/images/showcase-v2.jpg)

<sub>示例人物图为 AI 生成。人偶图是 image1，人物图是 image2，提示词以 `Draw character from image2` 开头；单人模式追加动作替换、仅保留一个人物及外观保持要求。</sub>

## 新机位（AnyAngle）

统一使用 `workflows/Fisher-Pose-Studio.json`：选择人物照片，点「编辑姿势与镜头」，先摆姿势，再切到「定镜头」选择拍摄角度，最后点「应用并生成」。也可点「仅应用」，稍后通过 ComfyUI 运行。

无需勾选 AnyAngle，也不用换工作流。正面镜头直接使用姿势结果；转动角度后，自动执行主体重建和换机位，只保存最终结果。开着「自动撑满」时，镜头远近和构图由程序自动拟合，不算换机位；关掉后手动调的远近或构图才算。「恢复正面」会重置镜头并跳过换机位处理。工作流下方折叠的自动处理节点通常无需调整。

- **只出正面，不用下载机位模型**：镜头是正面时，「应用」会把换机位那组节点设为静音（灰色），ComfyUI 不会运行也不会检查它们，所以没有下面这些模型也能出图。定了新镜头再「应用」，它们会自动恢复。
- **只换镜头，正面图不变**：镜头单独存在「Fisher 镜头」节点里，第一阶段种子固定，所以只改镜头时会直接复用上次的正面图和 3D 重建，只重跑换机位那一步。
- **想换一张**：姿势和镜头都没改，再点「应用并生成」，会自动换一个新的正面种子。
- 换机位的输出尺寸和正面图一致，也就是节点的 width/height。如果换机位失败，正面图仍会显示在「正面结果」预览节点里。

旧工作流和通用人偶图节点仍可摆姿势；没有连接完整生成链路时，镜头编辑入口会禁用并说明原因。ComfyUI 旧工作流内可点「打开完整工作流」加载新版，再选择人物照片。AIFISHER 画布目前仍走原有姿势图接口，不提供这里的镜头生成与直接排队按钮。

### 换机位追加模型

只出正面可以不下载本表；换机位需要本表 **6 个文件**，并保留下方基础模型。路径均相对于 `ComfyUI/`。点击“下载”获取文件，“来源”查看作者说明。

| 文件 | 放置目录 | 下载与来源 |
|---|---|---|
| `QI2.1_AnyAngle.safetensors` | `models/loras/` | [下载](https://huggingface.co/lilylilith/QI_2.1_AnyAngle/resolve/main/QI2.1_AnyAngle.safetensors?download=true) · [来源](https://huggingface.co/lilylilith/QI_2.1_AnyAngle) |
| `triposplat_fp16.safetensors` | `models/diffusion_models/` | [下载](https://huggingface.co/VAST-AI/TripoSplat/resolve/main/diffusion_models/triposplat_fp16.safetensors?download=true) · [来源](https://huggingface.co/VAST-AI/TripoSplat) |
| `triposplat_vae_decoder_fp16.safetensors` | `models/vae/` | [下载](https://huggingface.co/VAST-AI/TripoSplat/resolve/main/vae/triposplat_vae_decoder_fp16.safetensors?download=true) · [来源](https://huggingface.co/VAST-AI/TripoSplat) |
| `flux2-vae.safetensors` | `models/vae/` | [下载](https://huggingface.co/VAST-AI/TripoSplat/resolve/main/vae/flux2-vae.safetensors?download=true) · [来源](https://huggingface.co/VAST-AI/TripoSplat) |
| `dino_v3_vit_h.safetensors` | `models/clip_vision/` | [下载](https://huggingface.co/VAST-AI/TripoSplat/resolve/main/clip_vision/dino_v3_vit_h.safetensors?download=true) · [来源](https://huggingface.co/VAST-AI/TripoSplat) |
| `birefnet.safetensors` | `models/background_removal/` | [下载](https://huggingface.co/VAST-AI/TripoSplat/resolve/main/background_removal/birefnet.safetensors?download=true) · [来源](https://huggingface.co/VAST-AI/TripoSplat) |

`background_removal` 目录不存在时手动创建。注意三个 VAE 的用途不同：Qwen VAE 用于生图，Flux2 VAE 和 TripoSplat decoder 用于重建，不能互相替代。此工作流不使用 `triposplat_vae_encoder_fp16.safetensors`，也无需安装 Blender。

当前工作流使用「Fisher 换机位编码」固定接入正面结果、粗渲染、CLIP 和 VAE，内部按正面 `image1`、粗渲染 `image2` 编码，CFG 1、25 步，换机位种子固定 42。实测种子 0 会让这一步过曝，其他种子正常。重建前会抠出主体；这不是对原背景的完整三维还原。背面和被挡住的部分由模型推测，人偶预览用于构图，不能保证最终画面逐像素一致。

## 编辑器

![姿势与镜头编辑器](docs/images/studio-editor.jpg)

- **左侧**：常用姿势 / FISHER小彩蛋 / 我的图库、我的姿势、深度修正、手势。
- **中间**：3D 视口。橙框是最终拍摄范围，右下角小图是最终机位的人偶示意。
- **右侧**：镜头角度与远近、人物位置与转身、关节、体型和比例。内部参考图尺寸与提示词放在折叠区。

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

安装完成后重启 ComfyUI、Ctrl+F5 刷新页面，导入 [Fisher-Pose-Studio.json](workflows/Fisher-Pose-Studio.json)。工作流自带的 `example.png` 是占位文件，请选择自己的照片。

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

### 照片识别姿势（可选）

操作顺序是 **上传姿势参考图 → 识别骨骼图 → 检查预览 → 应用到当前人偶**。双人时应用到当前选中的人偶；动作参考照片不会替换用于生图的人物照片。内置姿势和导入 OpenPose 骨架图不需要 DWPose。

安装上表的 `comfyui_controlnet_aux` 后，首次点识别会由该插件下载检测权重。Fisher Pose 优先选择以下 TorchScript 文件；断网或自动下载失败时可以手动下载：

| 文件 | 下载 | 默认放置目录（相对于 ComfyUI） |
|---|---|---|
| `yolox_l.torchscript.pt` | [下载](https://huggingface.co/hr16/yolox-onnx/resolve/main/yolox_l.torchscript.pt?download=true) · [来源](https://huggingface.co/hr16/yolox-onnx) | `custom_nodes/comfyui_controlnet_aux/ckpts/hr16/yolox-onnx/` |
| `dw-ll_ucoco_384_bs5.torchscript.pt` | [下载](https://huggingface.co/hr16/DWPose-TorchScript-BatchSize5/resolve/main/dw-ll_ucoco_384_bs5.torchscript.pt?download=true) · [来源](https://huggingface.co/hr16/DWPose-TorchScript-BatchSize5) | `custom_nodes/comfyui_controlnet_aux/ckpts/hr16/DWPose-TorchScript-BatchSize5/` |

若你改过 controlnet_aux 的 `annotator_ckpts_path`，请放到配置指定的目录，保留后面的作者/仓库子目录。不同版本可提供不同检测器选项，以控制台实际请求的文件为准；不要将这些检测权重放进 `models/loras`。本功能只提取身体骨架，遮挡关节与前后深度仍可能需要微调。

## 快速上手

1. 导入 `workflows/Fisher-Pose-Studio.json`，选择节点里的模型文件和人物照片。
2. 点「编辑姿势与镜头」，在「摆姿势」里选择预设或拖关节。
3. 需要换拍摄角度时，切到「定镜头」，拖动画面定角度，滚轮调远近，右键拖动调构图。
4. 看右下角最终机位预览，点「应用并生成」。结果出现在「最终图像」，无需手动切换两阶段。

最终输出宽高仍由节点 width/height 决定；编辑器的「姿势参考尺寸」独立控制内部人偶图。只出正面时准备自由姿势所需模型即可；需要换机位时再安装 AnyAngle 与重建模型。

> `extra_prompt` 会另起一行附在固定指令后面，建议写英文，例如 `soft studio light`。

## 致谢

这个插件的自由姿势模式建立在以下开源工作之上，感谢各位作者的付出：

- **[VNCCS Utils](https://github.com/AHEKOT/ComfyUI_VNCCS_Utils) · [MiuProject / AHEKOT](https://github.com/AHEKOT)**：提供了 Pose Studio 人偶核心（`PoseViewerCore`、IK、截图）、MakeHuman 人体包加载、手部预设，以及 **[VNCCS PoseStudio QI2.1 LoRA](https://huggingface.co/MIUProject/VNCCS_PoseStudio_QI2.1)** 和它的训练约定（人偶 = image1，人物 = image2，`Draw character from image2`）。如果没有这套人偶和 LoRA，就没有这个自由姿势模式。代码以 MIT 许可随本仓库分发于 `web/vnccs/`，改动说明见该目录的 README。欢迎去原仓库点个星。
- **[MakeHuman](http://www.makehumancommunity.org/)**：人体网格与形体数据（CC0 1.0）。
- **[Qwen Image 2.1](https://github.com/QwenLM/Qwen-Image-2.1)**：生图模型，以及 [prompt_rewrite](https://github.com/QwenLM/Qwen-Image-2.1/tree/main/prompt_rewrite) 编辑指令规范（用于自由视角模式）。
- **[three.js](https://threejs.org/)**：3D 渲染（MIT）。
- **[ControlNet](https://github.com/lllyasviel/ControlNet)**：OpenPose 骨架的配色与连接顺序参考。
- **[ComfyUI-qwenmultiangle](https://github.com/jtydhr88/ComfyUI-qwenmultiangle)**：视角分档与镜头词汇参考。
- **[QI 2.1 AnyAngle](https://huggingface.co/lilylilith/QI_2.1_AnyAngle) · lilylilith**：换机位 LoRA；**[TripoSplat](https://github.com/VAST-AI-Research/TripoSplat) · VAST**：单图生成 3D 高斯溅射；**[AnyAngle Studio · T8](https://github.com/T8mars/Comfyui-Qwen-Image-2.1-MultiAngle-T8)**：AnyAngle 图片顺序与用法的参考。
- **[ComfyUI](https://github.com/comfyanonymous/ComfyUI)**：插件运行的平台。

## 常见问题

| 现象 | 原因和解决 |
|---|---|
| 「加载VAE 执行失败」、日志里有 `lora key not loaded`、出图和人物图一模一样 | 可能是核心版本、模型或 LoRA 不匹配，需结合完整日志判断。确认核心支持 Qwen Image 2.1；便携版可运行 `update/update_comfyui.bat`，git 安装执行 `git pull`，更新到 0.36.0 以上 |
| 编辑器打不开，或提示 `Failed to load Pose Studio MakeHuman asset: HTTP 404` | 插件文件不完整，通常是网盘下载时漏了文件。从 GitHub 重新下载，确认 `web/vnccs/assets/pose_studio_makehuman.v2.bin`（约 86MB）存在 |
| 找不到人偶图文件 | 人偶图存在 `input/fisher_pose/`，换电脑或清空过 input 文件夹时会丢。打开编辑器点一次「应用到节点」即可重新生成 |
| 多手、多腿 | 人偶图比例尽量和人物图一致（「人偶图尺寸」里点「人物图」），并用「撑满」让人偶占满画面。人物图请用全身照，只有头像时模型不知道身体长什么样 |

## 许可

- 本插件代码：[MIT](LICENSE)。
- `web/vnccs/`：VNCCS Utils（MIT, © 2025 MiuProject）；MakeHuman 人体包（CC0 1.0）；three.js（MIT）。
- `web/editor/vendor/`：three.js（MIT）。
- 使用 LoRA 和基础模型时，请遵守它们各自的许可。

## 已知限制

- 自由姿势最多两个人。当前双人样本中的姿势跟随不如单人稳定，动作幅度大的姿势（举手、指向、伸臂）比细微动作（叉腰）更容易还原。OpenPose 图里有多人时，只取身形最大的那个人。
- 2D 骨架无法唯一确定前后深度，复杂姿势需要手动翻转或微调。头部朝向、手指、脚掌不会从骨架读取。
- 人偶图只提供姿势。输出比例和人偶图差别很大时，人物在画面里的位置由模型决定。

---

更多：[自由视角模式详细说明](docs/自由视角详细说明.md)
