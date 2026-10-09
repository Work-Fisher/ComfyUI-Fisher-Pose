# Usage Guide

[中文原文](usage.md) · [Home](../README.en.md) · [Installation and models](installation.en.md)

See the [feedback fix validation record (Chinese)](feedback-validation.md) for the latest framing, skeleton application, and camera-switch checks.

## Modes

| Mode | Node | Purpose |
|---|---|---|
| **Free Pose** | Fisher Qwen2.1 Free Pose | Pose 1–2 realistic 3D mannequins and redraw the reference characters using the VNCCS PoseStudio LoRA. |
| **Pose + new camera** | Free Pose + Fisher AnyAngle Camera | Generate a front pose, reconstruct it with TripoSplat, and redraw from the saved editor camera using AnyAngle. Switches branches automatically and saves the final result. |
| **Universal mannequin image** | Fisher Mannequin Pose Image (Universal) | Outputs a mannequin image and prompt without CLIP/VAE for other editing workflows, such as Qwen Image 2511. |
| **Free Angle** | Fisher Qwen2.1 Character & Pose Encode | Edit a shared camera, poses, and positions for 1–3 people. Uses Chinese edit instructions and optional PE rewriting. [Original detailed guide (Chinese)](自由视角详细说明.md). |

## Interface language

The editors follow **Comfy > Locale > Language**, including changes while open. Chinese language settings show the original Chinese; other languages currently use English. Native Fisher node names, input/output labels, and tooltips use ComfyUI's translation support. Restart ComfyUI and refresh the browser after updating to load those files.

Interface translation preserves prompts, internal option values, filenames, saved names, and custom workflow titles. Some legacy node dropdown values remain Chinese because they are program values; English tooltips explain their meaning. Additional instructions and copied prompts retain their original text. Documentation is available in both languages using the links above.

## Free Pose features

- **Group photos**: upload a whole two-person photo and add a second mannequin. The original left person maps to mannequin 1 and the right person to mannequin 2; use Person Mapping to swap them. The whole photo is image2, without cropping. Moving a mannequin or camera does not reassign identities. Separate portraits use `reference_image_2` for the second photo. Mapping relies on the model following the prompt; it is not a face lock.
- **Realistic mannequins**: uses the [VNCCS Pose Studio](https://github.com/AHEKOT/ComfyUI_VNCCS_Utils) MakeHuman mannequin used to train the LoRA.
- **Pose reference photos**: Upload Pose Reference, click Detect Skeleton, check the original-photo overlay, then Apply to Current Mannequin or Person 1/2. Raw DWPose coordinates are preserved even for cached detections. The motion reference does not replace workflow character photos. Photo detection requires [comfyui_controlnet_aux](https://github.com/Fannovel16/comfyui_controlnet_aux).
- **Match Photo**: preserves 2D limb directions while adapting to mannequin bone lengths. Switch Depth Correction to Estimate Depth for front/back relationships. The mode is saved with the pose; neither mode uniquely recovers 3D motion from one image.
- **OpenPose imports**: click a colored skeleton to pose the mannequin. Depth is inferred from apparent bone shortening; manually flip torso or limb segments when the estimate is wrong.
- **Auto Fit Full Body**: enabled by default. Automatically frames people with a margin as poses or shot angles change. For half-body shots or close-ups, zoom or pan the front camera to disable full-body fitting. This framing goes directly into the first-stage pose reference, including when multi-angle is off. Changing poses or reopening preserves manual framing; Fit Now restores full-body framing.
- **Two-person depth**: use Depth under Person Position & Orientation to move the selected person closer or farther away. Each person's position is saved independently and retained when switching people or reopening. It affects perspective and occlusion in the mannequin reference; the final image still depends on the model.
- **XYZ movement handles**: select Move Person · XYZ in the viewport's upper left. Drag the red X axis left/right, green Y axis up/down, or blue Z axis farther/closer. Only the selected person moves, and the position sliders stay synchronized. Moving disables full-body fitting and supports undo, redo, and saving. If Z overlaps the front viewing direction, use View Axes at an Angle; this changes only the inspection view, preserving the shot camera. Return to Pose Joints to adjust the pose. Editing handles are excluded from output reference images.
- **Pose / Camera**: inspecting in Pose mode preserves the shot camera. Camera mode uses dragging for direction, scrolling for distance, and right-dragging for composition. The preview shows the final shot. The internal VNCCS pose reference remains front-facing; camera changes use the separate AnyAngle branch.
- **Hands and proportions**: Open, Flat, and Fist presets plus grip sliders. Adjust head, neck, shoulders, torso, upper arms, forearms, thighs, and lower legs independently while preserving the pose.
- **Independent dimensions**: set reference size in the editor. The workflow's width/height integer controls set generated image size: 64–4096, multiples of 16. The editor reads these controls to show final dimensions.
- **Immediate preview**: Apply Only or Apply & Generate shows the mannequin on the node without running the workflow first.
- **Small workflows**: mannequin captures are stored under `ComfyUI/input/fisher_pose/` rather than embedding PNG base64 in workflow JSON.
- **Photo aspect ratio**: new poses follow the connected photo's ratio. Select Photo Ratio under Mannequin Image Size to restore it.

## Character inputs

The current workflow connects two separate portraits by default and includes two mannequins, independent dimensions, and the multi-angle switch. All nodes start expanded.

| Input mode | Setup |
|---|---|
| Separate portraits (default) | Upload under Person 1 and Person 2; keep Separate Portraits in the editor. The first photo maps to mannequin 1 and the second to mannequin 2. |
| One group photo | Upload the whole group photo under Person 1. Disconnect `reference_image_2` and remove or disable its image-loading node. Select Group Photo, retain two mannequins, and apply. |
| One person from two portraits | Bypass or mute either photo node. Opening the editor or running automatically uses the remaining photo and its corresponding mannequin. No manual mannequin deletion or rewiring is needed. |

The distributed workflow embeds its initial mannequin reference and camera preview, so no author `input/fisher_pose/` files are required. New captures are saved locally. If you share only a workflow without its capture files, the recipient can open the editor and apply again to rebuild them.

Separate portraits support repeated one/two-person switching. The disabled person's pose stays in workflow data. Single-person edits update only the active person; reenabling both restores their poses and prior placement. A person-count change opens the editor, recaptures and applies the reference, then resumes queueing. Disabling both photos asks you to enable one. A group photo still uses Group Photo mode and two manually retained mannequins.

This switching is performed by the ComfyUI browser extension. Direct API callers must prepare a matching mannequin reference and route the sole character photo to the required `reference_image` input. If an older workflow deleted person 2 without preserving their state, reenabling the photo creates a default mannequin; lost data cannot be restored.

Separate-photo tests followed open-arm and waving poses. Complex raised-leg and prop-holding poses may still deviate. Prompt mapping does not guarantee identical identities, clothing, or every joint position.

## New camera angles: AnyAngle

Import the [current workflow](../workflows/【Work-Fisher】无限姿势+无限视角（支持双人）.json), choose photos, and open Edit Pose & Camera. Set the pose, switch to Camera, choose the shot, then Apply & Generate. Apply Only saves your edits for a later ComfyUI run.

The multi-angle switch above the workflow starts off:

- **Off · Pose Only**: generate the front pose without reconstruction or AnyAngle. Saved camera settings are retained.
- **On · Full Workflow**: use the saved shot camera, reconstruct the subject, and save the AnyAngle result. Front shots skip unnecessary camera processing.

The editor's Camera panel also has Generate Camera View, synchronized with the workflow's multi-angle switch. When off, the preview shows the actual front framing while retaining the rotated camera for later use. The switch and dimension controls use built-in ComfyUI nodes. Front-view zoom and pan directly affect the pose reference without activating the camera branch; yaw or pitch rotation requires multi-angle. Reset to Front resets both the camera and close-up framing.

The workflow has seven colored processing areas. Loaders are on the left; character inputs, pose/camera, front generation, and final output run across the upper row. Reconstruction and camera generation are below and normally require no manual changes. They are muted for front-only generation, while remaining expanded. Native reroutes organize long connections.

- **Base models are sufficient for front shots**: muted camera nodes are neither run nor validated. Enable multi-angle and set a new shot to restore them.
- **Camera-only edits reuse results**: the Fisher Shot node stores the camera separately, so the previous front image and 3D reconstruction remain cached. Only the camera stage reruns.
- **Another image**: if pose and camera are unchanged, Apply & Generate selects a fresh front seed.
- **Output size**: camera output matches the front image's width/height. If camera generation fails, the front preview still shows the first-stage result.

Older workflows and the universal mannequin node still support posing. Without the full generation chain, camera editing is disabled with an explanation. Open Full Workflow loads the current version; choose photos again. AIFISHER Canvas uses the existing pose-image interface and does not provide camera generation or direct queueing here.

### Encoding and calibration

Fisher AnyAngle Encode takes the front result as image1 and the coarse new-camera render as image2, with CLIP and VAE. The supplied workflow uses CFG 1, 25 steps, and camera seed 42. An earlier comparison overexposed at seed 0; this does not establish that all other seeds are safe. Reconstruction removes the background and does not reconstruct the whole original scene. Hidden surfaces are inferred; the mannequin preview guides framing without guaranteeing pixel-exact results.

TripoSplat predicts both geometry and an original camera for each image. The workflow reads that camera from the reconstruction sampler's `latent`, then applies the editor's camera position and orientation, including pitched views. The decoded `splat` alone lacks this camera data; connect `camera_latent` too. Calibration still depends on single-image reconstruction quality and does not measure the real original camera. See [calibration validation (Chinese)](camera-validation.md).

If an angle disagrees with the preview, compare the front result and coarse camera render first. Unmatched poses and inferred depth or two-person placement carry into the camera stage. Simply reversing left/right camera values cannot fix those errors.

## FAQ

| Symptom | Cause and action |
|---|---|
| Disabling one portrait leaves the character's original pose | Update Fisher Pose, restart the backend, and refresh. The current single-person instruction follows the mannequin and switches references according to enabled photos. Existing workflows and models can be reused. [Validation (Chinese)](single-validation.md). |
| Large camera turns remain near-front, or original reconstruction camera is missing | Update plugin and workflow, restart ComfyUI, and connect the TripoSplat sampler's `latent` to `camera_latent`. New calibration uses each reconstruction's predicted camera; no new models are needed. |
| VAE loading fails, `lora key not loaded` appears, or output matches the input photo | Check full logs for incompatible core/model/LoRA versions. Qwen Image 2.1 support is required. Portable installations use `update/update_comfyui.bat`; Git installations use `git pull`. Core must be 0.36.0 or newer. |
| Editor fails with a missing MakeHuman asset / HTTP 404 | Download the complete plugin again from GitHub. Check for `web/vnccs/assets/pose_studio_makehuman.v2.bin` (about 86 MB). |
| Body data exists but loading is interrupted | Check whether IDM, a proxy, or another download manager intercepted the local resource request. The plugin now uses an extension-free body-data route and distinguishes missing files, interrupted requests, and parsing failures. Restart the backend after updating; older servers fall back to the static file. |
| Skeleton detection reaches 100% but Apply does nothing | Check the status beside the detection button. Cropped photos now apply only valid limb segments, preserving undetected parts. A skeleton with no valid segments produces a specific error. Detection progress does not guarantee complete keypoints; provide the original photo and logs for other failures. |
| `pose_json` validation reports `tuple index out of range` | One reproduced cause is a saved link pointing to a nonexistent output slot. The plugin repairs known Fisher pose-data links and checks them against current backend schemas before queueing. If it persists, provide the workflow and full logs; the exception alone does not identify the cause. |
| Mannequin image file is missing | Captures live in `input/fisher_pose/` and may be lost when moving computers or clearing inputs. Open the editor and Apply Only to rebuild it. |
| Extra arms or legs | Match mannequin and photo aspect ratios, use Fit to fill the frame, and use a full-body photo rather than only a headshot. |
| People swap after a pose change | Update the plugin, restart ComfyUI, and refresh. Check Person Mapping and the front result first: the camera stage inherits it. Group-photo mapping still depends on the model's prompt following. |
| Two mannequins generate three people, or keep the group photo's poses | Restart after updating. The current instruction preserves the VNCCS trigger and explicitly reposes the existing two people. The camera stage cannot repair first-stage duplication. [Actual comparisons and limitations (Chinese)](duo-validation.md). |
| Backend person-mapping fix is not loaded | Save, fully stop, and restart the ComfyUI service serving your current URL, then refresh. Updating files, refreshing, or changing workflows alone does not reload Python. Multiple ports may belong to different processes. The browser checks backend capabilities before queueing two-person group photos. |
| Existing workflow headings remain Chinese | Custom workflow titles and saved names are preserved. Native node translations apply to standard node labels; the editors still follow the current ComfyUI language. |

## Known limitations

- Free Pose supports two people. Two-person pose matching is less stable than single-person matching. Broad gestures such as raising a hand or extending an arm work more reliably than subtle gestures such as hands on hips. Multi-person OpenPose images use the largest person.
- A 2D skeleton does not uniquely determine depth. Match Photo preserves visible motion direction rather than real depth. Occlusion, side views, and clothing can hide joints, and illustrated body proportions may differ. Inspect the overlay before applying. Head direction, fingers, and foot orientation are not extracted. With partial keypoints, only visible limbs are applied and other parts retain their current pose; Estimate Depth is disabled for these partial detections.
- Skeleton references are visual model inputs. The prompt tells the model to use colored lines and joint markers only as pose guides. A same-seed comparison removed skeleton lines, but some styles or poses may still copy them. Complex two-person extra limbs, identity changes, and proportion drift still require checking each stage; a successful run does not guarantee a correct image.
- Mannequin images provide pose guidance. If output and reference aspect ratios differ greatly, the model determines character placement.
