# 测试

在插件根目录运行（`python` 用 ComfyUI 自带的解释器）。以下测试都不会加载模型权重。

```bash
python -m unittest discover -s tests -p "test_pose*.py"
python -m unittest discover -s tests -p "test_pe_rewrite.py"
python -m unittest discover -s tests -p "test_gguf_clip.py"
python tests/test_saved_poses.py
python tests/test_anyangle.py
python tests/test_free_pose.py <ComfyUI 目录>
python tests/test_qwen_bridge.py <ComfyUI 目录>
node tests/test_openpose_lift.mjs
node --test tests/test_apply_state.mjs
node --test tests/test_workflow_controls.mjs
node --test tests/test_binding_runtime.mjs
```

`test_free_pose.py` 和 `test_qwen_bridge.py` 需要传入 ComfyUI 目录，用来导入 `TextEncodeQwenImage21`。

`tests/e2e/` 是浏览器端到端场景：用无头 Chrome 打开真实的 ComfyUI 前端，载入统一工作流后执行场景脚本。`studio_interaction.js`、`apply_stores_file.js` 等只检查交互；`anyangle_generate.js`、`two_people_generate.js` 会真实排队生图并加载模型。需要先启动 ComfyUI：

```bash
python tests/e2e/cdp_run.py tests/e2e/studio_interaction.js --base http://127.0.0.1:8188
```

常用姿势的缩略图由 `tools/build_common_poses.py` 在真实编辑器里渲染（改了 `web/editor/common-poses.mjs` 之后重跑，`--review` 会输出正面加侧面的检查图）。

`tools/upgrade_studio_workflow.js` 是统一工作流加入「Fisher 镜头」节点时的一次性迁移脚本（同样用 `cdp_run.py` 运行），留作记录。

`tests/fixtures/` 保留升级前的两份工作流，用于旧版本兼容测试，不作为用户入口。

## English / Chinese interface regression

```bash
node --test tests/test_i18n.mjs
```

The locale tests cover ComfyUI settings events, store-only changes, fallback languages, and preservation of interpolated names.

For the DOM and real WebGL editor checks, install Playwright in your test environment, serve the repository root in one terminal, and run the browser test in another:

```bash
python -m http.server 8765 --bind 127.0.0.1
CHROME=/path/to/chrome node tests/test_editor_language.cjs
```

`FISHER_TEST_BASE` can select another local preview URL. The test switches both actual editors through English → Chinese → English and verifies that dropdown values, pose/state JSON, and generated prompt text stay identical. It also checks dynamic messages, attributes, and exclusion of user names and editable text. It does not queue image generation or require a ComfyUI backend. Set `FISHER_SCREENSHOT_DIR` to an existing directory to save preview screenshots.
