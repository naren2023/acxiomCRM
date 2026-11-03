const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

// Enforce authentication on all API routes
router.use(requireAuth);

// Helper for customer authorization
function canAccessCustomer(user, customer) {
  if (user.Role === 'Admin' || user.Role === 'Manager') return true;
  return customer.OwnerId === user.UserId || customer.CreatedBy === user.UserId;
}

// Helper for lead authorization
function canAccessLead(user, lead) {
  if (user.Role === 'Admin' || user.Role === 'Manager') return true;
  return lead.AssignedTo === user.UserId;
}

// Helper for opportunity authorization
function canAccessOpportunity(user, opp) {
  if (user.Role === 'Admin' || user.Role === 'Manager') return true;
  return opp.AssignedTo === user.UserId;
}

// ================= CUSTOMERS API =================

// GET /api/customers
router.get('/customers', (req, res) => {
  const user = req.session.user;
  let query = 'SELECT CustomerId, CustomerCode, CustomerName, Email, Phone, CompanyName, Address, City, State, Status, CreatedDate, CreatedBy, OwnerId FROM Customers WHERE 1=1';
  const params = [];

  if (user.Role === 'SalesExecutive') {
    query += ' AND (OwnerId = ? OR CreatedBy = ?)';
    params.push(user.UserId, user.UserId);
  }

  query += ' ORDER BY CustomerId DESC';
  const customers = db.prepare(query).all(...params);
  res.status(200).json(customers);
});

// GET /api/customers/:id
router.get('/customers/:id', (req, res) => {
  const customerId = parseInt(req.params.id, 10);
  if (isNaN(customerId)) {
    return res.status(400).json({ error: 'Invalid Customer ID' });
  }

  const customer = db.prepare('SELECT CustomerId, CustomerCode, CustomerName, Email, Phone, CompanyName, Address, City, State, Status, CreatedDate, CreatedBy, OwnerId FROM Customers WHERE CustomerId = ?').get(customerId);
  if (!customer) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  if (!canAccessCustomer(req.session.user, customer)) {
    return res.status(403).json({ error: 'Forbidden. You do not have permission to view this customer.' });
  }

  res.status(200).json(customer);
});

// POST /api/customers
router.post('/customers', [
  body('CustomerName').trim().notEmpty().withMessage('Customer Name is required.').isLength({ max: 100 }),
  body('Email').trim().isEmail().withMessage('Enter a valid email address.')
    .custom((val) => {
      const existing = db.prepare('SELECT CustomerId FROM Customers WHERE Email = ?').get(val.toLowerCase());
      if (existing) throw new Error('Email address already registered with another customer.');
      return true;
    }),
  body('Phone').trim().matches(/^\d{10}$/).withMessage('Enter a valid 10-digit phone number.')
    .custom((val) => {
      const existing = db.prepare('SELECT CustomerId FROM Customers WHERE Phone = ?').get(val);
      if (existing) throw new Error('Phone number already registered with another customer.');
      return true;
    }),
  body('CustomerCode').trim().notEmpty().withMessage('Customer Code is required.')
    .custom((val) => {
      const existing = db.prepare('SELECT CustomerId FROM Customers WHERE CustomerCode = ?').get(val);
      if (existing) throw new Error('Customer Code must be unique.');
      return true;
    })
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Validation failed', details: errors.array() });
  }

  const user = req.session.user;
  const { CustomerCode, CustomerName, Email, Phone, CompanyName, Address, City, State, Status, OwnerId } = req.body;
  const assignedOwnerId = user.Role === 'SalesExecutive' ? user.UserId : (OwnerId ? parseInt(OwnerId, 10) : user.UserId);
  const now = new Date().toISOString();

  const insert = db.prepare(`
    INSERT INTO Customers (CustomerCode, CustomerName, Email, Phone, CompanyName, Address, City, State, Status, CreatedDate, CreatedBy, OwnerId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = insert.run(
    CustomerCode.trim(),
    CustomerName.trim(),
    Email.trim().toLowerCase(),
    Phone.trim(),
    (CompanyName || '').trim(),
    (Address || '').trim(),
    (City || '').trim(),
    (State || '').trim(),
    Status || 'Active',
    now,
    user.UserId,
    assignedOwnerId
  );

  const newId = Number(result.lastInsertRowid);
  const createdCustomer = db.prepare('SELECT CustomerId, CustomerCode, CustomerName, Email, Phone, CompanyName, Address, City, State, Status, CreatedDate, CreatedBy, OwnerId FROM Customers WHERE CustomerId = ?').get(newId);

  logAudit(req, {
    action: 'CREATE',
    entityName: 'Customer',
    recordId: newId,
    newValue: JSON.stringify(createdCustomer)
  });

  res.status(201).json({ message: 'Customer created successfully', customer: createdCustomer });
});

// PUT /api/customers/:id
router.put('/customers/:id', [
  body('CustomerName').trim().notEmpty().withMessage('Customer Name is required.').isLength({ max: 100 }),
  body('Email').trim().isEmail().withMessage('Enter a valid email address.')
    .custom((val, { req }) => {
      const customerId = parseInt(req.params.id, 10);
      const existing = db.prepare('SELECT CustomerId FROM Customers WHERE Email = ? AND CustomerId != ?').get(val.toLowerCase(), customerId);
      if (existing) throw new Error('Email address already registered with another customer.');
      return true;
    }),
  body('Phone').trim().matches(/^\d{10}$/).withMessage('Enter a valid 10-digit phone number.')
    .custom((val, { req }) => {
      const customerId = parseInt(req.params.id, 10);
      const existing = db.prepare('SELECT CustomerId FROM Customers WHERE Phone = ? AND CustomerId != ?').get(val, customerId);
      if (existing) throw new Error('Phone number already registered with another customer.');
      return true;
    }),
  body('CustomerCode').trim().notEmpty().withMessage('Customer Code is required.')
    .custom((val, { req }) => {
      const customerId = parseInt(req.params.id, 10);
      const existing = db.prepare('SELECT CustomerId FROM Customers WHERE CustomerCode = ? AND CustomerId != ?').get(val, customerId);
      if (existing) throw new Error('Customer Code must be unique.');
      return true;
    })
], (req, res) => {
  const customerId = parseInt(req.params.id, 10);
  if (isNaN(customerId)) {
    return res.status(400).json({ error: 'Invalid Customer ID' });
  }

  const existingCustomer = db.prepare('SELECT * FROM Customers WHERE CustomerId = ?').get(customerId);
  if (!existingCustomer) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  if (!canAccessCustomer(req.session.user, existingCustomer)) {
    return res.status(403).json({ error: 'Forbidden. You do not have permission to update this customer.' });
  }

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Validation failed', details: errors.array() });
  }

  const { CustomerCode, CustomerName, Email, Phone, CompanyName, Address, City, State, Status, OwnerId } = req.body;
  const user = req.session.user;
  const assignedOwnerId = user.Role === 'SalesExecutive' ? existingCustomer.OwnerId : (OwnerId ? parseInt(OwnerId, 10) : existingCustomer.OwnerId);

  const update = db.prepare(`
    UPDATE Customers
    SET CustomerCode = ?, CustomerName = ?, Email = ?, Phone = ?, CompanyName = ?, Address = ?, City = ?, State = ?, Status = ?, OwnerId = ?
    WHERE CustomerId = ?
  `);

  update.run(
    CustomerCode.trim(),
    CustomerName.trim(),
    Email.trim().toLowerCase(),
    Phone.trim(),
    (CompanyName || '').trim(),
    (Address || '').trim(),
    (City || '').trim(),
    (State || '').trim(),
    Status || existingCustomer.Status,
    assignedOwnerId,
    customerId
  );

  const updatedCustomer = db.prepare('SELECT CustomerId, CustomerCode, CustomerName, Email, Phone, CompanyName, Address, City, State, Status, CreatedDate, CreatedBy, OwnerId FROM Customers WHERE CustomerId = ?').get(customerId);

  logAudit(req, {
    action: 'UPDATE',
    entityName: 'Customer',
    recordId: customerId,
    oldValue: JSON.stringify(existingCustomer),
    newValue: JSON.stringify(updatedCustomer)
  });

  res.status(200).json({ message: 'Customer updated successfully', customer: updatedCustomer });
});

// DELETE /api/customers/:id
router.delete('/customers/:id', (req, res) => {
  const customerId = parseInt(req.params.id, 10);
  if (isNaN(customerId)) {
    return res.status(400).json({ error: 'Invalid Customer ID' });
  }

  const existingCustomer = db.prepare('SELECT * FROM Customers WHERE CustomerId = ?').get(customerId);
  if (!existingCustomer) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  if (!canAccessCustomer(req.session.user, existingCustomer)) {
    return res.status(403).json({ error: 'Forbidden. You do not have permission to delete this customer.' });
  }

  db.prepare('DELETE FROM Customers WHERE CustomerId = ?').run(customerId);

  logAudit(req, {
    action: 'DELETE',
    entityName: 'Customer',
    recordId: customerId,
    oldValue: JSON.stringify(existingCustomer),
    newValue: null
  });

  res.status(200).json({ message: 'Customer deleted successfully' });
});

// ================= LEADS API =================

// GET /api/leads
router.get('/leads', (req, res) => {
  const user = req.session.user;
  let query = 'SELECT LeadId, LeadCode, LeadName, Email, Phone, CompanyName, Source, Status, ExpectedValue, CreatedDate, AssignedTo FROM Leads WHERE 1=1';
  const params = [];

  if (user.Role === 'SalesExecutive') {
    query += ' AND AssignedTo = ?';
    params.push(user.UserId);
  }

  query += ' ORDER BY LeadId DESC';
  const leads = db.prepare(query).all(...params);
  res.status(200).json(leads);
});

// POST /api/leads
router.post('/leads', [
  body('LeadName').trim().notEmpty().withMessage('Lead Name is required.').isLength({ max: 100 }),
  body('Email').trim().isEmail().withMessage('Enter a valid email address.').isLength({ max: 150 }),
  body('Phone').trim().matches(/^\d{10}$/).withMessage('Enter a valid 10-digit phone number.'),
  body('LeadCode').trim().notEmpty().withMessage('Lead Code is required.')
    .custom((val) => {
      const existing = db.prepare('SELECT LeadId FROM Leads WHERE LeadCode = ?').get(val);
      if (existing) throw new Error('Lead Code must be unique.');
      return true;
    }),
  body('Status').isIn(['New', 'Contacted', 'Qualified', 'Unqualified', 'Converted', 'Lost']).withMessage('Invalid status.')
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Validation failed', details: errors.array() });
  }

  const user = req.session.user;
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
    Status || 'New',
    parseFloat(ExpectedValue) || 0,
    now,
    assignedUserId
  );

  const newId = Number(result.lastInsertRowid);
  const createdLead = db.prepare('SELECT LeadId, LeadCode, LeadName, Email, Phone, CompanyName, Source, Status, ExpectedValue, CreatedDate, AssignedTo FROM Leads WHERE LeadId = ?').get(newId);

  logAudit(req, {
    action: 'CREATE',
    entityName: 'Lead',
    recordId: newId,
    newValue: JSON.stringify(createdLead)
  });

  res.status(201).json({ message: 'Lead created successfully', lead: createdLead });
});

// ================= OPPORTUNITIES API =================

// GET /api/opportunities
router.get('/opportunities', (req, res) => {
  const user = req.session.user;
  let query = 'SELECT OpportunityId, OpportunityName, CustomerId, LeadId, Amount, Stage, Probability, ExpectedCloseDate, Status, CreatedDate, AssignedTo, Notes FROM Opportunities WHERE 1=1';
  const params = [];

  if (user.Role === 'SalesExecutive') {
    query += ' AND AssignedTo = ?';
    params.push(user.UserId);
  }

  query += ' ORDER BY OpportunityId DESC';
  const opps = db.prepare(query).all(...params);
  res.status(200).json(opps);
});

// POST /api/opportunities
router.post('/opportunities', [
  body('OpportunityName').trim().notEmpty().withMessage('Opportunity Name is required.').isLength({ max: 150 }),
  body('CustomerId').notEmpty().withMessage('Customer ID is required.').isInt(),
  body('Amount').isFloat({ gt: 0 }).withMessage('Amount must be greater than 0.'),
  body('Probability').isInt({ min: 0, max: 100 }).withMessage('Probability must be between 0 and 100.'),
  body('Stage').isIn(['Qualification', 'Proposal', 'Negotiation', 'Won', 'Lost']).withMessage('Invalid stage.'),
  body('ExpectedCloseDate').isISO8601().withMessage('Valid date required.')
    .custom((val, { req }) => {
      const stage = req.body.Stage;
      if (stage !== 'Won' && stage !== 'Lost') {
        const selected = new Date(val);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (selected < today) {
          throw new Error('Expected Close Date cannot be in the past for active opportunities.');
        }
      }
      return true;
    })
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Validation failed', details: errors.array() });
  }

  const user = req.session.user;
  const { OpportunityName, CustomerId, LeadId, Amount, Stage, Probability, ExpectedCloseDate, AssignedTo, Notes } = req.body;
  const assignedUserId = user.Role === 'SalesExecutive' ? user.UserId : (AssignedTo ? parseInt(AssignedTo, 10) : user.UserId);

  let status = 'Active';
  if (Stage === 'Won') status = 'Won';
  else if (Stage === 'Lost') status = 'Lost';

  const now = new Date().toISOString();

  const insert = db.prepare(`
    INSERT INTO Opportunities (OpportunityName, CustomerId, LeadId, Amount, Stage, Probability, ExpectedCloseDate, Status, CreatedDate, AssignedTo, Notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = insert.run(
    OpportunityName.trim(),
    parseInt(CustomerId, 10),
    LeadId ? parseInt(LeadId, 10) : null,
    parseFloat(Amount),
    Stage,
    parseInt(Probability, 10),
    ExpectedCloseDate,
    status,
    now,
    assignedUserId,
    (Notes || '').trim()
  );

  const newId = Number(result.lastInsertRowid);
  const createdOpp = db.prepare('SELECT OpportunityId, OpportunityName, CustomerId, LeadId, Amount, Stage, Probability, ExpectedCloseDate, Status, CreatedDate, AssignedTo, Notes FROM Opportunities WHERE OpportunityId = ?').get(newId);

  logAudit(req, {
    action: 'CREATE',
    entityName: 'Opportunity',
    recordId: newId,
    newValue: JSON.stringify(createdOpp)
  });

  res.status(201).json({ message: 'Opportunity created successfully', opportunity: createdOpp });
});

module.exports = router;
