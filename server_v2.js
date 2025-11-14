const express = require('express');
const path = require('path');
const app = express();
const port = process.env.PORT || 4000;

app.use(express.static(__dirname));
app.use(express.json());

// API للإحصائيات
app.get('/api/stats', (req, res) => {
    res.json({
        totalStandards: 150,
        totalTranslations: 89,
        recentUpdates: 12
    });
});

// API للمعايير المتاحة
app.get('/api/standards', (req, res) => {
    res.json([
        { id: 1, code: 'ASTM D1557', title: 'Modified Proctor Test', category: 'Soil Testing' },
        { id: 2, code: 'ASTM D698', title: 'Standard Proctor Test', category: 'Soil Testing' },
        { id: 3, code: 'ACI 318', title: 'Building Code for Concrete', category: 'Concrete' }
    ]);
});

// الصفحة الرئيسية
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// صفحة الأدمن
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'index_admin.html'));
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
});
