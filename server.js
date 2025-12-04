import express from 'express';
import cors from 'cors';
import fileUpload from 'express-fileupload';
import pkg from 'pg';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';

const { Pool } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

// PostgreSQL Connection Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/elkasaby_standards',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

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
async function initializeDatabase() {
  try {
    const client = await pool.connect();
    
    // Create tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS standards (
        id SERIAL PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        type TEXT,
        icon TEXT,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS files (
        id SERIAL PRIMARY KEY,
        standard_id INTEGER NOT NULL REFERENCES standards(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        filename TEXT NOT NULL,
        filepath TEXT NOT NULL,
        filesize INTEGER,
        downloads INTEGER DEFAULT 0,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        role TEXT DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS comments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        username TEXT NOT NULL,
        file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS ratings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        username TEXT NOT NULL,
        file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        rating INTEGER CHECK(rating >= 1 AND rating <= 5),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, file_id)
      );

      CREATE TABLE IF NOT EXISTS platform_ratings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        username TEXT NOT NULL,
        rating INTEGER CHECK(rating >= 1 AND rating <= 5),
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id)
      );
    `);

    // Insert default standards if not exist
    await client.query(`
      INSERT INTO standards (code, name, type, icon, description)
      VALUES 
        ('ACI', 'American Concrete Institute', 'ACI', '🏗️', 'American standards for concrete design and testing'),
        ('ASTM', 'American Society for Testing and Materials', 'ASTM', '🔬', 'American standards for materials and testing'),
        ('BS', 'British Standards', 'BS', '🇬🇧', 'British standards for engineering and construction')
      ON CONFLICT (code) DO NOTHING;
    `);

    client.release();
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
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
    }

    const client = await pool.connect();
    
    // Check if user exists
    const existing = await client.query('SELECT * FROM users WHERE username = $1 OR email = $2', [username, email]);
    if (existing.rows.length > 0) {
      client.release();
      return res.status(400).json({ error: 'اسم المستخدم أو البريد الإلكتروني موجود بالفعل' });
    }

    // Hash password
    const hashedPassword = bcrypt.hashSync(password, 10);

    // Insert user
    await client.query(
      'INSERT INTO users (username, email, password, role) VALUES ($1, $2, $3, $4)',
      [username, email, hashedPassword, 'user']
    );

    const user = await client.query('SELECT id, username, email FROM users WHERE username = $1', [username]);
    client.release();

    res.json({ success: true, message: 'تم التسجيل بنجاح', user: user.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// User login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'اسم المستخدم وكلمة السر مطلوبة' });
    }

    const client = await pool.connect();
    const result = await client.query('SELECT * FROM users WHERE username = $1', [username]);
    client.release();

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة السر غير صحيحة' });
    }

    const user = result.rows[0];
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
app.get('/api/files/:fileId/comments', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query(
      'SELECT id, username, content, created_at FROM comments WHERE file_id = $1 ORDER BY created_at DESC',
      [req.params.fileId]
    );
    client.release();
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add comment
app.post('/api/files/:fileId/comments', checkUser, async (req, res) => {
  try {
    const { content } = req.body;
    const fileId = req.params.fileId;
    const userId = req.userId;

    if (!content || content.trim() === '') {
      return res.status(400).json({ error: 'التعليق لا يمكن أن يكون فارغاً' });
    }

    const client = await pool.connect();

    // Check if file exists
    const fileCheck = await client.query('SELECT * FROM files WHERE id = $1', [fileId]);
    if (fileCheck.rows.length === 0) {
      client.release();
      return res.status(404).json({ error: 'الملف غير موجود' });
    }

    // Get username
    const userResult = await client.query('SELECT username FROM users WHERE id = $1', [userId]);
    const username = userResult.rows[0].username;

    // Insert comment
    await client.query(
      'INSERT INTO comments (user_id, username, file_id, content) VALUES ($1, $2, $3, $4)',
      [userId, username, fileId, content]
    );

    client.release();
    res.json({ success: true, message: 'تم إضافة التعليق بنجاح' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== Ratings ====================

// Get ratings for a file
app.get('/api/files/:fileId/ratings', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query(
      'SELECT AVG(rating) as averageRating, COUNT(*) as totalRatings FROM ratings WHERE file_id = $1',
      [req.params.fileId]
    );
    client.release();
    
    const data = result.rows[0];
    res.json({
      averageRating: data.averagerating ? parseFloat(data.averagerating) : 0,
      totalRatings: parseInt(data.totalratings) || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add or update rating for a file
app.post('/api/files/:fileId/ratings', checkUser, async (req, res) => {
  try {
    const { rating } = req.body;
    const fileId = req.params.fileId;
    const userId = req.userId;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'التقييم يجب أن يكون بين 1 و 5' });
    }

    const client = await pool.connect();

    // Check if file exists
    const fileCheck = await client.query('SELECT * FROM files WHERE id = $1', [fileId]);
    if (fileCheck.rows.length === 0) {
      client.release();
      return res.status(404).json({ error: 'الملف غير موجود' });
    }

    // Get username
    const userResult = await client.query('SELECT username FROM users WHERE id = $1', [userId]);
    const username = userResult.rows[0].username;

    // Check if user already rated
    const existingRating = await client.query(
      'SELECT * FROM ratings WHERE user_id = $1 AND file_id = $2',
      [userId, fileId]
    );

    if (existingRating.rows.length > 0) {
      await client.query(
        'UPDATE ratings SET rating = $1 WHERE user_id = $2 AND file_id = $3',
        [rating, userId, fileId]
      );
    } else {
      await client.query(
        'INSERT INTO ratings (user_id, username, file_id, rating) VALUES ($1, $2, $3, $4)',
        [userId, username, fileId, rating]
      );
    }

    client.release();
    res.json({ success: true, message: 'تم حفظ التقييم' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== Platform Ratings ====================

// Get platform ratings
app.get('/api/platform/ratings', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query(
      'SELECT AVG(rating) as averageRating, COUNT(*) as totalRatings FROM platform_ratings'
    );
    client.release();
    
    const data = result.rows[0];
    res.json({
      averageRating: data.averagerating ? parseFloat(data.averagerating) : 0,
      totalRatings: parseInt(data.totalratings) || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all platform ratings
app.get('/api/platform/ratings/all', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query(
      'SELECT username, rating, comment, created_at FROM platform_ratings ORDER BY created_at DESC LIMIT 20'
    );
    client.release();
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add or update platform rating
app.post('/api/platform/ratings', checkUser, async (req, res) => {
  try {
    const { rating, comment } = req.body;
    const userId = req.userId;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'التقييم يجب أن يكون بين 1 و 5' });
    }

    const client = await pool.connect();

    // Get username
    const userResult = await client.query('SELECT username FROM users WHERE id = $1', [userId]);
    const username = userResult.rows[0].username;

    // Check if user already rated
    const existingRating = await client.query(
      'SELECT * FROM platform_ratings WHERE user_id = $1',
      [userId]
    );

    if (existingRating.rows.length > 0) {
      await client.query(
        'UPDATE platform_ratings SET rating = $1, comment = $2 WHERE user_id = $3',
        [rating, comment || '', userId]
      );
    } else {
      await client.query(
        'INSERT INTO platform_ratings (user_id, username, rating, comment) VALUES ($1, $2, $3, $4)',
        [userId, username, rating, comment || '']
      );
    }

    client.release();
    res.json({ success: true, message: 'شكراً لتقييمك' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== Standards & Files ====================

// Get all standards
app.get('/api/standards', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM standards');
    client.release();
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get files for a standard
app.get('/api/standards/:standardId/files', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query(
      'SELECT * FROM files WHERE standard_id = $1 ORDER BY uploaded_at DESC',
      [req.params.standardId]
    );
    client.release();
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search files
app.get('/api/search', async (req, res) => {
  try {
    const query = `%${req.query.query}%`;
    const client = await pool.connect();
    const result = await client.query(
      'SELECT * FROM files WHERE title ILIKE $1 OR description ILIKE $1 ORDER BY uploaded_at DESC',
      [query]
    );
    client.release();
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get statistics
app.get('/api/statistics', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query(`
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
    client.release();
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload file (admin only)
app.post('/api/files/upload', checkAdmin, async (req, res) => {
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
    file.mv(filepath, async (err) => {
      if (err) {
        return res.status(500).json({ error: 'خطأ في حفظ الملف' });
      }

      try {
        const client = await pool.connect();
        await client.query(
          'INSERT INTO files (standard_id, title, description, filename, filepath, filesize) VALUES ($1, $2, $3, $4, $5, $6)',
          [standardId, title, description, filename, filepath, file.size]
        );
        client.release();
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
app.get('/api/files/:fileId/download', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM files WHERE id = $1', [req.params.fileId]);
    
    if (result.rows.length === 0) {
      client.release();
      return res.status(404).json({ error: 'الملف غير موجود' });
    }

    const file = result.rows[0];

    // Update download count
    await client.query('UPDATE files SET downloads = downloads + 1 WHERE id = $1', [req.params.fileId]);
    client.release();

    res.download(file.filepath, file.filename);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete file (admin only)
app.delete('/api/files/:fileId', checkAdmin, async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM files WHERE id = $1', [req.params.fileId]);

    if (result.rows.length === 0) {
      client.release();
      return res.status(404).json({ error: 'الملف غير موجود' });
    }

    const file = result.rows[0];

    // Delete from filesystem
    if (fs.existsSync(file.filepath)) {
      fs.unlinkSync(file.filepath);
    }

    // Delete from database
    await client.query('DELETE FROM files WHERE id = $1', [req.params.fileId]);
    client.release();

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
  console.log(`📁 PostgreSQL Database connected`);
  console.log(`📤 Uploads Directory: ./uploads`);
  console.log(`🌐 Access at: http://localhost:${PORT}` );
});
