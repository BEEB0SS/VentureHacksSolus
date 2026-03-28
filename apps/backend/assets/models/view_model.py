#!/usr/bin/env python3
"""Launch MuJoCo viewer for the robot car model."""
import sys
import os
import mujoco
import mujoco.viewer

model_path = os.path.join(os.path.dirname(__file__), "elegoo_car.xml")
if len(sys.argv) > 1:
    model_path = sys.argv[1]

m = mujoco.MjModel.from_xml_path(model_path)
d = mujoco.MjData(m)
mujoco.viewer.launch(m, d)
