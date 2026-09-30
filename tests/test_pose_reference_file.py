import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # plugin root
import base64
import io
import json
import os
import tempfile
import unittest

from PIL import Image

from pose_reference import input_file_path, reference_image


def png_bytes(size=(96, 128), color=(200, 180, 170)):
    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, format="PNG")
    return buffer.getvalue()


class PoseReferenceFileTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.input = self.temp.name
        os.makedirs(os.path.join(self.input, "fisher_pose"))
        with open(os.path.join(self.input, "fisher_pose", "pose_abc.png"), "wb") as file:
            file.write(png_bytes())

    def tearDown(self):
        self.temp.cleanup()

    def test_reads_the_stored_file(self):
        pose_json = json.dumps({"poseReferenceFile": {"filename": "pose_abc.png", "subfolder": "fisher_pose", "type": "input"}})
        image = reference_image(pose_json, input_directory=self.input)
        self.assertEqual(image.size, (96, 128))
        self.assertEqual(image.mode, "RGB")

    def test_base64_still_works_and_wins_over_a_file(self):
        encoded = "data:image/png;base64," + base64.b64encode(png_bytes((80, 80))).decode()
        pose_json = json.dumps({"poseReference": encoded, "poseReferenceFile": {"filename": "pose_abc.png", "subfolder": "fisher_pose"}})
        self.assertEqual(reference_image(pose_json, input_directory=self.input).size, (80, 80))

    def test_missing_file_says_to_reapply(self):
        pose_json = json.dumps({"poseReferenceFile": {"filename": "gone.png", "subfolder": "fisher_pose"}})
        with self.assertRaisesRegex(ValueError, "应用到节点"):
            reference_image(pose_json, input_directory=self.input)

    def test_paths_cannot_leave_the_input_folder(self):
        for entry in [{"filename": "../secret.png"}, {"filename": "x.png", "subfolder": "../.."},
                      {"filename": os.path.abspath(os.sep + "etc")}, {"filename": ""}, {}, "pose_abc.png"]:
            self.assertIsNone(input_file_path(entry, self.input), repr(entry))
        with self.assertRaisesRegex(ValueError, "路径无效"):
            reference_image(json.dumps({"poseReferenceFile": {"filename": "../x.png"}}), input_directory=self.input)

    def test_size_limits_apply_to_files_too(self):
        with open(os.path.join(self.input, "fisher_pose", "tiny.png"), "wb") as file:
            file.write(png_bytes((16, 16)))
        with self.assertRaisesRegex(ValueError, "64–4096"):
            reference_image(json.dumps({"poseReferenceFile": {"filename": "tiny.png", "subfolder": "fisher_pose"}}), input_directory=self.input)


if __name__ == "__main__":
    unittest.main()
