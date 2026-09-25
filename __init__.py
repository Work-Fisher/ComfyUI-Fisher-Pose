from .nodes import FisherPoseStudio
from .qwen_bridge import FisherQwenPose
from .gguf_clip import FisherQwen21GGUFCLIP
from .free_pose import FisherQwenFreePose
from .openpose_library import register_routes
from .saved_poses import register_routes as register_saved_pose_routes

register_routes()
register_saved_pose_routes()

NODE_CLASS_MAPPINGS = {"FisherPoseStudio": FisherPoseStudio, "FisherQwenPose": FisherQwenPose}
NODE_DISPLAY_NAME_MAPPINGS = {"FisherPoseStudio": "Fisher 机位与姿态", "FisherQwenPose": "Fisher Qwen2.1 人物与姿态编码"}
NODE_CLASS_MAPPINGS['FisherQwen21GGUFCLIP'] = FisherQwen21GGUFCLIP
NODE_CLASS_MAPPINGS['FisherQwenFreePose'] = FisherQwenFreePose
NODE_DISPLAY_NAME_MAPPINGS['FisherQwenFreePose'] = 'Fisher Qwen2.1 自由姿势'
NODE_DISPLAY_NAME_MAPPINGS['FisherQwen21GGUFCLIP'] = 'Fisher Qwen2.1 GGUF CLIP加载器'
WEB_DIRECTORY = "./web"
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
