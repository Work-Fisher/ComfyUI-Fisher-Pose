"""Deterministic camera projection and edit instructions. No model calls."""
import copy
import json
import math

import numpy as np
from PIL import Image, ImageDraw

BASE_POINTS = {
    "head": [0, 1.79, 0], "neck": [0, 1.55, 0],
    "ls": [.25, 1.48, 0], "le": [.39, 1.17, .03], "lw": [.43, .87, .1],
    "rs": [-.25, 1.48, 0], "re": [-.39, 1.17, .03], "rw": [-.43, .87, .1],
    "hip": [0, .95, 0], "lh": [.14, .94, 0], "lk": [.18, .51, .025], "la": [.19, .08, .02],
    "rh": [-.14, .94, 0], "rk": [-.18, .51, .025], "ra": [-.19, .08, .02],
}
DEFAULT_STATE = {"points": BASE_POINTS, "azimuth": 330, "elevation": 9, "distance": 4.3,
                 "bodyAngle": 0, "ratio": "3:4", "preset": "stand", "mode": "model"}
MODES = ["视角＋姿态", "仅视角", "仅姿态"]
POINT_ORDER = ["head", "neck", "rs", "re", "rw", "ls", "le", "lw", "rh", "rk", "ra", "lh", "lk", "la"]
# OpenPose body limb ordering, with unavailable eyes/ears/fingers omitted.
LIMBS = [(1, 2), (1, 5), (2, 3), (3, 4), (5, 6), (6, 7), (1, 8), (8, 9), (9, 10),
         (1, 11), (11, 12), (12, 13), (1, 0)]
COLORS = [(255, 0, 0), (255, 85, 0), (255, 170, 0), (255, 255, 0), (170, 255, 0),
          (85, 255, 0), (0, 255, 0), (0, 255, 85), (0, 255, 170), (0, 255, 255),
          (0, 170, 255), (0, 85, 255), (0, 0, 255), (85, 0, 255)]


def read_scene(scene_json):
    if len(scene_json) > 42_000_000:
        raise ValueError("Fisher 场景数据过大，请重新应用编辑器设置。")
    data = json.loads(scene_json or "{}")
    if not isinstance(data, dict):
        raise ValueError("Fisher 场景必须是 JSON 对象。")
    raw = data.get("state", data)
    if not isinstance(raw, dict):
        raise ValueError("Fisher 场景 state 必须是对象。")
    state = copy.deepcopy(DEFAULT_STATE)
    state.update(raw)
    for key in ("azimuth", "elevation", "distance"):
        value = state[key]
        if not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError(f"Fisher {key} 必须是有限数字。")
    if state["distance"] <= 0:
        raise ValueError("Fisher 相机距离必须大于 0。")
    state["elevation"] = max(-30, min(60, state["elevation"]))
    if "people" not in raw:
        state["people"] = [{"id": "p1", "name": "人物 01", "points": state["points"],
                            "bodyAngle": state["bodyAngle"], "position": [0, 0, 0],
                            "preset": state["preset"], "identity": ""}]
    people = state["people"]
    if not isinstance(people, list) or not 0 <= len(people) <= 3:
        raise ValueError("Fisher 支持 0–3 个人物。")
    for person in people:
        if not isinstance(person, dict) or not isinstance(person.get("points"), dict):
            raise ValueError("Fisher 缺少人物关节。")
        for name in BASE_POINTS:
            point = person["points"].get(name)
            validate_vector(point, f"关节 {name}")
        validate_vector(person.setdefault("position", [0, 0, 0]), "人物位置")
        angle = person.setdefault("bodyAngle", 0)
        if not isinstance(angle, (int, float)) or not math.isfinite(angle):
            raise ValueError("Fisher 人物朝向必须为有限数字。")
        if not isinstance(person.get("torsoFacingOffset", 0), (int, float)) or not math.isfinite(person.get("torsoFacingOffset", 0)):
            raise ValueError("躯干朝向必须为有限数字。")
        if not isinstance(person.get("identity", ""), str):
            raise ValueError("Fisher 人物对应说明须为文本。")
    validate_vector(state.setdefault("cameraTarget", [0, 1, 0]), "相机目标")
    zoom = state.setdefault("zoom", max(0, min(10, (6.8 - state["distance"]) / .5)))
    if not isinstance(zoom, (int, float)) or not math.isfinite(zoom):
        raise ValueError("Fisher zoom 必须为有限数字。")
    state.setdefault("promptStyle", "中文编辑指令")
    return state


def validate_vector(value, label):
    if not isinstance(value, list) or len(value) != 3 or not all(
        isinstance(v, (int, float)) and math.isfinite(v) and abs(v) <= 100 for v in value
    ):
        raise ValueError(f"Fisher {label} 数据无效。")


def project_points(state, width, height, person=None):
    if person is None:
        person = state.get("people", [state])[0]
    azimuth, elevation, body = (math.radians(value) for value in
                                (state["azimuth"], state["elevation"], person.get("bodyAngle", 0)))
    sa, ca, se, ce = math.sin(azimuth), math.cos(azimuth), math.sin(elevation), math.cos(elevation)
    right = np.array([ca, 0, -sa])
    up = np.array([-sa * se, ce, -ca * se])
    radial = np.array([sa * ce, se, ca * ce])
    tan_half_fov = math.tan(math.radians(37) / 2)
    result = []
    for name in POINT_ORDER:
        x, y, z = person["points"][name]
        if name == "head":
            z += .11  # Nose on the front of the head, matching the editor.
            y -= .005
        point = np.array([x * math.cos(body) + z * math.sin(body), y,
                          -x * math.sin(body) + z * math.cos(body)])
        point += np.array(person.get("position", [0, 0, 0])) - np.array(state.get("cameraTarget", [0, 1, 0]))
        depth = state["distance"] - float(point @ radial)
        if depth <= .05:
            result.append(None)
            continue
        px = .5 + float(point @ right) / (2 * depth * tan_half_fov * width / height)
        py = .5 - float(point @ up) / (2 * depth * tan_half_fov)
        result.append((px * width, py * height))
    return result


def person_facing(state, person):
    """Camera bearing relative to the avatar's +Z front, including actor position."""
    a, e, b = map(math.radians, (state['azimuth'], state['elevation'], person.get('bodyAngle', 0)))
    target = state.get('cameraTarget', [0, 1, 0])
    camera = np.array(target) + state['distance'] * np.array([math.sin(a)*math.cos(e), math.sin(e), math.cos(a)*math.cos(e)])
    x, y, z = person['points']['hip']
    center = np.array(person.get('position', [0, 0, 0])) + [x*math.cos(b)+z*math.sin(b), y, -x*math.sin(b)+z*math.cos(b)]
    delta = camera-center
    if math.hypot(delta[0], delta[2]) < 1e-6:
        return '镜头位于人物正上方或正下方，正背面不作判定'
    bearing = (math.degrees(math.atan2(delta[0], delta[2]))-person.get('bodyAngle', 0)-person.get('torsoFacingOffset', 0)) % 360
    return ['正面朝向镜头','左前侧朝向镜头','左侧朝向镜头','左后侧朝向镜头','背面朝向镜头','右后侧朝向镜头','右侧朝向镜头','右前侧朝向镜头'][int((bearing+22.5)//45)%8]


def person_constraints(state, person, number, include_pose=True):
    facts = [f"人物{number}：{person_facing(state, person)}。"]
    if not include_pose:
        return facts
    points = person['points']
    projected = dict(zip(POINT_ORDER, project_points(state, 1000, 1000, person)))
    for root, middle, end, label in [('ls','le','lw','左臂'),('rs','re','rw','右臂'),('lh','lk','la','左腿'),('rh','rk','ra','右腿')]:
        u = np.array(points[root])-points[middle]
        v = np.array(points[end])-points[middle]
        length = float(np.linalg.norm(u)*np.linalg.norm(v))
        if length < 1e-8:
            raise ValueError(f'人物{number}{label}骨段长度为零，请调整关节。')
        angle = math.degrees(math.acos(float(np.clip(np.dot(u,v)/length,-1,1))))
        bend = '基本伸直' if angle >= 160 else '轻度弯曲' if angle >= 120 else '明显弯曲' if angle >= 60 else '深度折叠'
        joint, tip = ('肘','手腕') if label.endswith('臂') else ('膝','脚踝')
        start, finish = projected[middle], projected[end]
        relation = ''
        if start is not None and finish is not None:
            dx, dy = finish[0]-start[0], finish[1]-start[1]
            visible = [p for p in projected.values() if p is not None]
            tolerance = max(5, (max(p[1] for p in visible)-min(p[1] for p in visible))*.06)
            horizontal = '向画面右侧' if dx>tolerance else '向画面左侧' if dx < -tolerance else '横向位置接近'
            vertical = '向画面下方' if dy>tolerance else '向画面上方' if dy < -tolerance else '在画面中近似等高'
            relation = f'，{tip}相对{joint}部{horizontal}、{vertical}'
        facts.append(f'人物{number}自身{label}：{joint}部{bend}（内夹角约{int(round(angle))}度）{relation}。')
    return facts


def person_description(state, person, number, include_pose=True):
    """Natural edit instructions from measured geometry, without inferring an action label."""
    import re
    facts = person_constraints(state, person, number, include_pose)
    text = facts[0]
    if not include_pose:
        return text
    projected = dict(zip(POINT_ORDER, project_points(state, 1000, 1000, person)))
    visible = [p for p in projected.values() if p is not None]
    tolerance = max(5, (max(p[1] for p in visible)-min(p[1] for p in visible))*.06) if visible else 5
    def direction(start, end):
        if start is None or end is None:
            return ''
        dx, dy = end[0]-start[0], end[1]-start[1]
        x = '右' if dx>tolerance else '左' if dx < -tolerance else ''
        y = '下' if dy>tolerance else '上' if dy < -tolerance else ''
        return ('向画面'+x+y+'方延伸') if x or y else '在画面中的两端位置接近'
    for index, (root, middle, end, segment) in enumerate([('ls','le','lw','左上臂'),('rs','re','rw','右上臂'),('lh','lk','la','左大腿'),('rh','rk','ra','右大腿')],1):
        relation = direction(projected[root], projected[middle])
        if relation:
            text += segment + relation + '，'
        sentence = facts[index].split('：',1)[1]
        text += re.sub(r'（内夹角约\d+度）', '', sentence)
        if index >= 3 and all(projected[k] is not None for k in ('lh','rh',middle,end)):
            center = (projected['lh'][0]+projected['rh'][0])/2
            knee, ankle = projected[middle][0]-center, projected[end][0]-center
            side = '左' if index==3 else '右'
            if knee*ankle < 0 and min(abs(knee),abs(ankle))>tolerance:
                text += side+'小腿跨过身体在画面中的中线。'
            elif abs(knee)-abs(ankle)>tolerance:
                text += side+'小腿向身体在画面中的中线收回。'
            elif abs(ankle)-abs(knee)>tolerance:
                text += side+'小腿向身体在画面中的外侧展开。'
    return text


def render_pose(state, width, height):
    if not (64 <= width <= 4096 and 64 <= height <= 4096):
        raise ValueError("骨架图宽高须在 64–4096 像素之间。")
    image = Image.new("RGB", (width, height), (0, 0, 0))
    draw = ImageDraw.Draw(image)
    thickness = max(2, round(min(width, height) / 150))
    radius = max(3, round(min(width, height) / 125))
    azimuth, elevation = math.radians(state["azimuth"]), math.radians(state["elevation"])
    radial = np.array([math.sin(azimuth) * math.cos(elevation), math.sin(elevation), math.cos(azimuth) * math.cos(elevation)])
    people = sorted(state.get("people", [state]), key=lambda person: float(np.array(person.get("position", [0, 0, 0])) @ radial))
    for person in people:
        points = project_points(state, width, height, person)
        for index, (start, end) in enumerate(LIMBS):
            if points[start] is not None and points[end] is not None:
                draw.line([points[start], points[end]], fill=COLORS[index], width=thickness)
        for index, point in enumerate(points):
            if point is not None:
                x, y = point
                draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=COLORS[index])
    return image


def camera_terms(state):
    """Bins/phrases follow jtydhr88/ComfyUI-qwenmultiangle nodes.py."""
    english = ["front view", "front-right quarter view", "right side view", "back-right quarter view",
               "back view", "back-left quarter view", "left side view", "front-left quarter view"]
    chinese = ["正面视角", "右前方视角", "右侧视角", "右后方视角", "背面视角", "左后方视角", "左侧视角", "左前方视角"]
    index = int(((state["azimuth"] % 360) + 22.5) // 45) % 8
    elevation = max(-30, min(60, state["elevation"]))
    vertical = 0 if elevation < -15 else 1 if elevation < 15 else 2 if elevation < 45 else 3
    zoom = state.get("zoom", max(0, min(10, (6.8 - state["distance"]) / .5)))
    distance = 0 if zoom < 2 else 1 if zoom < 6 else 2
    return {
        "en": f"{english[index]} {['low-angle shot', 'eye-level shot', 'elevated shot', 'high-angle shot'][vertical]} {['wide shot', 'medium shot', 'close-up'][distance]}",
        "zh": f"{chinese[index]}，{['仰拍', '平视', '高角度', '俯拍'][vertical]}，{['远景', '中景', '特写'][distance]}",
    }


def scene_prompt(state, extra=""):
    azimuth = int(math.floor(state['azimuth'] + .5)) % 360
    elevation = max(-30, min(60, int(math.floor(state['elevation'] + .5))))
    zoom = max(0, min(10, round(state.get('zoom', 5), 1)))
    direction = ['正面','右前侧','右侧','右后侧','背面','左后侧','左侧','左前侧'][int((azimuth+22.5)//45)%8]
    height = '低机位仰视' if elevation < -15 else '平视' if elevation < 15 else '抬高机位俯视' if elevation < 45 else '高机位俯拍'
    distance = '远景' if zoom < 2 else '中景' if zoom < 6 else '近景'
    return (f"根据参考图片重新呈现同一个主体，目标视角为主体的{direction}，{height}，{distance}构图。\n"
            f"精确相机参数：水平环绕 {azimuth}°（0°正面、90°主体右侧、180°背面、270°主体左侧），俯仰 {elevation}°（正值抬高机位向下看、负值降低机位向上看），取景靠近程度 {zoom:.1f}/10（0为远景、5为中景、10为特写）。按连续数值调整，不要量化为固定预设。\n"
            "只改变相机观察方向、高度和取景距离；保持主体身份、面部特征、服饰、道具、材质和画面风格一致。依据原图合理补全新视角可见的结构。不要用平面旋转、镜像或拉伸原图代替视角变化，不添加多视图拼版、文字或重复主体。以本段目标视角为准，其他内容要求保持不变。" + ("补充要求："+extra.strip() if extra.strip() else ""))


def build_prompt(state, mode, extra_prompt=""):
    if not state['people']:
        return scene_prompt(state, extra_prompt)
    if mode not in MODES:
        raise ValueError("请选择有效的 Fisher 输出模式。")
    people = state.get("people", [state])
    terms = camera_terms(state)
    english = state.get("promptStyle") == "Multiangle LoRA (<sks>)"
    if english:
        camera = "<sks> " + terms["en"]
        if mode == "仅视角":
            prompt = camera
        else:
            prompt = (camera + "\n" if mode == "视角＋姿态" else "")
            prompt += f"Use image 1 for the appearance and identity of {len(people)} subject(s). Use image 2 as the shooting-frame mannequin pose reference (pose only, not material or background) for all subjects. Keep their identities and clothing distinct. Do not render skeleton lines or joint markers."
    else:
        camera = f"将拍摄机位调整为{terms['zh']}。视角方向以场景正面为基准。"
        if mode == "仅视角":
            prompt = "以图1为人物与场景参考，保持人物身份、面部特征、发型、服装及原有身体动作一致。" + camera + "背景随新机位呈现合理的透视与遮挡关系，保持原有场景内容和视觉风格。"
        else:
            prompt = f"以图1为人物外观参考，画面中共{len(people)}个人物，分别保留各自身份、面部特征、发型和服装，不要互换人物特征。图2为所有人物的拍摄框人偶姿态参考，只参考动作和朝向，不复制人偶材质或背景，最终画幅仍按输出设置，按照图2调整各自的肢体位置、动作和画面占比。"
            if mode == "视角＋姿态":
                prompt += camera
            prompt += "最终图像不出现骨架线条或关节点。"
    if mode != "仅视角" and len(people) > 1:
        projected = [(index, project_points(state, 1000, 1000, person)[1]) for index, person in enumerate(people)]
        ordered = sorted(projected, key=lambda item: item[1][0] if item[1] is not None else math.inf)
        labels = [people[index].get("identity", "").strip() or f"图1中从左到右第{index + 1}个人物" for index, _ in ordered]
        prompt += ("\nMannequins from left to right correspond to: " if english else "\n图2人偶从左到右依次对应：") + "；".join(labels) + "。"
    if not english:
        prompt += '场景机位不等于人物朝向，以逐人描述为准。' + ''.join(
            person_description(state, person, i, mode != '仅视角') for i, person in enumerate(people, 1))
    return prompt + (("\n" + ("Additional instructions: " if english else "补充要求：") + extra_prompt.strip()) if extra_prompt.strip() else "")
