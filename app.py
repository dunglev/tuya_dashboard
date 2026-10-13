from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from tuya_service import fetch_devices, send_device_command, add_device_timer

app = Flask(__name__)
app.secret_key = "tuya_secret_key_change_this"
app.config['TEMPLATES_AUTO_RELOAD'] = True
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0

ADMIN_USER = "admin"
ADMIN_PASS = "1"

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        data = request.json
        if data.get("username") == ADMIN_USER and data.get("password") == ADMIN_PASS:
            session['logged_in'] = True
            return jsonify({"success": True, "message": "Đăng nhập thành công!"})
        return jsonify({"success": False, "message": "Sai tài khoản hoặc mật khẩu!"})
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.pop('logged_in', None)
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

# --- BỔ SUNG ROUTE API HẸN GIỜ ---
@app.route('/api/timer', methods=['POST'])
def set_timer():
    if not session.get('logged_in'):
        return jsonify({"success": False, "message": "Chưa đăng nhập"}), 401
        
    data = request.json
    device_id = data.get("device_id")
    time_str = data.get("time")         # Định dạng "HH:MM"
    action = data.get("action")         # True (Bật) hoặc False (Tắt)
    loops = data.get("loops", "0000000")# Lặp lại trong tuần
    code = data.get("code", "switch_1")

    response = add_device_timer(device_id, loops, time_str, code, action)
    if response.get("success"):
        return jsonify({"success": True, "message": "Hẹn giờ thành công!"})
    return jsonify({"success": False, "message": response.get("msg", "Lỗi cài đặt hẹn giờ")})
    
import threading

# Quản lý các timer đếm ngược tự động tắt ở backend: { device_id: Timer }
countdown_timers = {}

def server_auto_turn_off(device_id, switch_code, countdown_code):
    try:
        print(f"[AUTO-SHUTDOWN] Hết thời gian đếm ngược cho thiết bị {device_id}!")
        # 1. Gửi lệnh TẮT thiết bị (switch = False)
        send_device_command(device_id, switch_code, False)
        # 2. Xóa countdown về 0 trên Tuya Cloud
        send_device_command(device_id, countdown_code, 0)
        print(f"[AUTO-SHUTDOWN] Đã gửi lệnh TẮT thành công cho thiết bị {device_id}!")
    except Exception as e:
        print(f"[AUTO-SHUTDOWN ERROR] Lỗi khi tự động tắt: {e}")

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
    
    # Quy đổi tổng số giờ và phút ra giây
    total_seconds = (hours * 3600) + (minutes * 60)

    # Nếu thiết bị đang tắt và người dùng chọn tự động bật để chạy đếm ngược tắt
    if auto_turn_on and total_seconds > 0:
        send_device_command(device_id, switch_code, True)

    # Hủy timer backend cũ nếu có
    if device_id in countdown_timers:
        try:
            countdown_timers[device_id].cancel()
        except Exception:
            pass
        del countdown_timers[device_id]

    # Gửi lệnh vào DP code countdown của thiết bị
    response = send_device_command(device_id, countdown_code, total_seconds)
    
    if response.get("success"):
        if total_seconds > 0:
            # Thiết lập bộ hẹn giờ bảo hiểm ở Backend: Đảm bảo thiết bị 100% được tắt khi hết giờ
            timer = threading.Timer(total_seconds, server_auto_turn_off, args=[device_id, switch_code, countdown_code])
            timer.daemon = True
            timer.start()
            countdown_timers[device_id] = timer

            return jsonify({
                "success": True, 
                "message": f"Đã hẹn tự động tắt sau {hours} giờ {minutes} phút!",
                "total_seconds": total_seconds,
                "code": countdown_code,
                "switch_code": switch_code
            })
        else:
            return jsonify({
                "success": True, 
                "message": "Đã hủy chế độ đếm ngược tắt!",
                "total_seconds": 0,
                "code": countdown_code
            })
    else:
        return jsonify({"success": False, "message": response.get("msg", "Lỗi cài đặt đếm ngược")})

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000)