import copy
import base64
import io
from PIL import Image
import importlib.util
import json
from pathlib import Path
import sys
import unittest

import torch

ROOT = Path(__file__).parent
spec = importlib.util.spec_from_file_location("fisher_test", ROOT / "__init__.py", submodule_search_locations=[str(ROOT)])
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
from fisher_test.qwen_bridge import FisherQwenPose, mapped_prompt
from fisher_test.pose_core import read_scene


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


class BridgeTests(unittest.TestCase):
    def scene(self, count):
        state = read_scene('{}')
        state['azimuth'] = 0
        state['elevation'] = 0
        state['people'] = [copy.deepcopy(state['people'][0]) for _ in range(count)]
        for i, p in enumerate(state['people']):
            p.update(id=f'p{i+1}', name=f'person{i+1}', position=[(count-1)/2-i, 0, 0])
        return state

    def args(self, count=1):
        args = dict(clip=RecordingClip(), vae=DummyVae(), reference_image_1=torch.full((1,64,64,3), .1),
                    output_mode='视角＋姿态', width=512, height=768, reference_resolution=256,
                    person_1_reference='自动', person_2_reference='自动', person_3_reference='自动',
                    extra_prompt='', scene_json=json.dumps(self.scene(count)))
        buffer=io.BytesIO();Image.new('RGB',(512,768),(120,140,160)).save(buffer,format='PNG')
        args['scene_json']=json.dumps({'state':self.scene(count),'poseReference':'data:image/png;base64,'+base64.b64encode(buffer.getvalue()).decode()})
        for i in range(2,count+1):
            args[f'reference_image_{i}'] = torch.full((1,64,64,3), i / 10)
        return args

    def test_actual_encoder_image_order_positive_and_canvas(self):
        args = self.args(3)
        positive, negative, latent, prompt, skeleton, preview = FisherQwenPose().encode(**args)['result']
        calls = args['clip'].calls
        self.assertEqual(calls[0][0], prompt)
        document=json.loads(prompt)
        self.assertEqual(document['rewritten_prompt'],mapped_prompt(read_scene(args['scene_json']),args['output_mode'],3,['自动']*3))
        self.assertEqual(document['wh_ratio'],'2:3')
        self.assertEqual(document['ratio_follow'],'')
        self.assertEqual(len(document['posture_description'].splitlines()),3)
        self.assertIn(' - ',document['posture_description'])
        self.assertEqual(calls[1][0], '')
        images = calls[0][1]['images']
        self.assertEqual(len(images),4)
        for i in range(3):
            self.assertAlmostEqual(float(images[i].mean()), (i+1)/10, delta=1/255)
        self.assertIn('<image4>', prompt)
        self.assertIn('从左到右依次对应：<image3>中的人物；<image2>中的人物；<image1>中的人物',prompt)
        self.assertEqual(tuple(latent['samples'].shape),(1,64,48,32))
        self.assertEqual(tuple(skeleton.shape),(1,768,512,3))
        self.assertAlmostEqual(float(skeleton[0,0,0,0]),120/255,places=6)
        self.assertEqual(len(positive[0][1]['reference_latents']),4)
        self.assertEqual(len(negative[0][1]['reference_latents']),4)

    def test_pe_text_is_preserved_inside_encoded_json(self):
        from unittest.mock import patch
        args=self.args();args['pe_clip']=object()
        final='保持人物身份。背面朝向镜头 - 双臂展开。'
        with patch('fisher_test.pe_rewrite.rewrite',return_value=final) as rewrite:
            result=FisherQwenPose().encode(**args)['result']
        rewrite.assert_called_once()
        self.assertEqual(json.loads(result[3])['rewritten_prompt'],final)
        self.assertEqual(args['clip'].calls[0][0],result[3])
        self.assertEqual(len(result),6)

    def test_view_omits_skeleton(self):
        args = self.args()
        args['output_mode']='仅视角'
        result=FisherQwenPose().encode(**args)['result']
        self.assertEqual(len(args['clip'].calls[0][1]['images']),1)
        self.assertNotIn('<image2>',result[3])

    def test_empty_scene_uses_only_scene_image(self):
        from unittest.mock import patch
        args=self.args();state=self.scene(1);state['people']=[]
        args['scene_json']=json.dumps({'state':state})
        args['pe_clip']=object()
        final='场景使用新版机位描述，经PE扩写。'
        with patch('fisher_test.pe_rewrite.rewrite',return_value=final) as rewrite:
            result=FisherQwenPose().encode(**args)['result']
        rewrite.assert_called_once()
        self.assertEqual(rewrite.call_args.args[1],mapped_prompt(state,'仅视角',1,['自动']*3))
        self.assertEqual(len(rewrite.call_args.args[2]),1)
        self.assertFalse(rewrite.call_args.kwargs['pose_reference'])
        self.assertEqual(json.loads(result[3])['rewritten_prompt'],final)
        self.assertEqual(args['clip'].calls[0][0],result[3])
        self.assertEqual(len(args['clip'].calls[0][1]['images']),1)
        self.assertIn('场景',result[3]);self.assertNotIn('<image2>',result[3])
        self.assertNotIn('人物1',result[3])
        self.assertEqual(json.loads(result[3])['posture_description'],'')

    def test_shared_image_identity(self):
        state=self.scene(2)
        state['people'][1]['identity']='穿红外套的人'
        prompt=mapped_prompt(state,'仅姿态',1,['自动']*3)
        self.assertIn('<image1>中的穿红外套的人',prompt)
        self.assertIn('<image2>',prompt)
        self.assertNotIn('将拍摄机位',prompt)

    def test_preview_is_output_only(self):
        from unittest.mock import patch
        args=self.args();saved=json.loads(args['scene_json'])
        buffer=io.BytesIO();Image.new('RGB',(128,64),(255,0,0)).save(buffer,format='PNG')
        saved['cameraPreview']='data:image/png;base64,'+base64.b64encode(buffer.getvalue()).decode()
        args.update(scene_json=json.dumps(saved),pe_clip=object(),presence_penalty=2,thinking=True,use_default_template=False,mtp='off')
        with patch('fisher_test.pe_rewrite.rewrite',return_value='测试') as rewrite:
            result=FisherQwenPose().encode(**args)['result']
        self.assertEqual(tuple(result[5].shape),(1,64,128,3))
        self.assertEqual(len(rewrite.call_args.args[2]),2)
        self.assertEqual(len(args['clip'].calls[0][1]['images']),2)
        self.assertFalse(any(tuple(im.shape)==(1,64,128,3) for im in rewrite.call_args.args[2]))
        for key in ('presence_penalty','thinking','use_default_template','mtp'):
            self.assertEqual(rewrite.call_args.kwargs[key],args[key])

    def test_legacy_preview_does_not_reuse_pose_reference(self):
        from fisher_test.pose_reference import camera_preview
        args = self.args()
        self.assertNotIn('cameraPreview', json.loads(args['scene_json']))
        preview = camera_preview(args['scene_json'])
        self.assertEqual(preview.size, (768, 432))
        self.assertGreater(len(preview.getcolors(768 * 432)), 1)

    def test_explicit_mapping(self):
        prompt=mapped_prompt(self.scene(2),'仅姿态',2,['图2','图1','自动'])
        self.assertIn('人物1的身份、面部特征、发型和服装来自<image2>',prompt)

    def test_invalid_inputs_fail_before_encoding(self):
        cases=[]
        args=self.args();args['reference_image_3']=args['reference_image_1'];cases.append(args)
        args=self.args();args['reference_image_1']=args['reference_image_1'].repeat(2,1,1,1);cases.append(args)
        args=self.args();args['width']=513;cases.append(args)
        args=self.args();args['person_1_reference']='图3';cases.append(args)
        args=self.args(2);args['scene_json']='{}';cases.append(args)
        for args in cases:
            with self.subTest(keys=list(args)),self.assertRaises(ValueError):
                FisherQwenPose().encode(**args)
            self.assertEqual(args['clip'].calls,[])


if __name__=='__main__':
    # Pass the ComfyUI directory explicitly; no model weights are loaded.
    sys.path.insert(0,sys.argv[1])
    sys.argv=[sys.argv[0],'--cpu']
    from comfy_extras.nodes_qwen import TextEncodeQwenImage21
    sys.argv=[sys.argv[0]]
    unittest.main()
