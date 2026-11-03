const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);
router.use(requireRole('Admin', 'Manager'));

// GET /reports/pipeline
router.get('/pipeline', (req, res) => {
  const { stage, assignedTo } = req.query;

  // 1. Stage-wise breakdown
  const stageStatsQuery = `
    SELECT 
      Stage,
      COUNT(*) as oppCount,
      COALESCE(SUM(Amount), 0) as totalAmount,
      COALESCE(AVG(Probability), 0) as avgProb,
      COALESCE(SUM(Amount * Probability / 100.0), 0) as weightedValue
    FROM Opportunities
    GROUP BY Stage
  `;
  const stageStats = db.prepare(stageStatsQuery).all();

  // 2. Owner-wise breakdown
  const ownerStatsQuery = `
    SELECT 
      u.UserId,
      u.Name as OwnerName,
      COUNT(o.OpportunityId) as oppCount,
      COALESCE(SUM(o.Amount), 0) as totalAmount,
      COALESCE(SUM(CASE WHEN o.Stage = 'Won' THEN o.Amount ELSE 0 END), 0) as wonAmount,
      COALESCE(SUM(o.Amount * o.Probability / 100.0), 0) as weightedValue
    FROM Users u
    LEFT JOIN Opportunities o ON u.UserId = o.AssignedTo
    WHERE u.Role IN ('SalesExecutive', 'Manager')
    GROUP BY u.UserId
  `;
  const ownerStats = db.prepare(ownerStatsQuery).all();

  // 3. Filtered opportunity listing
  let detailQuery = `
    SELECT o.*, c.CustomerName, u.Name as OwnerName
    FROM Opportunities o
    LEFT JOIN Customers c ON o.CustomerId = c.CustomerId
    LEFT JOIN Users u ON o.AssignedTo = u.UserId
    WHERE 1=1
  `;
  const params = [];

  if (stage && stage !== 'All') {
    detailQuery += ' AND o.Stage = ?';
    params.push(stage);
  }

  if (assignedTo && assignedTo !== 'All') {
    detailQuery += ' AND o.AssignedTo = ?';
    params.push(parseInt(assignedTo, 10));
  }

  detailQuery += ' ORDER BY o.Amount DESC';
  const opportunities = db.prepare(detailQuery).all(...params);

  const salesUsers = db.prepare(`SELECT UserId, Name, Role FROM Users WHERE IsActive = 1 AND Role IN ('SalesExecutive', 'Manager')`).all();

  // Totals
  const totalPipeline = stageStats.reduce((acc, s) => acc + s.totalAmount, 0);
  const totalWeighted = stageStats.reduce((acc, s) => acc + s.weightedValue, 0);

  res.render('reports/pipeline', {
    activePage: 'pipeline',
    stageStats,
    ownerStats,
    opportunities,
    salesUsers,
    totalPipeline,
    totalWeighted,
    stage: stage || 'All',
    assignedTo: assignedTo || 'All'
  });
});

module.exports = router;
