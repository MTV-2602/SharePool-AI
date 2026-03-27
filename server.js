const express = require("express");
const path = require("path");
require("dotenv").config();

const apiApp = require("./api/index");

const app = express();
const PORT = process.env.PORT || 3000;
const clientDistPath = path.join(__dirname, "client", "dist");

app.use((req, res, next) => {
  if (req.path === "/api" || req.path.startsWith("/api/")) {
    return apiApp(req, res, next);
  }
  return next();
});

app.use(express.static(clientDistPath));

app.get("*", (req, res) => {
  res.sendFile(path.join(clientDistPath, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log("Mode: local wrapper -> api/index.js");
});
