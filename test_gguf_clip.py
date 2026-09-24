import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('gguf_list_test', Path(__file__).with_name('gguf_clip.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class GGUFInputTests(unittest.TestCase):
    def test_gguf_models_are_listed_for_prompt_validation(self):
        main = 'qwen3vl_8b_heretic-Q4_K_M.gguf'
        vision = 'mmproj-qwen3vl_8b_heretic-f16.gguf'
        files = {'text_encoders': ['qwen3vl_8b_bf16.safetensors'], 'clip_gguf': [main, vision]}
        folders = types.SimpleNamespace(folder_names_and_paths={'clip_gguf': None}, get_filename_list=files.__getitem__)
        with patch.dict(sys.modules, {'folder_paths': folders}):
            required = module.FisherQwen21GGUFCLIP.INPUT_TYPES()['required']
        self.assertIn(main, required['clip_name'][0])
        self.assertNotIn(vision, required['clip_name'][0])
        self.assertIn(vision, required['vision_source'][0])
        self.assertIn('qwen3vl_8b_bf16.safetensors', required['vision_source'][0])

    def test_missing_gguf_extension_does_not_break_node_discovery(self):
        folders = types.SimpleNamespace(folder_names_and_paths={}, get_filename_list=lambda _: ['model.safetensors'])
        with patch.dict(sys.modules, {'folder_paths': folders}):
            required = module.FisherQwen21GGUFCLIP.INPUT_TYPES()['required']
        self.assertEqual(required['clip_name'][0], [])
