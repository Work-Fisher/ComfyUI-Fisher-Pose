import importlib.util
import json
import math
from pathlib import Path
from types import SimpleNamespace
import unittest

import torch

ROOT = Path(__file__).resolve().parent.parent  # plugin root
spec = importlib.util.spec_from_file_location("fisher_anyangle", ROOT / "fisher_anyangle.py")
anyangle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(anyangle)


def fake_splat(world_points):
    # RenderSplat stores splats as (x, -y, -z) of world space.
    stored = torch.tensor(world_points, dtype=torch.float32) * torch.tensor([1.0, -1.0, -1.0])
    return SimpleNamespace(positions=stored.unsqueeze(0), counts=None)


def camera_latent(direction=(1, 0, 0)):
    token = torch.tensor([[list(direction) + [0.15, 0.8]]], dtype=torch.float32)
    return {"samples": SimpleNamespace(is_nested=True, unbind=lambda: [torch.zeros(1, 8, 16), token])}


def rotate_vector(quaternion, vector):
    # Quaternion-vector multiplication, independent of the production matrix conversion.
    q = torch.tensor([quaternion[k] for k in ('x', 'y', 'z')])
    vector = torch.as_tensor(vector, dtype=torch.float32)
    cross = 2 * torch.linalg.cross(q, vector)
    return vector + quaternion['w'] * cross + torch.linalg.cross(q, cross)


def person(height=1.0, center=(0.1, 0.2, -0.05), n=4000):
    g = torch.Generator().manual_seed(0)
    pts = (torch.rand(n, 3, generator=g) - 0.5) * torch.tensor([0.4, height, 0.2]) + torch.tensor(center)
    return pts.tolist()


def pose_json(position, forward, aspect=1.0, fov=35.0, enabled=True):
    return json.dumps({"anyAngle": {"enabled": enabled, "yaw": 0, "pitch": 0,
                                    "camera": {"position": position, "forward": forward, "fov": fov, "aspect": aspect}}})


# The real coarse render needs ComfyUI's RenderSplat; a gradient with out-of-range values stands in.
anyangle.render_coarse = lambda splat, camera, width, height: torch.linspace(-0.2, 1.3, width * height * 3).reshape(1, height, width, 3)


class AnyAngleCameraTests(unittest.TestCase):
    def camera(self, **kwargs):
        points = kwargs.pop("points", person())
        size = kwargs.pop("size", (1024, 1024))
        latent = kwargs.pop('latent', camera_latent())
        coarse, prompt, info = anyangle.FisherAnyAngleCamera().camera(fake_splat(points), pose_json(**kwargs), torch.zeros(1, size[1], size[0], 3), latent)["result"]
        return info, coarse.shape[2], coarse.shape[1], prompt

    def test_coarse_render_is_a_plain_image(self):
        coarse = anyangle.FisherAnyAngleCamera().camera(fake_splat(person()), pose_json([0, 0, 2.5], [0, 0, -1]), torch.zeros(1, 64, 96, 3), camera_latent())["result"][0]
        self.assertEqual(tuple(coarse.shape), (1, 64, 96, 3))
        self.assertEqual(coarse.dtype, torch.float32)
        self.assertGreaterEqual(float(coarse.min()), 0.0)
        self.assertLessEqual(float(coarse.max()), 1.0)

    def test_editor_front_lands_where_triposplat_shows_the_input(self):
        info, width, height, prompt = self.camera(position=[0, 0, 2.5], forward=[0, 0, -1])
        pos, target = info["position"], info["target"]
        self.assertAlmostEqual(pos["x"] - 0.1, 2.5, delta=0.05)   # on +X of the splat centre
        self.assertAlmostEqual(pos["z"] + 0.05, 0.0, delta=0.05)
        self.assertAlmostEqual(target["x"], 0.1, delta=0.05)       # looking back at the person
        self.assertAlmostEqual(target["y"], 0.2, delta=0.05)
        self.assertEqual((width, height), (1024, 1024))
        self.assertEqual(prompt, "Change the camera angle from <image2> to <image1>.")

    def test_distance_is_in_person_heights(self):
        info = self.camera(position=[0, 0, 2.0], forward=[0, 0, -1], points=person(height=3.0, center=(0, 0, 0)))[0]
        self.assertAlmostEqual(info["position"]["x"], 6.0, delta=0.15)

    def test_looking_down_stays_above(self):
        down = [0, -math.sin(0.5), -math.cos(0.5)]
        info = self.camera(position=[0, 2.5 * math.sin(0.5), 2.5 * math.cos(0.5)], forward=down)[0]
        self.assertGreater(info["position"]["y"], info["target"]["y"] + 0.5)

    def test_portrait_field_of_view_is_converted_for_the_shorter_side(self):
        info, width, height, _ = self.camera(position=[0, 0, 2.5], forward=[0, 0, -1], fov=35.0, size=(768, 1024))
        self.assertEqual((width, height), (768, 1024))
        expected = math.degrees(2 * math.atan(math.tan(math.radians(17.5)) * 0.75))
        self.assertAlmostEqual(info["fov"], expected, places=4)

    def test_floaters_do_not_move_the_centre(self):
        points = person(center=(0, 0, 0)) + [[40.0, 40.0, 40.0]] * 5
        center, height = anyangle.robust_box(anyangle.splat_points(fake_splat(points)))
        self.assertLess(float(center.abs().max()), 0.05)
        self.assertAlmostEqual(height, 0.98, delta=0.03)

    def test_missing_angle_is_explained(self):
        with self.assertRaisesRegex(ValueError, "新机位"):
            anyangle.FisherAnyAngleCamera().camera(fake_splat(person()), pose_json([0, 0, 2], [0, 0, -1], enabled=False), torch.zeros(1, 64, 64, 3))

    def test_render_matches_the_front_result_size(self):
        self.assertEqual(anyangle.render_size(1920, 1088), (1920, 1088))
        self.assertEqual(anyangle.render_size(4096, 2048), (2048, 1024))  # RenderSplat's limit


class SourceCameraTests(unittest.TestCase):
    def test_front_follows_predicted_source_instead_of_a_fixed_90_degrees(self):
        # Known decoder/world axes: raw +X -> world +X, raw -Y -> world +Z,
        # raw +Z -> world +Y. Vary the source per image, including elevated views.
        for raw, world in [((1, 0, 0), (1, 0, 0)), ((0, -1, 0), (0, 0, 1)),
                           ((0, 1, 0), (0, 0, -1)), ((0, -1, 1), (0, 1, 1))]:
            with self.subTest(raw=raw):
                basis = anyangle.reference_basis(camera_latent(raw))
                expected = torch.tensor(world, dtype=torch.float32)
                expected /= expected.norm()
                camera = {'position': [0, 0, 3], 'forward': [0, 0, -1]}
                info = anyangle.camera_info(camera, torch.zeros(3), 1, 512, 512, basis)
                actual = torch.tensor(list(info['position'].values()))
                torch.testing.assert_close(actual, 3 * expected)
                torch.testing.assert_close(rotate_vector(info['quaternion'], [0, 0, 1]), expected)

    def test_editor_rotations_are_relative_to_source_even_when_elevated(self):
        for raw in [(1, 0, 0), (0, -1, 1), (.7144, -.5352, .2957)]:
            basis = anyangle.reference_basis(camera_latent(raw))
            for yaw, pitch in [(45, 0), (90, 0), (-90, 0), (180, 0), (0, 45), (35, -30)]:
                with self.subTest(raw=raw, yaw=yaw, pitch=pitch):
                    y, p = math.radians(yaw), math.radians(pitch)
                    back = torch.tensor([math.sin(y)*math.cos(p), math.sin(p), math.cos(y)*math.cos(p)])
                    camera = {'position': (3 * back).tolist(), 'forward': (-back).tolist()}
                    info = anyangle.camera_info(camera, torch.zeros(3), 1, 512, 512, basis)
                    # Undo source orientation: both the sight line AND screen-right must match
                    # the editor, otherwise elevated inputs gain unwanted roll.
                    local_back = basis.T @ rotate_vector(info['quaternion'], [0, 0, 1])
                    local_right = basis.T @ rotate_vector(info['quaternion'], [1, 0, 0])
                    torch.testing.assert_close(local_back, back, atol=1e-6, rtol=1e-5)
                    torch.testing.assert_close(local_right, torch.tensor([math.cos(y), 0, -math.sin(y)]), atol=1e-6, rtol=1e-5)

    def test_height_and_framing_are_measured_in_source_camera_frame(self):
        basis = anyangle.reference_basis(camera_latent((0, -1, 1)))
        points = torch.tensor(person(height=3, center=(0, 0, 0))) @ basis.T
        info = AnyAngleCameraTests().camera(position=[0, 0, 2], forward=[0, 0, -1],
            points=points.tolist(), latent=camera_latent((0, -1, 1)))[0]
        distance = torch.tensor(list(info['position'].values())).norm()
        self.assertAlmostEqual(float(distance), 6, delta=.15)

    def test_missing_source_camera_does_not_silently_guess(self):
        with self.assertRaisesRegex(ValueError, '最新版工作流'):
            anyangle.reference_basis(None)
        with self.assertRaisesRegex(ValueError, 'TripoSplat'):
            anyangle.reference_basis({'samples': torch.zeros(1, 64, 8, 8)})

    def test_invalid_source_camera_is_reported(self):
        for direction in [(0, 0, 0), (float('nan'), 1, 0)]:
            with self.assertRaisesRegex(ValueError, '机位无效'):
                anyangle.reference_basis(camera_latent(direction))
        bad = {'samples': SimpleNamespace(is_nested=True, unbind=lambda: [torch.zeros(1, 8, 16)])}
        with self.assertRaisesRegex(ValueError, '5 维'):
            anyangle.reference_basis(bad)


class ResultSelectionTests(unittest.TestCase):
    def test_front_skips_camera_branch(self):
        node = anyangle.FisherPoseResult()
        front = torch.zeros(1, 64, 64, 3)
        self.assertEqual(node.check_lazy_status("{}"), ["front_image"])
        self.assertEqual(node.check_lazy_status("{}", front_image=front), [])
        self.assertIs(node.select("{}", front_image=front)[0], front)

    def test_camera_requires_only_camera_result(self):
        node = anyangle.FisherPoseResult()
        pose = json.dumps({"anyAngle": {"enabled": True, "camera": {"position": [0, 0, 2], "forward": [0, 0, -1]}}})
        image = torch.ones(1, 64, 64, 3)
        self.assertEqual(node.check_lazy_status(pose), ["camera_image"])
        self.assertEqual(node.check_lazy_status(pose, camera_image=image), [])
        self.assertIs(node.select(pose, camera_image=image)[0], image)

    def test_enabled_without_a_placed_camera_counts_as_front(self):
        # Same rule as FisherAnyAngleCamera, so the two nodes never disagree.
        node = anyangle.FisherPoseResult()
        pose = json.dumps({"anyAngle": {"enabled": True}})
        self.assertEqual(node.check_lazy_status(pose), ["front_image"])

    def test_muted_camera_branch_is_not_waited_for(self):
        node = anyangle.FisherPoseResult()
        pose = json.dumps({"anyAngle": {"enabled": True, "camera": {"position": [0, 0, 2], "forward": [0, 0, -1]}}})
        prompt = {"29": {"inputs": {"pose_json": ["30", 0], "front_image": ["8", 0]}}}  # camera_image dropped
        self.assertEqual(node.check_lazy_status(pose, prompt=prompt, unique_id="29"), [])
        with self.assertRaisesRegex(ValueError, "恢复正面"):
            node.select(pose, front_image=torch.zeros(1, 8, 8, 3), prompt=prompt, unique_id="29")


class ShotTests(unittest.TestCase):
    def test_disabled_camera_returns_front_without_erasing_saved_shot(self):
        shot = pose_json([1, 0, 2], [-0.5, 0, -1])
        node = anyangle.FisherShot()
        disabled = node.merge('{"kind":"vnccs-free-pose"}', shot, enable_camera=False)[0]
        self.assertEqual(anyangle.shot_of(disabled), {})
        self.assertEqual(anyangle.FisherPoseResult().check_lazy_status(disabled), ['front_image'])
        restored = node.merge('{"kind":"vnccs-free-pose"}', shot, enable_camera=True)[0]
        self.assertEqual(anyangle.shot_of(restored), json.loads(shot)['anyAngle'])
        self.assertEqual(anyangle.FisherPoseResult().check_lazy_status(restored), ['camera_image'])

    def test_disabled_camera_handles_legacy_pose_and_empty_shot(self):
        original = pose_json([0, 0, 2], [0, 0, -1])
        disabled = anyangle.FisherShot().merge(original, '{}', enable_camera=False)[0]
        self.assertEqual(anyangle.shot_of(disabled), {})
        self.assertEqual(json.loads(disabled)['anyAngle']['camera'], json.loads(original)['anyAngle']['camera'])

    def test_enabling_switch_keeps_front_shot_on_fast_path(self):
        merged = anyangle.FisherShot().merge('{}', '{}', enable_camera=True)[0]
        self.assertEqual(anyangle.FisherPoseResult().check_lazy_status(merged), ['front_image'])

    def test_shot_overrides_only_camera_fields(self):
        pose = json.dumps({"kind": "vnccs-free-pose", "width": 768, "anyAngle": {"enabled": False}})
        shot = json.dumps({"anyAngle": {"enabled": True, "yaw": 30}, "shotPreviewFile": {"filename": "shot.png"}, "width": 1})
        merged = json.loads(anyangle.FisherShot().merge(pose, shot)[0])
        self.assertEqual(merged["anyAngle"], {"enabled": True, "yaw": 30})
        self.assertEqual(merged["shotPreviewFile"], {"filename": "shot.png"})
        self.assertEqual(merged["width"], 768)  # pose fields are never taken from the shot

    def test_empty_shot_keeps_the_pose_as_is(self):
        pose = json.dumps({"anyAngle": {"enabled": True, "yaw": 10}})
        self.assertEqual(json.loads(anyangle.FisherShot().merge(pose, "{}")[0]), json.loads(pose))

    def test_editor_zoom_is_preserved_in_render_fov(self):
        camera = {"position": [0, 0, 2], "forward": [0, 0, -1], "fov": 35, "zoom": 2}
        info = anyangle.camera_info(camera, torch.zeros(3), 1, 1024, 1024, torch.eye(3))
        expected = math.degrees(2 * math.atan(math.tan(math.radians(17.5)) / 2))
        self.assertAlmostEqual(info['fov'], expected)


if __name__ == "__main__":
    unittest.main()
