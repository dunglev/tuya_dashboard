# ⚡ Tuya Smart Home Web Dashboard & Control System

A secure, production-ready web application built with **Python (Flask)** designed to monitor and control Tuya smart circuit breakers (energy meters). It features secure user authentication (Password + WebAuthn/Face ID), power monitoring, schedule timers, and real-time countdown progress bars.

---

## 📁 Project Structure

```text
tuya_webapp/
├── .env                 # Sensitive credentials (Excluded from Git)
├── .env.example         # Environment template file
├── .gitignore           # Git ignore configurations
├── tuya_service.py      # Tuya Cloud OpenAPI integration module
├── app.py               # Flask application core (Routes & Sessions)
├── venv/                # Python Virtual Environment
└── templates/
    ├── login.html       # Authentication UI (Password & Face ID / WebAuthn)
    └── index.html       # Control Dashboard, Power Stats, Timers & Progress Bars
```

## 🌐 Production Deployment on Ubuntu Server (Apache + Gunicorn)

1. **Install Dependencies:**
   ```bash
   sudo apt update && sudo apt install python3 python3-pip python3-venv apache2 certbot python3-certbot-apache -y
   ```
2. **Setup Project Directory:**
   ```bash
   sudo mkdir -p /var/www/tuya_webapp
   sudo chown -R $USER:$USER /var/www/tuya_webapp
   cd /var/www/tuya_webapp
   python3 -m venv venv
   source venv/bin/activate
   pip install tuya-connector-python flask python-dotenv gunicorn
   ```
3. **Configure Systemd Service (`/etc/systemd/system/tuyaweb.service`):**
   ```ini
   [Unit]
   Description=Gunicorn instance to serve Tuya Web App
   After=network.target

   [Service]
   User=ubuntu
   WorkingDirectory=/var/www/tuya_webapp
   Environment="PATH=/var/www/tuya_webapp/venv/bin"
   ExecStart=/var/www/tuya_webapp/venv/bin/gunicorn --workers 3 --bind 127.0.0.1:5000 app:app

   [Install]
   WantedBy=multi-user.target
   ```
   Enable service:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl start tuyaweb
   sudo systemctl enable tuyaweb
   ```
4. **Configure Apache Reverse Proxy (`/etc/apache2/sites-available/tuya_webapp.conf`):**
   ```apache
   <VirtualHost *:80>
       ServerName your_domain_or_ip
       ProxyPreserveHost On
       ProxyPass / http://127.0.0.1:5000/
       ProxyPassReverse / http://127.0.0.1:5000/
   </VirtualHost>
   ```
   Enable Apache modules and site:
   ```bash
   sudo a2enmod proxy proxy_http
   sudo a2ensite tuya_webapp.conf
   sudo systemctl restart apache2
   ```
5. **Enable HTTPS for Face ID / WebAuthn:**
   ```bash
   sudo certbot --apache -d your_domain_here