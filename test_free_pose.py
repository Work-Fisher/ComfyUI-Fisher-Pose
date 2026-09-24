import base64
import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest

from PIL import Image
import torch

ROOT = Path(__file__).parent
spec = importlib.util.spec_from_file_location("fisher_test", ROOT / "__init__.py", submodule_search_locations=[str(ROOT)])
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
from fisher_test.free_pose import FisherQwenFreePose, free_pose_prompt


class RecordingClip:
    def __init__(self):
        self.calls = []

    def tokenize(self, prompt, **kwargs):
        self.calls.append((prompt, kwargs))
        return prompt

    def encode_from_tokens_scheduled(self, tokens):
        return [[torch.zeros(1, 1, 1), {}]]


class DummyVae:
    def encode(self, image):
        return torch.zeros(1, 64, image.shape[1] // 16, image.shape[2] // 16)


def pose_json(size=(512, 768), color=(255, 255, 255)):
    buffer = io.BytesIO()
    Image.new('RGB', size, color).save(buffer, format='PNG')
    return json.dumps({'version': 1, 'poseReference': 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode()})


class FreePoseTests(unittest.TestCase):
    def args(self, **overrides):
        args = dict(clip=RecordingClip(), vae=DummyVae(), reference_image=torch.full((1, 64, 48, 3), .2),
                    width=512, height=768, reference_resolution=256, extra_prompt='', pose_json=pose_json())
        args.update(overrides)
        return args

    def test_vnccs_order_prompt_and_latent(self):
        args = self.args()
        positive, negative, latent, prompt, mannequin = FisherQwenFreePose().encode(**args)['result']
        self.assertEqual(prompt, 'Draw character from image2')
        calls = args['clip'].calls
        self.assertEqual(calls[0][0], prompt)
        self.assertEqual(calls[1][0], '')
        images = calls[0][1]['images']
        self.assertEqual(len(images), 2)
        self.assertAlmostEqual(float(images[0].mean()), 1.0, places=3)  # mannequin first
        self.assertAlmostEqual(float(images[1].mean()), .2, delta=1 / 255)  # character second
        self.assertEqual(tuple(latent['samples'].shape), (1, 64, 48, 32))
        self.assertEqual(tuple(mannequin.shape), (1, 768, 512, 3))
        self.assertIn('reference_latents', positive[0][1])

    def test_output_size_is_independent_of_mannequin_size(self):
        # Mannequin 1024x1024 from the editor, output 16:9 from a resolution selector.
        args = self.args(pose_json=pose_json((1024, 1024), (100, 100, 100)), width=1920, height=1088)
        positive, negative, latent, prompt, mannequin = FisherQwenFreePose().encode(**args)['result']
        self.assertEqual(tuple(mannequin.shape), (1, 1024, 1024, 3))
        encoded = args['clip'].calls[0][1]['images'][0]
        self.assertEqual(encoded.shape[1], encoded.shape[2])  # still square: not padded or stretched to 16:9
        self.assertEqual(tuple(latent['samples'].shape), (1, 64, 68, 120))

    def test_extra_prompt_follows_instruction(self):
        self.assertEqual(free_pose_prompt('  red dress \n\n studio light '), 'Draw character from image2\nred dress\nstudio light')

    def test_invalid_inputs_do_not_encode(self):
        cases = [
            self.args(pose_json='{}'),
            self.args(width=520),
            self.args(reference_image=torch.zeros(2, 64, 64, 3)),
        ]
        for args in cases:
            with self.subTest(), self.assertRaises(ValueError):
                FisherQwenFreePose().encode(**args)
            self.assertEqual(args['clip'].calls, [])


class OpenPoseLibraryTests(unittest.TestCase):
    def test_list_and_clear_only_touch_library_images(self):
        import tempfile
        from fisher_test.openpose_library import LIBRARY_SUBFOLDER, clear_library, list_library
        with tempfile.TemporaryDirectory() as root:
            self.assertEqual(list_library(root), [])
            folder = Path(root) / LIBRARY_SUBFOLDER
            folder.mkdir()
            for name in ('b.png', 'a.JPG', 'notes.txt'):
                (folder / name).write_bytes(b'x')
            (Path(root) / 'outside.png').write_bytes(b'x')
            self.assertEqual(list_library(root), ['a.JPG', 'b.png'])
            self.assertEqual(clear_library(root), 2)
            self.assertEqual(sorted(p.name for p in folder.iterdir()), ['notes.txt'])
            self.assertTrue((Path(root) / 'outside.png').exists())

    def test_builtin_gallery_is_numbered(self):
        from fisher_test.openpose_library import list_builtin
        names = list_builtin()
        self.assertEqual(len(names), 209)
        self.assertEqual(names[:3], ['1.png', '2.png', '3.png'])
        self.assertEqual(names[-1], '209.png')


if __name__ == '__main__':
    # Pass the ComfyUI directory explicitly; no model weights are loaded.
    sys.path.insert(0, sys.argv[1])
    sys.argv = [sys.argv[0], '--cpu']
    from comfy_extras.nodes_qwen import TextEncodeQwenImage21
    sys.argv = [sys.argv[0]]
    unittest.main()
