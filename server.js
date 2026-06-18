const cookieSession = require('cookie-session');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Initialize Database
const { initDb } = require('./database/db');
initDb().then(() => {
  console.log('✓ Firebase Database initialized and seeded successfully.');
}).catch(err => {
  console.error('✗ Failed to initialize database:', err);
});

const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Set up EJS views engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware for parsing body
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/Reviewer', express.static(path.join(__dirname, 'Reviewer')));

// Ensure data directory exists
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Configure cookie-based session (serverless compatible)
app.use(cookieSession({
  name: 'session',
  keys: [process.env.SESSION_SECRET || 'reviewvault-secret-change-this-in-production'],
  maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
}));

// Apply locals middleware
const { setLocals } = require('./middleware/auth');
app.use(setLocals);

// Routes
// Homepage / Landing
app.get('/', async (req, res) => {
  const { db } = require('./database/db');
  try {
    const products = await db.products.listActive();
    res.render('landing', {
      title: 'TeachSmart Academy — Secure Digital Learning Platform',
      products
    });
  } catch (err) {
    console.error('Landing page error:', err);
    res.render('landing', {
      title: 'TeachSmart Academy — Secure Digital Learning Platform',
      products: []
    });
  }
});

app.get('/privacy', (req, res) => {
  res.render('privacy', {
    title: 'Privacy Policy — TeachSmart Academy',
    user: req.session
  });
});

app.get('/terms', (req, res) => {
  res.render('terms', {
    title: 'Terms of Service — TeachSmart Academy',
    user: req.session
  });
});

// Auth Routes (Login, Register, Logout)
app.use('/', require('./routes/auth'));

// Dashboard Routes
app.use('/dashboard', require('./routes/dashboard'));

// Reader Routes
app.use('/reader', require('./routes/reader'));

// Admin Routes
app.use('/admin', require('./routes/admin'));

// 404 Route handler
app.use((req, res, next) => {
  res.status(404).render('error', {
    title: 'Page Not Found',
    message: 'The page you are looking for does not exist or has been moved.',
    user: req.session
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', {
    title: 'Server Error',
    message: 'Something went wrong on our end. Please try again later.',
    user: req.session
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`✓ TeachSmart Academy server is running on http://localhost:${PORT}`);
});
