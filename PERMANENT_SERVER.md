# 🔄 دليل تشغيل الخادم بشكل دائم

## المشكلة

الرابط المؤقت ينقطع عند دخول الخادم وضع السكون (Hibernation).

## الحل

هناك عدة طرق لإبقاء الخادم شغال طول الوقت:

---

## الطريقة 1: استخدام Screen (الأسهل)

### الخطوة 1: تشغيل الخادم في جلسة Screen

```bash
cd /home/ubuntu/elkasaby_standards_platform
screen -S elkasaby-server
node server_v2.js
```

### الخطوة 2: فصل الجلسة (بدون إيقاف الخادم)

اضغط: `Ctrl + A` ثم `D`

### الخطوة 3: التحقق من أن الخادم يعمل

```bash
screen -ls
```

### للعودة إلى الجلسة:

```bash
screen -r elkasaby-server
```

### لإيقاف الخادم:

```bash
screen -X -S elkasaby-server quit
```

---

## الطريقة 2: استخدام PM2 (الأفضل)

### الخطوة 1: تثبيت PM2

```bash
npm install -g pm2
```

### الخطوة 2: بدء الخادم مع PM2

```bash
cd /home/ubuntu/elkasaby_standards_platform
pm2 start server_v2.js --name "elkasaby-standards"
```

### الخطوة 3: جعل PM2 يبدأ تلقائياً عند إعادة التشغيل

```bash
pm2 startup
pm2 save
```

### الخطوة 4: التحقق من حالة الخادم

```bash
pm2 status
pm2 logs elkasaby-standards
```

### لإيقاف الخادم:

```bash
pm2 stop elkasaby-standards
```

---

## الطريقة 3: استخدام Systemd Service (الأكثر احترافية)

### الخطوة 1: إنشاء ملف Service

```bash
sudo nano /etc/systemd/system/elkasaby-standards.service
```

### الخطوة 2: أضف المحتوى التالي:

```ini
[Unit]
Description=Elkasaby Standards Platform
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/elkasaby_standards_platform
ExecStart=/usr/bin/node /home/ubuntu/elkasaby_standards_platform/server_v2.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### الخطوة 3: حفظ الملف

اضغط: `Ctrl + X` ثم `Y` ثم `Enter`

### الخطوة 4: تفعيل الخدمة

```bash
sudo systemctl daemon-reload
sudo systemctl enable elkasaby-standards
sudo systemctl start elkasaby-standards
```

### الخطوة 5: التحقق من الحالة

```bash
sudo systemctl status elkasaby-standards
```

### لإيقاف الخدمة:

```bash
sudo systemctl stop elkasaby-standards
```

---

## الطريقة 4: استخدام Nohup (بسيطة)

```bash
cd /home/ubuntu/elkasaby_standards_platform
nohup node server_v2.js > server.log 2>&1 &
```

---

## التوصية

**استخدم PM2** (الطريقة 2) لأنها:
- ✅ سهلة الاستخدام
- ✅ توفر إعادة تشغيل تلقائية
- ✅ توفر مراقبة الخادم
- ✅ توفر سجلات مفصلة

---

## التحقق من أن الخادم يعمل

```bash
curl http://localhost:5000/api/standards
```

يجب أن ترى بيانات المعايير (JSON).

---

## الرابط الدائم

بعد تشغيل الخادم بشكل دائم:

```
https://5000-ij5gz7y1btusy4wn28c6k-1a9d2fbb.manus-asia.computer
```

هذا الرابط سيعمل في أي وقت! ✅

---

## استكشاف الأخطاء

### المشكلة: الخادم توقف فجأة

**الحل:**
```bash
# تحقق من السجلات
tail -f /home/ubuntu/elkasaby_standards_platform/server.log

# أعد تشغيل الخادم
cd /home/ubuntu/elkasaby_standards_platform
node server_v2.js
```

### المشكلة: المنفذ 5000 مشغول

**الحل:**
```bash
# ابحث عن العملية المشغولة
lsof -i :5000

# اقتل العملية
kill -9 <PID>
```

---

**جزاك الله خيراً! 🙏**
