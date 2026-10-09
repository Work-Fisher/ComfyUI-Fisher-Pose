<div align="center">

# Fisher Pose

**Set the pose. Frame the shot.**

Edit one- or two-person poses in ComfyUI and generate matching images with Qwen Image 2.1.

[English](README.en.md) · [中文](README.md)

[Download plugin](https://github.com/Work-Fisher/ComfyUI-Fisher-Pose/archive/refs/heads/main.zip) · [Download workflow](https://raw.githubusercontent.com/Work-Fisher/ComfyUI-Fisher-Pose/main/workflows/【Work-Fisher】无限姿势+无限视角（支持双人）.json)

[Installation & models](docs/installation.en.md) · [Usage guide](docs/usage.en.md)

</div>

The editor follows **Comfy > Locale > Language** in ComfyUI, including changes while it is open. Chinese language settings show the original Chinese; other languages currently use English. The interface language does not change saved poses, workflow values, or prompts sent to the models. Restart ComfyUI and refresh the browser after installing this update so native node translations are loaded.

## Demo

https://github.com/user-attachments/assets/24dc201a-d9dc-4ac7-86a8-acc9d8f6dd7c

<sub>Free Pose demonstration. Two-person and new-camera examples are shown below.</sub>

## From pose to image

### One person: skeleton, mannequin, and result

Choose a skeleton or drag the mannequin's joints, then generate the matching pose using a character photo.

<img src="docs/images/hero.jpg" alt="Left: OpenPose skeleton; center: mannequin pose; right: generated result" width="100%">

<details>
<summary>Full comparison: skeleton, mannequin, character reference, and result</summary>

![Full pose comparison](docs/images/showcase-v2.jpg)

</details>

### Two people: one group photo, independent poses

Upload the whole group photo and add a second person in the editor. Adjust the mannequins independently; swap person mapping on the right if needed.

<table>
<tr><th width="30%">Group photo</th><th width="30%">Two-person pose</th><th width="40%">Result</th></tr>
<tr>
<td align="center"><img src="docs/images/duo-reference.png" alt="Whole group photo used as the character reference" width="230"></td>
<td align="center"><img src="docs/images/duo-pose.png" alt="Left mannequin with arms extended; right mannequin with a raised hand" width="230"></td>
<td align="center"><img src="docs/images/duo-result.png" alt="Generated two-person pose" width="320"></td>
</tr>
</table>

<sub>The whole photo is used; manual cropping is unnecessary. Identity mapping depends on the model's understanding. Complex occlusion and small movements may need adjustment.</sub>

### Multiple views: same pose, different camera

Generate the front pose first, then use AnyAngle to change the camera. Labels show the camera angles set in the editor.

<table>
<tr><th width="33%">Front</th><th width="33%">Right 45°</th><th width="33%">Right 90°</th></tr>
<tr>
<td><img src="docs/images/angle-front.png" alt="Front pose result" width="280"></td>
<td><img src="docs/images/angle-45.png" alt="Result with the camera set to right 45 degrees" width="280"></td>
<td><img src="docs/images/angle-90.png" alt="Result with the camera set to right 90 degrees" width="280"></td>
</tr>
</table>

<sub>Actual generated results. Camera and pose matching are not guaranteed pixel for pixel; hidden and rear surfaces are inferred by the model. New camera angles require additional models.</sub>

## Get started in three steps

| 1 · Choose people | 2 · Pose and frame | 3 · Apply and generate |
|---|---|---|
| Upload two separate portraits by default, or switch to a group photo or one person | Choose presets, drag joints, and switch to Camera when needed | Check the camera preview and run generation |

Prepare the environment using the [installation guide](docs/installation.en.md), then import the current [Fisher Pose workflow](workflows/【Work-Fisher】无限姿势+无限视角（支持双人）.json).

- **Two portrait inputs are connected**: upload photos under Person 1 and Person 2. The supplied references contain open arms for mannequin 1 and a wave for mannequin 2; no author input files are required. See [character inputs](docs/usage.en.md#character-inputs) for group-photo and single-person use.
- **Multi-angle off**: generate the front pose only; the base models are sufficient.
- **Multi-angle on**: run the full workflow using the saved camera. Camera-only edits reuse the last front result and 3D reconstruction.
- **Output size**: the two integer controls above the workflow set width and height independently of the editor's mannequin reference size.
- **Generate another image**: with the pose and camera unchanged, Apply & Generate updates the front seed.

<details>
<summary>Editor layout and controls</summary>

![Editor layout from an earlier interface; use the current buttons](docs/images/studio-editor.jpg)

Choose poses on the left, edit the mannequin in the center, and adjust camera, joints, body shape, and proportions on the right. In Pose mode, dragging empty space changes the inspection view without changing the shot camera.

[Complete usage guide](docs/usage.en.md)

</details>

## Features

| Posing | Camera and framing | Assets and reuse |
|---|---|---|
| Independent posing for one or two people | Front, side, high-angle, and low-angle shots | 29 common poses |
| Drag joints; adjust hands and body proportions | Separate inspection and shot cameras | 209 built-in skeletons |
| Photo → skeleton preview → apply pose | Auto Fit, camera zoom, and pan | Saved poses and personal library |
| Skeleton reference enabled by default | Independent reference and output dimensions | Mannequin preview immediately on apply |

Photo detection requires the optional DWPose plugin and weights. [Dependencies and downloads](docs/installation.en.md#photo-pose-detection-optional)

## Installation and downloads

| Task | Start here |
|---|---|
| First installation | [Plugin and environment](docs/installation.en.md#installation-and-dependencies) |
| One- or two-person pose generation | [4 base models and their folders](docs/installation.en.md#base-generation-models) |
| New camera angles | [6 additional camera models](docs/installation.en.md#additional-camera-models) |
| Detect a pose from a photo | [Detection plugin and 2 weights](docs/installation.en.md#photo-pose-detection-optional) |
| Upgrade an existing installation | [What to update and which models can be reused](docs/installation.en.md#upgrading) |

**After updating, import the current workflow, restart ComfyUI, and refresh the browser.** Existing complete files of the same model version can be reused.

The camera calibration update requires the current workflow's `camera_latent` connection. It addresses reconstruction angles that disagree with the preview and shots that remain near the front view after a camera change. See [upgrading](docs/installation.en.md#upgrading).

[FAQ](docs/usage.en.md#faq) · [Known limitations](docs/usage.en.md#known-limitations) · [Original Free Angle mode (Chinese)](docs/自由视角详细说明.md)

## Acknowledgments

Free Pose builds on these open-source projects:

- **[VNCCS Utils](https://github.com/AHEKOT/ComfyUI_VNCCS_Utils) · [MiuProject / AHEKOT](https://github.com/AHEKOT)**: Pose Studio mannequin core (`PoseViewerCore`, IK, capture), MakeHuman body-pack loading, hand presets, and the **[VNCCS PoseStudio QI2.1 LoRA](https://huggingface.co/MIUProject/VNCCS_PoseStudio_QI2.1)** and its training convention: mannequin = image1, character = image2, `Draw character from image2`. Free Pose depends on this mannequin and LoRA. The code is distributed under MIT in `web/vnccs/`; modifications are documented in that directory's README.
- **[MakeHuman](http://www.makehumancommunity.org/)**: human meshes and body-shape data (CC0 1.0).
- **[Qwen Image 2.1](https://github.com/QwenLM/Qwen-Image-2.1)**: image generation and [prompt_rewrite](https://github.com/QwenLM/Qwen-Image-2.1/tree/main/prompt_rewrite) conventions used by Free Angle mode.
- **[three.js](https://threejs.org/)**: 3D rendering (MIT).
- **[ControlNet](https://github.com/lllyasviel/ControlNet)**: OpenPose skeleton colors and connection order.
- **[ComfyUI-qwenmultiangle](https://github.com/jtydhr88/ComfyUI-qwenmultiangle)**: camera angle categories and vocabulary.
- **[QI 2.1 AnyAngle](https://huggingface.co/lilylilith/QI_2.1_AnyAngle) · lilylilith**: camera-change LoRA; **[TripoSplat](https://github.com/VAST-AI-Research/TripoSplat) · VAST**: single-image 3D Gaussian splats; **[AnyAngle Studio · T8](https://github.com/T8mars/Comfyui-Qwen-Image-2.1-MultiAngle-T8)**: image order and usage references.
- **[ComfyUI](https://github.com/comfyanonymous/ComfyUI)**: the platform this plugin runs on.

## License

- Plugin code: [MIT](LICENSE).
- `web/vnccs/`: VNCCS Utils (MIT, © 2025 MiuProject), MakeHuman body pack (CC0 1.0), three.js (MIT).
- `web/editor/vendor/`: three.js (MIT).
- Follow each model and LoRA's own license.
