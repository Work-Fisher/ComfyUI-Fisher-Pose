"""OpenPose skeleton galleries for the free-pose editor.

Built-in: the plugin's FISHER小彩蛋 folder (read-only).
User library: images uploaded through ComfyUI's own /upload/image into input/fisher_openpose,
so they survive restarts and browsers; these routes only list and clear that folder.
"""
import os

LIBRARY_SUBFOLDER = "fisher_openpose"
IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp")
# Built-in skeletons shipped with the plugin, named 1.png, 2.png, ...
BUILTIN_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "FISHER小彩蛋")


def list_builtin(folder=BUILTIN_FOLDER):
    if not os.path.isdir(folder):
        return []
    names = [name for name in os.listdir(folder) if name.lower().endswith(IMAGE_EXTENSIONS)]
    return sorted(names, key=lambda name: (int(os.path.splitext(name)[0]) if os.path.splitext(name)[0].isdigit() else float("inf"), name))


def library_folder(input_directory):
    return os.path.join(input_directory, LIBRARY_SUBFOLDER)


def list_library(input_directory):
    folder = library_folder(input_directory)
    if not os.path.isdir(folder):
        return []
    return sorted(name for name in os.listdir(folder)
                  if name.lower().endswith(IMAGE_EXTENSIONS) and os.path.isfile(os.path.join(folder, name)))


def clear_library(input_directory):
    folder = library_folder(input_directory)
    removed = 0
    for name in list_library(input_directory):
        os.remove(os.path.join(folder, name))
        removed += 1
    return removed


def register_routes():
    try:
        import folder_paths
        from aiohttp import web
        from server import PromptServer
        routes = PromptServer.instance.routes
    except (ImportError, AttributeError):  # unit tests import the package without a running server
        return

    @routes.get("/fisher_pose/openpose_library")
    async def get_library(request):
        return web.json_response({"subfolder": LIBRARY_SUBFOLDER, "files": list_library(folder_paths.get_input_directory())})

    @routes.post("/fisher_pose/openpose_library/clear")
    async def post_clear(request):
        return web.json_response({"removed": clear_library(folder_paths.get_input_directory())})

    @routes.get("/fisher_pose/builtin_poses")
    async def get_builtin(request):
        return web.json_response({"files": list_builtin()})

    @routes.get("/fisher_pose/builtin_poses/{name}")
    async def get_builtin_file(request):
        name = request.match_info["name"]
        if name not in list_builtin():  # only listed files, never arbitrary paths
            return web.Response(status=404)
        return web.FileResponse(os.path.join(BUILTIN_FOLDER, name))
