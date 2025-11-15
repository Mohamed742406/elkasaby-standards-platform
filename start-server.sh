#!/bin/bash

# منصة محمد القصبى للمواصفات الهندسية
# Elkasaby Standards Platform - Server Startup Script

echo "🚀 بدء تشغيل منصة محمد القصبى..."
echo "Starting Elkasaby Standards Platform..."

# تغيير المجلد
cd /home/ubuntu/elkasaby_standards_platform

# التأكد من وجود مجلد uploads
if [ ! -d "uploads" ]; then
    mkdir uploads
    echo "✅ تم إنشاء مجلد uploads"
fi

# بدء الخادم مع إعادة تشغيل تلقائية عند التوقف
while true; do
    echo "📡 تشغيل الخادم على المنفذ 5000..."
    node server_v2.js
    
    # إذا توقف الخادم، انتظر 5 ثوان وأعد التشغيل
    echo "⚠️ الخادم توقف. إعادة التشغيل في 5 ثوان..."
    sleep 5
done
