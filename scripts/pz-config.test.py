#!/usr/bin/env python3

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("pz-config.py")
SPEC = importlib.util.spec_from_file_location("pz_config", MODULE_PATH)
assert SPEC and SPEC.loader
pz_config = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = pz_config
SPEC.loader.exec_module(pz_config)


INI = """# Players can hurt each other
PVP=true

# Players are allowed to sleep but do not need to sleep
SleepAllowed=false

# Players get tired and need to sleep
SleepNeeded=false

# Maximum players Min: 1 Max: 100 Default: 32
MaxPlayers=4

Password=secret
Mods=ExampleMod
DefaultPort=16261
"""

SANDBOX = """SandboxVars = {
    VERSION = 6,
    -- Day duration
    -- 1 = 15 Minutes
    -- 2 = 30 Minutes
    -- 3 = 1 Hour
    DayLength = 3,
    ZombieConfig = {
        -- Population multiplier Min = 0.00 Max = 4.00 Default = 1.00
        PopulationMultiplier = 1.0,
    },
    ExampleMod = {
        -- Enables the example mod behavior
        Enabled = true,
        Name = "Home",
    },
}
"""


class ConfigTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.ini = root / "servertest.ini"
        self.sandbox = root / "servertest_SandboxVars.lua"
        self.ini.write_text(INI)
        self.sandbox.write_text(SANDBOX)

    def tearDown(self):
        self.temp.cleanup()

    def test_discovers_native_and_mod_fields_and_redacts_secrets(self):
        result, _, _ = pz_config.snapshot(self.ini, self.sandbox)
        fields = {(field["source"], field["path"]): field for field in result["fields"]}
        self.assertRegex(result["revision"], r"^[0-9a-f]{64}$")
        self.assertEqual(fields[("server", "SleepAllowed")]["value"], False)
        self.assertEqual(fields[("sandbox", "ZombieConfig.PopulationMultiplier")]["maximum"], 4.0)
        self.assertEqual(fields[("sandbox", "ExampleMod.Enabled")]["category"], "mods")
        self.assertIsNone(fields[("server", "Password")]["value"])
        self.assertTrue(fields[("server", "Password")]["configured"])
        self.assertFalse(fields[("server", "Password")]["editable"])
        self.assertFalse(fields[("server", "Mods")]["editable"])

    def test_applies_typed_changes_with_backups_and_new_revision(self):
        before, _, _ = pz_config.snapshot(self.ini, self.sandbox)
        result = pz_config.apply_update(
            self.ini,
            self.sandbox,
            {
                "expectedRevision": before["revision"],
                "createBackup": True,
                "changes": [
                    {"source": "server", "path": "SleepAllowed", "value": True},
                    {"source": "sandbox", "path": "ZombieConfig.PopulationMultiplier", "value": 2.5},
                    {"source": "sandbox", "path": "ExampleMod.Name", "value": "Safe House"},
                ],
            },
        )
        self.assertTrue(result["requiresRestart"])
        self.assertNotEqual(result["revision"], before["revision"])
        self.assertEqual(len(result["backupPaths"]), 2)
        self.assertIn("SleepAllowed=true", self.ini.read_text())
        sandbox = self.sandbox.read_text()
        self.assertIn("PopulationMultiplier = 2.5,", sandbox)
        self.assertIn('Name = "Safe House",', sandbox)
        for backup in result["backupPaths"]:
            self.assertTrue(Path(backup).exists())

    def test_rejects_stale_revision(self):
        before, _, _ = pz_config.snapshot(self.ini, self.sandbox)
        self.ini.write_text(self.ini.read_text() + "Public=true\n")
        with self.assertRaises(pz_config.StaleRevisionError):
            pz_config.apply_update(
                self.ini,
                self.sandbox,
                {
                    "expectedRevision": before["revision"],
                    "changes": [{"source": "server", "path": "SleepAllowed", "value": True}],
                },
            )

    def test_rejects_protected_and_out_of_range_changes(self):
        before, _, _ = pz_config.snapshot(self.ini, self.sandbox)
        with self.assertRaisesRegex(pz_config.ConfigError, "protected"):
            pz_config.apply_update(
                self.ini,
                self.sandbox,
                {
                    "expectedRevision": before["revision"],
                    "changes": [{"source": "server", "path": "DefaultPort", "value": 17261}],
                },
            )
        with self.assertRaisesRegex(pz_config.ConfigError, "at most 100"):
            pz_config.apply_update(
                self.ini,
                self.sandbox,
                {
                    "expectedRevision": before["revision"],
                    "changes": [{"source": "server", "path": "MaxPlayers", "value": 101}],
                },
            )

    def test_noop_does_not_create_backups(self):
        before, _, _ = pz_config.snapshot(self.ini, self.sandbox)
        result = pz_config.apply_update(
            self.ini,
            self.sandbox,
            {
                "expectedRevision": before["revision"],
                "changes": [{"source": "server", "path": "SleepAllowed", "value": False}],
            },
        )
        self.assertEqual(result["changed"], [])
        self.assertEqual(result["backupPaths"], [])
        self.assertFalse(result["requiresRestart"])


if __name__ == "__main__":
    unittest.main()
