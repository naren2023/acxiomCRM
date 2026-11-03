const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`AcxiomCRM Server is running at http://localhost:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Seeded Accounts:`);
  console.log(` - Admin:   admin@acxiom.com   / Test@1234`);
  console.log(` - Manager: manager@acxiom.com / Test@1234`);
  console.log(` - Sales:   sales@acxiom.com   / Test@1234`);
  console.log(`====================================================`);
});
