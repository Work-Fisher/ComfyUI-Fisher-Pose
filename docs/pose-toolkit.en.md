# Pose Assistance Tools

[中文原文](pose-toolkit.md) · [Usage](usage.en.md) · [Model downloads](installation.en.md#sdpose-optional)

Upstream adapted ideas from [ComfyUI-PZ-EasyUse](https://github.com/prinzer/ComfyUI-PZ-EasyUse) into Fisher's two-person editor. The tools retain person mapping, XYZ movement, independent camera settings, and the two-stage generation workflow.

## Detection and correction

Upload a pose reference and choose DWPose or SDPose. DWPose remains the default; SDPose requires optional weights and ComfyUI core nodes.

- **Detect Skeleton** previews keypoints over the original photo before application.
- **Detect & Apply** applies detection to the current mannequin without replacing the character photos used for generation.
- **Edit Keypoints** supports dragging, adding, deleting, undoing, and resetting body joints. Import or export OpenPose JSON with canvas dimensions, or download a skeleton PNG. Save corrections, then apply them to the mannequin.
- **Multiple people**: select a reference person from DWPose's detections. SDPose extracts a single person from the whole image here; use DWPose for group photos.

The tools pass raw body coordinates with their original precision, without reading them back from a rendered skeleton PNG. Face and finger keypoints are not edited; check occlusion and depth manually.

## Body shape and comparison

**Estimate Body Proportions** makes small adjustments from visible limbs when requested and supports undo. It preserves head direction, person placement, and camera. Perspective shortening means a 2D photo cannot establish true body measurements.

**My Body Presets** saves shape and limb proportions for the current person, preserving pose, placement, the other person, and camera. Up to 30 presets are stored in this browser and lost if its data is cleared. **My Poses** remains stored on the ComfyUI server. Clear Include Body Proportions to preserve the current people's shapes when loading a saved pose.

**Reference Alignment** overlays a character photo, pose reference, or custom image in the shot frame with adjustable opacity. It displays the full image at its original aspect ratio. The overlay is excluded from mannequin references, camera previews, and final output.

## Result history and continued editing

Click **Result History & Comparison** on the Fisher Free Pose node. It reads up to 60 final SaveImage outputs associated with this node from ComfyUI's latest 100 retained tasks and shows the input photos used by each task. Detector previews are excluded.

With one active character photo, **Use as Next Character Photo** copies the result into `input/fisher_history/` and replaces that photo, with undo available. With two active portraits, results are for comparison; select the input to replace in the workflow. This does not queue generation automatically.

History depends on ComfyUI's retained records and may disappear after restarting or clearing history. Saved image files are not deleted by clearing these records.

## Validation limits

The [upstream Chinese guide](pose-toolkit.md#验证边界) records validation of SDPose and DWPose in ComfyUI, keypoint dragging, two-person isolation, body presets, pose-only saves, overlays excluded from output, and XYZ/camera regressions. Automated coverage is in `tests/test_pose_toolkit.mjs`.

These interaction checks do not establish generation quality for extra limbs, identity confusion, or proportion drift. This localization update does not add head-direction inference or change model prompts.
