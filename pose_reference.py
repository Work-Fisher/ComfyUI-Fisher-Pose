"""Decode the editor-rendered shooting-frame mannequin reference."""
import base64
import io
import json
import os
from PIL import Image, ImageDraw


def input_file_path(entry, input_directory=None):
    """ComfyUI input-folder path of {'filename','subfolder'}; None when it would leave the input folder."""
    if input_directory is None:
        import folder_paths
        input_directory=folder_paths.get_input_directory()
    if not isinstance(entry,dict) or not isinstance(entry.get('filename'),str) or not entry['filename']:
        return None
    root=os.path.abspath(input_directory)
    path=os.path.abspath(os.path.join(root,str(entry.get('subfolder') or ''),entry['filename']))
    try:
        inside=os.path.commonpath([root,path])==root
    except ValueError:  # another drive on Windows
        return None
    return path if inside else None


def reference_image(scene_json, key='poseReference', input_directory=None):
    data=json.loads(scene_json or '{}')
    # ComfyUI's free-pose node stores the mannequin as a file in input/ (small workflows);
    # the base64 form is still accepted for older workflows and for AIFISHER Canvas.
    stored=data.get(key+'File') if key=='poseReference' else None
    if stored and not data.get(key):
        path=input_file_path(stored,input_directory)
        if path is None:
            raise ValueError('人偶图文件路径无效，请打开编辑器点击「应用到节点」重新生成。')
        if not os.path.isfile(path):
            raise ValueError(f'找不到人偶图文件 input/{stored.get("subfolder","")}/{stored["filename"]}（换了电脑或删过 input 文件夹时会这样）。请打开编辑器点击「应用到节点」重新生成。')
        with Image.open(path) as opened:
            image=opened.copy()
    else:
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
