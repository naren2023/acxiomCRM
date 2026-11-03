AcxiomCRM
AcxiomCRM is a role-based Customer Relationship Management (CRM) web application built with Node.js, Express, SQLite (better-sqlite3), EJS, Bootstrap 5, and Chart.js.

The application helps manage customers, leads, sales opportunities, follow-up activities, user access, audit records, and sales-pipeline reports.
Project status: The application is configured to run locally. Cloud deployment is not included in this project documentation.

1. Technology Stack
Area	Technology
Runtime	Node.js (v18 or later)
Backend	Express.js
Database	SQLite with better-sqlite3
View engine	EJS
Frontend styling	Bootstrap 5
Charts	Chart.js
Authentication	Express Session and bcryptjs
Validation	express-validator and client-side validation


2. Prerequisites
Before running the application, make sure the following are installed:
- Node.js version 18 or later
- npm (included with Node.js)
- A code editor such as Visual Studio Code (optional)
To check your installed versions, run:
node --version
npm --version
3. Installation and Local Setup
1. Open a terminal or PowerShell window.
2. Navigate to the project folder.
3. Install the project dependencies.
4. Start the application.
cd path/to/AcxiomCRM
npm install
npm start
After the server starts, open the following address in your browser:

http://localhost:3000

Keep the terminal running while using the application. To stop the server, press Ctrl + C.
4. Project Directory Structure
AcxiomCRM/
├── backend/
│   ├── middleware/
│   │   ├── audit.js
│   │   ├── auth.js
│   │   └── csrf.js
│   ├── routes/
│   │   ├── api.js
│   │   ├── audit.js
│   │   ├── auth.js
│   │   ├── customers.js
│   │   ├── dashboard.js
│   │   ├── followups.js
│   │   ├── leads.js
│   │   ├── opportunities.js
│   │   └── reports.js
│   ├── app.js
│   ├── db.js
│   └── server.js
├── frontend/
│   ├── public/
│   │   ├── css/
│   │   │   └── custom.css
│   │   └── js/
│   │       └── validation.js
│   └── views/
│       ├── audit/
│       ├── auth/
│       ├── customers/
│       ├── dashboard/
│       ├── followups/
│       ├── leads/
│       ├── opportunities/
│       ├── partials/
│       └── reports/
├── docs/
│   └── index.html
├── package.json
├── render.yaml
├── server.js
├── test_acceptance.js
├── test_all_features.js
└── README.md
Main folders and files
- backend/ – Express application logic, database setup, route handlers, and middleware.
- frontend/views/ – EJS pages used to display the CRM interface.
- frontend/public/ – CSS stylesheets and client-side JavaScript.
- backend/routes/ – Routes for authentication, customers, leads, opportunities, follow-ups, reports, audit logs, and APIs.
- backend/middleware/ – Authentication, authorization, CSRF protection, and audit middleware.
- backend/db.js – Database initialization and seed data.
- test_acceptance.js – Acceptance test script.
- test_all_features.js – Additional feature and edge-case test script.
5. User Roles and Login Credentials
The application supports three roles with different access permissions.
Role	Email	Password	Access
Admin	admin@acxiom.com	Test@1234	Full access to CRM records, users, reports, and audit logs
Manager	manager@acxiom.com	Test@1234	Team records, pipeline visibility, and management reports
Sales Executive	sales@acxiom.com	Test@1234	Records assigned to or created by the sales executive


The project includes seeded demo accounts for local testing. Change default credentials before using the application with real data.
6. Main Features and Modules
6.1 Authentication and User Access
- User login and registration.
- Password hashing using bcryptjs.
- Session-based authentication.
- Role-based access control for Admin, Manager, and Sales Executive.
- Account lockout after five consecutive failed login attempts for 15 minutes.
- Password policy requiring at least eight characters, including uppercase, lowercase, and numeric characters.
- CSRF token validation for form submissions.
6.2 Customer Management
- Add, view, edit, and delete customer records.
- Search customers by name, email, phone number, or company.
- Filter customers by status.
- Validate required fields, email format, and phone number.
- Enforce unique email addresses and phone numbers.
6.3 Lead Management
- Create and maintain lead records.
- Track lead status through New, Contacted, Qualified, Unqualified, Converted, and Lost.
- Validate lead status transitions.
- Convert a qualified lead into a customer and an opportunity through a database transaction.
6.4 Opportunity Management
- Create, view, update, and manage sales opportunities.
- Track stages: Qualification, Proposal, Negotiation, Won, and Lost.
- Validate opportunity amount and probability.
- Prevent past expected closing dates for active opportunities.
- Calculate weighted pipeline values.
6.5 Follow-up Management
- Schedule customer and lead follow-ups.
- Support Call, Meeting, Email, and Task activities.
- View and manage scheduled follow-up activities.
- Validate follow-up dates to prevent scheduling in the past.
6.6 Dashboard and Analytics
The dashboard provides an overview of CRM performance through eight KPI cards:
1. Total Customers
2. Total Leads
3. Open Leads
4. Total Pipeline Value
5. Total Opportunities
6. Open Opportunities
7. Won Opportunities
8. Lost Opportunities
It also includes three Chart.js visualizations:
- Lead Status Breakdown – Doughnut Chart
- Pipeline by Stage – Bar Chart
- Monthly Won Sales – Line Chart
6.7 Reports
- View pipeline information by opportunity stage.
- Review weighted revenue forecasts.
- View sales-representative-wise pipeline information.
- Restrict pipeline reports to authorized roles.
6.8 Audit Logging
The application records important actions for accountability, including:
- Successful and failed login attempts.
- Account lockout events.
- Creation, updating, and deletion of CRM records.
- Lead conversion activities.
Admin users can review audit records and filter them by action, entity, and user.
6.9 REST API
The application provides authenticated REST API endpoints for CRM operations.
Method	Endpoint	Purpose
GET	/api/customers	Retrieve customer records
POST	/api/customers	Create a customer
GET	/api/customers/:id	Retrieve a customer by ID
PUT	/api/customers/:id	Update a customer
DELETE	/api/customers/:id	Delete a customer
GET	/api/leads	Retrieve lead records
POST	/api/leads	Create a lead
GET	/api/opportunities	Retrieve opportunity records
POST	/api/opportunities	Create an opportunity


The API uses session authentication, role-based permissions, input validation, and appropriate HTTP status codes.
7. Security Measures
The project includes the following security measures:
- Password hashing: Passwords are hashed using bcryptjs; plain-text passwords are not stored.
- SQL injection prevention: Database operations use prepared statements and parameter binding.
- Role-based authorization: Access to protected pages and operations is checked on the server.
- CSRF protection: CSRF tokens are verified for state-changing form submissions.
- Input validation: Both client-side and server-side validation are used.
- Session authentication: Protected CRM pages require an authenticated session.
- Audit logging: Important user and data operations are recorded.
8. Running the Test Scripts
The repository includes automated test scripts for checking application behavior.

Run the acceptance test script:
node test_acceptance.js
Run the extended feature test script:
node test_all_features.js
The acceptance test suite is described as covering scenarios such as:
- Access to protected pages without logging in.
- Valid user login.
- Client-side and server-side input validation.
- Opportunity and follow-up validation.
- Role-based access restrictions.
- Audit log creation.
- REST API access.
- Dashboard KPI cards and charts.
Run the scripts in the project environment and review the terminal output to confirm the results.
9. Application Workflow
A typical CRM workflow is:
1. Log in using an account with the required role.
2. Add or review customer and lead information.
3. Update lead status as communication progresses.
4. Convert eligible leads into customers and opportunities.
5. Create opportunities and update their sales stages.
6. Schedule follow-up activities.
7. Review dashboard metrics and pipeline reports.
8. Use audit logs to review recorded activities (Admin access).
10. Notes
- The application is intended to be started and accessed locally using the setup steps in this README.
- The local application address is http://localhost:3000.
- Keep the server process running while accessing the application.
- The demo credentials are provided for testing; replace them before using real customer information.
- The docs/ folder contains a static HTML file, while the main CRM application uses the Node.js and Express server.
11. Project Summary
AcxiomCRM brings customer information, lead tracking, opportunity management, follow-up scheduling, reporting, and audit logging together in one role-based application. It uses a modular backend structure, an EJS-based interface, and an SQLite database to provide a straightforward CRM solution with validation and security controls.
