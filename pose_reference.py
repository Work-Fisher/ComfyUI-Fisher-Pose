"""Decode the editor-rendered shooting-frame mannequin reference."""
import base64
import io
import json
from PIL import Image, ImageDraw


def reference_image(scene_json, key='poseReference'):
    data=json.loads(scene_json or '{}')
    encoded=data.get(key,'')
    if not encoded:
        raise ValueError('请打开机位与姿态编辑器，点击「应用到节点」，生成拍摄框人偶参考图。')
    prefix='data:image/png;base64,'
    if not isinstance(encoded,str) or not encoded.startswith(prefix) or len(encoded)>32_000_000:
        raise ValueError('人偶参考图数据无效，请重新应用编辑器。')
    image=Image.open(io.BytesIO(base64.b64decode(encoded[len(prefix):],validate=True)))
    if not all((1 if key=='cameraPreview' else 64) <= value <= 4096 for value in image.size):
        raise ValueError('人偶参考图尺寸必须在64–4096像素内。请重新应用编辑器。')
    return image.convert('RGB')


def camera_preview(scene_json):
    data=json.loads(scene_json or '{}')
    if data.get('cameraPreview'):
        return reference_image(scene_json, 'cameraPreview')
    # This output is independent of the model's pose reference. Legacy captures
    # intentionally omit the cube, so never substitute them for the preview.
    image = Image.new('RGB', (768, 432), (239, 242, 246))
    draw = ImageDraw.Draw(image)
    draw.text((48, 176), 'Camera preview needs refreshing.', fill=(35, 48, 68), font_size=26)
    draw.text((48, 224), 'Reload ComfyUI, open the editor, then click Apply.', fill=(70, 85, 105), font_size=22)
    return image
