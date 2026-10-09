"""Exercise the actual no-extension asset route without a ComfyUI restart/GPU."""
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fisher_env_route_test', ROOT / 'env_check.py')
env = importlib.util.module_from_spec(spec)
spec.loader.exec_module(env)


class BodyPackRouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        routes = web.RouteTableDef()
        server = types.SimpleNamespace(PromptServer=types.SimpleNamespace(instance=types.SimpleNamespace(routes=routes)))
        with patch.dict(sys.modules, {'server': server}), patch.object(env, 'qwen21_supported', return_value=True):
            env.register_routes()
        app = web.Application()
        app.add_routes(routes)
        self.client = TestClient(TestServer(app))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()

    async def test_binary_range_and_headers(self):
        asset = ROOT / 'web/vnccs/assets/pose_studio_makehuman.v2.bin'
        if not asset.is_file():
            self.skipTest('Optional runtime asset not installed')
        response = await self.client.get('/fisher_pose/body_pack', headers={'Range': 'bytes=0-63'})
        self.assertEqual(response.status, 206)
        self.assertEqual(response.headers['Content-Type'], 'application/x-fisher-pose')
        self.assertNotIn('Content-Disposition', response.headers)
        with asset.open('rb') as file:
            self.assertEqual(await response.read(), file.read(64))

    async def test_missing_file_is_distinct(self):
        with patch.object(Path, 'is_file', return_value=False):
            response = await self.client.get('/fisher_pose/body_pack')
            self.assertEqual(response.status, 404)
            self.assertIn('人体数据文件缺失', await response.text())


if __name__ == '__main__':
    unittest.main()
