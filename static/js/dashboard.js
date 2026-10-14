let activeCountdowns = {};
const STORAGE_KEY = 'tuya_dashboard_countdowns';
let completedCountdowns = {};
let localSwitchStates = {};

function loadSavedCountdowns() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        const now = Date.now();
        for (let devId in saved) {
            if (saved[devId] && saved[devId].targetEndTime && saved[devId].targetEndTime > now) {
                activeCountdowns[devId] = saved[devId];
            }
        }
    } catch (e) {
        console.error("Lỗi đọc storage countdown:", e);
    }
}

function saveCountdownsToStorage() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(activeCountdowns));
    } catch (e) { }
}

loadSavedCountdowns();

function getRemainingSeconds(devId) {
    const item = activeCountdowns[devId];
    if (!item || !item.targetEndTime) return 0;
    const diff = Math.round((item.targetEndTime - Date.now()) / 1000);
    return diff > 0 ? diff : 0;
}

function showToast(message, type = 'info', duration = 3000) {
    const toast = document.getElementById('toast');
    toast.innerText = message;
    toast.className = type;
    toast.style.display = 'block';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
        toast.style.display = 'none';
    }, duration);
}

function formatTimeLeft(seconds) {
    if (seconds <= 0) return 'Hết giờ';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    let str = '';
    if (hrs > 0) str += hrs + ' giờ ';
    if (mins > 0 || hrs > 0) str += mins + ' phút ';
    str += secs + ' giây';
    return str;
}

function saveCurrentInputValues() {
    const values = {};
    document.querySelectorAll('input, select').forEach(el => {
        if (el.id) { values[el.id] = el.value; }
    });
    return values;
}

function restoreInputValues(savedValues) {
    for (let id in savedValues) {
        const el = document.getElementById(id);
        if (el) { el.value = savedValues[id]; }
    }
}

async function fetchDevices() {
    try {
        const res = await fetch('/api/devices');
        if (res.status === 401) { window.location.href = '/login'; return; }
        const data = await res.json();

        const container = document.getElementById('device-list');
        if (!data.success || !data.devices || data.devices.length === 0) {
            container.innerHTML = '<p style="text-align:center; padding: 20px; color: #777;">Không tìm thấy thiết bị nào trong tài khoản Tuya.</p>';
            return;
        }

        const savedInputs = saveCurrentInputValues();
        let html = '';
        const now = Date.now();
        let storageNeedSave = false;

        data.devices.forEach(dev => {
            const isOnline = !!dev.online;
            const statusText = isOnline ? '<span class="status-online">Online 🟢</span>' : '<span class="status-offline">Offline 🔴</span>';

            let switchStatus = false;
            let switchCode = 'switch_1';
            let countdownCode = 'countdown_1';
            let serverCountdown = 0;

            if (dev.status && Array.isArray(dev.status)) {
                const mainSwitch = dev.status.find(st =>
                    typeof st.value === 'boolean' && (st.code === 'switch' || /^switch_\d+$/.test(st.code))
                ) || dev.status.find(st =>
                    typeof st.value === 'boolean' && st.code && st.code.startsWith('switch')
                );

                if (mainSwitch) {
                    switchCode = mainSwitch.code;
                    switchStatus = mainSwitch.value;
                }

                const cdStatus = dev.status.find(st =>
                    st.code && st.code.startsWith('countdown') && typeof st.value === 'number'
                );
                if (cdStatus) {
                    countdownCode = cdStatus.code;
                    if (cdStatus.value > 0) { serverCountdown = cdStatus.value; }
                }
            }

            const localSw = localSwitchStates[dev.id];
            if (localSw && (now - localSw.timestamp < 6000)) {
                switchStatus = localSw.status;
                if (localSw.code) switchCode = localSw.code;
            } else if (localSw) {
                delete localSwitchStates[dev.id];
            }

            const justFinishedAt = completedCountdowns[dev.id];
            const isRecentlyFinished = justFinishedAt && (now - justFinishedAt < 45000);
            if (isRecentlyFinished) { serverCountdown = 0; }

            const clientRemaining = getRemainingSeconds(dev.id);

            if (serverCountdown > 0) {
                if (!activeCountdowns[dev.id] || clientRemaining <= 0) {
                    if (!isRecentlyFinished) {
                        activeCountdowns[dev.id] = {
                            targetEndTime: now + (serverCountdown * 1000),
                            total: serverCountdown,
                            code: countdownCode,
                            switchCode: switchCode,
                            deviceName: dev.name,
                            lastSetAt: now
                        };
                        storageNeedSave = true;
                    }
                } else {
                    activeCountdowns[dev.id].switchCode = switchCode;
                    activeCountdowns[dev.id].deviceName = dev.name;
                    if (serverCountdown > activeCountdowns[dev.id].total + 10) {
                        activeCountdowns[dev.id].total = serverCountdown;
                        activeCountdowns[dev.id].targetEndTime = now + (serverCountdown * 1000);
                        activeCountdowns[dev.id].lastSetAt = now;
                        storageNeedSave = true;
                    } else if (serverCountdown < clientRemaining - 30) {
                        activeCountdowns[dev.id].targetEndTime = now + (serverCountdown * 1000);
                        storageNeedSave = true;
                    }
                }
            } else {
                if (activeCountdowns[dev.id]) {
                    const timeSinceSet = now - (activeCountdowns[dev.id].lastSetAt || 0);
                    if (timeSinceSet > 8000) {
                        delete activeCountdowns[dev.id];
                        storageNeedSave = true;
                    }
                }
            }

            const remaining = getRemainingSeconds(dev.id);
            const hasCountdown = remaining > 0;
            const totalSecs = activeCountdowns[dev.id]?.total || remaining || 1;
            const percent = hasCountdown ? Math.max(0, Math.min(100, Math.round((remaining / totalSecs) * 100))) : 0;
            const timeLeftFormatted = hasCountdown ? formatTimeLeft(remaining) : '';

            html += `
            <div class="device-card" id="card-${dev.id}">
                <div class="device-row">
                    <div class="device-info">
                        <h3>${dev.name}</h3>
                        <p>Mã: <code>${dev.id}</code> | Loại: ${dev.category} | Trạng thái: ${statusText}</p>
                    </div>
                    <div>
                        <button class="btn ${switchStatus ? 'btn-off' : 'btn-on'}" 
                                id="btn-toggle-${dev.id}"
                                ${!isOnline ? 'disabled title="Thiết bị đang Offline"' : ''}
                                onclick="toggleDevice('${dev.id}', '${switchCode}', ${!switchStatus})">
                            ${switchStatus ? 'Tắt ⏻' : 'Bật ⏻'}
                        </button>
                    </div>
                </div>

                <div id="countdown-box-${dev.id}" class="countdown-active-box" style="display: ${hasCountdown ? 'block' : 'none'};">
                    <div class="countdown-header">
                        <span class="countdown-title">
                            ⏳ Đang đếm ngược tự tắt:
                            <span id="countdown-text-${dev.id}" class="countdown-time-badge">${timeLeftFormatted}</span>
                        </span>
                        <button class="btn btn-cancel" onclick="cancelCountdown('${dev.id}', '${countdownCode}')" title="Hủy đếm ngược">
                            Hủy Đếm Ngược ❌
                        </button>
                    </div>
                    <div class="progress-container">
                        <div id="p-bar-${dev.id}" class="progress-bar" style="width: ${percent}%;"></div>
                        <div id="p-text-${dev.id}" class="progress-text">${percent}%</div>
                    </div>
                </div>
                
                <div class="timer-box">
                    <span>⏱️ <strong>Lịch Hẹn:</strong></span>
                    <input type="time" id="time-${dev.id}" value="06:00">
                    <select id="action-${dev.id}">
                        <option value="true">Bật điện</option>
                        <option value="false">Tắt điện</option>
                    </select>
                    <button class="btn btn-timer" ${!isOnline ? 'disabled' : ''} onclick="setTimer('${dev.id}', '${switchCode}')">
                        Lưu Lịch Hẹn
                    </button>
                </div>
                
                <div class="timer-box" style="margin-top: 6px; border-top: 1px dashed #e2e8f0; padding-top: 8px;">
                    <span>⏳ <strong>Tự tắt sau:</strong></span>
                    <input type="number" id="cd-hours-${dev.id}" min="0" max="23" value="0" style="width: 55px; text-align: center;" placeholder="Giờ"> giờ
                    <input type="number" id="cd-minutes-${dev.id}" min="0" max="59" value="30" style="width: 55px; text-align: center;" placeholder="Phút"> phút
                    <button class="btn btn-countdown" ${!isOnline ? 'disabled' : ''} onclick="setCountdown('${dev.id}', '${countdownCode}', '${switchCode}', ${switchStatus}, '${dev.name}')">
                        Kích Hoạt Đếm Ngược
                    </button>
                </div>
            </div>
            `;
        });

        if (storageNeedSave) { saveCountdownsToStorage(); }
        container.innerHTML = html;
        restoreInputValues(savedInputs);

    } catch (err) {
        console.error("Lỗi khi tải thiết bị:", err);
    }
}

setInterval(() => {
    const now = Date.now();
    let storageNeedSave = false;

    for (let devId in activeCountdowns) {
        const item = activeCountdowns[devId];
        if (!item || !item.targetEndTime) continue;

        const remaining = Math.max(0, Math.round((item.targetEndTime - now) / 1000));
        const box = document.getElementById(`countdown-box-${devId}`);
        const bar = document.getElementById(`p-bar-${devId}`);
        const pText = document.getElementById(`p-text-${devId}`);
        const timeText = document.getElementById(`countdown-text-${devId}`);

        if (remaining > 0) {
            const percent = Math.max(0, Math.min(100, Math.round((remaining / item.total) * 100)));
            if (box && bar && pText && timeText) {
                box.style.display = 'block';
                bar.style.width = percent + '%';
                pText.innerText = percent + '%';
                timeText.innerText = formatTimeLeft(remaining);
            }
        } else {
            const switchCodeToTurnOff = item.switchCode || 'switch_1';
            const cdCode = item.code || 'countdown_1';
            const devName = item.deviceName || devId;

            completedCountdowns[devId] = now;
            delete activeCountdowns[devId];
            storageNeedSave = true;

            if (box) box.style.display = 'none';

            localSwitchStates[devId] = { status: false, code: switchCodeToTurnOff, timestamp: now };
            const btn = document.getElementById(`btn-toggle-${devId}`);
            if (btn) {
                btn.className = 'btn btn-on';
                btn.innerHTML = 'Bật ⏻';
                btn.setAttribute('onclick', `toggleDevice('${devId}', '${switchCodeToTurnOff}', true)`);
            }

            showToast(`🔔 Thiết bị "${devName}" đã đếm ngược xong và tự động TẮT!`, 'success', 4000);

            fetch('/api/control', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ device_id: devId, code: switchCodeToTurnOff, value: false })
            }).catch(console.error);

            fetch('/api/countdown', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ device_id: devId, hours: 0, minutes: 0, code: cdCode })
            }).catch(console.error);

            setTimeout(fetchDevices, 3000);
        }
    }
    if (storageNeedSave) { saveCountdownsToStorage(); }
}, 1000);

async function toggleDevice(deviceId, code, targetState) {
    const btn = document.getElementById(`btn-toggle-${deviceId}`);
    const originalClass = btn ? btn.className : '';
    const originalHtml = btn ? btn.innerHTML : '';
    const originalOnClick = btn ? btn.getAttribute('onclick') : '';

    localSwitchStates[deviceId] = { status: targetState, code: code, timestamp: Date.now() };

    if (btn) {
        btn.className = `btn ${targetState ? 'btn-off' : 'btn-on'}`;
        btn.innerHTML = `${targetState ? 'Tắt ⏻' : 'Bật ⏻'} <span style="font-size:11px; opacity:0.8;">⏳</span>`;
        btn.setAttribute('onclick', `toggleDevice('${deviceId}', '${code}', ${!targetState})`);
    }

    showToast(`Đang ${targetState ? 'bật' : 'tắt'} thiết bị...`, 'info', 1200);

    try {
        const res = await fetch('/api/control', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: deviceId, code: code, value: targetState })
        });
        const result = await res.json();

        if (result.success) {
            showToast(result.message || 'Thành công!', 'success', 2000);
            if (btn) {
                btn.className = `btn ${targetState ? 'btn-off' : 'btn-on'}`;
                btn.innerHTML = targetState ? 'Tắt ⏻' : 'Bật ⏻';
            }
            setTimeout(fetchDevices, 2500);
        } else {
            delete localSwitchStates[deviceId];
            if (btn) { btn.className = originalClass; btn.innerHTML = originalHtml; btn.setAttribute('onclick', originalOnClick); }
            showToast('Thất bại: ' + (result.message || 'Lỗi điều khiển'), 'error', 3500);
        }
    } catch (err) {
        delete localSwitchStates[deviceId];
        if (btn) { btn.className = originalClass; btn.innerHTML = originalHtml; btn.setAttribute('onclick', originalOnClick); }
        showToast('Lỗi mạng khi điều khiển!', 'error', 3500);
    }
}

async function setTimer(deviceId, code) {
    const timeVal = document.getElementById(`time-${deviceId}`)?.value;
    const actionVal = document.getElementById(`action-${deviceId}`)?.value === 'true';

    if (!timeVal) { showToast('Vui lòng chọn thời gian!', 'error'); return; }

    showToast('Đang cài đặt lịch hẹn...', 'info', 1500);
    try {
        const res = await fetch('/api/timer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: deviceId, code: code, time: timeVal, action: actionVal, loops: "0000000" })
        });
        const result = await res.json();
        if (result.success) {
            showToast('Đã thiết lập lịch hẹn giờ thành công lúc ' + timeVal, 'success');
        } else {
            showToast('Lỗi hẹn giờ: ' + result.message, 'error');
        }
    } catch (err) {
        showToast('Lỗi kết nối khi hẹn giờ!', 'error');
    }
}

async function setCountdown(deviceId, countdownCode = 'countdown_1', switchCode = 'switch_1', currentSwitchStatus = false, devName = '') {
    const hoursVal = document.getElementById(`cd-hours-${deviceId}`)?.value || 0;
    const minutesVal = document.getElementById(`cd-minutes-${deviceId}`)?.value || 0;

    const hours = parseInt(hoursVal) || 0;
    const minutes = parseInt(minutesVal) || 0;
    const totalSecs = (hours * 3600) + (minutes * 60);

    if (totalSecs <= 0) {
        if (!confirm('Đặt thời gian là 0 sẽ hủy chế độ đếm ngược. Bạn có muốn hủy?')) { return; }
    }

    delete completedCountdowns[deviceId];
    const willAutoTurnOn = !currentSwitchStatus && totalSecs > 0;

    if (willAutoTurnOn) {
        localSwitchStates[deviceId] = { status: true, code: switchCode, timestamp: Date.now() };
        const btn = document.getElementById(`btn-toggle-${deviceId}`);
        if (btn) {
            btn.className = 'btn btn-off';
            btn.innerHTML = 'Tắt ⏻';
            btn.setAttribute('onclick', `toggleDevice('${deviceId}', '${switchCode}', false)`);
        }
    }

    showToast(willAutoTurnOn ? 'Đang bật thiết bị và hẹn tự tắt...' : 'Đang gửi lệnh đếm ngược tắt...', 'info', 1500);

    try {
        const res = await fetch('/api/countdown', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: deviceId, hours: hours, minutes: minutes, code: countdownCode, switch_code: switchCode, auto_turn_on: willAutoTurnOn })
        });

        const result = await res.json();
        if (result.success) {
            if (totalSecs > 0) {
                const now = Date.now();
                activeCountdowns[deviceId] = {
                    targetEndTime: now + (totalSecs * 1000),
                    total: totalSecs,
                    code: countdownCode,
                    switchCode: switchCode,
                    deviceName: devName,
                    lastSetAt: now
                };
                saveCountdownsToStorage();

                const box = document.getElementById(`countdown-box-${deviceId}`);
                const bar = document.getElementById(`p-bar-${deviceId}`);
                const pText = document.getElementById(`p-text-${deviceId}`);
                const timeText = document.getElementById(`countdown-text-${deviceId}`);

                if (box) box.style.display = 'block';
                if (bar) bar.style.width = '100%';
                if (pText) pText.innerText = '100%';
                if (timeText) timeText.innerText = formatTimeLeft(totalSecs);

                showToast(result.message, 'success');
            } else {
                delete activeCountdowns[deviceId];
                saveCountdownsToStorage();
                const box = document.getElementById(`countdown-box-${deviceId}`);
                if (box) box.style.display = 'none';
                showToast('Đã hủy đếm ngược!', 'success');
            }
        } else {
            showToast('Thất bại: ' + result.message, 'error');
        }
    } catch (err) {
        showToast('Lỗi kết nối khi đặt đếm ngược!', 'error');
    }
}

async function cancelCountdown(deviceId, countdownCode = 'countdown_1') {
    if (!confirm('Bạn có chắc chắn muốn hủy đếm ngược cho thiết bị này?')) return;

    showToast('Đang hủy đếm ngược...', 'info', 1500);
    try {
        const res = await fetch('/api/countdown', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: deviceId, hours: 0, minutes: 0, code: countdownCode })
        });
        const result = await res.json();
        if (result.success) {
            delete activeCountdowns[deviceId];
            saveCountdownsToStorage();
            const box = document.getElementById(`countdown-box-${deviceId}`);
            if (box) box.style.display = 'none';
            showToast('Đã hủy đếm ngược thành công!', 'success');
        } else {
            showToast('Lỗi hủy đếm ngược: ' + result.message, 'error');
        }
    } catch (err) {
        showToast('Lỗi kết nối khi hủy đếm ngược!', 'error');
    }
}

async function manualRefresh() {
    const icon = document.getElementById('refresh-icon');
    if (icon) icon.style.animation = 'spin 0.7s linear infinite';
    showToast('Đang đồng bộ từ Tuya Cloud...', 'info', 1000);
    try {
        await fetchDevices();
        showToast('Đã đồng bộ xong trạng thái!', 'success', 1500);
    } catch (e) {
        showToast('Lỗi đồng bộ!', 'error', 2000);
    } finally {
        if (icon) icon.style.animation = 'none';
    }
}

// Các hàm xử lý modal đổi mật khẩu
function openPasswordModal() {
    document.getElementById('passwordModal').style.display = 'flex';
}

function closePasswordModal() {
    document.getElementById('passwordModal').style.display = 'none';
    document.getElementById('old-pass').value = '';
    document.getElementById('new-pass').value = '';
    document.getElementById('confirm-pass').value = '';
}

async function submitChangePassword() {
    const old_password = document.getElementById('old-pass').value;
    const new_password = document.getElementById('new-pass').value;
    const confirm_password = document.getElementById('confirm-pass').value;

    if (!old_password || !new_password || !confirm_password) {
        showToast('Vui lòng điền đầy đủ tất cả các trường!', 'error');
        return;
    }

    // Kiểm tra mật khẩu mới và xác nhận có khớp nhau không
    if (new_password !== confirm_password) {
        showToast('Mật khẩu mới và xác nhận mật khẩu không khớp nhau!', 'error');
        return;
    }

    try {
        const res = await fetch('/api/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ old_password, new_password })
        });
        const data = await res.json();
        if (data.success) {
            showToast(data.message, 'success');
            closePasswordModal();
        } else {
            showToast(data.message, 'error');
        }
    } catch (err) {
        showToast('Lỗi kết nối khi đổi mật khẩu!', 'error');
    }
}
// --- Quản lý Modal Cài đặt & Sinh trắc học ---
async function openSettingsModal() {
    document.getElementById('settingsModal').style.display = 'flex';
    try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        if (data.success) {
            document.getElementById('biometric-toggle').checked = !!data.biometric_enabled;
        }
    } catch (e) {
        console.error("Lỗi tải cài đặt:", e);
    }
}

function closeSettingsModal() {
    document.getElementById('settingsModal').style.display = 'none';
}

async function toggleBiometricSetting(checkbox) {
    const enabled = checkbox.checked;

    // Nếu người dùng bật tính năng, yêu cầu xác thực sinh trắc học trên thiết bị để cấp quyền liên kết
    if (enabled) {
        try {
            const publicKey = {
                challenge: Uint8Array.from("tuya_smart_challenge_str", c => c.charCodeAt(0)),
                rp: { name: "Tuya Smart Home Web" },
                user: {
                    id: Uint8Array.from("admin", c => c.charCodeAt(0)),
                    name: "admin",
                    displayName: "Admin"
                },
                pubKeyCredParams: [{ alg: -7, type: "public-key" }],
                timeout: 60000,
                authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" }
            };
            await navigator.credentials.create({ publicKey });
        } catch (err) {
            console.error("Xác thực thiết bị thất bại:", err);
            showToast('Không thể bật Face ID/Vân tay do xác thực sinh trắc học bị hủy!', 'error');
            checkbox.checked = false;
            return;
        }
    }

    try {
        const res = await fetch('/api/settings/biometric', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled })
        });
        const data = await res.json();
        if (data.success) {
            showToast(data.message, 'success');
        } else {
            showToast(data.message, 'error');
            checkbox.checked = !enabled;
        }
    } catch (err) {
        showToast('Lỗi kết nối khi cập nhật cài đặt!', 'error');
        checkbox.checked = !enabled;
    }
}

fetchDevices();
setInterval(fetchDevices, 1500);