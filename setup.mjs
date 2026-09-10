// One-time setup: connect this web app to your local Hermes agent.
//
// What it does (all safe to run more than once):
//   1. Makes sure Hermes is installed.
//   2. Generates a secret key so the web app and Hermes can talk privately.
//   3. Turns on Hermes's "API server" and saves that key into Hermes's config.
//   4. Saves the same key into this project's .env file.
//   5. Picks a free, no-sign-up model — unless you've already chosen one.
//
// After this, run `hermes gateway` in one terminal and `npm run dev` in another.

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, delimiter } from "node:path";
import { execSync } from "node:child_process";

const REPO_ENV = new URL("./.env", import.meta.url);

// A free, no-sign-up model that answers fast. (The free catalog changes over
// time; if this one is ever slow or unavailable, see the README for how to
// switch — `hermes config set model.default <name>`.)
const FREE_MODEL = "ling-3.0-flash-fin-free";

// Run a `hermes ...` command, making sure the usual install folder is on PATH
// even if the user hasn't reloaded their shell yet. Returns {ok, out}.
function hermes(args) {
  const binDirs = [join(homedir(), ".local", "bin")];
  if (platform() === "win32" && process.env.LOCALAPPDATA)
    binDirs.push(join(process.env.LOCALAPPDATA, "hermes", "bin"));
  const PATH = `${binDirs.join(delimiter)}${delimiter}${process.env.PATH || ""}`;
  try {
    const out = execSync(`hermes ${args}`, {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
      env: { ...process.env, PATH },
    });
    return { ok: true, out: out.trim() };
  } catch (e) {
    return { ok: false, out: (e.stdout || "").toString().trim() };
  }
}

// Find Hermes's home folder the same way Hermes does.
function hermesHome() {
  if (process.env.HERMES_HOME) return process.env.HERMES_HOME;
  // Native Windows installs live under %LOCALAPPDATA%\hermes.
  if (platform() === "win32" && process.env.LOCALAPPDATA) {
    const winHome = join(process.env.LOCALAPPDATA, "hermes");
    if (existsSync(winHome)) return winHome;
  }
  return join(homedir(), ".hermes");
}

// Read an env file into a plain object. Missing file → {}.
function readEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// Update ONLY the given keys in an env file, leaving every other line untouched.
function updateEnvFile(path, updates) {
  const lines = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/) : [];
  const remaining = { ...updates };
  const result = lines.map((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=/i);
    if (m && m[1] in remaining) {
      const key = m[1];
      const val = remaining[key];
      delete remaining[key];
      return `${key}=${val}`;
    }
    return line;
  });
  for (const [key, val] of Object.entries(remaining)) result.push(`${key}=${val}`);
  // Tidy trailing blank lines into exactly one.
  while (result.length && result[result.length - 1].trim() === "") result.pop();
  result.push("");
  writeFileSync(path, result.join("\n"));
}

console.log("");
console.log("  Hermes workshop bot — setup");
console.log("  ---------------------------");

// 1. Is Hermes installed?
const HOME = hermesHome();
if (!existsSync(HOME)) {
  console.log("");
  console.log("  ⚠️  I can't find Hermes on this computer.");
  console.log(`      (Looked in: ${HOME})`);
  console.log("");
  console.log("  Please install Hermes first, then run `npm run setup` again:");
  console.log("");
  if (platform() === "win32") {
    console.log("      iex (irm https://hermes-agent.nousresearch.com/install.ps1)");
  } else {
    console.log("      curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash");
  }
  console.log("");
  console.log("  (Full instructions are in the README, under \"Before the workshop\".)");
  console.log("");
  process.exit(1);
}

// 2. Reuse an existing key if one is already set anywhere, else make a strong one.
const hermesEnvPath = join(HOME, ".env");
const hermesEnv = readEnv(hermesEnvPath);
const repoEnv = readEnv(REPO_ENV);

const existingKey =
  hermesEnv.API_SERVER_KEY?.trim() || repoEnv.API_SERVER_KEY?.trim() || "";
const key = existingKey || `hermes_ws_${randomBytes(24).toString("hex")}`;
if (existingKey) {
  console.log("");
  console.log("  ✓ Reusing the API key that's already set up.");
} else {
  console.log("");
  console.log("  ✓ Generated a new secret key to connect the app to Hermes.");
}

// 3. Turn on Hermes's API server and save the key into Hermes's own config.
updateEnvFile(hermesEnvPath, {
  API_SERVER_ENABLED: "true",
  API_SERVER_KEY: key,
});
console.log(`  ✓ Enabled Hermes's API server  (${hermesEnvPath})`);

// 4. Save the matching settings into this project's .env.
updateEnvFile(REPO_ENV, {
  HERMES_API_URL: repoEnv.HERMES_API_URL || "http://127.0.0.1:8642/v1",
  API_SERVER_KEY: key,
});
console.log(`  ✓ Saved the app's settings     (.env)`);

// 5. Pick a free, no-sign-up model — but ONLY if you haven't already chosen a
//    provider. This is what makes it work at home with zero accounts, and it
//    won't touch the OpenAI setup you'll add at the workshop.
const providerSet = hermes("config get model.provider").ok;
if (providerSet) {
  console.log("  ✓ Leaving your existing model choice untouched.");
} else {
  const p = hermes(`config set model.provider opencode-free`);
  const m = hermes(`config set model.default ${FREE_MODEL}`);
  if (p.ok && m.ok) {
    console.log(`  ✓ Picked the free model         (${FREE_MODEL})`);
  } else {
    console.log("  •  Couldn't auto-pick the free model — do it once by hand:");
    console.log(`       hermes config set model.provider opencode-free`);
    console.log(`       hermes config set model.default ${FREE_MODEL}`);
  }
}

console.log("");
console.log("  All set! Start Hermes, then the web app, in two terminals:");
console.log("");
console.log("     hermes gateway      ← terminal 1 (leave it running)");
console.log("     npm run dev         ← terminal 2");
console.log("");
console.log("  Then open  http://localhost:3000");
console.log("");
console.log("  (First reply can take a few seconds while Hermes wakes up.)");
console.log("");
