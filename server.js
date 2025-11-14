import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fileUpload from 'express-fileupload';
import path from 'path';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';
import fs from 'fs';

// Initialize environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 5000;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload());
app.use(express.static('public'));

// Handle preflight requests
app.options('*', cors());

// Create uploads directory if it doesn't exist
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Initialize SQLite Database
const db = new sqlite3.Database('standards.db', (err) => {
  if (err) {
    console.error('Database error:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Initialize database tables
function initializeDatabase() {
  db.serialize(() => {
    // Standards table
    db.run(`
      CREATE TABLE IF NOT EXISTS standards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        icon TEXT,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Files table
    db.run(`
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
      )
    `);

    // Users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        role TEXT DEFAULT 'user',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert default standards
    db.run(`
      INSERT OR IGNORE INTO standards (code, name, type, icon, description)
      VALUES 
        ('ACI', 'American Concrete Institute', 'ACI', '🏗️', 'American standards for concrete design and testing'),
        ('ASTM', 'American Society for Testing and Materials', 'ASTM', '🔬', 'American standards for materials and testing'),
        ('BS', 'British Standards', 'BS', '🇬🇧', 'British standards for engineering and construction')
    `);
  });
}

// Routes

// Get all standards
app.get('/api/standards', (req, res) => {
  db.all('SELECT * FROM standards', (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

// Get files by standard
app.get('/api/standards/:standardId/files', (req, res) => {
  const { standardId } = req.params;
  db.all(
    'SELECT * FROM files WHERE standard_id = ? ORDER BY uploaded_at DESC',
    [standardId],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
      } else {
        res.json(rows);
      }
    }
  );
});

// Search files
app.get('/api/search', (req, res) => {
  const { query } = req.query;
  if (!query) {
    res.json([]);
    return;
  }

  db.all(
    `SELECT f.*, s.name as standard_name, s.code as standard_code 
     FROM files f 
     JOIN standards s ON f.standard_id = s.id 
     WHERE f.title LIKE ? OR f.description LIKE ? 
     ORDER BY f.uploaded_at DESC`,
    [`%${query}%`, `%${query}%`],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
      } else {
        res.json(rows);
      }
    }
  );
});

// Upload file (protected - would need authentication in production)
app.post('/api/files/upload', (req, res) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).json({ error: 'No files were uploaded.' });
  }

  const { standardId, title, description } = req.body;
  const uploadedFile = req.files.file;
  const filename = `${Date.now()}-${uploadedFile.name}`;
  const filepath = path.join('uploads', filename);

  uploadedFile.mv(filepath, (err) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    // Save to database
    db.run(
      `INSERT INTO files (standard_id, title, description, filename, filepath, filesize)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [standardId, title, description, uploadedFile.name, filepath, uploadedFile.size],
      function(err) {
        if (err) {
          res.status(500).json({ error: err.message });
        } else {
          res.json({
            success: true,
            message: 'File uploaded successfully',
            fileId: this.lastID
          });
        }
      }
    );
  });
});

// Download file
app.get('/api/files/:fileId/download', (req, res) => {
  const { fileId } = req.params;

  db.get('SELECT * FROM files WHERE id = ?', [fileId], (err, file) => {
    if (err || !file) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Increment download count
    db.run('UPDATE files SET downloads = downloads + 1 WHERE id = ?', [fileId]);

    // Send file
    res.download(file.filepath, file.filename);
  });
});

// Get file details
app.get('/api/files/:fileId', (req, res) => {
  const { fileId } = req.params;

  db.get(
    `SELECT f.*, s.name as standard_name, s.code as standard_code 
     FROM files f 
     JOIN standards s ON f.standard_id = s.id 
     WHERE f.id = ?`,
    [fileId],
    (err, file) => {
      if (err || !file) {
        res.status(404).json({ error: 'File not found' });
      } else {
        res.json(file);
      }
    }
  );
});

// Get statistics
app.get('/api/statistics', (req, res) => {
  db.all(
    `SELECT s.code, s.name, COUNT(f.id) as file_count, SUM(f.downloads) as total_downloads
     FROM standards s
     LEFT JOIN files f ON s.id = f.standard_id
     GROUP BY s.id`,
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
      } else {
        res.json(rows);
      }
    }
  );
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Mohamed Elkasaby's Standards Platform running on port ${PORT}`);
  console.log(`📁 Standards Database: standards.db`);
  console.log(`📤 Uploads Directory: ./uploads`);
});
