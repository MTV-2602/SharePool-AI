const fs = require(" fs\);
const path = require(\path\);
const filePath = path.join(__dirname, \src\, \app\, \login\, \page.js\);
let content = fs.readFileSync(filePath, \utf8\);
