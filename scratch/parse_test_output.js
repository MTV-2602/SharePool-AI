const fs = require('fs');
const content = fs.readFileSync('scratch/test_output.txt', 'utf16le');

const startIdx = content.indexOf('Full reqData:');
if (startIdx !== -1) {
  const jsonStart = content.indexOf('{', startIdx);
  // Find matching closing brace
  let braceCount = 0;
  let jsonEnd = -1;
  for (let i = jsonStart; i < content.length; i++) {
    if (content[i] === '{') braceCount++;
    if (content[i] === '}') {
      braceCount--;
      if (braceCount === 0) {
        jsonEnd = i + 1;
        break;
      }
    }
  }
  
  if (jsonEnd !== -1) {
    const jsonStr = content.substring(jsonStart, jsonEnd);
    try {
      const data = JSON.parse(jsonStr);
      console.log('Keys:', Object.keys(data));
      console.log('turnstile:', data.turnstile);
      console.log('proofofwork:', data.proofofwork);
    } catch (e) {
      console.error('JSON parse error:', e.message);
    }
  } else {
    console.log('Could not find matching closing brace');
  }
} else {
  console.log('Could not find Full reqData:');
}
