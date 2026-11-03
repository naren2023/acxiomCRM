const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

router.use(requireAuth);

function canAccessFollowUp(user, followup) {
  if (user.Role === 'Admin' || user.Role === 'Manager') return true;
  return followup.AssignedTo === user.UserId;
}

// GET /followups (List, Search, Filter)
router.get('/', (req, res) => {
  const user = req.session.user;
  const { date, status, assignedTo, type } = req.query;

  let query = `
    SELECT f.*, c.CustomerName, l.LeadName, u.Name as AssignedName
    FROM FollowUps f
    LEFT JOIN Customers c ON f.CustomerId = c.CustomerId
    LEFT JOIN Leads l ON f.LeadId = l.LeadId
    LEFT JOIN Users u ON f.AssignedTo = u.UserId
    WHERE 1=1
  `;
  const params = [];

  if (user.Role === 'SalesExecutive') {
    query += ` AND f.AssignedTo = ?`;
    params.push(user.UserId);
  } else if (assignedTo && assignedTo !== 'All') {
    query += ` AND f.AssignedTo = ?`;
    params.push(parseInt(assignedTo, 10));
  }

  if (status && status !== 'All') {
    query += ` AND f.Status = ?`;
    params.push(status);
  }

  if (type && type !== 'All') {
    query += ` AND f.FollowUpType = ?`;
    params.push(type);
  }

  if (date) {
    query += ` AND f.FollowUpDate = ?`;
    params.push(date);
  }

  query += ` ORDER BY f.FollowUpDate ASC, f.FollowUpId DESC`;

  const followups = db.prepare(query).all(...params);
  const salesUsers = db.prepare(`SELECT UserId, Name, Role FROM Users WHERE IsActive = 1 AND Role IN ('SalesExecutive', 'Manager')`).all();

  res.render('followups/index', {
    activePage: 'followups',
    followups,
    salesUsers,
    date: date || '',
    status: status || 'All',
    type: type || 'All',
    assignedTo: assignedTo || 'All'
  });
});

// GET /followups/new (Create form)
router.get('/new', (req, res) => {
  const user = req.session.user;
  let custQuery = "SELECT CustomerId, CustomerName FROM Customers WHERE Status = 'Active'";
  let leadQuery = "SELECT LeadId, LeadName FROM Leads WHERE Status != 'Converted'";

  if (user.Role === 'SalesExecutive') {
    custQuery += ` AND (OwnerId = ${user.UserId} OR CreatedBy = ${user.UserId})`;
    leadQuery += ` AND AssignedTo = ${user.UserId}`;
  }

  const customers = db.prepare(custQuery).all();
  const leads = db.prepare(leadQuery).all();
  const salesUsers = db.prepare(`SELECT UserId, Name, Role FROM Users WHERE IsActive = 1 AND Role IN ('SalesExecutive', 'Manager')`).all();

  const today = new Date().toISOString().split('T')[0];

  res.render('followups/form', {
    activePage: 'followups',
    title: 'Schedule Follow-Up',
    isEdit: false,
    followup: {
      FollowUpDate: today,
      FollowUpType: 'Call',
      Status: 'Planned',
      CustomerId: req.query.customerId ? parseInt(req.query.customerId, 10) : '',
      LeadId: req.query.leadId ? parseInt(req.query.leadId, 10) : ''
    },
    customers,
    leads,
    salesUsers,
    errors: [],
    oldInput: {}
  });
});

// POST /followups (Create action)
router.post('/', [
  body('FollowUpType').isIn(['Call', 'Meeting', 'Email', 'Task']).withMessage('Invalid follow-up type.'),
  body('Remarks').trim().notEmpty().withMessage('Remarks / Subject is required.').isLength({ max: 255 }),
  body('Status').isIn(['Planned', 'Completed', 'Missed', 'Cancelled']).withMessage('Invalid status.'),
  body('FollowUpDate').isISO8601().withMessage('Valid date is required.')
    .custom((val, { req }) => {
      const status = req.body.Status;
      if (status === 'Planned') {
        const selected = new Date(val);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (selected < today) {
          throw new Error('Follow-up date cannot be earlier than today for a new/planned follow-up.');
        }
      }
      return true;
    }),
  body('CustomerId').custom((val, { req }) => {
    if (!val && !req.body.LeadId) {
      throw new Error('Either a Customer or a Lead must be selected for the follow-up.');
    }
    return true;
  })
], (req, res) => {
  const errors = validationResult(req);
  const user = req.session.user;

  if (!errors.isEmpty()) {
    let custQuery = "SELECT CustomerId, CustomerName FROM Customers WHERE Status = 'Active'";
    let leadQuery = "SELECT LeadId, LeadName FROM Leads WHERE Status != 'Converted'";
    if (user.Role === 'SalesExecutive') {
      custQuery += ` AND (OwnerId = ${user.UserId} OR CreatedBy = ${user.UserId})`;
      leadQuery += ` AND AssignedTo = ${user.UserId}`;
    }
    const customers = db.prepare(custQuery).all();
    const leads = db.prepare(leadQuery).all();
    const salesUsers = db.prepare(`SELECT UserId, Name, Role FROM Users WHERE IsActive = 1 AND Role IN ('SalesExecutive', 'Manager')`).all();

    return res.status(400).render('followups/form', {
      activePage: 'followups',
      title: 'Schedule Follow-Up',
      isEdit: false,
      followup: req.body,
      customers,
      leads,
      salesUsers,
      errors: errors.array(),
      oldInput: req.body
    });
  }

  const { CustomerId, LeadId, FollowUpDate, FollowUpType, Remarks, Status, AssignedTo } = req.body;
  const assignedUserId = user.Role === 'SalesExecutive' ? user.UserId : (AssignedTo ? parseInt(AssignedTo, 10) : user.UserId);
  const now = new Date().toISOString();

  const insert = db.prepare(`
    INSERT INTO FollowUps (CustomerId, LeadId, FollowUpDate, FollowUpType, Remarks, Status, AssignedTo, CreatedDate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = insert.run(
    CustomerId ? parseInt(CustomerId, 10) : null,
    LeadId ? parseInt(LeadId, 10) : null,
    FollowUpDate,
    FollowUpType,
    Remarks.trim(),
    Status,
    assignedUserId,
    now
  );

  const newId = Number(result.lastInsertRowid);

  logAudit(req, {
    action: 'CREATE',
    entityName: 'FollowUp',
    recordId: newId,
    newValue: JSON.stringify({ CustomerId, LeadId, FollowUpDate, FollowUpType, Status, assignedUserId })
  });

  req.session.flashSuccess = 'Follow-up interaction scheduled successfully.';
  res.redirect('/followups');
});

// GET /followups/:id/edit (Edit form)
router.get('/:id/edit', (req, res) => {
  const followUpId = parseInt(req.params.id, 10);
  const followup = db.prepare('SELECT * FROM FollowUps WHERE FollowUpId = ?').get(followUpId);

  if (!followup) {
    return res.status(404).render('partials/error', { title: '404', statusCode: 404, message: 'Follow-up not found.' });
  }

  if (!canAccessFollowUp(req.session.user, followup)) {
    return res.status(403).render('partials/error', { title: '403 Forbidden', statusCode: 403, message: 'Access denied.' });
  }

  const user = req.session.user;
  let custQuery = "SELECT CustomerId, CustomerName FROM Customers WHERE Status = 'Active'";
  let leadQuery = "SELECT LeadId, LeadName FROM Leads WHERE Status != 'Converted'";
  if (user.Role === 'SalesExecutive') {
    custQuery += ` AND (OwnerId = ${user.UserId} OR CreatedBy = ${user.UserId})`;
    leadQuery += ` AND AssignedTo = ${user.UserId}`;
  }
  const customers = db.prepare(custQuery).all();
  const leads = db.prepare(leadQuery).all();
  const salesUsers = db.prepare(`SELECT UserId, Name, Role FROM Users WHERE IsActive = 1 AND Role IN ('SalesExecutive', 'Manager')`).all();

  res.render('followups/form', {
    activePage: 'followups',
    title: 'Edit Follow-Up',
    isEdit: true,
    followup,
    customers,
    leads,
    salesUsers,
    errors: [],
    oldInput: {}
  });
});

// POST /followups/:id/edit (Update action)
router.post('/:id/edit', [
  body('FollowUpType').isIn(['Call', 'Meeting', 'Email', 'Task']).withMessage('Invalid follow-up type.'),
  body('Remarks').trim().notEmpty().withMessage('Remarks / Subject is required.').isLength({ max: 255 }),
  body('Status').isIn(['Planned', 'Completed', 'Missed', 'Cancelled']).withMessage('Invalid status.'),
  body('FollowUpDate').isISO8601().withMessage('Valid date is required.')
], (req, res) => {
  const followUpId = parseInt(req.params.id, 10);
  const oldFollowup = db.prepare('SELECT * FROM FollowUps WHERE FollowUpId = ?').get(followUpId);

  if (!oldFollowup) {
    return res.status(404).render('partials/error', { title: '404', statusCode: 404, message: 'Follow-up not found.' });
  }

  const user = req.session.user;
  if (!canAccessFollowUp(user, oldFollowup)) {
    return res.status(403).render('partials/error', { title: '403 Forbidden', statusCode: 403, message: 'Access denied.' });
  }

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    let custQuery = "SELECT CustomerId, CustomerName FROM Customers WHERE Status = 'Active'";
    let leadQuery = "SELECT LeadId, LeadName FROM Leads WHERE Status != 'Converted'";
    if (user.Role === 'SalesExecutive') {
      custQuery += ` AND (OwnerId = ${user.UserId} OR CreatedBy = ${user.UserId})`;
      leadQuery += ` AND AssignedTo = ${user.UserId}`;
    }
    const customers = db.prepare(custQuery).all();
    const leads = db.prepare(leadQuery).all();
    const salesUsers = db.prepare(`SELECT UserId, Name, Role FROM Users WHERE IsActive = 1 AND Role IN ('SalesExecutive', 'Manager')`).all();

    return res.status(400).render('followups/form', {
      activePage: 'followups',
      title: 'Edit Follow-Up',
      isEdit: true,
      followup: { ...oldFollowup, ...req.body },
      customers,
      leads,
      salesUsers,
      errors: errors.array(),
      oldInput: req.body
    });
  }

  const { CustomerId, LeadId, FollowUpDate, FollowUpType, Remarks, Status, AssignedTo } = req.body;
  const assignedUserId = user.Role === 'SalesExecutive' ? oldFollowup.AssignedTo : (AssignedTo ? parseInt(AssignedTo, 10) : oldFollowup.AssignedTo);

  const update = db.prepare(`
    UPDATE FollowUps
    SET CustomerId = ?, LeadId = ?, FollowUpDate = ?, FollowUpType = ?, Remarks = ?, Status = ?, AssignedTo = ?
    WHERE FollowUpId = ?
  `);

  update.run(
    CustomerId ? parseInt(CustomerId, 10) : null,
    LeadId ? parseInt(LeadId, 10) : null,
    FollowUpDate,
    FollowUpType,
    Remarks.trim(),
    Status,
    assignedUserId,
    followUpId
  );

  logAudit(req, {
    action: 'UPDATE',
    entityName: 'FollowUp',
    recordId: followUpId,
    oldValue: JSON.stringify(oldFollowup),
    newValue: JSON.stringify({ CustomerId, LeadId, FollowUpDate, FollowUpType, Status, assignedUserId })
  });

  req.session.flashSuccess = 'Follow-up interaction updated successfully.';
  res.redirect('/followups');
});

// POST /followups/:id/delete (Delete action)
router.post('/:id/delete', (req, res) => {
  const followUpId = parseInt(req.params.id, 10);
  const followup = db.prepare('SELECT * FROM FollowUps WHERE FollowUpId = ?').get(followUpId);

  if (!followup) {
    return res.status(404).render('partials/error', { title: '404', statusCode: 404, message: 'Follow-up not found.' });
  }

  const user = req.session.user;
  if (!canAccessFollowUp(user, followup)) {
    return res.status(403).render('partials/error', { title: '403 Forbidden', statusCode: 403, message: 'Access denied.' });
  }

  db.prepare('DELETE FROM FollowUps WHERE FollowUpId = ?').run(followUpId);

  logAudit(req, {
    action: 'DELETE',
    entityName: 'FollowUp',
    recordId: followUpId,
    oldValue: JSON.stringify(followup),
    newValue: null
  });

  req.session.flashSuccess = 'Follow-up interaction deleted successfully.';
  res.redirect('/followups');
});

module.exports = router;
