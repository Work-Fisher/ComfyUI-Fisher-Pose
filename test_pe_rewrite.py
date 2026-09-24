import json
import unittest
import torch
from pe_rewrite import parse_final, rewrite


class ParseTests(unittest.TestCase):
    def setUp(self):
        self.images=[torch.zeros(1,96,64,3),torch.zeros(1,128,64,3)]

    def raw(self,**kwargs):
        result=dict(rewritten_prompt='按<image2>摆姿，双臂向两侧伸展。',wh_ratio='',ratio_follow='<image2>')
        result.update(kwargs)
        return 'reasoning {"rewritten_prompt":"must not use this"}</think>\n'+json.dumps(result)+'<|im_end|>'

    def test_final_only(self):
        value=parse_final(self.raw(),2,self.images,512,1024)
        self.assertTrue(value.startswith('按<image2>'))
        self.assertNotIn('reasoning',value)

    def test_non_thinking_json(self):
        raw = self.raw().split('</think>', 1)[1]
        self.assertIn('摆姿', parse_final(raw,2,self.images,512,1024))
        self.assertIn('摆姿', parse_final('```json\n'+raw+'\n```',2,self.images,512,1024))

    def test_truncated_thinking_rejected(self):
        for raw in ['Wait, let me think. Language: The','<think>not finished','{"rewritten_prompt":"draft"}']:
            with self.assertRaises(ValueError):parse_final(raw,2,self.images,512,1024)

    def test_invalid_contract_rejected(self):
        cases=[self.raw(rewritten_prompt=''),self.raw(rewritten_prompt='按照<image6>'),
               self.raw(wh_ratio='1:2'),self.raw(ratio_follow=''),self.raw(ratio_follow='<image3>'),
               self.raw(wh_ratio='16:9',ratio_follow=''),self.raw()[:-12]]
        for raw in cases:
            with self.subTest(raw=raw),self.assertRaises(ValueError):parse_final(raw,2,self.images,512,1024)

    def test_explicit_ratio(self):
        self.assertIn('摆姿',parse_final(self.raw(wh_ratio='1:2',ratio_follow=''),2,self.images,512,1024))

    def test_reuse_and_invalidation(self):
        from types import SimpleNamespace
        calls=[]
        clip=SimpleNamespace(tokenizer=SimpleNamespace(clip_name='qwen35_9b'),
            tokenize=lambda *a,**k: 'tokens',
            generate=lambda *a,**k: calls.append(1),
            decode=lambda *a,**k: self.raw().split('</think>',1)[1])
        rewrite(clip,'动作',self.images,512,1024)
        rewrite(clip,'动作',[x.clone() for x in self.images],512,1024)
        self.assertEqual(len(calls),1)
        changed=[x.clone() for x in self.images];changed[0][0,0,0,0]=1
        rewrite(clip,'动作',changed,512,1024)
        rewrite(clip,'另一动作',self.images,512,1024)
        rewrite(clip,'动作',self.images,512,1024,required_facts=['新朝向'])
        self.assertEqual(len(calls),4)
        clip.decode=lambda *a,**k:'broken'
        for _ in range(2):
            with self.assertRaises(ValueError):rewrite(clip,'失败输入',self.images,512,1024)
        self.assertEqual(len(calls),6)

    def test_adapter_uses_qwen_chat_and_ordered_images(self):
        from types import SimpleNamespace
        calls={}
        def tokenize(chat, **kwargs):
            calls['chat']=chat;calls['tokenize']=kwargs
            return 'tokens'
        def generate(tokens, **kwargs):
            calls['generate']=kwargs
            return 'generated'
        def decode(tokens, **kwargs):
            self.assertFalse(kwargs['skip_special_tokens'])
            return self.raw(wh_ratio='1:2',ratio_follow='').split('</think>',1)[1]
        clip=SimpleNamespace(tokenizer=SimpleNamespace(clip_name='qwen35_9b'),tokenize=tokenize,generate=generate,decode=decode)
        # Three identity references plus a portrait skeleton, all through the real adapter.
        images=[torch.full((1,600,2000,3),.1),torch.full((1,1024,1024,3),.2),
                torch.full((1,96,64,3),.3),torch.full((1,1664,928,3),.4)]
        original_shapes=[tuple(image.shape) for image in images]
        result=rewrite(clip,'测试指令',images,512,1024)
        self.assertTrue(calls['chat'].startswith('<|im_start|>system'))
        self.assertTrue(calls['chat'].endswith('<think>\n</think>\n'))
        self.assertEqual(calls['chat'].count('<|image_pad|>'),4)
        prepared=calls['tokenize']['images']
        self.assertEqual([tuple(x.shape) for x in prepared],[(1,307,1024,3),(1,1024,1024,3),(1,96,64,3),(1,1024,571,3)])
        self.assertEqual([tuple(image.shape) for image in images],original_shapes)
        for i,image in enumerate(prepared):
            self.assertAlmostEqual(float(image.mean()),(i+1)/10,places=5)
        self.assertFalse(calls['tokenize']['thinking'])
        self.assertEqual(calls['generate']['presence_penalty'],1.5)
        self.assertNotIn('reasoning',result)
        rewritten=rewrite(clip,'测试指令',self.images,512,1024,required_facts=['人物1：背面朝向镜头。'])
        self.assertIn('人物1：背面朝向镜头。',calls['chat'])
        self.assertEqual(rewritten,result)
        rewrite(clip,'测试指令',self.images,512,1024,required_facts=['按<image2>摆姿，双臂向两侧伸展。'])

    def test_options_change_generation_and_cache(self):
        from types import SimpleNamespace
        calls=[];chats=[]
        clip=SimpleNamespace(tokenizer=SimpleNamespace(clip_name='qwen35_9b'),
            tokenize=lambda chat,**kw: chats.append((chat,kw)),
            generate=lambda *a,**kw: calls.append(kw),
            decode=lambda *a,**kw:self.raw().split('</think>',1)[1])
        for options in ({},{'presence_penalty':2.0},{'thinking':True},{'use_default_template':False},{'mtp':'3'}):
            rewrite(clip,'动作',self.images,512,1024,**options)
            rewrite(clip,'动作',self.images,512,1024,**options)
        self.assertEqual(len(calls),5)
        self.assertEqual(calls[1]['presence_penalty'],2.0)
        self.assertTrue(chats[2][1]['thinking'])
        self.assertTrue(chats[2][0].endswith('<think>\n'))
        self.assertNotEqual(chats[0][0],chats[3][0])
        self.assertEqual(calls[4]['mtp'],3)


if __name__=='__main__':unittest.main()
