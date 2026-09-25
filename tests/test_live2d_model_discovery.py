import os
import tempfile
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from open_llm_vtuber.routes import init_webtool_routes


class Live2DModelDiscoveryTest(unittest.TestCase):
    def test_discovers_descriptor_with_original_filename(self):
        original_cwd = Path.cwd()
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            for folder, descriptor in (
                ("legacy", "legacy.model3.json"),
                ("胡桃", "Hu Tao.model3.json"),
            ):
                model_dir = root / "live2d-models" / folder
                model_dir.mkdir(parents=True)
                (model_dir / descriptor).write_text('{"Version": 3}', encoding="utf-8")
            (root / "live2d-models" / "胡桃" / "Icon.png").write_bytes(b"icon")

            app = FastAPI()
            app.include_router(init_webtool_routes(default_context_cache=None))
            try:
                os.chdir(root)
                with TestClient(app) as client:
                    response = client.get("/live2d-models/info")
            finally:
                os.chdir(original_cwd)

        self.assertEqual(response.status_code, 200)
        models = {item["name"]: item for item in response.json()["characters"]}
        self.assertEqual(set(models), {"legacy", "胡桃"})
        self.assertEqual(
            models["胡桃"]["model_path"],
            "live2d-models/胡桃/Hu Tao.model3.json",
        )
        self.assertEqual(models["胡桃"]["avatar"], "live2d-models/胡桃/Icon.png")


if __name__ == "__main__":
    unittest.main()
