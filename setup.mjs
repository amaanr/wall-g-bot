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
import dotenv from "dotenv";

const REPO_ENV = new URL("./.env", import.meta.url);

// This script runs two ways:
//   • `npm run setup`  — you ran it on purpose; show the full friendly guide.
//   • `npm run dev`    — it runs automatically first (as "predev") to make sure
//                        things are connected. Stay quiet so we don't drown out
//                        the web app's own "running!" message or repeat the
//                        "now run npm run dev" instructions you just followed.
const QUIET = process.env.npm_lifecycle_event === "predev";
const say = (...args) => {
  if (!QUIET) console.log(...args);
};

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
  return dotenv.parse(readFileSync(path, "utf8"));
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

say("");
say("  Hermes workshop bot — setup");
say("  ---------------------------");

// 1. Is Hermes installed?  (This warning is ALWAYS shown — even under predev —
//    because without Hermes the web app can't work and we must say why.)
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
  say("");
  say("  ✓ Reusing the API key that's already set up.");
} else {
  say("");
  say("  ✓ Generated a new secret key to connect the app to Hermes.");
}

// 3. Turn on Hermes's API server and save the key into Hermes's own config.
updateEnvFile(hermesEnvPath, {
  API_SERVER_ENABLED: "true",
  API_SERVER_KEY: key,
});
say(`  ✓ Enabled Hermes's API server  (${hermesEnvPath})`);

// 4. Save the matching settings into this project's .env.
updateEnvFile(REPO_ENV, {
  HERMES_API_URL: repoEnv.HERMES_API_URL || "http://127.0.0.1:8642/v1",
  API_SERVER_KEY: key,
});
say(`  ✓ Saved the app's settings     (.env)`);

// 5. Pick a free, no-sign-up model — but ONLY if you haven't already chosen a
//    provider. This is what makes it work at home with zero accounts, and it
//    won't touch the OpenAI setup you'll add at the workshop.
const provider = hermes("config get model.provider");
const providerSet = provider.ok && provider.out && provider.out !== "auto";
if (providerSet) {
  say("  ✓ Leaving your existing model choice untouched.");
} else {
  const p = hermes(`config set model.provider opencode-free`);
  const m = hermes(`config set model.default ${FREE_MODEL}`);
  if (p.ok && m.ok) {
    say(`  ✓ Picked the free model         (${FREE_MODEL})`);
  } else {
    console.error("  Couldn't configure the free model. Run these in a new terminal:");
    console.error("       hermes config set model.provider opencode-free");
    console.error(`       hermes config set model.default ${FREE_MODEL}`);
    console.error("  If either command fails, ask a workshop helper before continuing.");
    process.exit(1);
  }
}

// The closing "now do this next" guide only makes sense when you ran setup on
// purpose. Under predev, the web app's own startup message takes over from here.
say("");
say("  All set! Start Hermes, then the web app, in two terminals:");
say("");
say("     hermes gateway      ← terminal 1 (leave it running)");
say("     npm run dev         ← terminal 2");
say("  Already started the gateway before setup? Stop it with Ctrl+C and restart it.");
say("");
say("  Then open  http://localhost:3000");
say("");
say("  (First reply can take a few seconds while Hermes wakes up.)");
say("");
