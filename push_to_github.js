const { execSync } = require('child_process');

async function main() {
  try {
    // 1. Get credentials from git credential fill
    const credOutput = execSync('git credential fill', {
      input: 'protocol=https\nhost=github.com\n',
      encoding: 'utf-8'
    });

    let token = '';
    let username = '';
    for (const line of credOutput.split('\n')) {
      if (line.startsWith('username=')) username = line.slice(9).trim();
      if (line.startsWith('password=')) token = line.slice(9).trim();
    }

    if (!token) {
      throw new Error('No GitHub token found in git credentials');
    }

    console.log(`Found GitHub user: ${username}`);

    // 2. Check if repo exists or create it
    const repoName = 'acxiomCRM';
    const checkRes = await fetch(`https://api.github.com/repos/${username}/${repoName}`, {
      headers: {
        'Authorization': `token ${token}`,
        'User-Agent': 'AcxiomCRM-Setup',
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (checkRes.status === 404) {
      console.log(`Creating repository ${repoName} on GitHub...`);
      const createRes = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: {
          'Authorization': `token ${token}`,
          'User-Agent': 'AcxiomCRM-Setup',
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: repoName,
          description: 'Enterprise Role-Based CRM with Node.js, Express, SQLite, EJS, Bootstrap 5, and Chart.js',
          private: false,
          auto_init: false
        })
      });

      if (!createRes.ok) {
        const errText = await createRes.text();
        throw new Error(`Failed to create repository: ${createRes.status} ${errText}`);
      }
      console.log(`Repository ${repoName} successfully created on GitHub!`);
    } else if (checkRes.ok) {
      console.log(`Repository ${repoName} already exists on GitHub.`);
    } else {
      console.log(`Repository check status: ${checkRes.status}`);
    }

    // 3. Initialize git and commit
    console.log('Initializing local git repository...');
    try { execSync('git init', { stdio: 'inherit' }); } catch (e) {}
    try { execSync('git branch -M main', { stdio: 'inherit' }); } catch (e) {}

    execSync('git add .', { stdio: 'inherit' });
    try {
      execSync('git commit -m "Complete AcxiomCRM implementation: Auth, CRUD, Audit, Dashboard KPIs, Chart.js, and REST APIs"', { stdio: 'inherit' });
    } catch (e) {
      console.log('Nothing to commit or already committed.');
    }

    // 4. Set remote origin
    const remoteUrl = `https://github.com/${username}/${repoName}.git`;
    try {
      execSync(`git remote add origin ${remoteUrl}`, { stdio: 'ignore' });
    } catch (e) {
      execSync(`git remote set-url origin ${remoteUrl}`, { stdio: 'ignore' });
    }

    // 5. Push to GitHub
    console.log(`Pushing to ${remoteUrl}...`);
    // Push using the authenticated token URL in memory without logging it
    const authRemoteUrl = `https://${username}:${token}@github.com/${username}/${repoName}.git`;
    execSync(`git push -u "${authRemoteUrl}" main --force`, { stdio: 'inherit' });

    console.log(`\nSuccessfully pushed to https://github.com/${username}/${repoName}!`);
  } catch (err) {
    console.error('Error during git push:', err.message);
    process.exit(1);
  }
}

main();
