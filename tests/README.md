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
