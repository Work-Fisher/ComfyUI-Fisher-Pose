import base64
import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest

from PIL import Image
import torch

ROOT = Path(__file__).resolve().parent.parent  # plugin root
spec = importlib.util.spec_from_file_location("fisher_test", ROOT / "__init__.py", submodule_search_locations=[str(ROOT)])
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
from fisher_test.free_pose import FisherQwenFreePose, free_pose_prompt, SINGLE_PERSON_INSTRUCTION


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
    def test_skeleton_guides_are_not_requested_in_final_image(self):
        from fisher_test.free_pose import SKELETON_GUIDE_INSTRUCTION
        for two in (False, True):
            data = {'outputSkeleton': True}
            if two:
                data['people'] = [{'transform': {'x': -1}}, {'transform': {'x': 1}}]
            prompt = free_pose_prompt('Custom detail', json.dumps(data))
            self.assertIn(SKELETON_GUIDE_INSTRUCTION, prompt)
            self.assertTrue(prompt.endswith('Custom detail'))
            data['outputSkeleton'] = False
            self.assertNotIn(SKELETON_GUIDE_INSTRUCTION, free_pose_prompt('', json.dumps(data)))

    def test_connected_integer_dimensions_are_range_checked(self):
        for width, height in [(0, 1024), (1024, -16), (4112, 1024), (1024, 8192)]:
            with self.subTest(width=width, height=height), self.assertRaisesRegex(ValueError, '64到4096'):
                FisherQwenFreePose().encode(**self.args(width=width, height=height))

    def args(self, **overrides):
        args = dict(clip=RecordingClip(), vae=DummyVae(), reference_image=torch.full((1, 64, 48, 3), .2),
                    width=512, height=768, reference_resolution=256, extra_prompt='', pose_json=pose_json())
        args.update(overrides)
        return args

    def test_vnccs_order_prompt_and_latent(self):
        args = self.args()
        positive, negative, latent, prompt, mannequin, passed = FisherQwenFreePose().encode(**args)['result']
        self.assertEqual(prompt, SINGLE_PERSON_INSTRUCTION)
        self.assertIn('Repose the person in image2 to match image1.', prompt)
        self.assertIn('Preserve their appearance', prompt)
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
        positive, negative, latent, prompt, mannequin, passed = FisherQwenFreePose().encode(**args)['result']
        self.assertEqual(tuple(mannequin.shape), (1, 1024, 1024, 3))
        encoded = args['clip'].calls[0][1]['images'][0]
        self.assertEqual(encoded.shape[1], encoded.shape[2])  # still square: not padded or stretched to 16:9
        self.assertEqual(tuple(latent['samples'].shape), (1, 64, 68, 120))

    def test_extra_prompt_follows_instruction(self):
        self.assertEqual(free_pose_prompt('  red dress \n\n studio light '), SINGLE_PERSON_INSTRUCTION + '\nred dress\nstudio light')

    def test_single_after_two_portraits_uses_only_current_pose_and_photo(self):
        node = FisherQwenFreePose()
        args = self.args(pose_json=two_people(), reference_image_2=torch.full((1, 64, 48, 3), .6))
        self.assertEqual(len(node.encode(**args)['result'][0][0][1]['reference_latents']), 3)
        # Removing person 2 leaves referenceMode in saved editor state. The bypassed
        # LoadImage is absent from the API request, and must not survive this switch.
        for color in ((64, 64, 64), (192, 192, 192)):
            data = json.loads(pose_json(color=color))
            data.update(people=None, referenceMode='separate', swapPeople=True)
            single = self.args(pose_json=json.dumps(data))
            result = node.encode(**single)['result']
            images = single['clip'].calls[0][1]['images']
            self.assertEqual(len(images), 2)
            self.assertEqual(len(result[0][0][1]['reference_latents']), 2)
            self.assertAlmostEqual(float(images[0].mean()), color[0] / 255, places=3)
            self.assertAlmostEqual(float(images[1].mean()), .2, delta=1 / 255)
            self.assertEqual(result[3], SINGLE_PERSON_INSTRUCTION)
            self.assertNotIn('image3', result[3])

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


def two_people(xs=(-4.0, 5.0)):
    data = json.loads(pose_json((768, 512)))
    data['referenceMode'] = 'separate'
    data['people'] = [{'transform': {'x': x, 'y': 0, 'z': 0, 'zoom': 1}} for x in xs]
    return json.dumps(data)


class TwoPeopleTests(unittest.TestCase):
    args = FreePoseTests.args

    def test_group_reposes_existing_people_with_vnccs_trigger(self):
        data = json.loads(two_people()); data['referenceMode'] = 'group'
        prompt = free_pose_prompt('', json.dumps(data))
        self.assertTrue(prompt.startswith('Draw character from image2.'))
        self.assertIn('Repose the existing two people in image2 to match image1.', prompt)
        self.assertIn('Keep their left-to-right order:', prompt)

    def test_second_person_is_image3_and_named_by_side(self):
        args = self.args(pose_json=two_people(), reference_image_2=torch.full((1, 64, 48, 3), .6))
        prompt = FisherQwenFreePose().encode(**args)['result'][3]
        self.assertEqual(prompt, 'Draw the left character from image2 in the pose of the left mannequin in image1, '
                                 'and the right character from image3 in the pose of the right mannequin in image1.')
        images = args['clip'].calls[0][1]['images']
        self.assertEqual(len(images), 3)
        self.assertAlmostEqual(float(images[2].mean()), .6, delta=1 / 255)  # person 2 is image3

    def test_sides_follow_where_people_stand(self):
        self.assertTrue(free_pose_prompt('', two_people((6.0, -3.0))).startswith('Draw the right character from image2'))

    def test_group_photo_stays_whole_even_with_legacy_split(self):
        data = json.loads(two_people()); data['referenceMode'] = 'group'
        photo = torch.cat([torch.full((1,64,24,3),.2), torch.full((1,64,24,3),.8)], dim=2)
        for swapped in (False, True):
            for split in (.1, .5, .9):
                data.update(swapPeople=swapped, groupSplit=split)
                args = self.args(pose_json=json.dumps(data), reference_image=photo)
                result = FisherQwenFreePose().encode(**args)['result']
                images = args['clip'].calls[0][1]['images']
                self.assertEqual(len(images), 2)
                self.assertEqual(len(result[0][0][1]['reference_latents']), 2)
                self.assertAlmostEqual(float(images[1].mean()), .5, delta=.01)
                center = images[1].shape[2] // 2
                self.assertAlmostEqual(float(images[1][:,:,:center,:].mean()), .2, delta=.02)
                self.assertAlmostEqual(float(images[1][:,:,center:,:].mean()), .8, delta=.02)
                self.assertNotIn('image3', result[3])
                source = 'right' if swapped else 'left'
                self.assertIn(f"person on the viewer's {source} in image2 takes the left mannequin pose", result[3])

    def test_group_binding_matches_labels_before_and_after_moving(self):
        # Source identities stay attached to person IDs when mannequins cross.
        for xs, targets in [((-4, 5), ('left', 'right')), ((6, -3), ('right', 'left'))]:
            for swapped, sources in [(False, ('left', 'right')), (True, ('right', 'left'))]:
                with self.subTest(xs=xs, swapped=swapped):
                    data = json.loads(two_people(xs))
                    data.update(referenceMode='group', swapPeople=swapped)
                    prompt = free_pose_prompt('', json.dumps(data))
                    for source, target in zip(sources, targets):
                        image_label = ' in image2' if target == 'left' else ''
                        self.assertIn(f"person on the viewer's {source}{image_label} takes the {target} mannequin pose", prompt)
                    expected_order = 'Keep' if sources[0] == targets[0] else 'Exchange'
                    self.assertIn(f'{expected_order} their left-to-right order:', prompt)

    def test_changing_only_pose_does_not_swap_source_identities(self):
        data = json.loads(two_people()); data['referenceMode'] = 'group'
        first = free_pose_prompt('', json.dumps(data))
        data['people'][0]['pose'] = {'bones': {'upperarm_l': [0, 0, 45]}}
        second = free_pose_prompt('', json.dumps(data))
        self.assertEqual(first, second)
        self.assertIn("person on the viewer's left in image2 takes the left mannequin pose", second)

    def test_legacy_two_photos_keep_separate_mode(self):
        data = json.loads(two_people()); data.pop('referenceMode')
        args = self.args(pose_json=json.dumps(data), reference_image_2=torch.zeros(1,64,48,3))
        prompt = FisherQwenFreePose().encode(**args)['result'][3]
        self.assertIn('image3', prompt)

    def test_group_rejects_ambiguous_second_photo(self):
        data = json.loads(two_people()); data['referenceMode'] = 'group'
        with self.assertRaisesRegex(ValueError, '合照模式'):
            FisherQwenFreePose().encode(**self.args(pose_json=json.dumps(data), reference_image_2=torch.zeros(1,64,48,3)))

    def test_wiring_mismatches_are_explained(self):
        for args, message in [(self.args(pose_json=two_people()), 'reference_image_2'),
                              (self.args(reference_image_2=torch.zeros(1, 64, 48, 3)), '只有 1 个人')]:
            with self.subTest(message), self.assertRaisesRegex(ValueError, message):
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


class AnyAngleEncodeTests(unittest.TestCase):
    def test_output_size_keeps_sixteen_pixel_dimensions_after_angle_change(self):
        from fisher_test.fisher_anyangle import FisherAnyAngleEncode
        front = torch.full((1, 112, 80, 3), .2)
        coarse = torch.full((1, 112, 80, 3), .8)
        _, _, latent = FisherAnyAngleEncode().encode(RecordingClip(), DummyVae(), front, coarse, 0)
        self.assertEqual(tuple(latent['samples'].shape), (1, 64, 7, 5))

    def test_fixed_inputs_encode_both_references_with_vae(self):
        from fisher_test.fisher_anyangle import FisherAnyAngleEncode, ANYANGLE_PROMPT
        clip = RecordingClip()
        front = torch.full((1, 64, 96, 3), .2)
        coarse = torch.full((1, 64, 96, 3), .8)
        positive, negative, latent = FisherAnyAngleEncode().encode(clip, DummyVae(), front, coarse, 256)
        self.assertEqual(clip.calls[0][0], ANYANGLE_PROMPT)
        self.assertEqual(len(positive[0][1]['reference_latents']), 2)
        self.assertAlmostEqual(float(clip.calls[0][1]['images'][0].mean()), .2, places=3)
        self.assertAlmostEqual(float(clip.calls[0][1]['images'][1].mean()), .8, places=3)
        self.assertIn('camera_image', FisherAnyAngleEncode.INPUT_TYPES()['required'])
        self.assertIn('vae', FisherAnyAngleEncode.INPUT_TYPES()['required'])


if __name__ == '__main__':
    # Pass the ComfyUI directory explicitly; no model weights are loaded.
    sys.path.insert(0, sys.argv[1])
    sys.argv = [sys.argv[0], '--cpu']
    from comfy_extras.nodes_qwen import TextEncodeQwenImage21
    sys.argv = [sys.argv[0]]
    unittest.main()
