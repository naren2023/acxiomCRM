const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// GET /dashboard
router.get('/', (req, res) => {
  const user = req.session.user;
  const isSalesExec = user.Role === 'SalesExecutive';
  const userId = user.UserId;

  // 1. Total Customers
  const customerCountQuery = isSalesExec
    ? 'SELECT COUNT(*) as count FROM Customers WHERE OwnerId = ? OR CreatedBy = ?'
    : 'SELECT COUNT(*) as count FROM Customers';
  const totalCustomers = (isSalesExec
    ? db.prepare(customerCountQuery).get(userId, userId)
    : db.prepare(customerCountQuery).get()).count;

  // 2. Leads: Total and Open
  const totalLeadsQuery = isSalesExec
    ? 'SELECT COUNT(*) as count FROM Leads WHERE AssignedTo = ?'
    : 'SELECT COUNT(*) as count FROM Leads';
  const totalLeads = (isSalesExec
    ? db.prepare(totalLeadsQuery).get(userId)
    : db.prepare(totalLeadsQuery).get()).count;

  const openLeadsQuery = isSalesExec
    ? `SELECT COUNT(*) as count FROM Leads WHERE AssignedTo = ? AND Status IN ('New', 'Contacted', 'Qualified')`
    : `SELECT COUNT(*) as count FROM Leads WHERE Status IN ('New', 'Contacted', 'Qualified')`;
  const openLeads = (isSalesExec
    ? db.prepare(openLeadsQuery).get(userId)
    : db.prepare(openLeadsQuery).get()).count;

  // 3. Opportunities: Total, Open, Won, Lost, and Pipeline Value
  const oppTotalQuery = isSalesExec
    ? 'SELECT COUNT(*) as count FROM Opportunities WHERE AssignedTo = ?'
    : 'SELECT COUNT(*) as count FROM Opportunities';
  const totalOpportunities = (isSalesExec
    ? db.prepare(oppTotalQuery).get(userId)
    : db.prepare(oppTotalQuery).get()).count;

  const openOppQuery = isSalesExec
    ? `SELECT COUNT(*) as count, COALESCE(SUM(Amount), 0) as pipelineValue FROM Opportunities WHERE AssignedTo = ? AND Status = 'Active'`
    : `SELECT COUNT(*) as count, COALESCE(SUM(Amount), 0) as pipelineValue FROM Opportunities WHERE Status = 'Active'`;
  const openOppRow = isSalesExec
    ? db.prepare(openOppQuery).get(userId)
    : db.prepare(openOppQuery).get();
  const openOpportunities = openOppRow.count;
  const totalPipelineValue = openOppRow.pipelineValue;

  const wonOppQuery = isSalesExec
    ? `SELECT COUNT(*) as count FROM Opportunities WHERE AssignedTo = ? AND (Status = 'Won' OR Stage = 'Won')`
    : `SELECT COUNT(*) as count FROM Opportunities WHERE Status = 'Won' OR Stage = 'Won'`;
  const wonOpportunities = (isSalesExec
    ? db.prepare(wonOppQuery).get(userId)
    : db.prepare(wonOppQuery).get()).count;

  const lostOppQuery = isSalesExec
    ? `SELECT COUNT(*) as count FROM Opportunities WHERE AssignedTo = ? AND (Status = 'Lost' OR Stage = 'Lost')`
    : `SELECT COUNT(*) as count FROM Opportunities WHERE Status = 'Lost' OR Stage = 'Lost'`;
  const lostOpportunities = (isSalesExec
    ? db.prepare(lostOppQuery).get(userId)
    : db.prepare(lostOppQuery).get()).count;

  // 4. Pending Follow-ups count
  const followUpQuery = isSalesExec
    ? `SELECT COUNT(*) as count FROM FollowUps WHERE AssignedTo = ? AND Status = 'Planned'`
    : `SELECT COUNT(*) as count FROM FollowUps WHERE Status = 'Planned'`;
  const pendingFollowUps = (isSalesExec
    ? db.prepare(followUpQuery).get(userId)
    : db.prepare(followUpQuery).get()).count;

  // 5. Chart 1 Data: Lead Statuses
  const leadStatuses = ['New', 'Contacted', 'Qualified', 'Unqualified', 'Converted', 'Lost'];
  const leadStatusCounts = {};
  leadStatuses.forEach(s => { leadStatusCounts[s] = 0; });

  const leadChartQuery = isSalesExec
    ? `SELECT Status, COUNT(*) as count FROM Leads WHERE AssignedTo = ? GROUP BY Status`
    : `SELECT Status, COUNT(*) as count FROM Leads GROUP BY Status`;
  const leadRows = isSalesExec
    ? db.prepare(leadChartQuery).all(userId)
    : db.prepare(leadChartQuery).all();
  leadRows.forEach(r => {
    if (leadStatusCounts[r.Status] !== undefined) leadStatusCounts[r.Status] = r.count;
  });

  // 6. Chart 2 Data: Opportunity Pipeline by Stage
  const oppStages = ['Qualification', 'Proposal', 'Negotiation', 'Won', 'Lost'];
  const stageAmounts = {};
  oppStages.forEach(st => { stageAmounts[st] = 0; });

  const oppChartQuery = isSalesExec
    ? `SELECT Stage, SUM(Amount) as totalAmount FROM Opportunities WHERE AssignedTo = ? GROUP BY Stage`
    : `SELECT Stage, SUM(Amount) as totalAmount FROM Opportunities GROUP BY Stage`;
  const oppRows = isSalesExec
    ? db.prepare(oppChartQuery).all(userId)
    : db.prepare(oppChartQuery).all();
  oppRows.forEach(r => {
    if (stageAmounts[r.Stage] !== undefined) stageAmounts[r.Stage] = r.totalAmount;
  });

  // 7. Chart 3 Data: Monthly Sales / Won Outcome Totals
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthlySales = new Array(12).fill(0);

  const currentYear = new Date().getFullYear();
  const salesChartQuery = isSalesExec
    ? `SELECT strftime('%m', CreatedDate) as monthNum, SUM(Amount) as totalWon 
       FROM Opportunities 
       WHERE AssignedTo = ? AND (Status = 'Won' OR Stage = 'Won') AND strftime('%Y', CreatedDate) = ? 
       GROUP BY monthNum`
    : `SELECT strftime('%m', CreatedDate) as monthNum, SUM(Amount) as totalWon 
       FROM Opportunities 
       WHERE (Status = 'Won' OR Stage = 'Won') AND strftime('%Y', CreatedDate) = ? 
       GROUP BY monthNum`;

  const salesRows = isSalesExec
    ? db.prepare(salesChartQuery).all(userId, String(currentYear))
    : db.prepare(salesChartQuery).all(String(currentYear));

  salesRows.forEach(r => {
    const idx = parseInt(r.monthNum, 10) - 1;
    if (idx >= 0 && idx < 12) {
      monthlySales[idx] = r.totalWon || 0;
    }
  });

  // Also include recent activity / follow-ups
  const upcomingFollowUpsQuery = isSalesExec
    ? `SELECT f.*, c.CustomerName, l.LeadName FROM FollowUps f 
       LEFT JOIN Customers c ON f.CustomerId = c.CustomerId 
       LEFT JOIN Leads l ON f.LeadId = l.LeadId 
       WHERE f.AssignedTo = ? AND f.Status = 'Planned' 
       ORDER BY f.FollowUpDate ASC LIMIT 5`
    : `SELECT f.*, c.CustomerName, l.LeadName, u.Name as AssignedName FROM FollowUps f 
       LEFT JOIN Customers c ON f.CustomerId = c.CustomerId 
       LEFT JOIN Leads l ON f.LeadId = l.LeadId 
       LEFT JOIN Users u ON f.AssignedTo = u.UserId 
       WHERE f.Status = 'Planned' 
       ORDER BY f.FollowUpDate ASC LIMIT 5`;

  const upcomingFollowUps = isSalesExec
    ? db.prepare(upcomingFollowUpsQuery).all(userId)
    : db.prepare(upcomingFollowUpsQuery).all();

  res.render('dashboard/index', {
    activePage: 'dashboard',
    useChartJs: true,
    kpis: {
      totalCustomers,
      totalLeads,
      openLeads,
      totalOpportunities,
      openOpportunities,
      wonOpportunities,
      lostOpportunities,
      totalPipelineValue,
      pendingFollowUps
    },
    charts: {
      leadLabels: leadStatuses,
      leadData: leadStatuses.map(s => leadStatusCounts[s]),
      oppLabels: oppStages,
      oppData: oppStages.map(s => stageAmounts[s]),
      monthLabels: months,
      monthData: monthlySales
    },
    upcomingFollowUps
  });
});

module.exports = router;
