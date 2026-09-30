import os
import tempfile
import time
import unittest
from pathlib import Path
from loguru import logger
from src.open_llm_vtuber.logging_config import configure_logging, prune_logs
from upgrade_codes.upgrade_manager import UpgradeManager

class LoggingPolicyTest(unittest.TestCase):
    def test_entrypoint_level_upgrade_constructor_and_retention(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            configure_logging(directory=root)
            UpgradeManager()
            logger.debug("debug-marker")
            logger.info("info-marker")
            logger.remove()
            content = "".join(p.read_text(encoding="utf-8") for p in root.glob("backend_*.log"))
            self.assertIn("info-marker", content)
            self.assertNotIn("debug-marker", content)
            self.assertEqual(list(root.glob("upgrade_*.log")), [])
            configure_logging("DEBUG", root)
            logger.debug("explicit-debug-marker")
            logger.remove()
            self.assertIn("explicit-debug-marker", "".join(p.read_text(encoding="utf-8") for p in root.glob("backend_*.log")))
            for name, age in [("new.log",0),("old.log",1),("expired.log",100)]:
                path=root/name; path.write_bytes(b"123456")
                os.utime(path,(time.time()-age,time.time()-age))
            history=root/"chat_history.json"; history.write_text("keep")
            prune_logs([root/"new.log",root/"old.log",root/"expired.log"],max_bytes=10,max_age=50)
            self.assertTrue((root/"new.log").exists())
            self.assertFalse((root/"old.log").exists())
            self.assertFalse((root/"expired.log").exists())
            self.assertEqual(history.read_text(),"keep")

if __name__=="__main__": unittest.main()
