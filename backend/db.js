const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'acxiomcrm.db');
const db = new Database(dbPath);

// Enable WAL mode and foreign keys
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS Users (
      UserId INTEGER PRIMARY KEY AUTOINCREMENT,
      Name TEXT NOT NULL,
      Email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      PasswordHash TEXT NOT NULL,
      Role TEXT NOT NULL CHECK(Role IN ('Admin', 'Manager', 'SalesExecutive')),
      IsActive INTEGER NOT NULL DEFAULT 1,
      FailedLoginCount INTEGER NOT NULL DEFAULT 0,
      LockoutEnd TEXT DEFAULT NULL,
      CreatedDate TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS Customers (
      CustomerId INTEGER PRIMARY KEY AUTOINCREMENT,
      CustomerCode TEXT NOT NULL UNIQUE,
      CustomerName TEXT NOT NULL,
      Email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      Phone TEXT NOT NULL UNIQUE,
      CompanyName TEXT,
      Address TEXT,
      City TEXT,
      State TEXT,
      Status TEXT NOT NULL DEFAULT 'Active' CHECK(Status IN ('Active', 'Inactive')),
      CreatedDate TEXT NOT NULL,
      CreatedBy INTEGER NOT NULL,
      OwnerId INTEGER NOT NULL,
      FOREIGN KEY (CreatedBy) REFERENCES Users(UserId),
      FOREIGN KEY (OwnerId) REFERENCES Users(UserId)
    );

    CREATE TABLE IF NOT EXISTS Leads (
      LeadId INTEGER PRIMARY KEY AUTOINCREMENT,
      LeadCode TEXT NOT NULL UNIQUE,
      LeadName TEXT NOT NULL,
      Email TEXT NOT NULL,
      Phone TEXT NOT NULL,
      CompanyName TEXT,
      Source TEXT,
      Status TEXT NOT NULL DEFAULT 'New' CHECK(Status IN ('New', 'Contacted', 'Qualified', 'Unqualified', 'Converted', 'Lost')),
      ExpectedValue REAL NOT NULL DEFAULT 0,
      CreatedDate TEXT NOT NULL,
      AssignedTo INTEGER NOT NULL,
      FOREIGN KEY (AssignedTo) REFERENCES Users(UserId)
    );

    CREATE TABLE IF NOT EXISTS Opportunities (
      OpportunityId INTEGER PRIMARY KEY AUTOINCREMENT,
      OpportunityName TEXT NOT NULL,
      CustomerId INTEGER NOT NULL,
      LeadId INTEGER,
      Amount REAL NOT NULL CHECK(Amount > 0),
      Stage TEXT NOT NULL DEFAULT 'Qualification' CHECK(Stage IN ('Qualification', 'Proposal', 'Negotiation', 'Won', 'Lost')),
      Probability INTEGER NOT NULL CHECK(Probability >= 0 AND Probability <= 100),
      ExpectedCloseDate TEXT NOT NULL,
      Status TEXT NOT NULL DEFAULT 'Active' CHECK(Status IN ('Active', 'Won', 'Lost')),
      CreatedDate TEXT NOT NULL,
      AssignedTo INTEGER NOT NULL,
      Notes TEXT,
      FOREIGN KEY (CustomerId) REFERENCES Customers(CustomerId) ON DELETE CASCADE,
      FOREIGN KEY (LeadId) REFERENCES Leads(LeadId) ON DELETE SET NULL,
      FOREIGN KEY (AssignedTo) REFERENCES Users(UserId)
    );

    CREATE TABLE IF NOT EXISTS FollowUps (
      FollowUpId INTEGER PRIMARY KEY AUTOINCREMENT,
      CustomerId INTEGER,
      LeadId INTEGER,
      FollowUpDate TEXT NOT NULL,
      FollowUpType TEXT NOT NULL CHECK(FollowUpType IN ('Call', 'Meeting', 'Email', 'Task')),
      Remarks TEXT NOT NULL,
      Status TEXT NOT NULL DEFAULT 'Planned' CHECK(Status IN ('Planned', 'Completed', 'Missed', 'Cancelled')),
      AssignedTo INTEGER NOT NULL,
      CreatedDate TEXT NOT NULL,
      FOREIGN KEY (CustomerId) REFERENCES Customers(CustomerId) ON DELETE CASCADE,
      FOREIGN KEY (LeadId) REFERENCES Leads(LeadId) ON DELETE CASCADE,
      FOREIGN KEY (AssignedTo) REFERENCES Users(UserId)
    );

    CREATE TABLE IF NOT EXISTS AuditLog (
      AuditLogId INTEGER PRIMARY KEY AUTOINCREMENT,
      UserId INTEGER,
      Action TEXT NOT NULL,
      EntityName TEXT NOT NULL,
      RecordId TEXT,
      OldValue TEXT,
      NewValue TEXT,
      CreatedDate TEXT NOT NULL,
      IpAddress TEXT,
      FOREIGN KEY (UserId) REFERENCES Users(UserId) ON DELETE SET NULL
    );
  `);

  seedData();
}

function seedData() {
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM Users').get().count;
  if (userCount === 0) {
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync('Test@1234', salt);
    const now = new Date().toISOString();

    const insertUser = db.prepare(`
      INSERT INTO Users (Name, Email, PasswordHash, Role, IsActive, FailedLoginCount, CreatedDate)
      VALUES (?, ?, ?, ?, 1, 0, ?)
    `);

    const admin = insertUser.run('System Admin', 'admin@acxiom.com', passwordHash, 'Admin', now);
    const manager = insertUser.run('Sales Manager', 'manager@acxiom.com', passwordHash, 'Manager', now);
    const sales = insertUser.run('Sales Executive', 'sales@acxiom.com', passwordHash, 'SalesExecutive', now);

    const salesId = Number(sales.lastInsertRowid);
    const managerId = Number(manager.lastInsertRowid);
    const adminId = Number(admin.lastInsertRowid);

    // Seed sample customers
    const insertCustomer = db.prepare(`
      INSERT INTO Customers (CustomerCode, CustomerName, Email, Phone, CompanyName, Address, City, State, Status, CreatedDate, CreatedBy, OwnerId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const cust1 = insertCustomer.run(
      'CUST-001', 'Reliance Industries', 'contact@reliance.com', '9876543210',
      'Reliance Ltd', 'Maker Chambers IV, Nariman Point', 'Mumbai', 'Maharashtra', 'Active', now, salesId, salesId
    );
    const cust2 = insertCustomer.run(
      'CUST-002', 'Tata Consultancy Services', 'tcs.corp@tcs.com', '9876543211',
      'Tata Sons', 'Banyan Park', 'Mumbai', 'Maharashtra', 'Active', now, managerId, salesId
    );
    const cust3 = insertCustomer.run(
      'CUST-003', 'Infosys Technologies', 'procure@infosys.com', '9876543212',
      'Infosys Ltd', 'Electronics City', 'Bengaluru', 'Karnataka', 'Active', now, adminId, salesId
    );

    // Seed sample leads
    const insertLead = db.prepare(`
      INSERT INTO Leads (LeadCode, LeadName, Email, Phone, CompanyName, Source, Status, ExpectedValue, CreatedDate, AssignedTo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const lead1 = insertLead.run('LEAD-001', 'Anand Verma', 'anand@vermatech.com', '9876543213', 'Verma Tech', 'Website', 'Qualified', 450000, now, salesId);
    const lead2 = insertLead.run('LEAD-002', 'Priya Sharma', 'priya@sharmaenterprises.in', '9876543214', 'Sharma Enterprises', 'Referral', 'Contacted', 250000, now, salesId);
    const lead3 = insertLead.run('LEAD-003', 'Vikram Malhotra', 'vikram@malhotragroup.com', '9876543215', 'Malhotra Group', 'LinkedIn', 'New', 180000, now, salesId);

    // Seed sample opportunities
    const insertOpp = db.prepare(`
      INSERT INTO Opportunities (OpportunityName, CustomerId, LeadId, Amount, Stage, Probability, ExpectedCloseDate, Status, CreatedDate, AssignedTo, Notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Tomorrow date format YYYY-MM-DD
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];

    insertOpp.run('Enterprise Cloud Migration', cust1.lastInsertRowid, null, 750000, 'Proposal', 60, nextMonth, 'Active', now, salesId, 'Client requested detailed architecture proposal.');
    insertOpp.run('Annual AMC Renewal', cust2.lastInsertRowid, null, 300000, 'Negotiation', 80, tomorrow, 'Active', now, salesId, 'Final discount discussions ongoing.');
    insertOpp.run('Digital Transformation Phase 1', cust3.lastInsertRowid, null, 1200000, 'Won', 100, tomorrow, 'Won', now, salesId, 'Contract signed.');

    // Seed sample follow-ups
    const insertFollowUp = db.prepare(`
      INSERT INTO FollowUps (CustomerId, LeadId, FollowUpDate, FollowUpType, Remarks, Status, AssignedTo, CreatedDate)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertFollowUp.run(cust1.lastInsertRowid, null, tomorrow, 'Meeting', 'Demo CRM features to leadership team', 'Planned', salesId, now);
    insertFollowUp.run(null, lead1.lastInsertRowid, tomorrow, 'Call', 'Confirm technical requirements with Anand', 'Planned', salesId, now);

    // Seed initial AuditLog
    const insertAudit = db.prepare(`
      INSERT INTO AuditLog (UserId, Action, EntityName, RecordId, OldValue, NewValue, CreatedDate, IpAddress)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertAudit.run(adminId, 'SEED', 'System', '0', null, 'System initialized with baseline seed data', now, '127.0.0.1');
  }
}

initDb();

module.exports = db;
