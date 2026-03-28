"""Fixture: a ROS2 motor controller node with discoverable patterns."""
import rclpy
from rclpy.node import Node
from geometry_msgs.msg import Twist

# Hardware constants — discoverable by AST analyzer
DRV8825_STEP_PIN = 17
DRV8825_DIR_PIN = 27
MICROSTEPPING = 16

class MotorController(Node):
    def __init__(self):
        super().__init__('motor_controller')
        # ROS topic subscription — discoverable
        self.subscription = self.create_subscription(
            Twist, '/cmd_vel', self.cmd_callback, 10)
        # ROS topic publisher — discoverable
        self.odom_pub = self.create_publisher(
            Twist, '/odom', 10)

    def cmd_callback(self, msg):
        pass
