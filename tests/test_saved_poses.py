import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent  # plugin root
spec = importlib.util.spec_from_file_location("saved_poses", ROOT / "saved_poses.py")
saved_poses = importlib.util.module_from_spec(spec)
spec.loader.exec_module(saved_poses)

RECORD = {"version": 1, "thumbnail": "data:image/png;base64,AAAA", "doc": {"pose": {"bones": {"head": [1, 2, 3]}}, "width": 1024}}


class SafeNameTest(unittest.TestCase):
    def test_accepts_chinese_and_spaces(self):
        self.assertEqual(saved_poses.safe_name("  武士  起手式 "), "武士 起手式")

    def test_rejects_path_tricks(self):
        for name in ["", "   ", ".", "..", "../evil", "a/b", "a\\b", "c:x", ".hidden", "x" * 61, "a\x00b", None, 3]:
            self.assertIsNone(saved_poses.safe_name(name), repr(name))


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.user = self.temp.name

    def tearDown(self):
        self.temp.cleanup()

    def test_save_list_read_delete(self):
        self.assertEqual(saved_poses.list_poses(self.user), [])
        self.assertEqual(saved_poses.save_pose(self.user, "起手式", RECORD), ("saved", "起手式"))
        listing = saved_poses.list_poses(self.user)
        self.assertEqual([entry["name"] for entry in listing], ["起手式"])
        self.assertEqual(listing[0]["thumbnail"], RECORD["thumbnail"])
        self.assertNotIn("doc", listing[0])  # the list stays light: no pose data
        record = saved_poses.read_pose(self.user, "起手式")
        self.assertEqual(record["doc"], RECORD["doc"])
        self.assertEqual(record["kind"], "fisher-saved-pose")
        self.assertTrue(os.path.isfile(os.path.join(self.user, "default", "fisher_pose", "poses", "起手式.json")))
        self.assertTrue(saved_poses.delete_pose(self.user, "起手式"))
        self.assertFalse(saved_poses.delete_pose(self.user, "起手式"))
        self.assertEqual(saved_poses.list_poses(self.user), [])

    def test_existing_name_needs_overwrite(self):
        saved_poses.save_pose(self.user, "a", RECORD)
        self.assertEqual(saved_poses.save_pose(self.user, "a", RECORD)[0], "exists")
        changed = {**RECORD, "doc": {"width": 512}}
        self.assertEqual(saved_poses.save_pose(self.user, "a", changed, overwrite=True)[0], "saved")
        self.assertEqual(saved_poses.read_pose(self.user, "a")["doc"], {"width": 512})

    def test_newest_first(self):
        saved_poses.save_pose(self.user, "old", RECORD)
        record = saved_poses.read_pose(self.user, "old")
        record["savedAt"] = 1  # pretend it was saved long ago
        Path(saved_poses.pose_path(self.user, "old")).write_text(json.dumps(record), encoding="utf-8")
        saved_poses.save_pose(self.user, "new", RECORD)
        self.assertEqual([entry["name"] for entry in saved_poses.list_poses(self.user)], ["new", "old"])

    def test_invalid_input_writes_nothing(self):
        self.assertEqual(saved_poses.save_pose(self.user, "../x", RECORD)[0], "invalid")
        self.assertEqual(saved_poses.save_pose(self.user, "ok", {"no": "doc"})[0], "invalid")
        self.assertIsNone(saved_poses.read_pose(self.user, "../x"))
        self.assertFalse(os.path.exists(os.path.join(self.user, "x.json")))
        self.assertEqual(saved_poses.list_poses(self.user), [])

    def test_broken_files_are_skipped(self):
        saved_poses.save_pose(self.user, "good", RECORD)
        folder = saved_poses.poses_folder(self.user)
        Path(folder, "broken.json").write_text("{not json", encoding="utf-8")
        Path(folder, "notes.txt").write_text("x", encoding="utf-8")
        self.assertEqual([entry["name"] for entry in saved_poses.list_poses(self.user)], ["good"])


if __name__ == "__main__":
    unittest.main()
