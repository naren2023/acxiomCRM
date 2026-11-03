const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

router.use(requireAuth);

// Helper to check record access for SalesExecutive
function canAccessCustomer(user, customer) {
  if (user.Role === 'Admin' || user.Role === 'Manager') return true;
  return customer.OwnerId === user.UserId || customer.CreatedBy === user.UserId;
}

// GET /customers (List, Search, Filter)
router.get('/', (req, res) => {
  const user = req.session.user;
  const { search, status } = req.query;

  let query = `
    SELECT c.*, u.Name as OwnerName, cb.Name as CreatedByName
    FROM Customers c
    LEFT JOIN Users u ON c.OwnerId = u.UserId
    LEFT JOIN Users cb ON c.CreatedBy = cb.UserId
    WHERE 1=1
  `;
  const params = [];

  if (user.Role === 'SalesExecutive') {
    query += ` AND (c.OwnerId = ? OR c.CreatedBy = ?)`;
    params.push(user.UserId, user.UserId);
  }

  if (status && status !== 'All') {
    query += ` AND c.Status = ?`;
    params.push(status);
  }

  if (search && search.trim() !== '') {
    query += ` AND (c.CustomerName LIKE ? OR c.Email LIKE ? OR c.Phone LIKE ? OR c.CompanyName LIKE ?)`;
    const s = `%${search.trim()}%`;
    params.push(s, s, s, s);
  }

  query += ` ORDER BY c.CustomerId DESC`;

  const customers = db.prepare(query).all(...params);

  res.render('customers/index', {
    activePage: 'customers',
    customers,
    search: search || '',
    status: status || 'All'
  });
});

// GET /customers/new (Create form)
router.get('/new', (req, res) => {
  const salesUsers = db.prepare(`SELECT UserId, Name, Role FROM Users WHERE IsActive = 1 AND Role IN ('SalesExecutive', 'Manager')`).all();
  // Auto-generate next code
  const last = db.prepare('SELECT CustomerId FROM Customers ORDER BY CustomerId DESC LIMIT 1').get();
  const nextId = (last ? last.CustomerId : 0) + 1;
  const autoCode = `CUST-${String(nextId).padStart(3, '0')}`;

  res.render('customers/form', {
    activePage: 'customers',
    title: 'New Customer',
    isEdit: false,
    customer: { CustomerCode: autoCode, Status: 'Active' },
    salesUsers,
    oldInput: {},
    errors: []
  });
});

// POST /customers (Create action)
router.post('/', [
  body('CustomerName').trim().notEmpty().withMessage('Customer Name is required.').isLength({ max: 100 }).withMessage('Customer Name cannot exceed 100 characters.'),
  body('Email').trim().isEmail().withMessage('Enter a valid email address.').isLength({ max: 150 }).withMessage('Email cannot exceed 150 characters.')
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
    }),
  body('Status').isIn(['Active', 'Inactive']).withMessage('Status must be Active or Inactive.')
], (req, res) => {
  const errors = validationResult(req);
  const user = req.session.user;

  if (!errors.isEmpty()) {
    const salesUsers = db.prepare(`SELECT UserId, Name, Role FROM Users WHERE IsActive = 1 AND Role IN ('SalesExecutive', 'Manager')`).all();
    return res.status(400).render('customers/form', {
      activePage: 'customers',
      title: 'New Customer',
      isEdit: false,
      customer: req.body,
      salesUsers,
      errors: errors.array(),
      oldInput: req.body
    });
  }

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
    Status,
    now,
    user.UserId,
    assignedOwnerId
  );

  const newId = Number(result.lastInsertRowid);

  logAudit(req, {
    action: 'CREATE',
    entityName: 'Customer',
    recordId: newId,
    newValue: JSON.stringify({ CustomerCode, CustomerName, Email, Phone, CompanyName, Status, assignedOwnerId })
  });

  req.session.flashSuccess = `Customer "${CustomerName}" created successfully.`;
  res.redirect(`/customers/${newId}`);
});

// GET /customers/:id (Details)
router.get('/:id', (req, res) => {
  const customerId = parseInt(req.params.id, 10);
  const customer = db.prepare(`
    SELECT c.*, u.Name as OwnerName, cb.Name as CreatedByName
    FROM Customers c
    LEFT JOIN Users u ON c.OwnerId = u.UserId
    LEFT JOIN Users cb ON c.CreatedBy = cb.UserId
    WHERE c.CustomerId = ?
  `).get(customerId);

  if (!customer) {
    return res.status(404).render('partials/error', {
      title: 'Customer Not Found',
      statusCode: 404,
      message: 'The requested customer does not exist.'
    });
  }

  if (!canAccessCustomer(req.session.user, customer)) {
    return res.status(403).render('partials/error', {
      title: '403 Forbidden',
      statusCode: 403,
      message: 'You are not authorized to view this customer.'
    });
  }

  // Related opportunities and follow-ups
  const opportunities = db.prepare(`
    SELECT o.*, u.Name as OwnerName
    FROM Opportunities o
    LEFT JOIN Users u ON o.AssignedTo = u.UserId
    WHERE o.CustomerId = ?
    ORDER BY o.OpportunityId DESC
  `).all(customerId);

  const followups = db.prepare(`
    SELECT f.*, u.Name as AssignedName
    FROM FollowUps f
    LEFT JOIN Users u ON f.AssignedTo = u.UserId
    WHERE f.CustomerId = ?
    ORDER BY f.FollowUpDate DESC
  `).all(customerId);

  res.render('customers/details', {
    activePage: 'customers',
    customer,
    opportunities,
    followups
  });
});

// GET /customers/:id/edit (Edit form)
router.get('/:id/edit', (req, res) => {
  const customerId = parseInt(req.params.id, 10);
  const customer = db.prepare('SELECT * FROM Customers WHERE CustomerId = ?').get(customerId);

  if (!customer) {
    return res.status(404).render('partials/error', {
      title: 'Customer Not Found',
      statusCode: 404,
      message: 'The customer to edit does not exist.'
    });
  }

  if (!canAccessCustomer(req.session.user, customer)) {
    return res.status(403).render('partials/error', {
      title: '403 Forbidden',
      statusCode: 403,
      message: 'You are not authorized to edit this customer.'
    });
  }

  const salesUsers = db.prepare(`SELECT UserId, Name, Role FROM Users WHERE IsActive = 1 AND Role IN ('SalesExecutive', 'Manager')`).all();

  res.render('customers/form', {
    activePage: 'customers',
    title: `Edit Customer: ${customer.CustomerName}`,
    isEdit: true,
    customer,
    salesUsers,
    oldInput: {},
    errors: []
  });
});

// POST /customers/:id/edit (Update action)
router.post('/:id/edit', [
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
    }),
  body('Status').isIn(['Active', 'Inactive']).withMessage('Status must be Active or Inactive.')
], (req, res) => {
  const customerId = parseInt(req.params.id, 10);
  const oldCustomer = db.prepare('SELECT * FROM Customers WHERE CustomerId = ?').get(customerId);

  if (!oldCustomer) {
    return res.status(404).render('partials/error', { title: '404', statusCode: 404, message: 'Customer not found.' });
  }

  const user = req.session.user;
  if (!canAccessCustomer(user, oldCustomer)) {
    return res.status(403).render('partials/error', { title: '403 Forbidden', statusCode: 403, message: 'Access denied.' });
  }

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const salesUsers = db.prepare(`SELECT UserId, Name, Role FROM Users WHERE IsActive = 1 AND Role IN ('SalesExecutive', 'Manager')`).all();
    return res.status(400).render('customers/form', {
      activePage: 'customers',
      title: `Edit Customer: ${oldCustomer.CustomerName}`,
      isEdit: true,
      customer: { ...oldCustomer, ...req.body },
      salesUsers,
      errors: errors.array(),
      oldInput: req.body
    });
  }

  const { CustomerCode, CustomerName, Email, Phone, CompanyName, Address, City, State, Status, OwnerId } = req.body;
  const assignedOwnerId = user.Role === 'SalesExecutive' ? oldCustomer.OwnerId : (OwnerId ? parseInt(OwnerId, 10) : oldCustomer.OwnerId);

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
    Status,
    assignedOwnerId,
    customerId
  );

  logAudit(req, {
    action: 'UPDATE',
    entityName: 'Customer',
    recordId: customerId,
    oldValue: JSON.stringify(oldCustomer),
    newValue: JSON.stringify({ CustomerCode, CustomerName, Email, Phone, CompanyName, Status, assignedOwnerId })
  });

  req.session.flashSuccess = `Customer "${CustomerName}" updated successfully.`;
  res.redirect(`/customers/${customerId}`);
});

// POST /customers/:id/delete (Delete action)
router.post('/:id/delete', (req, res) => {
  const customerId = parseInt(req.params.id, 10);
  const customer = db.prepare('SELECT * FROM Customers WHERE CustomerId = ?').get(customerId);

  if (!customer) {
    return res.status(404).render('partials/error', { title: '404', statusCode: 404, message: 'Customer not found.' });
  }

  const user = req.session.user;
  if (!canAccessCustomer(user, customer)) {
    return res.status(403).render('partials/error', { title: '403 Forbidden', statusCode: 403, message: 'Access denied.' });
  }

  db.prepare('DELETE FROM Customers WHERE CustomerId = ?').run(customerId);

  logAudit(req, {
    action: 'DELETE',
    entityName: 'Customer',
    recordId: customerId,
    oldValue: JSON.stringify(customer),
    newValue: null
  });

  req.session.flashSuccess = `Customer "${customer.CustomerName}" deleted successfully.`;
  res.redirect('/customers');
});

module.exports = router;
