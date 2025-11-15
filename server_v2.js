import express from 'express';
import cors from 'cors';
import fileUpload from 'express-fileupload';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload());
app.use(express.static('public'));

// Create uploads directory
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Initialize database
const db = new Database('standards.db');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS standards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE,
    name TEXT,
    type TEXT,
    icon TEXT,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    standard_id INTEGER,
    title TEXT,
    description TEXT,
    filename TEXT,
    filepath TEXT,
    filesize INTEGER,
    downloads INTEGER DEFAULT 0,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (standard_id) REFERENCES standards(id)
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    email TEXT UNIQUE,
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Initialize standards if empty
const standardsCount = db.prepare('SELECT COUNT(*) as count FROM standards').get();
if (standardsCount.count === 0) {
  db.prepare(`
    INSERT INTO standards (code, name, type, icon, description) VALUES
    (?, ?, ?, ?, ?)
  `).run('ACI', 'American Concrete Institute', 'ACI', '🏗️', 'American standards for concrete design and testing');
  
  db.prepare(`
    INSERT INTO standards (code, name, type, icon, description) VALUES
    (?, ?, ?, ?, ?)
  `).run('ASTM', 'American Society for Testing and Materials', 'ASTM', '🔬', 'American standards for materials and testing');
  
  db.prepare(`
    INSERT INTO standards (code, name, type, icon, description) VALUES
    (?, ?, ?, ?, ?)
  `).run('BS', 'British Standards', 'BS', '🇬🇧', 'British standards for engineering and construction');
}

// ==================== Authentication ====================
const ADMIN_PASSWORD = 'elkasaby2025'; // Change this to your desired password
const sessions = new Map();

// Generate session token
function generateToken() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Middleware to check admin authentication
function checkAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ==================== API Routes ====================

// Admin login
app.post('/api/admin/login', (req, res) => {
  try {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'كلمة السر غير صحيحة' });
    }
    const token = generateToken();
    sessions.set(token, { createdAt: new Date(), lastActivity: new Date() });
    res.json({ success: true, token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin logout
app.post('/api/admin/logout', (req, res) => {
  try {
    const token = req.headers['x-admin-token'];
    if (token) {
      sessions.delete(token);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Check admin status
app.get('/api/admin/status', (req, res) => {
  try {
    const token = req.headers['x-admin-token'];
    const isAdmin = token && sessions.has(token);
    res.json({ isAdmin });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all standards
app.get('/api/standards', (req, res) => {
  try {
    const standards = db.prepare('SELECT * FROM standards').all();
    res.json(standards);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get files for a standard
app.get('/api/standards/:standardId/files', (req, res) => {
  try {
    const files = db.prepare('SELECT * FROM files WHERE standard_id = ? ORDER BY uploaded_at DESC')
      .all(req.params.standardId);
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search files
app.get('/api/search', (req, res) => {
  try {
    const query = `%${req.query.query}%`;
    const results = db.prepare(`
      SELECT * FROM files 
      WHERE title LIKE ? OR description LIKE ? 
      ORDER BY uploaded_at DESC
    `).all(query, query);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get statistics
app.get('/api/statistics', (req, res) => {
  try {
    const stats = db.prepare(`
      SELECT 
        s.id,
        s.name,
        s.icon,
        COUNT(f.id) as fileCount,
        COALESCE(SUM(f.downloads), 0) as totalDownloads
      FROM standards s
      LEFT JOIN files f ON s.id = f.standard_id
      GROUP BY s.id
    `).all();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload file (admin only)
app.post('/api/files/upload', checkAdmin, (req, res) => {
  try {
    if (!req.files || Object.keys(req.files).length === 0) {
      return res.status(400).json({ error: 'لم يتم اختيار ملف' });
    }

    const file = req.files.file;
    const standardId = req.body.standardId;
    const title = req.body.title;
    const description = req.body.description;

    if (!standardId || !title) {
      return res.status(400).json({ error: 'البيانات غير كاملة' });
    }

    // Validate file type
    const allowedExtensions = ['.pdf', '.doc', '.docx', '.txt'];
    const fileExtension = path.extname(file.name).toLowerCase();
    if (!allowedExtensions.includes(fileExtension)) {
      return res.status(400).json({ error: 'نوع الملف غير مدعوم' });
    }

    // Generate unique filename
    const timestamp = Date.now();
    const filename = `${timestamp}-${file.name}`;
    const filepath = path.join('uploads', filename);

    // Save file
    file.mv(filepath, (err) => {
      if (err) {
        return res.status(500).json({ error: 'خطأ في حفظ الملف' });
      }

      // Save to database
      db.prepare(`
        INSERT INTO files (standard_id, title, description, filename, filepath, filesize)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(standardId, title, description, filename, filepath, file.size);

      res.json({ success: true, message: 'تم رفع الملف بنجاح' });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Download file
app.get('/api/files/:fileId/download', (req, res) => {
  try {
    const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.fileId);
    if (!file) {
      return res.status(404).json({ error: 'الملف غير موجود' });
    }

    // Update download count
    db.prepare('UPDATE files SET downloads = downloads + 1 WHERE id = ?').run(req.params.fileId);

    res.download(file.filepath, file.filename);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete file (admin only)
app.delete('/api/files/:fileId', checkAdmin, (req, res) => {
  try {
    const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.fileId);
    if (!file) {
      return res.status(404).json({ error: 'الملف غير موجود' });
    }

    // Delete from filesystem
    if (fs.existsSync(file.filepath)) {
      fs.unlinkSync(file.filepath);
    }

    // Delete from database
    db.prepare('DELETE FROM files WHERE id = ?').run(req.params.fileId);

    res.json({ success: true, message: 'تم حذف الملف' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// ==================== Start Server ====================
app.listen(PORT, () => {
  console.log(`✅ Mohamed Elkasaby's Standards Platform running on port ${PORT}`);
  console.log(`📁 Standards Database: standards.db`);
  console.log(`📤 Uploads Directory: ./uploads`);
  console.log(`🌐 Access at: http://localhost:${PORT}`);
});
