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

## 能做什么

| 模式 | 节点 | 一句话 |
|---|---|---|
| **自由姿势** | `Fisher Qwen2.1 自由姿势` | 1–2 人任意摆姿：真人比例 3D 人偶 + VNCCS PoseStudio LoRA，把参考图里的人物重画成新姿势 |
| **姿势 + 新机位** | 自由姿势 + `Fisher AnyAngle 机位` | 先按正面摆好姿势出图，再用 TripoSplat 变成 3D、按编辑器里设的机位重绘（AnyAngle LoRA），一次运行出两张 |
| **通用人偶图** | `Fisher 人偶姿态图（通用）` | 只输出人偶图和提示词，不接 clip / vae，可以当姿势参考接进任何编辑模型的工作流（例如 Qwen Image 2511） |
| **自由视角** | `Fisher Qwen2.1 人物与姿态编码` | 1–3 人共用机位：转镜头、改站位与动作，中文编辑指令，可接 PE 扩写（[详细说明](docs/自由视角详细说明.md)） |

### 自由姿势亮点

- **最多两个人**：编辑器上方点「＋ 第二个人」，两个人各自摆姿势、调位置、改体型；点画面里的人偶就能切换编辑对象。第二个人的照片接节点的 `reference_image_2`（image3），提示词会按两人在画面里的左右自动写好。
- **真人比例人偶**：采用 [VNCCS Pose Studio](https://github.com/AHEKOT/ComfyUI_VNCCS_Utils) 的 MakeHuman 人偶，和 LoRA 训练时用的人偶一致，模型认得出。
- **从人物图识别姿势**：在编辑器里点一下，用 DWPose 读出人物图里的姿势，人偶直接摆好，再在 3D 里微调。需要装 [comfyui_controlnet_aux](https://github.com/Fannovel16/comfyui_controlnet_aux)，没装时按钮不出现。
- **OpenPose 一键摆姿**：点一张彩色骨架图就能摆好。2D 骨架没有前后信息，插件按骨长缩短量推算深度；估错时，躯干和四肢各段都能一键在前后之间翻转。
- **常用姿势**：29 个日常姿势（站、坐、跪、蹲、走、跑、叉腰、抱胸、挥手、敬礼、侧身、背面等），直接按 3D 方向定义，套在任何体型上都准，不会有 2D 骨架的前后歧义。
- **FISHER小彩蛋**：内置 209 张骨架图，涵盖站、坐、跪、蹲、躺、劈叉、悬空等姿势，打开就能点。
- **我的图库**：自己的骨架图选一次就会保存下来，下次打开自动载入。
- **我的姿势**：摆好的姿势一键保存，连同体型、比例、画面位置和手势一起存下来，下次点缩略图就能恢复，换工作流也能用。保存在 `ComfyUI/user/default/fisher_pose/poses/`，每个姿势一个 JSON 文件，可以直接拷给别人。
- **自由视角编辑，正面输出**：拖空白处随意转视角、拖关节摆姿（手、脚、髋部可 IK）、Shift+拖动移动人物；输出固定为 VNCCS 的正面相机。
- **手势预设**：张开、并拢、握拳，外加握紧程度滑杆。
- **比例调整**：头部大小、脖子、肩宽、躯干、上臂、小臂、大腿、小腿都可以单独拉长或缩短，姿势保持不变。
- **两个尺寸互不影响**：人偶图尺寸在编辑器里设；输出尺寸由节点的 width/height 决定，可以直接接分辨率节点。
- **应用即预览**：点「应用到节点」后，人偶图立刻显示在节点上，不用先跑一遍工作流。
- **工作流很小**：人偶图存成 `ComfyUI/input/fisher_pose/` 里的文件，不再以 base64 塞进工作流，工作流只有十几 KB。
- **人偶图比例跟随人物图**：新建姿势时人偶图自动取人物图的比例，也可以在「人偶图尺寸」里点「人物图」恢复。

## 效果

![效果展示](docs/images/showcase-v2.jpg)

<sub>示例人物图为 AI 生成。人偶图是 image1，人物图是 image2，提示词固定为 `Draw character from image2`。</sub>

## 新机位（AnyAngle）

导入 `workflows/Fisher-Qwen2.1-自由姿势+机位-AnyAngle.json`，打开编辑器，在「输出」里启用 **新机位 · AnyAngle**：用滑杆调水平角度和俯仰（正数是从上往下看），或者先在视口里转到想要的角度再点「用视口的当前视角」。下面的小图就是新机位下的人偶。应用后运行，工作流先出正面姿势图，再把它重建成 3D、从新机位重绘。

额外需要的模型（约 3.7GB）：

| 文件 | 放到 | 来源 |
|---|---|---|
| `QI2.1_AnyAngle.safetensors` | `models/loras` | [lilylilith/QI_2.1_AnyAngle](https://huggingface.co/lilylilith/QI_2.1_AnyAngle) |
| `triposplat_fp16.safetensors` | `models/diffusion_models` | [VAST-AI/TripoSplat](https://huggingface.co/VAST-AI/TripoSplat) |
| `triposplat_vae_decoder_fp16.safetensors`、`flux2-vae.safetensors` | `models/vae` | 同上 |
| `dino_v3_vit_h.safetensors` | `models/clip_vision` | 同上 |
| `birefnet.safetensors` | `models/background_removal` | [Comfy-Org/BiRefNet](https://huggingface.co/Comfy-Org/BiRefNet) |

几点经验（都实测过）：正面结果接 AnyAngle 编码的 `image1`、粗渲染接 `image2`，CFG 1、25 步；反过来接机位不会变。种子 0 会让这一步过曝发硬，工作流默认种子 42 并每次随机。3D 由单张图重建，背面和被挡住的部分是模型猜的，转得越多越不准。

## 编辑器

![自由姿势编辑器](docs/images/editor.jpg)

- **左侧**：常用姿势 / FISHER小彩蛋 / 我的图库、我的姿势、深度修正、手势。
- **中间**：3D 视口。橙色框是输出画面，右下角小图是实际的正面输出。
- **右侧**：人物在画面中的大小、位置和转身，人偶图尺寸，关节微调，体型，头颈与四肢比例。

## 安装

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/Work-Fisher/ComfyUI-Fisher-Pose.git
```

装好后重启 ComfyUI 并刷新浏览器。插件不需要额外安装 Python 依赖，节点搜 `Fisher` 就能找到。

也可以在 GitHub 页面点 Code → Download ZIP，解压后把文件夹放进 `custom_nodes`。从网盘下载的请确认 `web/vnccs/assets/` 里有约 86MB 的 `pose_studio_makehuman.v2.bin`，缺了它编辑器打不开人偶。

**自由姿势需要的模型：**

| 文件 | 放到 | 说明 |
|---|---|---|
| `qwen_image_2.1_*.safetensors` | `models/diffusion_models` | Qwen Image 2.1 主模型 |
| `qwen3vl_8b_*.safetensors` | `models/text_encoders` | 类型选 `qwen_image` |
| `qwen_image_2.1_vae_*.safetensors` | `models/vae` | |
| `VNCCS_QI2_PoseStudioV1.1.safetensors` | `models/loras` | **必需**，强度 1。下载：[MIUProject/VNCCS_PoseStudio_QI2.1](https://huggingface.co/MIUProject/VNCCS_PoseStudio_QI2.1) |

**需要 ComfyUI 0.36.0 或更新**（Qwen Image 2.1 在这个版本进入 ComfyUI 核心）。版本太旧时，编辑器顶部会显示红色提示。

## 快速上手（自由姿势）

1. 拖入 `workflows/Fisher-Qwen2.1-自由姿势-VNCCS-LoRA.json`，在「人物图 → image2」节点里选你的人物照片。
2. 点节点上的 **「打开自由姿势编辑器」**，在左侧 FISHER小彩蛋 里点一张骨架图，或者自己拖关节摆姿势。
3. 需要时用「深度修正」翻转前后、调整手势和人物大小，然后点 **「应用到节点」**。
4. 设置输出宽高，点运行。推荐参数：25 步、cfg 1、euler / simple，和 VNCCS 官方一致。

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
| 「加载VAE 执行失败」、日志里有 `lora key not loaded`、出图和人物图一模一样 | ComfyUI 版本太旧，不支持 Qwen Image 2.1。便携版运行 `update/update_comfyui.bat`，git 安装执行 `git pull`，更新到 0.36.0 以上 |
| 编辑器打不开，或提示 `Failed to load Pose Studio MakeHuman asset: HTTP 404` | 插件文件不完整，通常是网盘下载时漏了文件。从 GitHub 重新下载，确认 `web/vnccs/assets/pose_studio_makehuman.v2.bin`（约 86MB）存在 |
| 找不到人偶图文件 | 人偶图存在 `input/fisher_pose/`，换电脑或清空过 input 文件夹时会丢。打开编辑器点一次「应用到节点」即可重新生成 |
| 多手、多腿 | 人偶图比例尽量和人物图一致（「人偶图尺寸」里点「人物图」），并用「撑满」让人偶占满画面。人物图请用全身照，只有头像时模型不知道身体长什么样 |

## 许可

- 本插件代码：[MIT](LICENSE)。
- `web/vnccs/`：VNCCS Utils（MIT, © 2025 MiuProject）；MakeHuman 人体包（CC0 1.0）；three.js（MIT）。
- `web/editor/vendor/`：three.js（MIT）。
- 使用 LoRA 和基础模型时，请遵守它们各自的许可。

## 已知限制

- 自由姿势最多两个人。VNCCS LoRA 是用单人数据训练的，两人时姿势跟随度不如单人稳定，动作幅度大的姿势（举手、指向、伸臂）比细微动作（叉腰）更容易还原。OpenPose 图里有多人时，只取身形最大的那个人。
- 2D 骨架无法唯一确定前后深度，复杂姿势需要手动翻转或微调。头部朝向、手指、脚掌不会从骨架读取。
- 人偶图只提供姿势。输出比例和人偶图差别很大时，人物在画面里的位置由模型决定。

---

更多：[自由视角模式详细说明](docs/自由视角详细说明.md)
