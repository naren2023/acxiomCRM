# AcxiomCRM

A lightweight, enterprise-grade Role-Based Customer Relationship Management (CRM) application built strictly with **Node.js**, **Express**, **SQLite (`better-sqlite3`)**, **EJS views**, **Bootstrap 5 (CDN)**, and **Chart.js (CDN)**.

Complies with the technical and functional specification in `AcxiomCRM_Complete_Project_Assignment.pdf`.

---

## 1. Quick Setup & Run

### Prerequisites
- Node.js installed (v18+)

### Installation
Clone or navigate to the project repository:
```bash
cd c:\PROJECTS\acxiomCRM
npm install
```

### Start the Application
```bash
npm start
```
The server will start at: **`http://localhost:3000`**

---

## 2. Cloud Deployment (GitHub Pages & Render)

### Live Deployment Status:
- **Frontend Portal (GitHub Pages)**: [https://naren2023.github.io/acxiomCRM/](https://naren2023.github.io/acxiomCRM/) *(Live & Active)*
- **Backend Service (Render Blueprint)**: [Deploy AcxiomCRM to Render](https://render.com/deploy?repo=https://github.com/naren2023/acxiomCRM)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/naren2023/acxiomCRM)

### Architecture:
1. **Frontend Portal (GitHub Pages)**:
   - Hosted directly from the `/docs` directory on GitHub Pages.
   - Live URL: **`https://naren2023.github.io/acxiomCRM/`**
   - Provides a responsive dashboard overview, demo login credentials, API explorer for testing backend endpoints, and direct links to the running CRM.
2. **Backend Service (Render)**:
   - Pre-configured using [`render.yaml`](render.yaml) blueprint.
   - Deploys as a Node.js web service running the Express app and SQLite database.
   - Click the **Deploy to Render** button above or in the Render Dashboard go to **New > Blueprint** &rarr; select **`naren2023/acxiomCRM`** &rarr; **Apply**.
   - Once deployed, copy your Render app URL (e.g., `https://acxiomcrm-backend.onrender.com`) and paste it into the backend URL input on the GitHub Pages portal to test live API calls.

---

## 3. Directory Structure (Frontend & Backend Separation)

```
acxiomCRM/
├── backend/                       # Server-side logic, APIs, and database
│   ├── middleware/                # Custom auth, role-check, CSRF, and audit middlewares
│   │   ├── audit.js
│   │   ├── auth.js
│   │   └── csrf.js
│   ├── routes/                    # Modular Express route controllers
│   │   ├── api.js                 # REST API endpoints
│   │   ├── audit.js               # Admin audit log viewer
│   │   ├── auth.js                # Login, registration, lockout, logout
│   │   ├── customers.js           # Customers CRUD
│   │   ├── dashboard.js           # KPI cards & Chart.js statistics
│   │   ├── followups.js           # Follow-ups schedule CRUD
│   │   ├── leads.js               # Leads CRUD & atomic conversion
│   │   ├── opportunities.js       # Opportunities pipeline CRUD
│   │   └── reports.js             # Pipeline management report
│   ├── app.js                     # Express application configuration
│   ├── db.js                      # SQLite database initialization & seeding
│   └── server.js                  # Backend HTTP listener
├── frontend/                      # Presentation layer, UI views, and static assets
│   ├── public/                    # Client-side static assets
│   │   ├── css/
│   │   │   └── custom.css         # Modern CRM theme styling
│   │   └── js/
│   │       └── validation.js      # Client-side validation & inline error messages
│   └── views/                     # EJS views and templates
│       ├── audit/                 # Audit log UI
│       ├── auth/                  # Login & registration views
│       ├── customers/             # Customer views (list, form, details)
│       ├── dashboard/             # Executive dashboard & charts
│       ├── followups/             # Follow-up schedule views
│       ├── leads/                 # Lead views (list, form, details)
│       ├── opportunities/         # Opportunity views (list, form, details)
│       ├── partials/              # Shared partials (header, navbar, footer, alerts)
│       └── reports/               # Executive pipeline report
├── docs/                          # GitHub Pages static frontend portal
│   └── index.html                 # Frontend portal with API explorer and demo info
├── package.json                   # Project metadata and dependencies
├── render.yaml                    # Render blueprint deployment configuration
├── server.js                      # Root server launcher
├── test_acceptance.js             # Automated 14-step Section 17.19 acceptance test suite
├── test_all_features.js           # Extended edge-case test suite
└── README.md                      # Comprehensive documentation
```

---

## 4. Seeded User Credentials

All seeded accounts share the default password **`Test@1234`** (complies with the enterprise password policy):

| Role | Email | Password | Scope & Permissions |
| :--- | :--- | :--- | :--- |
| **Admin** | `admin@acxiom.com` | `Test@1234` | Full system access, audit logs, all CRM data, reports, user administration. |
| **Manager** | `manager@acxiom.com` | `Test@1234` | Full team pipeline visibility, team records, management pipeline reports. |
| **SalesExecutive** | `sales@acxiom.com` | `Test@1234` | Scoped visibility: only assigned customers, leads, opportunities, and follow-ups. |

*Quick login buttons are also available directly on the login screen for rapid testing.*

---

## 5. Architecture & Phase Summary

### Phase 1: Authentication & Security
- **Session & Password Hashing**: `express-session` with secure cookies + `bcryptjs` salted password hashing.
- **Password Policy**: Enforced on server and client (minimum 8 characters, at least 1 uppercase letter, 1 lowercase letter, 1 digit).
- **Account Lockout**: Automatically locks an account for **15 minutes** after **5 consecutive failed login attempts**.
- **Anti-CSRF Protection**: Cryptographic CSRF token attached to all sessions, rendered in all POST forms (`_csrf`), and verified by `middleware/csrf.js`.
- **Role-Based Authorization**: `requireRole('Admin', 'Manager', 'SalesExecutive')` enforced at server route level.
- **Shared Layout**: Responsive Bootstrap 5 navbar dynamically rendering menu items based on the authenticated user's role.

### Phase 2: Core CRM Modules (CRUD)
- **Customers**: List, search by (name, email, phone, company), filter by status, create, view, edit, delete. Enforces unique email, unique 10-digit phone, and required fields.
- **Leads**: Full lifecycle tracking (`New`, `Contacted`, `Qualified`, `Unqualified`, `Converted`, `Lost`). Invalid transitions are rejected at the server level. Includes an atomic **Convert** workflow that generates a Customer and an Opportunity in a single transaction.
- **Opportunities**: Tracks commercial pipeline (`Qualification`, `Proposal`, `Negotiation`, `Won`, `Lost`). Validates `Amount > 0`, `Probability 0-100`, and rejects `ExpectedCloseDate` in the past for active deals. Computes weighted pipeline values.
- **Follow-ups**: Schedules interactions (`Call`, `Meeting`, `Email`, `Task`) linked to customers or leads. Validates that scheduled follow-up dates cannot be earlier than today.
- **Data Scoping**: Sales executives only see records assigned to them or created by them.

### Phase 3: Audit Logging & Dashboard Analytics
- **AuditLog Table**: Records `UserId`, `Action`, `EntityName`, `RecordId`, `OldValue`, `NewValue`, `CreatedDate`, `IpAddress` on:
  - Login success and failed attempts / account lockouts
  - Create, Update, and Delete on all CRM entities
  - Lead conversions
- **Admin Audit View (`/audit`)**: Filter by Action, Entity, and User with old vs new diff view.
- **Dashboard (`/dashboard`)**: Displays the 8 mandatory KPI cards from Section 17.11:
  - Total Customers
  - Total Leads
  - Open Leads
  - Total Pipeline Value
  - Total Opportunities
  - Open Opportunities
  - Won Opportunities
  - Lost Opportunities
- **Chart.js Visualizations**:
  1. *Lead Status Breakdown* (Doughnut Chart)
  2. *Pipeline by Stage* (Bar Chart)
  3. *Monthly Won Sales* (Line Chart)
- **Pipeline Report (`/reports/pipeline`)**: Stage-wise and sales rep-wise weighted revenue forecasts for Admin and Manager.

### Phase 4: REST API
All endpoints are authenticated via session, role-scoped, input-validated, and return clean JSON with proper HTTP status codes:
- `GET /api/customers` (200 OK)
- `POST /api/customers` (201 Created / 400 Bad Request)
- `GET /api/customers/:id` (200 OK / 403 Forbidden / 404 Not Found)
- `PUT /api/customers/:id` (200 OK / 400 Bad Request / 403 Forbidden / 404 Not Found)
- `DELETE /api/customers/:id` (200 OK / 403 Forbidden / 404 Not Found)
- `GET /api/leads` (200 OK)
- `POST /api/leads` (201 Created / 400 Bad Request)
- `GET /api/opportunities` (200 OK)
- `POST /api/opportunities` (201 Created / 400 Bad Request)

---

## 6. Section 17.19 Acceptance Scenario Walkthrough

The automated acceptance test suite in `test_acceptance.js` verifies all 14 steps defined in Section 17.19:

```bash
node test_acceptance.js
```

### Results Summary:
1. **Unauthenticated access to protected pages**: Attempting to load `/dashboard` or `/customers` redirects to `/login` (HTTP 302). Anonymous `/api/customers` returns `HTTP 401 Unauthorized`. `[PASS]`
2. **Register/Login valid user**: Authenticating as `admin@acxiom.com` succeeds, sets session, and redirects to Dashboard. `[PASS]`
3. **Client-side validation on invalid Customer inputs**: HTML5 + JS (`validation.js`) catches empty names, invalid email syntax, and non-10-digit phone numbers with inline feedback. `[PASS]`
4. **Bypass browser validation with crafted request**: Server-side `express-validator` rejects requests with empty names or malformed emails with `HTTP 400 Bad Request`. `[PASS]`
5. **Opportunity Amount <= 0**: Server rejects Opportunity creation when `Amount <= 0` with `HTTP 400 Bad Request`. `[PASS]`
6. **Opportunity Probability > 100**: Server rejects Opportunity creation when `Probability > 100` with `HTTP 400 Bad Request`. `[PASS]`
7. **Expected Close Date in the past**: Active opportunities with historical close dates are rejected with `HTTP 400 Bad Request`. `[PASS]`
8. **Follow-Up dated before today**: Scheduling a planned follow-up in the past is rejected with `HTTP 400 Bad Request`. `[PASS]`
9. **SalesExecutive scoping**: Logging in as `sales@acxiom.com` restricts record visibility to assigned records and denies access to `/audit` and `/reports/pipeline` (`HTTP 403 Forbidden`). `[PASS]`
10. **Manager pipeline access**: Logging in as `manager@acxiom.com` grants access to `/reports/pipeline` (`HTTP 200 OK`) while restricting security audit administration (`HTTP 403 Forbidden`). `[PASS]`
11. **Admin security administration**: Logging in as `admin@acxiom.com` provides full access to `/audit` with filtering capabilities (`HTTP 200 OK`). `[PASS]`
12. **Audit log creation on CRM operations**: Create, update, delete, and lead conversions generate immutable records in the `AuditLog` table. `[PASS]`
13. **REST API access**: Authenticated call to `GET /api/customers` returns JSON array with status `200 OK`. `[PASS]`
14. **Dashboard KPI cards & Chart.js**: `/dashboard` loads all 8 Section 17.11 metric cards and initializes 3 Chart.js visualizations. `[PASS]`

---

## 7. Security Highlights
- **Parameterized SQL Only**: All queries use `better-sqlite3` prepared statements with parameter binding to prevent SQL injection.
- **Passwords Never Logged or Exposed**: Password hashes are excluded from all API responses, views, and audit log entries.
- **Anti-CSRF Protection**: Tokens enforced on all HTML form state-modifying POST requests.
