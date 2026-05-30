async function main() {
  const { gotScraping } = await import('got-scraping');
  const fs = require('fs');
  const url = 'https://github.com/realasfngl/ChatGPT/tree/main/wrapper/reverse';
  console.log('Fetching Github file list...');
  const res = await gotScraping(url);
  console.log('Status:', res.statusCode);
  
  // Save HTML to check
  fs.writeFileSync('scratch/github_tree.html', res.body);
  
  // Find all file names ending in .py in the HTML
  const regex = /href="\/realasfngl\/ChatGPT\/blob\/main\/wrapper\/reverse\/([^"]+)"/g;
  const files = new Set();
  let match;
  while ((match = regex.exec(res.body)) !== null) {
    files.add(match[1]);
  }
  
  console.log('Found Python Files:', [...files]);
}

main().catch(console.error);
