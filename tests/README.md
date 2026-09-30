# 测试

在插件根目录运行（`python` 用 ComfyUI 自带的解释器）。以下测试都不会加载模型权重。

```bash
python -m unittest discover -s tests -p "test_pose*.py"
python -m unittest discover -s tests -p "test_pe_rewrite.py"
python -m unittest discover -s tests -p "test_gguf_clip.py"
python tests/test_saved_poses.py
python tests/test_free_pose.py <ComfyUI 目录>
python tests/test_qwen_bridge.py <ComfyUI 目录>
node tests/test_openpose_lift.mjs
```

`test_free_pose.py` 和 `test_qwen_bridge.py` 需要传入 ComfyUI 目录，用来导入 `TextEncodeQwenImage21`。

`tests/e2e/` 是浏览器端到端场景：用无头 Chrome 打开真实的 ComfyUI 前端，载入自由姿势工作流后执行场景脚本（不会排队出图）。需要先启动 ComfyUI：

```bash
python tests/e2e/cdp_run.py tests/e2e/apply_stores_file.js --base http://127.0.0.1:8188
```

常用姿势的缩略图由 `tools/build_common_poses.py` 在真实编辑器里渲染（改了 `web/editor/common-poses.mjs` 之后重跑，`--review` 会输出正面加侧面的检查图）。
