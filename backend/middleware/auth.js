const db = require('../db');

function attachUser(req, res, next) {
  if (req.session && req.session.user) {
    const user = db.prepare('SELECT UserId, Name, Email, Role, IsActive FROM Users WHERE UserId = ?').get(req.session.user.UserId);
    if (!user || user.IsActive === 0) {
      req.session.destroy(() => {});
      res.locals.currentUser = null;
    } else {
      req.session.user = user;
      res.locals.currentUser = user;
    }
  } else {
    res.locals.currentUser = null;
  }
  next();
}

function isApiRequest(req) {
  return (req.originalUrl && req.originalUrl.startsWith('/api')) ||
         (req.baseUrl && req.baseUrl.startsWith('/api')) ||
         (req.path && req.path.startsWith('/api')) ||
         req.xhr ||
         (req.headers.accept && req.headers.accept.includes('application/json'));
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    if (isApiRequest(req)) {
      return res.status(401).json({ error: 'Unauthorized. Authentication required.' });
    }
    return res.redirect('/login');
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      if (isApiRequest(req)) {
        return res.status(401).json({ error: 'Unauthorized. Authentication required.' });
      }
      return res.redirect('/login');
    }

    if (!roles.includes(req.session.user.Role)) {
      if (isApiRequest(req)) {
        return res.status(403).json({ error: 'Forbidden. Requires role: ' + roles.join(' or ') });
      }
      return res.status(403).render('partials/error', {
        title: '403 Forbidden',
        statusCode: 403,
        message: 'Access Denied. You do not have permission to view this resource. Requires role: ' + roles.join(' or ')
      });
    }

    next();
  };
}

module.exports = {
  attachUser,
  requireAuth,
  requireRole
};
