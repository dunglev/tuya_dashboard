import os
import json
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from tuya_service import fetch_devices, send_device_command, add_device_timer
import threading

app = Flask(__name__)
app.secret_key = "tuya_secret_key_change_this"
app.config['TEMPLATES_AUTO_RELOAD'] = True
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0

USERS_FILE = "users.json"

def load_users():
    if not os.path.exists(USERS_FILE):
        default_data = {"admin": {"password": "1", "credentials": []}}
        save_users(default_data)
        return default_data
    with open(USERS_FILE, "r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return {}

def save_users(users_data):
    with open(USERS_FILE, "w", encoding="utf-8") as f:
        json.dump(users_data, f, ensure_ascii=False, indent=4)

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        data = request.json
        username = data.get("username")
        password = data.get("password")
        
        users = load_users()
        if username in users and users[username]["password"] == password:
            session['logged_in'] = True
            session['username'] = username
            return jsonify({"success": True, "message": "Đăng nhập thành công!"})
        return jsonify({"success": False, "message": "Sai tài khoản hoặc mật khẩu!"})
    return render_template('login.html')

@app.route('/api/change-password', methods=['POST'])
def change_password():
    if not session.get('logged_in'):
        return jsonify({"success": False, "message": "Chưa đăng nhập"}), 401
        
    data = request.json
    old_pass = data.get("old_password")
    new_pass = data.get("new_password")
    username = session.get('username')
    
    users = load_users()
    if username in users:
        if users[username]["password"] != old_pass:
            return jsonify({"success": False, "message": "Mật khẩu cũ không chính xác!"})
        
        users[username]["password"] = new_pass
        save_users(users)
        return jsonify({"success": True, "message": "Đổi mật khẩu thành công!"})
    return jsonify({"success": False, "message": "Người dùng không tồn tại!"})

# --- WebAuthn / Face ID API Endpoints ---
@app.route('/logout')
def logout():
    session.pop('logged_in', None)
    session.pop('username', None)
    return redirect(url_for('login'))

@app.route('/')
def index():
    if not session.get('logged_in'):
        return redirect(url_for('login'))
    return render_template('index.html')

@app.route('/api/devices', methods=['GET'])
def get_devices():
    if not session.get('logged_in'):
        return jsonify({"success": False, "message": "Chưa đăng nhập"}), 401
    return jsonify({"success": True, "devices": fetch_devices()})

@app.route('/api/control', methods=['POST'])
def control_device():
    if not session.get('logged_in'):
        return jsonify({"success": False, "message": "Chưa đăng nhập"}), 401
        
    data = request.json
    response = send_device_command(data.get("device_id"), data.get("code", "switch_1"), data.get("value"))
    if response.get("success"):
        return jsonify({"success": True, "message": "Điều khiển thành công!"})
    return jsonify({"success": False, "message": response.get("msg", "Lỗi điều khiển")})

@app.route('/api/timer', methods=['POST'])
def set_timer():
    if not session.get('logged_in'):
        return jsonify({"success": False, "message": "Chưa đăng nhập"}), 401
        
    data = request.json
    device_id = data.get("device_id")
    time_str = data.get("time")
    action = data.get("action")
    loops = data.get("loops", "0000000")
    code = data.get("code", "switch_1")

    response = add_device_timer(device_id, loops, time_str, code, action)
    if response.get("success"):
        return jsonify({"success": True, "message": "Hẹn giờ thành công!"})
    return jsonify({"success": False, "message": response.get("msg", "Lỗi cài đặt hẹn giờ")})

countdown_timers = {}

def server_auto_turn_off(device_id, switch_code, countdown_code):
    try:
        send_device_command(device_id, switch_code, False)
        send_device_command(device_id, countdown_code, 0)
    except Exception as e:
        print(f"[AUTO-SHUTDOWN ERROR]: {e}")

@app.route('/api/countdown', methods=['POST'])
def set_countdown():
    if not session.get('logged_in'):
        return jsonify({"success": False, "message": "Chưa đăng nhập"}), 401
        
    data = request.json
    device_id = data.get("device_id")
    hours = int(data.get("hours", 0))
    minutes = int(data.get("minutes", 0))
    countdown_code = data.get("code", "countdown_1")
    switch_code = data.get("switch_code", "switch_1")
    auto_turn_on = data.get("auto_turn_on", False)
    
    total_seconds = (hours * 3600) + (minutes * 60)

    if auto_turn_on and total_seconds > 0:
        send_device_command(device_id, switch_code, True)

    if device_id in countdown_timers:
        try:
            countdown_timers[device_id].cancel()
        except Exception:
            pass
        del countdown_timers[device_id]

    response = send_device_command(device_id, countdown_code, total_seconds)
    
    if response.get("success"):
        if total_seconds > 0:
            timer = threading.Timer(total_seconds, server_auto_turn_off, args=[device_id, switch_code, countdown_code])
            timer.daemon = True
            timer.start()
            countdown_timers[device_id] = timer

            return jsonify({
                "success": True, 
                "message": f"Đã hẹn tự động tắt sau {hours} giờ {minutes} phút!",
                "total_seconds": total_seconds
            })
        else:
            return jsonify({"success": True, "message": "Đã hủy chế độ đếm ngược tắt!"})
    else:
        return jsonify({"success": False, "message": response.get("msg", "Lỗi cài đặt đếm ngược")})
# Cập nhật cấu trúc mẫu trong load_users nếu chưa có:
def load_users():
    if not os.path.exists(USERS_FILE):
        default_data = {"admin": {"password": "1", "biometric_enabled": False}}
        save_users(default_data)
        return default_data
    with open(USERS_FILE, "r", encoding="utf-8") as f:
        try:
            data = json.load(f)
            # Đảm bảo có key biometric_enabled cho mọi user
            for u in data:
                if "biometric_enabled" not in data[u]:
                    data[u]["biometric_enabled"] = False
            return data
        except json.JSONDecodeError:
            return {}

# --- BỔ SUNG API CÀI ĐẶT ---
@app.route('/api/settings', methods=['GET'])
def get_settings():
    if not session.get('logged_in'):
        return jsonify({"success": False, "message": "Chưa đăng nhập"}), 401
    username = session.get('username')
    users = load_users()
    user_data = users.get(username, {})
    return jsonify({
        "success": True,
        "biometric_enabled": user_data.get("biometric_enabled", False)
    })

@app.route('/api/settings/biometric', methods=['POST'])
def update_biometric_setting():
    if not session.get('logged_in'):
        return jsonify({"success": False, "message": "Chưa đăng nhập"}), 401
    data = request.json
    enabled = data.get("enabled", False)
    username = session.get('username')
    
    users = load_users()
    if username in users:
        users[username]["biometric_enabled"] = enabled
        save_users(users)
        return jsonify({"success": True, "message": "Cập nhật cài đặt sinh trắc học thành công!"})
    return jsonify({"success": False, "message": "Người dùng không tồn tại!"})

# Cập nhật API đăng nhập sinh trắc học kiểm tra quyền:
@app.route('/api/biometric/login', methods=['POST'])
def biometric_login():
    data = request.json
    username = data.get("username", "admin")
    users = load_users()
    if username in users and users[username].get("biometric_enabled", False):
        session['logged_in'] = True
        session['username'] = username
        return jsonify({"success": True, "message": "Xác thực sinh trắc học thành công!"})
    return jsonify({"success": False, "message": "Tính năng đăng nhập bằng Face ID/Vân tay chưa được bật cho tài khoản này!"})
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)