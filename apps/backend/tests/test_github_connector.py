"""Tests for GitHub connector — local repo file walker."""
import os
from packages.shared_types.src.models import EntityType

class TestGitHubConnector:
    def _make_repo(self, tmp_path):
        """Create a fake robotics repo structure."""
        ros_pkg = tmp_path / "src" / "motor_control"
        ros_pkg.mkdir(parents=True)
        (ros_pkg / "package.xml").write_text('<package format="3"><name>motor_control</name></package>')
        (ros_pkg / "CMakeLists.txt").write_text("cmake_minimum_required(VERSION 3.5)")

        scripts = ros_pkg / "scripts"
        scripts.mkdir()
        (scripts / "motor_controller.py").write_text("#!/usr/bin/env python3\nimport rclpy")

        config = ros_pkg / "config"
        config.mkdir()
        (config / "motor_params.yaml").write_text("motor:\n  max_speed: 100")

        urdf_dir = tmp_path / "description"
        urdf_dir.mkdir()
        (urdf_dir / "robot.urdf").write_text('<robot name="testbot"></robot>')

        launch_dir = ros_pkg / "launch"
        launch_dir.mkdir()
        (launch_dir / "motor.launch.py").write_text("from launch import LaunchDescription")

        cad_dir = tmp_path / "cad"
        cad_dir.mkdir()
        (cad_dir / "chassis.step").write_text("ISO-10303-21;")
        (cad_dir / "wheel.stl").write_bytes(b"solid wheel\nendsolid")

        (tmp_path / "README.md").write_text("# My Robot")
        (tmp_path / ".gitignore").write_text("*.pyc")
        return tmp_path

    def test_walk_finds_ros_package(self, tmp_path):
        from apps.backend.src.connectors.github_connector import GitHubConnector
        repo = self._make_repo(tmp_path)
        result = GitHubConnector.walk_repo(str(repo))
        names = {e["name"] for e in result["entities"]}
        assert "motor_control" in names

    def test_walk_finds_python_files(self, tmp_path):
        from apps.backend.src.connectors.github_connector import GitHubConnector
        repo = self._make_repo(tmp_path)
        result = GitHubConnector.walk_repo(str(repo))
        names = {e["name"] for e in result["entities"]}
        assert "motor_controller.py" in names

    def test_walk_finds_urdf(self, tmp_path):
        from apps.backend.src.connectors.github_connector import GitHubConnector
        repo = self._make_repo(tmp_path)
        result = GitHubConnector.walk_repo(str(repo))
        names = {e["name"] for e in result["entities"]}
        assert "robot.urdf" in names

    def test_walk_finds_cad_files(self, tmp_path):
        from apps.backend.src.connectors.github_connector import GitHubConnector
        repo = self._make_repo(tmp_path)
        result = GitHubConnector.walk_repo(str(repo))
        names = {e["name"] for e in result["entities"]}
        assert "chassis.step" in names
        assert "wheel.stl" in names

    def test_walk_classifies_entity_types(self, tmp_path):
        from apps.backend.src.connectors.github_connector import GitHubConnector
        repo = self._make_repo(tmp_path)
        result = GitHubConnector.walk_repo(str(repo))
        by_name = {e["name"]: e for e in result["entities"]}
        assert by_name["motor_controller.py"]["entity_type"] == EntityType.SOFTWARE_MODULE
        assert by_name["chassis.step"]["entity_type"] == EntityType.MECHANICAL_PART
        assert by_name["robot.urdf"]["entity_type"] == EntityType.DOCUMENT

    def test_sync_returns_snapshot_dict(self, tmp_path):
        from apps.backend.src.connectors.github_connector import GitHubConnector
        repo = self._make_repo(tmp_path)
        snapshot = GitHubConnector.sync(str(repo))
        assert "motor_controller.py" in snapshot
        assert snapshot["motor_controller.py"]["type"] == "software_module"

    def test_walk_finds_config_files(self, tmp_path):
        from apps.backend.src.connectors.github_connector import GitHubConnector
        repo = self._make_repo(tmp_path)
        result = GitHubConnector.walk_repo(str(repo))
        names = {e["name"] for e in result["entities"]}
        assert "motor_params.yaml" in names
