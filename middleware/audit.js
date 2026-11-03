const db = require('../db');

function logAudit(req, { action, entityName, recordId, oldValue, newValue, userId }) {
  try {
    const effectiveUserId = userId || (req && req.session && req.session.user ? req.session.user.UserId : null);
    const ipAddress = (req && (req.headers['x-forwarded-for'] || req.ip || (req.socket && req.socket.remoteAddress))) || '127.0.0.1';
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO AuditLog (UserId, Action, EntityName, RecordId, OldValue, NewValue, CreatedDate, IpAddress)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      effectiveUserId,
      action,
      entityName,
      recordId !== undefined && recordId !== null ? String(recordId) : null,
      oldValue !== undefined && oldValue !== null ? (typeof oldValue === 'object' ? JSON.stringify(oldValue) : String(oldValue)) : null,
      newValue !== undefined && newValue !== null ? (typeof newValue === 'object' ? JSON.stringify(newValue) : String(newValue)) : null,
      now,
      String(ipAddress)
    );
  } catch (err) {
    console.error('AuditLog error:', err.message);
  }
}

module.exports = { logAudit };
