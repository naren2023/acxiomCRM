const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

router.use(requireAuth);

function canAccessOpportunity(user, opp) {
  if (user.Role === 'Admin' || user.Role === 'Manager') return true;
  return opp.AssignedTo === user.UserId;
}

// GET /opportunities (List, Search, Filter)
router.get('/', (req, res) => {
  const user = req.session.user;
  const { search, stage, status } = req.query;

  let query = `
    SELECT o.*, c.CustomerName, u.Name as AssignedName
    FROM Opportunities o
    LEFT JOIN Customers c ON o.CustomerId = c.CustomerId
    LEFT JOIN Users u ON o.AssignedTo = u.UserId
    WHERE 1=1
  `;
  const params = [];

  if (user.Role === 'SalesExecutive') {
    query += ` AND o.AssignedTo = ?`;
    params.push(user.UserId);
  }

  if (stage && stage !== 'All') {
    query += ` AND o.Stage = ?`;
    params.push(stage);
  }

  if (status && status !== 'All') {
    query += ` AND o.Status = ?`;
    params.push(status);
  }

  if (search && search.trim() !== '') {
    query += ` AND (o.OpportunityName LIKE ? OR c.CustomerName LIKE ?)`;
    const s = `%${search.trim()}%`;
    params.push(s, s);
  }

  query += ` ORDER BY o.OpportunityId DESC`;

  const opportunities = db.prepare(query).all(...params);

  res.render('opportunities/index', {
    activePage: 'opportunities',
    opportunities,
    search: search || '',
    stage: stage || 'All',
    status: status || 'All'
  });
});

// GET /opportunities/new (Create form)
router.get('/new', (req, res) => {
  const user = req.session.user;
    let customersQuery = "SELECT CustomerId, CustomerName, CustomerCode FROM Customers WHERE Status = 'Active'";
  if (user.Role === 'SalesExecutive') {
    customersQuery += ` AND (OwnerId = ${user.UserId} OR CreatedBy = ${user.UserId})`;
  }
  const customers = db.prepare(customersQuery).all();
  const salesUsers = db.prepare(`SELECT UserId, Name, Role FROM Users WHERE IsActive = 1 AND Role IN ('SalesExecutive', 'Manager')`).all();

  const prefillCustomerId = req.query.customerId ? parseInt(req.query.customerId, 10) : null;
  const defaultCloseDate = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];

  res.render('opportunities/form', {
    activePage: 'opportunities',
    title: 'New Opportunity',
    isEdit: false,
    opportunity: {
      CustomerId: prefillCustomerId,
      Amount: 100000,
      Probability: 50,
      Stage: 'Qualification',
      ExpectedCloseDate: defaultCloseDate
    },
    customers,
    salesUsers,
    errors: [],
    oldInput: {}
  });
});

// POST /opportunities (Create action)
router.post('/', [
  body('OpportunityName').trim().notEmpty().withMessage('Opportunity Name is required.').isLength({ max: 150 }),
  body('CustomerId').notEmpty().withMessage('Customer selection is required.').isInt().withMessage('Invalid customer.'),
  body('Amount').isFloat({ gt: 0 }).withMessage('Opportunity Amount must be greater than 0.'),
  body('Probability').isInt({ min: 0, max: 100 }).withMessage('Probability must be between 0 and 100.'),
  body('Stage').isIn(['Qualification', 'Proposal', 'Negotiation', 'Won', 'Lost']).withMessage('Invalid stage.'),
  body('ExpectedCloseDate').isISO8601().withMessage('Valid Expected Close Date is required.')
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
  const user = req.session.user;

  if (!errors.isEmpty()) {
      let customersQuery = "SELECT CustomerId, CustomerName, CustomerCode FROM Customers WHERE Status = 'Active'";
    if (user.Role === 'SalesExecutive') {
      customersQuery += ` AND (OwnerId = ${user.UserId} OR CreatedBy = ${user.UserId})`;
    }
    const customers = db.prepare(customersQuery).all();
    const salesUsers = db.prepare(`SELECT UserId, Name, Role FROM Users WHERE IsActive = 1 AND Role IN ('SalesExecutive', 'Manager')`).all();

    return res.status(400).render('opportunities/form', {
      activePage: 'opportunities',
      title: 'New Opportunity',
      isEdit: false,
      opportunity: req.body,
      customers,
      salesUsers,
      errors: errors.array(),
      oldInput: req.body
    });
  }

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

  logAudit(req, {
    action: 'CREATE',
    entityName: 'Opportunity',
    recordId: newId,
    newValue: JSON.stringify({ OpportunityName, CustomerId, Amount, Stage, Probability, ExpectedCloseDate, status, assignedUserId })
  });

  req.session.flashSuccess = `Opportunity "${OpportunityName}" created successfully.`;
  res.redirect(`/opportunities/${newId}`);
});

// GET /opportunities/:id (Details)
router.get('/:id', (req, res) => {
  const oppId = parseInt(req.params.id, 10);
  const opp = db.prepare(`
    SELECT o.*, c.CustomerName, c.CustomerCode, u.Name as AssignedName
    FROM Opportunities o
    LEFT JOIN Customers c ON o.CustomerId = c.CustomerId
    LEFT JOIN Users u ON o.AssignedTo = u.UserId
    WHERE o.OpportunityId = ?
  `).get(oppId);

  if (!opp) {
    return res.status(404).render('partials/error', {
      title: 'Opportunity Not Found',
      statusCode: 404,
      message: 'The requested opportunity does not exist.'
    });
  }

  if (!canAccessOpportunity(req.session.user, opp)) {
    return res.status(403).render('partials/error', {
      title: '403 Forbidden',
      statusCode: 403,
      message: 'You are not authorized to view this opportunity.'
    });
  }

  // Weighted pipeline value: Amount * Probability / 100
  const weightedValue = (opp.Amount * opp.Probability) / 100;

  res.render('opportunities/details', {
    activePage: 'opportunities',
    opp,
    weightedValue
  });
});

// GET /opportunities/:id/edit (Edit form)
router.get('/:id/edit', (req, res) => {
  const oppId = parseInt(req.params.id, 10);
  const opp = db.prepare('SELECT * FROM Opportunities WHERE OpportunityId = ?').get(oppId);

  if (!opp) {
    return res.status(404).render('partials/error', { title: '404', statusCode: 404, message: 'Opportunity not found.' });
  }

  if (!canAccessOpportunity(req.session.user, opp)) {
    return res.status(403).render('partials/error', { title: '403 Forbidden', statusCode: 403, message: 'Access denied.' });
  }

  const user = req.session.user;
    let customersQuery = "SELECT CustomerId, CustomerName, CustomerCode FROM Customers WHERE Status = 'Active'";
  if (user.Role === 'SalesExecutive') {
    customersQuery += ` AND (OwnerId = ${user.UserId} OR CreatedBy = ${user.UserId})`;
  }
  const customers = db.prepare(customersQuery).all();
  const salesUsers = db.prepare(`SELECT UserId, Name, Role FROM Users WHERE IsActive = 1 AND Role IN ('SalesExecutive', 'Manager')`).all();

  res.render('opportunities/form', {
    activePage: 'opportunities',
    title: `Edit Opportunity: ${opp.OpportunityName}`,
    isEdit: true,
    opportunity: opp,
    customers,
    salesUsers,
    errors: [],
    oldInput: {}
  });
});

// POST /opportunities/:id/edit (Update action)
router.post('/:id/edit', [
  body('OpportunityName').trim().notEmpty().withMessage('Opportunity Name is required.').isLength({ max: 150 }),
  body('CustomerId').notEmpty().withMessage('Customer selection is required.').isInt(),
  body('Amount').isFloat({ gt: 0 }).withMessage('Opportunity Amount must be greater than 0.'),
  body('Probability').isInt({ min: 0, max: 100 }).withMessage('Probability must be between 0 and 100.'),
  body('Stage').isIn(['Qualification', 'Proposal', 'Negotiation', 'Won', 'Lost']).withMessage('Invalid stage.'),
  body('ExpectedCloseDate').isISO8601().withMessage('Valid Expected Close Date is required.')
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
  const oppId = parseInt(req.params.id, 10);
  const oldOpp = db.prepare('SELECT * FROM Opportunities WHERE OpportunityId = ?').get(oppId);

  if (!oldOpp) {
    return res.status(404).render('partials/error', { title: '404', statusCode: 404, message: 'Opportunity not found.' });
  }

  const user = req.session.user;
  if (!canAccessOpportunity(user, oldOpp)) {
    return res.status(403).render('partials/error', { title: '403 Forbidden', statusCode: 403, message: 'Access denied.' });
  }

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
      let customersQuery = "SELECT CustomerId, CustomerName, CustomerCode FROM Customers WHERE Status = 'Active'";
    if (user.Role === 'SalesExecutive') {
      customersQuery += ` AND (OwnerId = ${user.UserId} OR CreatedBy = ${user.UserId})`;
    }
    const customers = db.prepare(customersQuery).all();
    const salesUsers = db.prepare(`SELECT UserId, Name, Role FROM Users WHERE IsActive = 1 AND Role IN ('SalesExecutive', 'Manager')`).all();

    return res.status(400).render('opportunities/form', {
      activePage: 'opportunities',
      title: `Edit Opportunity: ${oldOpp.OpportunityName}`,
      isEdit: true,
      opportunity: { ...oldOpp, ...req.body },
      customers,
      salesUsers,
      errors: errors.array(),
      oldInput: req.body
    });
  }

  const { OpportunityName, CustomerId, Amount, Stage, Probability, ExpectedCloseDate, AssignedTo, Notes } = req.body;
  const assignedUserId = user.Role === 'SalesExecutive' ? oldOpp.AssignedTo : (AssignedTo ? parseInt(AssignedTo, 10) : oldOpp.AssignedTo);

  let status = 'Active';
  if (Stage === 'Won') status = 'Won';
  else if (Stage === 'Lost') status = 'Lost';

  const update = db.prepare(`
    UPDATE Opportunities
    SET OpportunityName = ?, CustomerId = ?, Amount = ?, Stage = ?, Probability = ?, ExpectedCloseDate = ?, Status = ?, AssignedTo = ?, Notes = ?
    WHERE OpportunityId = ?
  `);

  update.run(
    OpportunityName.trim(),
    parseInt(CustomerId, 10),
    parseFloat(Amount),
    Stage,
    parseInt(Probability, 10),
    ExpectedCloseDate,
    status,
    assignedUserId,
    (Notes || '').trim(),
    oppId
  );

  logAudit(req, {
    action: 'UPDATE',
    entityName: 'Opportunity',
    recordId: oppId,
    oldValue: JSON.stringify(oldOpp),
    newValue: JSON.stringify({ OpportunityName, CustomerId, Amount, Stage, Probability, ExpectedCloseDate, status, assignedUserId })
  });

  req.session.flashSuccess = `Opportunity "${OpportunityName}" updated successfully.`;
  res.redirect(`/opportunities/${oppId}`);
});

// POST /opportunities/:id/delete (Delete action)
router.post('/:id/delete', (req, res) => {
  const oppId = parseInt(req.params.id, 10);
  const opp = db.prepare('SELECT * FROM Opportunities WHERE OpportunityId = ?').get(oppId);

  if (!opp) {
    return res.status(404).render('partials/error', { title: '404', statusCode: 404, message: 'Opportunity not found.' });
  }

  const user = req.session.user;
  if (!canAccessOpportunity(user, opp)) {
    return res.status(403).render('partials/error', { title: '403 Forbidden', statusCode: 403, message: 'Access denied.' });
  }

  db.prepare('DELETE FROM Opportunities WHERE OpportunityId = ?').run(oppId);

  logAudit(req, {
    action: 'DELETE',
    entityName: 'Opportunity',
    recordId: oppId,
    oldValue: JSON.stringify(opp),
    newValue: null
  });

  req.session.flashSuccess = `Opportunity "${opp.OpportunityName}" deleted successfully.`;
  res.redirect('/opportunities');
});

module.exports = router;
