import copy
import json
import unittest
from pose_core import read_scene, person_facing, person_constraints, person_description


class SemanticsTests(unittest.TestCase):
    def test_turn_and_camera_are_relative(self):
        state=read_scene('{}');state.update(azimuth=0,elevation=0)
        person=state['people'][0]
        for camera,body,expected in [(0,0,'正面'),(180,0,'背面'),(180,180,'正面'),(90,90,'正面'),(0,90,'右侧'),(0,-90,'左侧')]:
            state['azimuth']=camera;person['bodyAngle']=body
            self.assertTrue(person_facing(state,person).startswith(expected))

    def test_position_changes_bearing_and_translation_is_invariant(self):
        state=read_scene('{}');state.update(azimuth=0,elevation=0,distance=2)
        person=state['people'][0];person['position']=[5,0,0]
        self.assertTrue(person_facing(state,person).startswith('右侧'))
        before=person_facing(state,person)
        state['cameraTarget']=[3,1,4];person['position']=[8,0,4]
        self.assertEqual(before,person_facing(state,person))

    def test_multi_person_and_degenerate_joint(self):
        state=read_scene('{}');state.update(azimuth=0,elevation=0)
        a=state['people'][0];b=copy.deepcopy(a);b['bodyAngle']=180
        self.assertNotEqual(person_facing(state,a),person_facing(state,b))
        a['points']['le']=a['points']['lw'][:]
        with self.assertRaises(ValueError):person_constraints(state,a,1)

    def test_folded_legs_are_not_described_as_dangling(self):
        state=read_scene('{}');state.update(azimuth=180,elevation=0)
        p=state['people'][0]
        p['points'].update(lh=[.17,.4,0],lk=[.58,.05,0],la=[.18,.1,0])
        fact=next(f for f in person_constraints(state,p,1) if '自身左腿' in f)
        self.assertIn('深度折叠',fact)
        self.assertIn('向画面右侧',fact)
        self.assertIn('近似等高',fact)
        self.assertEqual(len(person_constraints(state,p,1,False)),1)
        description=person_description(state,p,1)
        self.assertIn('左小腿向身体在画面中的中线收回',description)
        self.assertIn('近似等高',description)
        self.assertNotIn('内夹角',description)
        self.assertNotIn('膝',person_description(state,p,1,False))


if __name__=='__main__':unittest.main()
