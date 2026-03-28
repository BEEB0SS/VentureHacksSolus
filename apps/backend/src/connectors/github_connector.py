"""
GitHub Connector — Walk a local repo directory and classify robotics files.

Detects: ROS packages, Python/C++ source, URDF/Xacro, launch files,
config files (YAML/TOML/JSON), CAD files (.step, .stl), KiCad files.
Returns data in a format suitable for ContextEngine.create_snapshot().
"""

import os
from pathlib import Path
from typing import Optional
from packages.shared_types.src.models import EntityType

_EXT_MAP: dict[str, EntityType] = {
    ".py": EntityType.SOFTWARE_MODULE, ".cpp": EntityType.SOFTWARE_MODULE,
    ".c": EntityType.SOFTWARE_MODULE, ".h": EntityType.SOFTWARE_MODULE,
    ".hpp": EntityType.SOFTWARE_MODULE, ".rs": EntityType.SOFTWARE_MODULE,
    ".yaml": EntityType.DOCUMENT, ".yml": EntityType.DOCUMENT,
    ".toml": EntityType.DOCUMENT, ".json": EntityType.DOCUMENT,
    ".xml": EntityType.DOCUMENT, ".launch": EntityType.DOCUMENT,
    ".urdf": EntityType.DOCUMENT, ".xacro": EntityType.DOCUMENT,
    ".sdf": EntityType.DOCUMENT,
    ".step": EntityType.MECHANICAL_PART, ".stp": EntityType.MECHANICAL_PART,
    ".stl": EntityType.MECHANICAL_PART, ".obj": EntityType.MECHANICAL_PART,
    ".dae": EntityType.MECHANICAL_PART,
    ".kicad_sch": EntityType.ELECTRICAL_PART, ".kicad_pcb": EntityType.ELECTRICAL_PART,
}

_SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "build", "install", "log", ".cache"}
_SKIP_FILES = {".gitignore", ".gitmodules", "LICENSE", "Makefile"}


def _classify_file(path: Path) -> Optional[EntityType]:
    name = path.name
    if name.endswith(".launch.py"):
        return EntityType.DOCUMENT
    ext = path.suffix.lower()
    return _EXT_MAP.get(ext)


def _is_ros_package(dirpath: Path) -> bool:
    return (dirpath / "package.xml").exists()


class GitHubConnector:
    @staticmethod
    def walk_repo(repo_path: str) -> dict:
        root = Path(repo_path)
        entities = []
        ros_packages = []

        for dirpath, dirnames, filenames in os.walk(root):
            dp = Path(dirpath)
            dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS]

            if _is_ros_package(dp):
                pkg_name = dp.name
                ros_packages.append(pkg_name)
                entities.append({
                    "name": pkg_name,
                    "path": str(dp.relative_to(root)),
                    "entity_type": EntityType.SOFTWARE_MODULE,
                    "metadata": {"is_ros_package": True},
                })

            for fname in filenames:
                fpath = dp / fname
                if fname in _SKIP_FILES or fname.startswith("."):
                    continue
                entity_type = _classify_file(fpath)
                if entity_type is None:
                    continue
                rel_path = str(fpath.relative_to(root))
                entities.append({
                    "name": fname,
                    "path": rel_path,
                    "entity_type": entity_type,
                    "metadata": {"relative_path": rel_path, "size_bytes": fpath.stat().st_size},
                })

        return {"entities": entities, "ros_packages": ros_packages}

    @staticmethod
    def sync(repo_path: str) -> dict:
        result = GitHubConnector.walk_repo(repo_path)
        snapshot: dict = {}
        for entity in result["entities"]:
            name = entity["name"]
            etype = entity["entity_type"]
            snapshot[name] = {
                "type": etype.value if isinstance(etype, EntityType) else etype,
                "path": entity.get("path", ""),
                **entity.get("metadata", {}),
            }
        return snapshot
