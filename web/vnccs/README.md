# Vendored VNCCS Pose Studio core

Copied unchanged from https://github.com/AHEKOT/ComfyUI_VNCCS_Utils (commit 70b752f2), MIT License, Copyright (c) 2025 MiuProject — see LICENSE.
MakeHuman body pack: CC0 1.0 — see assets/pose_studio_makehuman.v2.LICENSE.md.
three.js r160 (MIT) and its OrbitControls/TransformControls.

Used by the Fisher "自由姿势" editor so the mannequin render matches the VNCCS_QI2_PoseStudio LoRA training input.

Local changes (only these): the `.js` files (core, three.js, controls, hand presets) were renamed to `.mjs` so ComfyUI does not auto-load them as extensions (it imports every `web/**/*.js`), and the three import paths inside them were updated to match.
`assets/pose_studio_makehuman.v2.bin` is the upstream `.bin.gz` stored decompressed (same bytes after gunzip): cloud drives delete archive files, and without the pack the editor cannot load. The upstream loader accepts either form.
`textures/skin.png` was edited: the nipples were inpainted away (OpenCV Telea + feathered blur) so the mannequin chest reads flat. The morph `breast_size` is also pinned to 0 by the Fisher editor.
Only `textures/skin.png` (the `naked` skin used by the Fisher editor) is shipped; the unused `skin_marks.png` / `skin_dummy.png` variants were left out.
