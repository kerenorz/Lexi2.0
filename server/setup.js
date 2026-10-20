/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable prettier/prettier */
const fs = require("fs");
const readline = require("readline");
const { execSync } = require("child_process");
const crypto = require("crypto");
const path = require('path');

const colors = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
};

const emojis = {
  success: "✅",
  warning: "⚠️",
  info: "ℹ️",
  error: "❌",
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const ask = (question) =>
  new Promise((resolve) => rl.question(question, resolve));

function createFolder(folderPath) {
  // Check if the folder already exists
  if (!fs.existsSync(folderPath)) {
      // Create the directory
      fs.mkdirSync(folderPath, { recursive: true });
      console.log(`Directory created: ${folderPath}`);
  } else {
      console.log(`Directory already exists: ${folderPath}`);
  }
}

const foldersToCreate = [
  'action_units',
  'webcamBase'
];

(async function setup() {
  console.log(
    colors.cyan,
    `${emojis.info} Starting setup process...`,
    colors.reset
  );

  // The server connects with MONGODB_URL alone, so it must be the full connection string:
  // user, password and database name included. LLM API keys are not asked for here; each
  // researcher adds their own in the admin UI, where they are stored encrypted.
  const mongodbUrl = await ask(
    `${colors.yellow}Enter your full MongoDB connection string, with your user, password and database name in it (local example: mongodb://localhost:27017/lexi): ${colors.reset}`
  );
  const frontendUrl = "http://localhost:3000";

  const jwtSecretKey = crypto.randomBytes(16).toString("hex");
  // Encrypts the stored API keys; utils/encryption.ts requires 64 hex characters (32 bytes).
  const apiKeyEncryptionKey = crypto.randomBytes(32).toString("hex");

  const envContent = `
MONGODB_URL="${mongodbUrl}"
FRONTEND_URL="${frontendUrl}"
JWT_SECRET_KEY="${jwtSecretKey}"
API_KEY_ENCRYPTION_KEY="${apiKeyEncryptionKey}"
PORT=5000
  `.trim();

  fs.writeFileSync(".env", envContent);

  console.log(
    colors.green,
    `${emojis.success} .env file created successfully.`,
    colors.reset
  );

  foldersToCreate.forEach(folder => {
    const fullPath = path.join(__dirname, folder);
    createFolder(fullPath);
  });

  console.log(
    colors.cyan,
    `${emojis.info} Installing dependencies...`,
    colors.reset
  );
  execSync("npm i", { stdio: "inherit" });

  console.log(
    colors.cyan,
    `${emojis.info} Building the project...`,
    colors.reset
  );
  execSync("npm run build", { stdio: "inherit" });

  const adminUsername = await ask(
    `${colors.yellow}Enter a username for the admin user: ${colors.reset}`
  );
  const adminPassword = await ask(
    `${colors.yellow}Enter a password for the admin user: ${colors.reset}`
  );

  console.log(
    colors.cyan,
    `${emojis.info} Creating admin user...`,
    colors.reset
  );
  execSync(
    `node build/server.js create-user ${adminUsername} ${adminPassword}`,
    { stdio: "inherit" }
  );

  rl.close();
  console.log(colors.green, `${emojis.success} Setup complete!`, colors.reset);
})();
