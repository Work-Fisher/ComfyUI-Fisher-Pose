import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # plugin root
import json
import copy
import unittest

import numpy as np

from pose_core import BASE_POINTS, camera_terms, build_prompt, project_points, read_scene, render_pose


class PoseTests(unittest.TestCase):
    def test_defaults_and_render(self):
        state = read_scene('{}')
        pixels = np.asarray(render_pose(state, 768, 1024))
        self.assertEqual(pixels.shape, (1024, 768, 3))
        self.assertGreater(np.count_nonzero(pixels), 1000)
        self.assertEqual(int(pixels[0, 0].sum()), 0)

    def test_modes_do_not_conflict(self):
        state = read_scene('{}')
        view = build_prompt(state, '仅视角')
        pose = build_prompt(state, '仅姿态')
        both = build_prompt(state, '视角＋姿态', '保留红色外套')
        self.assertNotIn('图2', view)
        self.assertIn('原有身体动作一致', view)
        self.assertIn('图2', pose)
        self.assertNotIn('将拍摄机位', pose)
        self.assertIn('图2', both)
        self.assertNotIn('原有身体动作一致', both)
        self.assertIn('保留红色外套', both)

    def test_scene_relative_direction(self):
        state = read_scene('{}')
        state['azimuth'] = 90
        state['people'][0]['bodyAngle'] = 90
        self.assertIn('右侧视角', build_prompt(state, '仅视角'))

    def test_qwen_bins_and_exact_output(self):
        state = read_scene('{}')
        state.update(azimuth=90, elevation=60, zoom=8, promptStyle='Multiangle LoRA (<sks>)')
        self.assertEqual(build_prompt(state, '仅视角'), '<sks> right side view high-angle shot close-up')
        for angle, expected in [(0,'front view'), (22.499,'front view'), (22.5,'front-right quarter view'),
                                (67.5,'right side view'), (180,'back view'), (315,'front-left quarter view'), (337.5,'front view'), (360,'front view')]:
            state['azimuth'] = angle
            self.assertTrue(camera_terms(state)['en'].startswith(expected))
        for elevation, expected in [(-16,'low-angle shot'),(-15,'eye-level shot'),(14.99,'eye-level shot'),(15,'elevated shot'),(45,'high-angle shot')]:
            state['elevation'] = elevation
            self.assertIn(expected,camera_terms(state)['en'])
        for zoom, expected in [(1.99,'wide shot'),(2,'medium shot'),(5.99,'medium shot'),(6,'close-up')]:
            state['zoom'] = zoom
            self.assertTrue(camera_terms(state)['en'].endswith(expected))

    def test_legacy_scene_migration(self):
        legacy={'points':copy.deepcopy(BASE_POINTS),'bodyAngle':75,'azimuth':15,'distance':3.7,'preset':'wave'}
        scene=read_scene(json.dumps({'state':legacy}))
        self.assertEqual(len(scene['people']),1)
        self.assertEqual(scene['people'][0]['bodyAngle'],75)
        self.assertAlmostEqual(scene['zoom'],6.2)
        self.assertEqual(scene['people'][0]['points'],BASE_POINTS)

    def test_three_people_projection_and_identity(self):
        state=read_scene('{}')
        state.update(azimuth=0,elevation=0,distance=6,zoom=1.6)
        actor=copy.deepcopy(state['people'][0])
        state['people']=[dict(copy.deepcopy(actor),id=f'p{i}',position=[x,0,0],identity=f'原图角色{i}') for i,x in enumerate([0,1,-1],1)]
        projected=[project_points(state,768,1024,p)[1][0] for p in state['people']]
        self.assertLess(projected[2],projected[0]);self.assertLess(projected[0],projected[1])
        text=build_prompt(state,'视角＋姿态')
        self.assertIn('共3个人物',text)
        self.assertIn('原图角色3；原图角色1；原图角色2',text)
        combined=np.asarray(render_pose(state,768,1024))
        one=dict(state,people=[state['people'][0]])
        self.assertGreater(np.count_nonzero(combined),np.count_nonzero(np.asarray(render_pose(one,768,1024)))*2)
        saved=read_scene(json.dumps({'state':state}))
        self.assertEqual(saved['people'],state['people'])
        saved['people'].append(copy.deepcopy(actor))
        with self.assertRaises(ValueError):read_scene(json.dumps({'state':saved}))

    def test_world_translation_matches_camera_target(self):
        state=read_scene('{}')
        before=project_points(state,768,1024)
        state['people'][0]['position']=[1,0,2]
        state['cameraTarget']=[1,1,2]
        after=project_points(state,768,1024)
        np.testing.assert_allclose(before,after,rtol=0,atol=1e-10)

    def test_projection_and_restore(self):
        state = read_scene('{}')
        initial = project_points(state, 768, 1024)
        state['azimuth'] = 90
        side = project_points(state, 768, 1024)
        self.assertNotEqual(initial, side)
        self.assertEqual(state['points'], BASE_POINTS)
        restored = read_scene(json.dumps({'state': state}))
        self.assertEqual(side, project_points(restored, 768, 1024))
        wide = project_points(state, 1536, 1024)
        self.assertAlmostEqual(side[1][0] - 768 / 2, wide[1][0] - 1536 / 2)

    def test_invalid_scene(self):
        for text in ['[]', '{"distance":0}', '{"azimuth":NaN}', '{"points":{}}']:
            with self.assertRaises(ValueError):
                read_scene(text)


if __name__ == '__main__':
    unittest.main()
