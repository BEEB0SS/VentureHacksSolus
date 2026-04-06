"""
ArduinoFlasher — compile and upload Arduino sketches via arduino-cli.
Prerequisites: arduino-cli must be installed and on PATH.
"""

from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
from pathlib import Path


class ArduinoFlasher:
    def __init__(self):
        self.arduino_cli = shutil.which("arduino-cli")
        self.sketches_dir = Path.home() / ".solus" / "sketches"
        self.sketches_dir.mkdir(parents=True, exist_ok=True)

    def is_available(self) -> bool:
        return self.arduino_cli is not None

    def list_boards(self) -> list[dict]:
        """Run 'arduino-cli board list --format json' and return connected boards."""
        if not self.arduino_cli:
            return []
        try:
            result = subprocess.run(
                [self.arduino_cli, "board", "list", "--format", "json"],
                capture_output=True, text=True, timeout=10,
            )
            return json.loads(result.stdout) if result.stdout.strip() else []
        except Exception:
            return []

    def save_sketch(self, name: str, code: str) -> Path:
        """Save sketch code to ~/.solus/sketches/{name}/{name}.ino"""
        sketch_dir = self.sketches_dir / name
        sketch_dir.mkdir(exist_ok=True)
        sketch_file = sketch_dir / f"{name}.ino"
        sketch_file.write_text(code)
        return sketch_file

    async def compile_and_upload(
        self,
        name: str,
        code: str,
        port: str,
        fqbn: str = "arduino:avr:uno",
    ) -> dict:
        """
        Compile and flash a sketch to the connected board.
        fqbn = Fully Qualified Board Name (arduino:avr:uno for Elegoo V4's Uno).
        Returns: {"success": bool, "stage": str, "output": str, "errors": str}
        """
        if not self.arduino_cli:
            return {"success": False, "stage": "check", "output": "", "errors": "arduino-cli not found on PATH"}

        sketch_path = self.save_sketch(name, code)
        sketch_dir = str(sketch_path.parent)

        # Compile
        compile_cmd = [self.arduino_cli, "compile", "--fqbn", fqbn, sketch_dir]
        compile_result = await asyncio.create_subprocess_exec(
            *compile_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        compile_stdout, compile_stderr = await compile_result.communicate()

        if compile_result.returncode != 0:
            return {
                "success": False,
                "stage": "compile",
                "output": compile_stdout.decode(),
                "errors": compile_stderr.decode(),
            }

        # Upload
        upload_cmd = [self.arduino_cli, "upload", "--fqbn", fqbn, "-p", port, sketch_dir]
        upload_result = await asyncio.create_subprocess_exec(
            *upload_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        upload_stdout, upload_stderr = await upload_result.communicate()

        return {
            "success": upload_result.returncode == 0,
            "stage": "upload",
            "output": upload_stdout.decode(),
            "errors": upload_stderr.decode(),
        }

    def get_saved_sketches(self) -> list[dict]:
        """List all saved sketches."""
        sketches = []
        for d in self.sketches_dir.iterdir():
            if d.is_dir():
                ino = d / f"{d.name}.ino"
                if ino.exists():
                    sketches.append({
                        "name": d.name,
                        "path": str(ino),
                        "code": ino.read_text(),
                        "modified": ino.stat().st_mtime,
                    })
        return sketches
