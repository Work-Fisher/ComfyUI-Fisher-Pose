"""Saved poses for the free-pose editor ("我的姿势").

Each pose is one JSON file under ComfyUI/user/default/fisher_pose/poses, so it survives restarts,
browsers and plugin updates. The record holds the whole editor state (bone rotations, IK, body
shape, proportions, framing, mannequin size, grip sliders) plus a small front-capture thumbnail.
"""
import json
import logging
import os
import time

MAX_NAME_LENGTH = 60
MAX_RECORD_BYTES = 8 * 1024 * 1024
FORBIDDEN_CHARACTERS = set('\\/:*?"<>|')


def poses_folder(user_directory):
    return os.path.join(user_directory, "default", "fisher_pose", "poses")


def safe_name(name):
    """The pose name doubles as its file name: reject path tricks instead of silently rewriting them."""
    if not isinstance(name, str):
        return None
    name = " ".join(name.split())  # collapse whitespace, drop control characters like \n and \t
    if not name or len(name) > MAX_NAME_LENGTH or name.strip(".") == "":
        return None
    if any(ch in FORBIDDEN_CHARACTERS or ord(ch) < 32 for ch in name) or name.startswith("."):
        return None
    return name


def pose_path(user_directory, name):
    name = safe_name(name)
    return None if name is None else os.path.join(poses_folder(user_directory), name + ".json")


def read_pose(user_directory, name):
    path = pose_path(user_directory, name)
    if path is None or not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as file:
        return json.load(file)


def list_poses(user_directory):
    """Name, save time and thumbnail of every pose, newest first; unreadable files are skipped."""
    folder = poses_folder(user_directory)
    if not os.path.isdir(folder):
        return []
    poses = []
    for file_name in os.listdir(folder):
        if not file_name.endswith(".json"):
            continue
        name = file_name[:-5]
        if safe_name(name) != name:
            continue
        try:
            record = read_pose(user_directory, name)
        except (OSError, ValueError):
            continue
        if not isinstance(record, dict):
            continue
        poses.append({"name": name, "savedAt": record.get("savedAt", 0), "thumbnail": record.get("thumbnail", "")})
    return sorted(poses, key=lambda pose: pose["savedAt"], reverse=True)


def save_pose(user_directory, name, record, overwrite=False):
    """Returns (status, message): 'saved', 'exists' (name taken and overwrite is off) or 'invalid'."""
    path = pose_path(user_directory, name)
    if path is None:
        return "invalid", "名字不能为空、不能超过 60 个字，也不能包含 \\ / : * ? \" < > |"
    if not isinstance(record, dict) or not isinstance(record.get("doc"), dict):
        return "invalid", "姿势数据不完整"
    if os.path.exists(path) and not overwrite:
        return "exists", "已有同名姿势"
    record = {**record, "kind": "fisher-saved-pose", "name": safe_name(name), "savedAt": int(time.time() * 1000)}
    text = json.dumps(record, ensure_ascii=False)
    if len(text.encode("utf-8")) > MAX_RECORD_BYTES:
        return "invalid", "姿势数据过大"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temporary = path + ".tmp"
    with open(temporary, "w", encoding="utf-8") as file:
        file.write(text)
    os.replace(temporary, path)  # never leave a half-written pose behind
    return "saved", record["name"]


def delete_pose(user_directory, name):
    path = pose_path(user_directory, name)
    if path is None or not os.path.isfile(path):
        return False
    os.remove(path)
    return True


def register_routes():
    try:
        import folder_paths
        from aiohttp import web
        from server import PromptServer
        routes = PromptServer.instance.routes
    except (ImportError, AttributeError):  # unit tests import the package without a running server
        return

    user_directory = folder_paths.get_user_directory

    # 列表为什么单独一条路径：热重载类插件（如 comfyui_lg_hotreload）同步路由时按「路径」找资源，
    # 会把该路径下所有方法的 handler 刷成最后注册的那个，GET 会被 POST 抢走 → 前端拿 400 → 保存按钮被禁用。
    # 所以同一路径只保留一种方法，列表用 /fisher_pose/saved_pose_list 独立开。
    @routes.get("/fisher_pose/saved_pose_list")
    async def get_poses(request):
        poses = list_poses(user_directory())
        logging.info('[Fisher Pose] 列出已存姿势 %d 个', len(poses))
        return web.json_response({"poses": poses})

    @routes.get("/fisher_pose/saved_poses/{name}")
    async def get_pose(request):
        name = request.match_info["name"]
        record = read_pose(user_directory(), name)
        logging.info('[Fisher Pose] 读取姿势 %r：%s', name, "命中" if record is not None else "不存在")
        return web.json_response(record) if record is not None else web.Response(status=404)

    @routes.post("/fisher_pose/saved_poses")
    async def post_pose(request):
        try:
            body = await request.json()
        except ValueError:
            logging.warning('[Fisher Pose] 保存姿势失败：请求体不是合法 JSON')
            return web.json_response({"error": "请求格式错误"}, status=400)
        status, message = save_pose(user_directory(), body.get("name"), body.get("record"), bool(body.get("overwrite")))
        if status == "saved":
            logging.info('[Fisher Pose] 已保存姿势 %r（覆盖=%s）', message, bool(body.get("overwrite")))
            return web.json_response({"name": message})
        logging.warning('[Fisher Pose] 保存姿势被拒（%s）：%s', status, message)
        return web.json_response({"error": message}, status=409 if status == "exists" else 400)

    @routes.post("/fisher_pose/saved_poses/{name}/delete")
    async def post_delete(request):
        name = request.match_info["name"]
        removed = delete_pose(user_directory(), name)
        logging.info('[Fisher Pose] 删除姿势 %r：%s', name, "成功" if removed else "不存在")
        return web.json_response({"removed": removed})

    logging.info('[Fisher Pose] 已注册保存姿势路由：GET /fisher_pose/saved_pose_list、GET /fisher_pose/saved_poses/{name}、'
                 'POST /fisher_pose/saved_poses、POST /fisher_pose/saved_poses/{name}/delete')
