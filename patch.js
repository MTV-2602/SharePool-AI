const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'src', 'app', 'login', 'page.js');
let content = fs.readFileSync(file, 'utf8');

const oldGeminiMarkdownRegex = /const getGeminiMarkdown = \(\) => \{[\s\S]*?return `[\s\S]*?`;\s*\};/;
const newGeminiMarkdown = fs.readFileSync('gemini_md.txt', 'utf8');
const newGeminiMarkdownFunc = 'const getGeminiMarkdown = () => {\n    return `' + newGeminiMarkdown.replace(/`/g, '\\`') + '`;\n  };';

if (oldGeminiMarkdownRegex.test(content)) {
  content = content.replace(oldGeminiMarkdownRegex, newGeminiMarkdownFunc);
  console.log('Patched getGeminiMarkdown markdown');
}

const oldBtnStr = '🐍 Python & cURL';
const oldBtnStr2 = '🐍 Python & cURL';
if (content.includes(oldBtnStr)) {
  content = content.replace(oldBtnStr, '🤖 Google Gemini (SDK/API)');
  console.log('Patched tab button label');
} else {
  const matchIndex = content.indexOf('Python & cURL');
  if (matchIndex   !== -1) {
    const startIdx = content.lastIndexOf('<button', matchIndex);
    const endIdx = content.indexOf('</button>', matchIndex);
    if (startIdx !== -1 && endIdx !== -1) {
      let buttonHtml = content.substring(startIdx, endIdx + 9);
      buttonHtml = buttonHtml.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]\s*Python\s*&\s*cURL|[^\x00-\x7F]+\s*Python\s*&\s*cURL|Python\s*&\s*cURL/, '🤖 Google Gemini (SDK/API)');
      content = content.substring(0, startIdx) + buttonHtml + content.substring(endIdx + 9);
      console.log('Patched tab button label dynamically');
    }
  }
}

const startIndex = content.indexOf('{guideTab === "gemini" && (');
if (startIndex !== -1) {
  let openBraceCount = 0;
  let endIndex = -1;
  for (let i = startIndex; i < content.length; i ++) {
    if (content[i] === '(') openBraceCount++;
    if (content[i] === ')') {
      openBraceCount--;
      if (openBraceCount === 0) {
        const nextBrace = content.indexOf('}', i);
        endIndex = nextBrace + 1;
        break;
      }
    }
  }
  if (endIndex !== -1) {
    const newGeminiBlock = fs.readFileSync('gemini_ui.txt', 'utf8');
    content = content.substring(0, startIndex) + newGeminiBlock + content.substring(endIndex);
    console.log('Patched Gemini UI Block');
  }
}
fs.writeFileSync(file, content, 'utf8');
console.log('Saved page.js successfully!');
