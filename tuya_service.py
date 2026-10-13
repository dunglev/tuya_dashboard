import os
from dotenv import load_dotenv
from tuya_connector import TuyaOpenAPI

load_dotenv()

ACCESS_ID = os.getenv("TUYA_ACCESS_ID")
ACCESS_SECRET = os.getenv("TUYA_ACCESS_SECRET")
API_ENDPOINT = os.getenv("TUYA_API_ENDPOINT", "https://openapi.tuyaus.com")
UID = os.getenv("TUYA_UID")

openapi = TuyaOpenAPI(API_ENDPOINT, ACCESS_ID, ACCESS_SECRET)
openapi.connect()

def fetch_devices():
    response = openapi.get(f"/v1.0/users/{UID}/devices")
    if response.get("success"):
        return response.get("result", [])
    return []

def send_device_command(device_id, code, value):
    command_body = {
        "commands": [
            {
                "code": code,
                "value": value
            }
        ]
    }
    response = openapi.post(f"/v1.0/devices/{device_id}/commands", command_body)
    return response

# --- BỔ SUNG HỆ THỐNG HẸN GIỜ (TIMER) ---
def add_device_timer(device_id, loops, time_str, code, value):
    """
    Tạo lịch hẹn giờ cho thiết bị Tuya
    - loops: Chuỗi lặp lại (Ví dụ: "1111110" là từ Thứ 2 đến Chủ Nhật, "0000000" chạy 1 lần)
    - time_str: Giờ hẹn định dạng "HH:MM" (Ví dụ: "06:30")
    - code: Mã DP cần thay đổi (Ví dụ: "switch_1")
    - value: Giá trị đổi sang (True/False)
    """
    # API tạo timer Cloud của Tuya
    url = f"/v1.0/device-timer/devices/{device_id}/timers"
    body = {
        "loops": loops,
        "time": time_str,
        "status": True,
        "instruct": [
            {
                "code": code,
                "value": value
            }
        ]
    }
    response = openapi.post(url, body)
    return response