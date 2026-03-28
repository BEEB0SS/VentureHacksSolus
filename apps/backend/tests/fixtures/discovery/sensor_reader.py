"""Fixture: a ROS2 sensor reader with I2C hardware references."""
import rclpy
from rclpy.node import Node

# Hardware I2C addresses — discoverable by AST analyzer
IMU_ADDRESS = 0x68      # MPU6050
TOF_ADDRESS = 0x29      # VL53L0X

class SensorReader(Node):
    def __init__(self):
        super().__init__('sensor_reader')
        self.imu_pub = self.create_publisher(None, '/imu/data', 10)
        self.scan_pub = self.create_publisher(None, '/scan', 10)

    def read_imu(self):
        # I2C bus read — address discoverable
        data = self.bus.read_byte_data(0x68, 0x3B)
        return data
