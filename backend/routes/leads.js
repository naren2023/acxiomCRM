const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

router.use(requireAuth);

// Helper for sales rep access
function canAccessLead(user, lead) {
  if (user.Role === 'Admin' || user.Role === 'Manager') return true;
  return lead.AssignedTo === user.UserId;
}

// Valid Lead Status Transitions
const VALID_TRANSITIONS = {
  New: ['New', 'Contacted', 'Qualified', 'Unqualified', 'Lost'],
  Contacted: ['Contacted', 'Qualified', 'Unqualified', 'Lost'],
  Qualified: ['Qualified', 'Converted', 'Unqualified', 'Lost'],
  Unqualified: ['Unqualified', 'Contacted', 'Qualified'],
  Lost: ['Lost', 'Contacted'],
  Converted: ['Converted'] // Terminal: cannot be changed
};

// GET /leads (List, Search, Filter)
router.get('/', (req, res) => {
  const user = req.session.user;
  const { search, status, assignedTo } = req.query;

  let query = `
    SELECT l.*, u.Name as AssignedName
    FROM Leads l
    LEFT JOIN Users u ON l.AssignedTo = u.UserId
    WHERE 1=1
  `;
  const params = [];

  if (user.Role === 'SalesExecutive') {
    query += ` AND l.AssignedTo = ?`;
    params.push(user.UserId);
  } else if (assignedTo && assignedTo !== 'All') {
    query += ` AND l.AssignedTo = ?`;
    params.push(parseInt(assignedTo, 10));
  }

  if (status && status !== 'All') {
    query += ` AND l.Status = ?`;
    params.push(status);
  }

  if (search && search.trim() !== '') {
    query += ` AND (l.LeadName LIKE ? OR l.Email LIKE ? OR l.Phone LIKE ? OR l.CompanyName LIKE ?)`;
    const s = `%${search.trim()}%`;
    params.push(s, s, s, s);
  }

  query += ` ORDER BY l.LeadId DESC`;

  const leads = db.prepare(query).all(...params);
  const salesUsers = db.prepare(`SELECT UserId, Name, Role FROM Users WHERE IsActive = 1 AND Role IN ('SalesExecutive', 'Manager')`).all();

  res.render('leads/index', {
    activePage: 'leads',
    leads,
    salesUsers,
    search: search || '',
    status: status || 'All',
    assignedTo: assignedTo || 'All'
  });
});

// GET /leads/new (Create form)
router.get('/new', (req, res) => {
  const salesUsers = db.prepare(`SELECT UserId, Name, Role FROM Users WHERE IsActive = 1 AND Role IN ('SalesExecutive', 'Manager')`).all();
  const last = db.prepare('SELECT LeadId FROM Leads ORDER BY LeadId DESC LIMIT 1').get();
  const nextId = (last ? last.LeadId : 0) + 1;
  const autoCode = `LEAD-${String(nextId).padStart(3, '0')}`;

  res.render('leads/form', {
    activePage: 'leads',
    title: 'New Lead',
    isEdit: false,
    lead: { LeadCode: autoCode, Status: 'New', ExpectedValue: 100000, Source: 'Website' },
    salesUsers,
    errors: [],
    oldInput: {}
  });
});

// POST /leads (Create action)
router.post('/', [
  body('LeadName').trim().notEmpty().withMessage('Lead Name is required.').isLength({ max: 100 }),
  body('Email').trim().isEmail().withMessage('Enter a valid email address.').isLength({ max: 150 }),
  body('Phone').trim().matches(/^\d{10}$/).withMessage('Enter a valid 10-digit phone number.'),
  body('LeadCode').trim().notEmpty().withMessage('Lead Code is required.')
    .custom((val) => {
      const existing = db.prepare('SELECT LeadId FROM Leads WHERE LeadCode = ?').get(val);
      if (existing) throw new Error('Lead Code must be unique.');
      return true;
    }),
  body('Status').isIn(['New', 'Contacted', 'Qualified', 'Unqualified', 'Converted', 'Lost']).withMessage('Invalid lead status.'),
  body('ExpectedValue').isFloat({ min: 0 }).withMessage('Expected value must be a valid positive number.')
], (req, res) => {
  const errors = validationResult(req);
  const user = req.session.user;

  if (!errors.isEmpty()) {
    const salesUsers = db.prepare(`SELECT UserId, Name, Role FROM Users WHERE IsActive = 1 AND Role IN ('SalesExecutive', 'Manager')`).all();
    return res.status(400).render('leads/form', {
      activePage: 'leads',
      title: 'New Lead',
      isEdit: false,
      lead: req.body,
      salesUsers,
      errors: errors.array(),
      oldInput: req.body
    });
  }

  const { LeadCode, LeadName, Email, Phone, CompanyName, Source, Status, ExpectedValue, AssignedTo } = req.body;
  const assignedUserId = user.Role === 'SalesExecutive' ? user.UserId : (AssignedTo ? parseInt(AssignedTo, 10) : user.UserId);
  const now = new Date().toISOString();

  const insert = db.prepare(`
    INSERT INTO Leads (LeadCode, LeadName, Email, Phone, CompanyName, Source, Status, ExpectedValue, CreatedDate, AssignedTo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = insert.run(
    LeadCode.trim(),
    LeadName.trim(),
    Email.trim().toLowerCase(),
    Phone.trim(),
    (CompanyName || '').trim(),
    (Source || 'Website').trim(),
    Status,
    parseFloat(ExpectedValue) || 0,
    now,
    assignedUserId
  );

  const newId = Number(result.lastInsertRowid);

  logAudit(req, {
    action: 'CREATE',
    entityName: 'Lead',
    recordId: newId,
    newValue: JSON.stringify({ LeadCode, LeadName, Email, Phone, CompanyName, Status, ExpectedValue, assignedUserId })
  });

  req.session.flashSuccess = `Lead "${LeadName}" created successfully.`;
  res.redirect(`/leads/${newId}`);
});

// GET /leads/:id (Details)
router.get('/:id', (req, res) => {
  const leadId = parseInt(req.params.id, 10);
  const lead = db.prepare(`
    SELECT l.*, u.Name as AssignedName
    FROM Leads l
    LEFT JOIN Users u ON l.AssignedTo = u.UserId
    WHERE l.LeadId = ?
  `).get(leadId);

  if (!lead) {
    return res.status(404).render('partials/error', {
      title: 'Lead Not Found',
      statusCode: 404,
      message: 'The requested lead does not exist.'
    });
  }

  if (!canAccessLead(req.session.user, lead)) {
    return res.status(403).render('partials/error', {
      title: '403 Forbidden',
      statusCode: 403,
      message: 'You are not authorized to view this lead.'
    });
  }

  const followups = db.prepare(`
    SELECT f.*, u.Name as AssignedName
    FROM FollowUps f
    LEFT JOIN Users u ON f.AssignedTo = u.UserId
    WHERE f.LeadId = ?
    ORDER BY f.FollowUpDate DESC
  `).all(leadId);

  res.render('leads/details', {
    activePage: 'leads',
    lead,
    followups
  });
});

// GET /leads/:id/edit (Edit form)
router.get('/:id/edit', (req, res) => {
  const leadId = parseInt(req.params.id, 10);
  const lead = db.prepare('SELECT * FROM Leads WHERE LeadId = ?').get(leadId);

  if (!lead) {
    return res.status(404).render('partials/error', { title: '404', statusCode: 404, message: 'Lead not found.' });
  }

  if (!canAccessLead(req.session.user, lead)) {
    return res.status(403).render('partials/error', { title: '403 Forbidden', statusCode: 403, message: 'Access denied.' });
  }

  const salesUsers = db.prepare(`SELECT UserId, Name, Role FROM Users WHERE IsActive = 1 AND Role IN ('SalesExecutive', 'Manager')`).all();

  res.render('leads/form', {
    activePage: 'leads',
    title: `Edit Lead: ${lead.LeadName}`,
    isEdit: true,
    lead,
    salesUsers,
    errors: [],
    oldInput: {}
  });
});

// POST /leads/:id/edit (Update action with transition blocking)
router.post('/:id/edit', [
  body('LeadName').trim().notEmpty().withMessage('Lead Name is required.').isLength({ max: 100 }),
  body('Email').trim().isEmail().withMessage('Enter a valid email address.').isLength({ max: 150 }),
  body('Phone').trim().matches(/^\d{10}$/).withMessage('Enter a valid 10-digit phone number.'),
  body('LeadCode').trim().notEmpty().withMessage('Lead Code is required.')
    .custom((val, { req }) => {
      const leadId = parseInt(req.params.id, 10);
      const existing = db.prepare('SELECT LeadId FROM Leads WHERE LeadCode = ? AND LeadId != ?').get(val, leadId);
      if (existing) throw new Error('Lead Code must be unique.');
      return true;
    }),
  body('Status').isIn(['New', 'Contacted', 'Qualified', 'Unqualified', 'Converted', 'Lost']).withMessage('Invalid status selected.'),
  body('ExpectedValue').isFloat({ min: 0 }).withMessage('Expected value must be a valid positive number.')
], (req, res) => {
  const leadId = parseInt(req.params.id, 10);
  const oldLead = db.prepare('SELECT * FROM Leads WHERE LeadId = ?').get(leadId);

  if (!oldLead) {
    return res.status(404).render('partials/error', { title: '404', statusCode: 404, message: 'Lead not found.' });
  }

  const user = req.session.user;
  if (!canAccessLead(user, oldLead)) {
    return res.status(403).render('partials/error', { title: '403 Forbidden', statusCode: 403, message: 'Access denied.' });
  }

  const errors = validationResult(req);
  const newStatus = req.body.Status;

  // Enforce workflow status transition rules
  const allowed = VALID_TRANSITIONS[oldLead.Status] || [];
  if (oldLead.Status !== newStatus && !allowed.includes(newStatus)) {
    return res.status(400).render('leads/form', {
      activePage: 'leads',
      title: `Edit Lead: ${oldLead.LeadName}`,
      isEdit: true,
      lead: { ...oldLead, ...req.body },
      salesUsers: db.prepare(`SELECT UserId, Name, Role FROM Users WHERE IsActive = 1 AND Role IN ('SalesExecutive', 'Manager')`).all(),
      errors: [{ msg: `Invalid status transition from "${oldLead.Status}" to "${newStatus}". Allowed transitions: ${allowed.join(', ')}` }],
      oldInput: req.body
    });
  }

  if (!errors.isEmpty()) {
    const salesUsers = db.prepare(`SELECT UserId, Name, Role FROM Users WHERE IsActive = 1 AND Role IN ('SalesExecutive', 'Manager')`).all();
    return res.status(400).render('leads/form', {
      activePage: 'leads',
      title: `Edit Lead: ${oldLead.LeadName}`,
      isEdit: true,
      lead: { ...oldLead, ...req.body },
      salesUsers,
      errors: errors.array(),
      oldInput: req.body
    });
  }

  const { LeadCode, LeadName, Email, Phone, CompanyName, Source, ExpectedValue, AssignedTo } = req.body;
  const assignedUserId = user.Role === 'SalesExecutive' ? oldLead.AssignedTo : (AssignedTo ? parseInt(AssignedTo, 10) : oldLead.AssignedTo);

  const update = db.prepare(`
    UPDATE Leads
    SET LeadCode = ?, LeadName = ?, Email = ?, Phone = ?, CompanyName = ?, Source = ?, Status = ?, ExpectedValue = ?, AssignedTo = ?
    WHERE LeadId = ?
  `);

  update.run(
    LeadCode.trim(),
    LeadName.trim(),
    Email.trim().toLowerCase(),
    Phone.trim(),
    (CompanyName || '').trim(),
    (Source || 'Website').trim(),
    newStatus,
    parseFloat(ExpectedValue) || 0,
    assignedUserId,
    leadId
  );

  logAudit(req, {
    action: 'UPDATE',
    entityName: 'Lead',
    recordId: leadId,
    oldValue: JSON.stringify(oldLead),
    newValue: JSON.stringify({ LeadCode, LeadName, Email, Phone, Status: newStatus, ExpectedValue, assignedUserId })
  });

  req.session.flashSuccess = `Lead "${LeadName}" updated successfully.`;
  res.redirect(`/leads/${leadId}`);
});

// POST /leads/:id/convert (Convert Lead into Customer & Opportunity)
router.post('/:id/convert', (req, res) => {
  const leadId = parseInt(req.params.id, 10);
  const lead = db.prepare('SELECT * FROM Leads WHERE LeadId = ?').get(leadId);

  if (!lead) {
    return res.status(404).render('partials/error', { title: '404', statusCode: 404, message: 'Lead not found.' });
  }

  const user = req.session.user;
  if (!canAccessLead(user, lead)) {
    return res.status(403).render('partials/error', { title: '403 Forbidden', statusCode: 403, message: 'Access denied.' });
  }

  if (lead.Status === 'Converted') {
    req.session.flashError = 'This lead has already been converted.';
    return res.redirect(`/leads/${leadId}`);
  }

  const now = new Date().toISOString();
  const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];

  // Database transaction for atomic conversion
  const convertTransaction = db.transaction(() => {
    // 1. Check or create customer
    let customer = db.prepare('SELECT CustomerId FROM Customers WHERE Email = ?').get(lead.Email);
    let customerId;

    if (customer) {
      customerId = customer.CustomerId;
    } else {
      const lastCust = db.prepare('SELECT CustomerId FROM Customers ORDER BY CustomerId DESC LIMIT 1').get();
      const nextCustCode = `CUST-${String((lastCust ? lastCust.CustomerId : 0) + 1).padStart(3, '0')}`;
      
      // Ensure phone uniqueness if already present in another customer
      let safePhone = lead.Phone;
      const phoneExists = db.prepare('SELECT CustomerId FROM Customers WHERE Phone = ?').get(lead.Phone);
      if (phoneExists) {
        safePhone = '9' + Math.floor(100000000 + Math.random() * 900000000);
      }

      const insertCustomer = db.prepare(`
        INSERT INTO Customers (CustomerCode, CustomerName, Email, Phone, CompanyName, Address, City, State, Status, CreatedDate, CreatedBy, OwnerId)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?, ?)
      `);

      const custRes = insertCustomer.run(
        nextCustCode,
        lead.LeadName,
        lead.Email,
        safePhone,
        lead.CompanyName || lead.LeadName,
        'Converted from Lead #' + lead.LeadCode,
        'N/A',
        'N/A',
        now,
        user.UserId,
        lead.AssignedTo
      );

      customerId = Number(custRes.lastInsertRowid);

      logAudit(req, {
        action: 'CREATE',
        entityName: 'Customer',
        recordId: customerId,
        newValue: `Created customer from converted lead #${lead.LeadId}`
      });
    }

    // 2. Create Opportunity
    const oppAmount = lead.ExpectedValue > 0 ? lead.ExpectedValue : 100000;
    const oppName = `${lead.CompanyName || lead.LeadName} - Commercial Opportunity`;

    const insertOpp = db.prepare(`
      INSERT INTO Opportunities (OpportunityName, CustomerId, LeadId, Amount, Stage, Probability, ExpectedCloseDate, Status, CreatedDate, AssignedTo, Notes)
      VALUES (?, ?, ?, ?, 'Qualification', 25, ?, 'Active', ?, ?, ?)
    `);

    const oppRes = insertOpp.run(
      oppName,
      customerId,
      lead.LeadId,
      oppAmount,
      nextMonth,
      now,
      lead.AssignedTo,
      `Auto-generated on lead conversion from ${lead.LeadCode}`
    );

    const opportunityId = Number(oppRes.lastInsertRowid);

    // 3. Mark Lead as Converted
    db.prepare(`UPDATE Leads SET Status = 'Converted' WHERE LeadId = ?`).run(lead.LeadId);

    // 4. Log Audits
    logAudit(req, {
      action: 'LEAD_CONVERTED',
      entityName: 'Lead',
      recordId: lead.LeadId,
      oldValue: lead.Status,
      newValue: JSON.stringify({ CustomerId: customerId, OpportunityId: opportunityId, Status: 'Converted' })
    });

    logAudit(req, {
      action: 'CREATE',
      entityName: 'Opportunity',
      recordId: opportunityId,
      newValue: JSON.stringify({ OpportunityName: oppName, CustomerId: customerId, Amount: oppAmount })
    });

    return { customerId, opportunityId };
  });

  const { customerId, opportunityId } = convertTransaction();

  req.session.flashSuccess = `Lead successfully converted! Created Customer #${customerId} and Opportunity #${opportunityId}.`;
  res.redirect(`/opportunities/${opportunityId}`);
});

// POST /leads/:id/delete (Delete action)
router.post('/:id/delete', (req, res) => {
  const leadId = parseInt(req.params.id, 10);
  const lead = db.prepare('SELECT * FROM Leads WHERE LeadId = ?').get(leadId);

  if (!lead) {
    return res.status(404).render('partials/error', { title: '404', statusCode: 404, message: 'Lead not found.' });
  }

  const user = req.session.user;
  if (!canAccessLead(user, lead)) {
    return res.status(403).render('partials/error', { title: '403 Forbidden', statusCode: 403, message: 'Access denied.' });
  }

  db.prepare('DELETE FROM Leads WHERE LeadId = ?').run(leadId);

  logAudit(req, {
    action: 'DELETE',
    entityName: 'Lead',
    recordId: leadId,
    oldValue: JSON.stringify(lead),
    newValue: null
  });

  req.session.flashSuccess = `Lead "${lead.LeadName}" deleted successfully.`;
  res.redirect('/leads');
});

module.exports = router;
