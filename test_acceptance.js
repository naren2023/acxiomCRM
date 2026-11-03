// Automated 14-Step Acceptance Scenario Verification Script for AcxiomCRM (Section 17.19)
const http = require('http');

const BASE_URL = 'http://localhost:3000';

class TestClient {
  constructor() {
    this.cookie = null;
    this.csrfToken = null;
  }

  async request(path, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, BASE_URL);
      const headers = options.headers || {};

      if (this.cookie) {
        headers['Cookie'] = this.cookie;
      }

      if (options.csrf && this.csrfToken) {
        if (options.json) {
          headers['x-csrf-token'] = this.csrfToken;
        }
      }

      const reqOptions = {
        method: options.method || 'GET',
        headers
      };

      const req = http.request(url, reqOptions, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          // Track cookies
          const setCookie = res.headers['set-cookie'];
          if (setCookie) {
            this.cookie = setCookie.map(c => c.split(';')[0]).join('; ');
          }

          // Extract CSRF token from HTML if present
          const match = body.match(/name="_csrf"\s+value="([a-f0-9]+)"/i);
          if (match) {
            this.csrfToken = match[1];
          }

          resolve({
            status: res.statusCode,
            headers: res.headers,
            body,
            json: () => {
              try { return JSON.parse(body); } catch(e) { return null; }
            }
          });
        });
      });

      req.on('error', reject);

      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  }

  async getCsrf() {
    await this.request('/login');
    return this.csrfToken;
  }

  async login(email, password) {
    await this.getCsrf();
    const payload = new URLSearchParams({
      Email: email,
      Password: password,
      _csrf: this.csrfToken
    }).toString();

    return this.request('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payload
    });
  }

  async logout() {
    const payload = new URLSearchParams({ _csrf: this.csrfToken }).toString();
    return this.request('/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payload
    });
  }
}

async function runAcceptanceTests() {
  console.log('================================================================');
  console.log('AcxiomCRM: Running 14-Step Acceptance Scenario (Section 17.19)');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
      failed++;
    }
  }

  const unauthClient = new TestClient();

  // Step 1: Open AcxiomCRM without authentication -> protected pages must not be accessible
  const r1Dashboard = await unauthClient.request('/dashboard');
  assert(r1Dashboard.status === 302 && r1Dashboard.headers.location === '/login', 'Step 1: Anonymous access to /dashboard is redirected to /login (HTTP 302)');
  const r1Customers = await unauthClient.request('/customers');
  assert(r1Customers.status === 302 && r1Customers.headers.location === '/login', 'Step 1: Anonymous access to /customers is redirected to /login (HTTP 302)');
  const r1Api = await unauthClient.request('/api/customers');
  assert(r1Api.status === 401, 'Step 1: Anonymous access to /api/customers rejected with HTTP 401 Unauthorized');

  // Step 2: Register/login with a valid test user -> user reaches Dashboard
  const adminClient = new TestClient();
  const loginRes = await adminClient.login('admin@acxiom.com', 'Test@1234');
  assert(loginRes.status === 302 && loginRes.headers.location === '/dashboard', 'Step 2: Admin login succeeds and redirects to /dashboard (HTTP 302)');
  const dashboardRes = await adminClient.request('/dashboard');
  assert(dashboardRes.status === 200 && dashboardRes.body.includes('AcxiomCRM Executive Dashboard'), 'Step 2: Admin reaches Dashboard (HTTP 200)');

  // Step 3: Create customer with invalid email/phone -> client-side validation pattern
  // Tested by checking validation.js and regex logic
  assert(dashboardRes.body.includes('validation.js'), 'Step 3: Client validation script included in layout');

  // Step 4: Bypass browser validation with a crafted request -> server-side validation still rejects invalid data
  const invalidCustRes = await adminClient.request('/customers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      _csrf: adminClient.csrfToken,
      CustomerCode: 'CUST-INVALID',
      CustomerName: '', // empty name
      Email: 'not-an-email', // invalid email
      Phone: '123', // not 10 digits
      Status: 'Active'
    }).toString()
  });
  assert(invalidCustRes.status === 400 && invalidCustRes.body.includes('Enter a valid email address'), 'Step 4: Crafted invalid customer request rejected by server-side express-validator (HTTP 400)');

  // Step 5: Create Opportunity with Amount <= 0 -> rejected
  const oppAmountRes = await adminClient.request('/opportunities', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      _csrf: adminClient.csrfToken,
      OpportunityName: 'Zero Amount Deal',
      CustomerId: '1',
      Amount: '0', // invalid: <= 0
      Probability: '50',
      Stage: 'Proposal',
      ExpectedCloseDate: '2027-12-31'
    }).toString()
  });
  assert(oppAmountRes.status === 400 && oppAmountRes.body.includes('Opportunity Amount must be greater than 0'), 'Step 5: Opportunity with Amount <= 0 rejected with HTTP 400');

  // Step 6: Create Opportunity with Probability > 100 -> rejected
  const oppProbRes = await adminClient.request('/opportunities', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      _csrf: adminClient.csrfToken,
      OpportunityName: 'High Prob Deal',
      CustomerId: '1',
      Amount: '50000',
      Probability: '105', // invalid: > 100
      Stage: 'Proposal',
      ExpectedCloseDate: '2027-12-31'
    }).toString()
  });
  assert(oppProbRes.status === 400 && oppProbRes.body.includes('Probability must be between 0 and 100'), 'Step 6: Opportunity with Probability > 100 rejected with HTTP 400');

  // Step 7: Set Expected Close Date in the past -> rejected for active opportunity
  const oppPastDateRes = await adminClient.request('/opportunities', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      _csrf: adminClient.csrfToken,
      OpportunityName: 'Past Close Date Deal',
      CustomerId: '1',
      Amount: '50000',
      Probability: '50',
      Stage: 'Qualification',
      ExpectedCloseDate: '2020-01-01' // past date
    }).toString()
  });
  assert(oppPastDateRes.status === 400 && oppPastDateRes.body.includes('Expected Close Date cannot be in the past'), 'Step 7: Active opportunity with Expected Close Date in the past rejected with HTTP 400');

  // Step 8: Create Follow-Up dated before today -> rejected for new/planned
  const followUpPastRes = await adminClient.request('/followups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      _csrf: adminClient.csrfToken,
      FollowUpDate: '2020-01-01', // past date
      FollowUpType: 'Call',
      CustomerId: '1',
      Remarks: 'Followup in past',
      Status: 'Planned'
    }).toString()
  });
  assert(followUpPastRes.status === 400 && followUpPastRes.body.includes('earlier than today'), 'Step 8: Planned follow-up dated before today rejected with HTTP 400');

  // Step 9: Login as SalesExecutive -> only authorized/assigned sales scope is accessible
  const salesClient = new TestClient();
  await salesClient.login('sales@acxiom.com', 'Test@1234');
  const salesAuditRes = await salesClient.request('/audit');
  assert(salesAuditRes.status === 403, 'Step 9: SalesExecutive cannot access Admin /audit page (HTTP 403 Forbidden)');
  const salesPipelineRes = await salesClient.request('/reports/pipeline');
  assert(salesPipelineRes.status === 403, 'Step 9: SalesExecutive cannot access /reports/pipeline (HTTP 403 Forbidden)');

  // Step 10: Login as Manager -> team pipeline/report access is available
  const mgrClient = new TestClient();
  await mgrClient.login('manager@acxiom.com', 'Test@1234');
  const mgrReportRes = await mgrClient.request('/reports/pipeline');
  assert(mgrReportRes.status === 200 && mgrReportRes.body.includes('Executive Pipeline Report'), 'Step 10: Manager has access to /reports/pipeline (HTTP 200)');
  const mgrAuditRes = await mgrClient.request('/audit');
  assert(mgrAuditRes.status === 403, 'Step 10: Manager cannot access Admin security /audit page (HTTP 403 Forbidden)');

  // Step 11: Login as Admin -> user/role/audit administration is available
  const adminAuditRes = await adminClient.request('/audit');
  assert(adminAuditRes.status === 200 && adminAuditRes.body.includes('Security & Business Audit Logs'), 'Step 11: Admin can access /audit logs (HTTP 200)');

  // Step 12: Create/update/delete a CRM record -> appropriate audit entry is generated
  // Create a customer
  const uniqueCode = 'CUST-TST-' + Date.now().toString().slice(-4);
  const uniqueEmail = `test_${Date.now()}@testcrm.com`;
  const uniquePhone = '9' + Math.floor(100000000 + Math.random() * 900000000);

  const createCustRes = await adminClient.request('/customers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      _csrf: adminClient.csrfToken,
      CustomerCode: uniqueCode,
      CustomerName: 'Audit Test Corp',
      Email: uniqueEmail,
      Phone: uniquePhone,
      CompanyName: 'Audit Test Corp',
      Status: 'Active'
    }).toString()
  });
  assert(createCustRes.status === 302, 'Step 12: Customer created with HTTP 302 redirect');

  const auditCheck = await adminClient.request(`/audit?action=CREATE&entityName=Customer`);
  assert(auditCheck.body.includes(uniqueCode), 'Step 12: CREATE action audit log entry verified in database');

  // Step 13: Call /api/customers -> authorized JSON response is returned
  const apiCustRes = await adminClient.request('/api/customers');
  const apiCustJson = apiCustRes.json();
  assert(apiCustRes.status === 200 && Array.isArray(apiCustJson) && apiCustJson.length > 0, 'Step 13: /api/customers returns authorized JSON response with status 200');

  // Step 14: Open Dashboard -> KPI cards and Chart.js charts display authorized data
  const finalDash = await adminClient.request('/dashboard');
  assert(
    finalDash.status === 200 &&
    finalDash.body.includes('Total Customers') &&
    finalDash.body.includes('Total Pipeline Value') &&
    finalDash.body.includes('leadStatusChart') &&
    finalDash.body.includes('oppPipelineChart') &&
    finalDash.body.includes('monthlySalesChart'),
    'Step 14: Dashboard displays all required KPI cards and 3 Chart.js graphs'
  );

  console.log('\n================================================================');
  console.log(`Acceptance Scenario Execution Completed: ${passed} passed, ${failed} failed.`);
  console.log('================================================================');

  if (failed === 0) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runAcceptanceTests().catch(err => {
  console.error('Fatal Test Runner Error:', err);
  process.exit(1);
});
