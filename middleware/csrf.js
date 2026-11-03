const crypto = require('crypto');

function csrfMiddleware(req, res, next) {
  if (!req.session) {
    return next();
  }

  // Ensure CSRF token in session
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }

  // Expose to all views
  res.locals.csrfToken = req.session.csrfToken;

  // State-changing HTTP methods
  const isStateChanging = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method);

  // Skip CSRF validation for REST API calls (API endpoints are authenticated by session or tokens)
  if (req.path.startsWith('/api')) {
    return next();
  }

  if (isStateChanging) {
    const token = (req.body && req.body._csrf) || req.headers['x-csrf-token'];
    if (!token || token !== req.session.csrfToken) {
      return res.status(403).render('partials/error', {
        title: '403 Forbidden',
        statusCode: 403,
        message: 'Invalid or missing CSRF token. Please submit the form again.'
      });
    }
  }

  next();
}

module.exports = csrfMiddleware;
