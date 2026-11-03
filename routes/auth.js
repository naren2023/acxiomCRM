const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { logAudit } = require('../middleware/audit');

// GET /login
router.get('/login', (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect('/dashboard');
  }
  const error = req.session.flashError || null;
  const success = req.session.flashSuccess || null;
  delete req.session.flashError;
  delete req.session.flashSuccess;

  res.render('auth/login', { error, success, oldInput: {} });
});

// POST /login
router.post('/login', [
  body('Email').trim().isEmail().withMessage('Please enter a valid email address.'),
  body('Password').notEmpty().withMessage('Password is required.')
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).render('auth/login', {
      errors: errors.array(),
      oldInput: { Email: req.body.Email }
    });
  }

  const { Email, Password } = req.body;
  const user = db.prepare('SELECT * FROM Users WHERE Email = ?').get(Email.toLowerCase());

  if (!user) {
    logAudit(req, {
      action: 'LOGIN_FAILED',
      entityName: 'Users',
      recordId: null,
      oldValue: null,
      newValue: `Failed login attempt for unknown email: ${Email}`
    });

    return res.status(401).render('auth/login', {
      error: 'Invalid email or password.',
      oldInput: { Email }
    });
  }

  // Check account lockout
  if (user.LockoutEnd) {
    const lockoutEndTime = new Date(user.LockoutEnd).getTime();
    const nowTime = Date.now();
    if (lockoutEndTime > nowTime) {
      const remainingMinutes = Math.ceil((lockoutEndTime - nowTime) / (60 * 1000));
      logAudit(req, {
        action: 'LOGIN_BLOCKED_LOCKOUT',
        entityName: 'Users',
        recordId: user.UserId,
        userId: user.UserId,
        newValue: `Login blocked due to active lockout (${remainingMinutes}m remaining)`
      });

      return res.status(403).render('auth/login', {
        error: `Account is temporarily locked due to repeated failed logins. Please try again in ${remainingMinutes} minute(s).`,
        oldInput: { Email }
      });
    } else {
      // Lockout expired - reset counter and lockout
      db.prepare('UPDATE Users SET FailedLoginCount = 0, LockoutEnd = NULL WHERE UserId = ?').run(user.UserId);
      user.FailedLoginCount = 0;
      user.LockoutEnd = null;
    }
  }

  // Check if account is active
  if (user.IsActive === 0) {
    return res.status(403).render('auth/login', {
      error: 'Account is deactivated. Please contact an administrator.',
      oldInput: { Email }
    });
  }

  // Verify password
  const isMatch = bcrypt.compareSync(Password, user.PasswordHash);
  if (!isMatch) {
    const newCount = (user.FailedLoginCount || 0) + 1;
    let lockoutMessage = '';

    if (newCount >= 5) {
      const lockoutEnd = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      db.prepare('UPDATE Users SET FailedLoginCount = ?, LockoutEnd = ? WHERE UserId = ?').run(newCount, lockoutEnd, user.UserId);

      logAudit(req, {
        action: 'LOCKOUT',
        entityName: 'Users',
        recordId: user.UserId,
        userId: user.UserId,
        newValue: 'User locked out for 15 minutes after 5 failed login attempts'
      });

      lockoutMessage = 'Account locked for 15 minutes due to 5 consecutive failed login attempts.';
    } else {
      db.prepare('UPDATE Users SET FailedLoginCount = ? WHERE UserId = ?').run(newCount, user.UserId);

      logAudit(req, {
        action: 'LOGIN_FAILED',
        entityName: 'Users',
        recordId: user.UserId,
        userId: user.UserId,
        newValue: `Failed password attempt ${newCount} of 5`
      });

      lockoutMessage = `Invalid email or password. Attempt ${newCount} of 5 before 15-minute lockout.`;
    }

    return res.status(401).render('auth/login', {
      error: lockoutMessage,
      oldInput: { Email }
    });
  }

  // Login successful - Reset failed login attempts
  db.prepare('UPDATE Users SET FailedLoginCount = 0, LockoutEnd = NULL WHERE UserId = ?').run(user.UserId);

  req.session.user = {
    UserId: user.UserId,
    Name: user.Name,
    Email: user.Email,
    Role: user.Role
  };

  logAudit(req, {
    action: 'LOGIN_SUCCESS',
    entityName: 'Users',
    recordId: user.UserId,
    userId: user.UserId,
    newValue: `User logged in with role: ${user.Role}`
  });

  res.redirect('/dashboard');
});

// GET /register
router.get('/register', (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect('/dashboard');
  }
  res.render('auth/register', { oldInput: {} });
});

// POST /register
router.post('/register', [
  body('Name').trim().notEmpty().withMessage('Full Name is required.').isLength({ max: 100 }).withMessage('Name cannot exceed 100 characters.'),
  body('Email').trim().isEmail().withMessage('Enter a valid email address.').isLength({ max: 150 }),
  body('Role').isIn(['Admin', 'Manager', 'SalesExecutive']).withMessage('Invalid role selected.'),
  body('Password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters long.')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter.')
    .matches(/[a-z]/).withMessage('Password must contain at least one lowercase letter.')
    .matches(/[0-9]/).withMessage('Password must contain at least one digit.'),
  body('ConfirmPassword').custom((value, { req }) => {
    if (value !== req.body.Password) {
      throw new Error('Confirm password does not match.');
    }
    return true;
  })
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).render('auth/register', {
      errors: errors.array(),
      oldInput: req.body
    });
  }

  const { Name, Email, Role, Password } = req.body;
  const existing = db.prepare('SELECT UserId FROM Users WHERE Email = ?').get(Email.toLowerCase());
  if (existing) {
    return res.status(400).render('auth/register', {
      error: 'An account with this email address already exists.',
      oldInput: req.body
    });
  }

  const passwordHash = bcrypt.hashSync(Password, 10);
  const now = new Date().toISOString();

  const insert = db.prepare(`
    INSERT INTO Users (Name, Email, PasswordHash, Role, IsActive, FailedLoginCount, CreatedDate)
    VALUES (?, ?, ?, ?, 1, 0, ?)
  `);

  const result = insert.run(Name, Email.toLowerCase(), passwordHash, Role, now);
  const newUserId = Number(result.lastInsertRowid);

  logAudit(req, {
    action: 'REGISTER',
    entityName: 'Users',
    recordId: newUserId,
    userId: newUserId,
    newValue: `Registered new user: ${Email} with role: ${Role}`
  });

  req.session.flashSuccess = 'Registration successful! You may now sign in.';
  res.redirect('/login');
});

// POST /logout
router.post('/logout', (req, res) => {
  if (req.session && req.session.user) {
    logAudit(req, {
      action: 'LOGOUT',
      entityName: 'Users',
      recordId: req.session.user.UserId,
      userId: req.session.user.UserId,
      newValue: 'User logged out'
    });
  }
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// GET /logout (allow safe navigation logout as fallback)
router.get('/logout', (req, res) => {
  if (req.session && req.session.user) {
    logAudit(req, {
      action: 'LOGOUT',
      entityName: 'Users',
      recordId: req.session.user.UserId,
      userId: req.session.user.UserId,
      newValue: 'User logged out'
    });
  }
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;
