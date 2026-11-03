const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);
router.use(requireRole('Admin'));

// GET /audit
router.get('/', (req, res) => {
  const { action, entityName, userId } = req.query;

  let query = `
    SELECT a.*, u.Name as UserName, u.Email as UserEmail
    FROM AuditLog a
    LEFT JOIN Users u ON a.UserId = u.UserId
    WHERE 1=1
  `;
  const params = [];

  if (action && action !== 'All') {
    query += ' AND a.Action = ?';
    params.push(action);
  }

  if (entityName && entityName !== 'All') {
    query += ' AND a.EntityName = ?';
    params.push(entityName);
  }

  if (userId && userId !== 'All') {
    query += ' AND a.UserId = ?';
    params.push(parseInt(userId, 10));
  }

  query += ' ORDER BY a.AuditLogId DESC LIMIT 200';

  const auditLogs = db.prepare(query).all(...params);
  const users = db.prepare('SELECT UserId, Name, Role FROM Users ORDER BY Name ASC').all();

  const distinctActions = db.prepare('SELECT DISTINCT Action FROM AuditLog ORDER BY Action ASC').all().map(r => r.Action);
  const distinctEntities = db.prepare('SELECT DISTINCT EntityName FROM AuditLog ORDER BY EntityName ASC').all().map(r => r.EntityName);

  res.render('audit/index', {
    activePage: 'audit',
    auditLogs,
    users,
    distinctActions,
    distinctEntities,
    action: action || 'All',
    entityName: entityName || 'All',
    userId: userId || 'All'
  });
});

module.exports = router;
