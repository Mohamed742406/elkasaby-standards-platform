import express from 'express';
import cors from 'cors';
import fileUpload from 'express-fileupload';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

// Initialize SQLite Database
const db = new Database('standards.db');

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

// Initialize database tables
function initializeDatabase() {
  try {
    // Create tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS standards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        type TEXT,
        icon TEXT,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        standard_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        filename TEXT NOT NULL,
        filepath TEXT NOT NULL,
        filesize INTEGER,
        downloads INTEGER DEFAULT 0,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (standard_id) REFERENCES standards(id)
      );

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        role TEXT DEFAULT 'user',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        file_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (file_id) REFERENCES files(id)
      );

      CREATE TABLE IF NOT EXISTS ratings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        file_id INTEGER NOT NULL,
        rating INTEGER CHECK(rating >= 1 AND rating <= 5),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, file_id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (file_id) REFERENCES files(id)
      );

      CREATE TABLE IF NOT EXISTS platform_ratings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        rating INTEGER CHECK(rating >= 1 AND rating <= 5),
        comment TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
    `);

    // Insert default standards if not exist
    const checkStandards = db.prepare('SELECT COUNT(*) as count FROM standards');
    const result = checkStandards.get();
    
    if (result.count === 0) {
      const insertStandards = db.prepare(`
        INSERT INTO standards (code, name, type, icon, description)
        VALUES (?, ?, ?, ?, ?)
      `);

      insertStandards.run('ACI', 'American Concrete Institute', 'ACI', '🏗️', 'American standards for concrete design and testing');
      insertStandards.run('ASTM', 'American Society for Testing and Materials', 'ASTM', '🔬', 'American standards for materials and testing');
      insertStandards.run('BS', 'British Standards', 'BS', '🇬🇧', 'British standards for engineering and construction');
    }

    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
  }
}

// Initialize database on startup
initializeDatabase();

// ==================== Authentication ====================
const ADMIN_PASSWORD = 'elkasaby2025';
const sessions = new Map();

function generateToken() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

function checkAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function checkUser(req, res, next) {
  const token = req.headers['x-user-token'];
  if (!token) {
    return res.status(401).json({ error: 'يجب تسجيل الدخول أولاً' });
  }
  req.userId = parseInt(token);
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

// ==================== User Registration & Login ====================

// User registration
app.post('/api/auth/register', (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
    }

    // Check if user exists
    const checkUser = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?');
    const existing = checkUser.get(username, email);
    
    if (existing) {
      return res.status(400).json({ error: 'اسم المستخدم أو البريد الإلكتروني موجود بالفعل' });
    }

    // Hash password
    const hashedPassword = bcrypt.hashSync(password, 10);

    // Insert user
    const insertUser = db.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)');
    insertUser.run(username, email, hashedPassword, 'user');

    const getUser = db.prepare('SELECT id, username, email FROM users WHERE username = ?');
    const user = getUser.get(username);

    res.json({ success: true, message: 'تم التسجيل بنجاح', user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// User login
app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'اسم المستخدم وكلمة السر مطلوبة' });
    }

    const getUser = db.prepare('SELECT * FROM users WHERE username = ?');
    const user = getUser.get(username);

    if (!user) {
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة السر غير صحيحة' });
    }

    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة السر غير صحيحة' });
    }

    res.json({
      success: true,
      message: 'تم تسجيل الدخول بنجاح',
      user: { id: user.id, username: user.username, email: user.email, role: user.role }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== Comments ====================

// Get comments for a file
app.get('/api/files/:fileId/comments', (req, res) => {
  try {
    const getComments = db.prepare('SELECT id, username, content, created_at FROM comments WHERE file_id = ? ORDER BY created_at DESC');
    const comments = getComments.all(req.params.fileId);
    res.json(comments);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add comment
app.post('/api/files/:fileId/comments', checkUser, (req, res) => {
  try {
    const { content } = req.body;
    const fileId = req.params.fileId;
    const userId = req.userId;

    if (!content || content.trim() === '') {
      return res.status(400).json({ error: 'التعليق لا يمكن أن يكون فارغاً' });
    }

    // Check if file exists
    const checkFile = db.prepare('SELECT * FROM files WHERE id = ?');
    if (!checkFile.get(fileId)) {
      return res.status(404).json({ error: 'الملف غير موجود' });
    }

    // Get username
    const getUser = db.prepare('SELECT username FROM users WHERE id = ?');
    const user = getUser.get(userId);

    // Insert comment
    const insertComment = db.prepare('INSERT INTO comments (user_id, username, file_id, content) VALUES (?, ?, ?, ?)');
    insertComment.run(userId, user.username, fileId, content);

    res.json({ success: true, message: 'تم إضافة التعليق بنجاح' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== Ratings ====================

// Get ratings for a file
app.get('/api/files/:fileId/ratings', (req, res) => {
  try {
    const getRatings = db.prepare('SELECT AVG(rating) as averageRating, COUNT(*) as totalRatings FROM ratings WHERE file_id = ?');
    const data = getRatings.get(req.params.fileId);
    res.json({
      averageRating: data.averageRating || 0,
      totalRatings: data.totalRatings || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add or update rating for a file
app.post('/api/files/:fileId/ratings', checkUser, (req, res) => {
  try {
    const { rating } = req.body;
    const fileId = req.params.fileId;
    const userId = req.userId;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'التقييم يجب أن يكون بين 1 و 5' });
    }

    // Check if file exists
    const checkFile = db.prepare('SELECT * FROM files WHERE id = ?');
    if (!checkFile.get(fileId)) {
      return res.status(404).json({ error: 'الملف غير موجود' });
    }

    // Get username
    const getUser = db.prepare('SELECT username FROM users WHERE id = ?');
    const user = getUser.get(userId);

    // Check if user already rated
    const checkRating = db.prepare('SELECT * FROM ratings WHERE user_id = ? AND file_id = ?');
    const existingRating = checkRating.get(userId, fileId);

    if (existingRating) {
      const updateRating = db.prepare('UPDATE ratings SET rating = ? WHERE user_id = ? AND file_id = ?');
      updateRating.run(rating, userId, fileId);
    } else {
      const insertRating = db.prepare('INSERT INTO ratings (user_id, username, file_id, rating) VALUES (?, ?, ?, ?)');
      insertRating.run(userId, user.username, fileId, rating);
    }

    res.json({ success: true, message: 'تم حفظ التقييم' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== Platform Ratings ====================

// Get platform ratings
app.get('/api/platform/ratings', (req, res) => {
  try {
    const getRatings = db.prepare('SELECT AVG(rating) as averageRating, COUNT(*) as totalRatings FROM platform_ratings');
    const data = getRatings.get();
    res.json({
      averageRating: data.averageRating || 0,
      totalRatings: data.totalRatings || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all platform ratings
app.get('/api/platform/ratings/all', (req, res) => {
  try {
    const getRatings = db.prepare('SELECT username, rating, comment, created_at FROM platform_ratings ORDER BY created_at DESC LIMIT 20');
    const ratings = getRatings.all();
    res.json(ratings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add or update platform rating
app.post('/api/platform/ratings', checkUser, (req, res) => {
  try {
    const { rating, comment } = req.body;
    const userId = req.userId;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'التقييم يجب أن يكون بين 1 و 5' });
    }

    // Get username
    const getUser = db.prepare('SELECT username FROM users WHERE id = ?');
    const user = getUser.get(userId);

    // Check if user already rated
    const checkRating = db.prepare('SELECT * FROM platform_ratings WHERE user_id = ?');
    const existingRating = checkRating.get(userId);

    if (existingRating) {
      const updateRating = db.prepare('UPDATE platform_ratings SET rating = ?, comment = ? WHERE user_id = ?');
      updateRating.run(rating, comment || '', userId);
    } else {
      const insertRating = db.prepare('INSERT INTO platform_ratings (user_id, username, rating, comment) VALUES (?, ?, ?, ?)');
      insertRating.run(userId, user.username, rating, comment || '');
    }

    res.json({ success: true, message: 'شكراً لتقييمك' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== Standards & Files ====================

// Get all standards
app.get('/api/standards', (req, res) => {
  try {
    const getStandards = db.prepare('SELECT * FROM standards');
    const standards = getStandards.all();
    res.json(standards);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get files for a standard
app.get('/api/standards/:standardId/files', (req, res) => {
  try {
    const getFiles = db.prepare('SELECT * FROM files WHERE standard_id = ? ORDER BY uploaded_at DESC');
    const files = getFiles.all(req.params.standardId);
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search files
app.get('/api/search', (req, res) => {
  try {
    const query = `%${req.query.query}%`;
    const searchFiles = db.prepare('SELECT * FROM files WHERE title LIKE ? OR description LIKE ? ORDER BY uploaded_at DESC');
    const files = searchFiles.all(query, query);
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get statistics
app.get('/api/statistics', (req, res) => {
  try {
    const getStats = db.prepare(`
      SELECT 
        s.id,
        s.name,
        s.icon,
        COUNT(f.id) as fileCount,
        COALESCE(SUM(f.downloads), 0) as totalDownloads
      FROM standards s
      LEFT JOIN files f ON s.id = f.standard_id
      GROUP BY s.id, s.name, s.icon
    `);
    const stats = getStats.all();
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

      try {
        const insertFile = db.prepare('INSERT INTO files (standard_id, title, description, filename, filepath, filesize) VALUES (?, ?, ?, ?, ?, ?)');
        insertFile.run(standardId, title, description, filename, filepath, file.size);
        res.json({ success: true, message: 'تم رفع الملف بنجاح' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Download file
app.get('/api/files/:fileId/download', (req, res) => {
  try {
    const getFile = db.prepare('SELECT * FROM files WHERE id = ?');
    const file = getFile.get(req.params.fileId);

    if (!file) {
      return res.status(404).json({ error: 'الملف غير موجود' });
    }

    // Update download count
    const updateDownloads = db.prepare('UPDATE files SET downloads = downloads + 1 WHERE id = ?');
    updateDownloads.run(req.params.fileId);

    res.download(file.filepath, file.filename);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete file (admin only)
app.delete('/api/files/:fileId', checkAdmin, (req, res) => {
  try {
    const getFile = db.prepare('SELECT * FROM files WHERE id = ?');
    const file = getFile.get(req.params.fileId);

    if (!file) {
      return res.status(404).json({ error: 'الملف غير موجود' });
    }

    // Delete from filesystem
    if (fs.existsSync(file.filepath)) {
      fs.unlinkSync(file.filepath);
    }

    // Delete from database
    const deleteFile = db.prepare('DELETE FROM files WHERE id = ?');
    deleteFile.run(req.params.fileId);

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
  console.log(`📁 SQLite Database: standards.db`);
  console.log(`📤 Uploads Directory: ./uploads`);
  console.log(`🌐 Access at: http://localhost:${PORT}` );
});
