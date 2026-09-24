"""PE-style JSON plus OpenPose-style posture text, passed directly to encoding."""
import json
import math
from .pose_core import person_description, person_facing


def format_prompt_json(prompt, state, mode, width, height):
    descriptions = []
    for index, person in enumerate(state['people'], 1):
        facing = person_facing(state, person)
        text = person_description(state, person, index, mode != '仅视角')
        prefix = f'人物{index}：{facing}。'
        pose = text[len(prefix):] if text.startswith(prefix) else text
        if mode == '仅视角':
            pose = '保持原有身体动作。'
        descriptions.append(f'人物{index}：{facing} - {pose}')
    divisor = math.gcd(width, height)
    return json.dumps({
        'rewritten_prompt': prompt,
        'posture_description': '\n'.join(descriptions),
        'wh_ratio': f'{width//divisor}:{height//divisor}',
        'ratio_follow': '',
    }, ensure_ascii=False, indent=2)
