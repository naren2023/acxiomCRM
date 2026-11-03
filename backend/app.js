const express = require('express');
const path = require('path');
const session = require('express-session');
const db = require('./db');
const csrfMiddleware = require('./middleware/csrf');
const { attachUser, requireAuth } = require('./middleware/auth');

const app = express();

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../frontend/views'));

// Static files
app.use(express.static(path.join(__dirname, '../frontend/public')));

// Body parsing
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Session configuration
app.use(session({
  secret: 'acxiom_crm_super_secure_session_secret_2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax'
  }
}));

// CSRF middleware
app.use(csrfMiddleware);

// User session attach middleware
app.use(attachUser);

// Flash messages middleware
app.use((req, res, next) => {
  res.locals.flashSuccess = req.session.flashSuccess || null;
  res.locals.flashError = req.session.flashError || null;
  delete req.session.flashSuccess;
  delete req.session.flashError;
  next();
});

// Auth Routes (Login, Register, Logout)
const authRoutes = require('./routes/auth');
app.use('/', authRoutes);

// Root route redirect
app.get('/', (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect('/dashboard');
  }
  res.redirect('/login');
});

// Import and mount feature routes
const dashboardRoutes = require('./routes/dashboard');
const customerRoutes = require('./routes/customers');
const leadRoutes = require('./routes/leads');
const opportunityRoutes = require('./routes/opportunities');
const followupRoutes = require('./routes/followups');
const reportRoutes = require('./routes/reports');
const auditRoutes = require('./routes/audit');
const apiRoutes = require('./routes/api');

app.use('/dashboard', dashboardRoutes);
app.use('/customers', customerRoutes);
app.use('/leads', leadRoutes);
app.use('/opportunities', opportunityRoutes);
app.use('/followups', followupRoutes);
app.use('/reports', reportRoutes);
app.use('/audit', auditRoutes);
app.use('/api', apiRoutes);

// 404 handler
app.use((req, res) => {
  if (req.path.startsWith('/api') || req.xhr) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  res.status(404).render('partials/error', {
    title: '404 - Page Not Found',
    statusCode: 404,
    message: 'The page or resource you requested does not exist.'
  });
});

// 500 error handler
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err);
  if (req.path.startsWith('/api') || req.xhr) {
    return res.status(500).json({ error: 'An unexpected server error occurred.' });
  }
  res.status(500).render('partials/error', {
    title: '500 - Internal Server Error',
    statusCode: 500,
    message: 'An unexpected internal server error occurred. Please try again later.'
  });
});

module.exports = app;
