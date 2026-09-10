// One-time setup: connect this web app to your local Hermes agent.
//
// What it does (all safe to run more than once):
//   1. Makes sure Hermes is installed.
//   2. Generates a secret key so the web app and Hermes can talk privately.
//   3. Turns on Hermes's "API server" and saves that key into Hermes's config.
//   4. Saves the same key into this project's .env file.
//   5. Sets up the model ladder: OpenAI first if a key is present, with free
//      no-sign-up models as automatic fallbacks (and as the primary at home).
//
// After this, run `hermes gateway` in one terminal and `npm run dev` in another.

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, delimiter } from "node:path";
import { execSync, execFileSync } from "node:child_process";
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

// Free, no-sign-up models (OpenCode Free — keyless). The first is the at-home
// primary; the rest are automatic fallbacks if it's slow or down. The free
// catalog rotates over time; if these change, `hermes model` shows the current
// list and `hermes config set model.default <name>` switches the primary.
const FREE_MODELS = [
  "nemotron-3.5-lightning-free",
  "nemotron-3-ultra-free",
  "ling-3.0-flash-fin-free",
];

// When an OpenAI key is present we prefer OpenAI (faster, more capable). This is
// the model we select; the free models above become the fallback chain.
const OPENAI_MODEL = "gpt-4o-mini";

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

// Same as hermes(), but passes each argument separately instead of through a
// shell. Use this when a value contains characters a shell would mangle — e.g.
// the JSON we hand to `config set fallback_providers` (quotes and spaces break
// on Windows cmd.exe otherwise). Returns {ok, out}.
function hermesArgs(argv) {
  const binDirs = [join(homedir(), ".local", "bin")];
  if (platform() === "win32" && process.env.LOCALAPPDATA)
    binDirs.push(join(process.env.LOCALAPPDATA, "hermes", "bin"));
  const PATH = `${binDirs.join(delimiter)}${delimiter}${process.env.PATH || ""}`;
  try {
    const out = execFileSync("hermes", argv, {
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

// 5. Set up the model ladder.
//
//    Priority: OpenAI (if a key is present) → free no-sign-up models.
//
//    • At home, there's no OpenAI key, so a free model is the primary and the
//      other free models are fallbacks. Zero accounts needed.
//    • At the workshop, we add the shared OPENAI_API_KEY. Setup then makes
//      OpenAI the primary and keeps the free models as a safety net.
//
//    The free models are always the fallback chain either way, so a momentary
//    hiccup on the primary just rolls over to the next model automatically.
//
//    We only skip this if you've deliberately chosen some OTHER provider
//    yourself (e.g. Groq, a local model) — we won't stomp on that.

// An OpenAI key can live in this project's .env or in Hermes's own .env.
const openaiKey =
  repoEnv.OPENAI_API_KEY?.trim() || hermesEnv.OPENAI_API_KEY?.trim() || "";

// What provider is configured right now? "auto" (or unset) means "you haven't
// chosen", and so do the two providers THIS script manages (openai-api and
// opencode-free) — re-running setup should freely re-pick between those as the
// key comes and goes. Any other value is a deliberate choice we leave alone.
const providerNow = hermes("config get model.provider");
const currentProvider =
  providerNow.ok && !/not set/i.test(providerNow.out) ? providerNow.out.trim() : "";
const managedProviders = new Set(["", "auto", "openai-api", "opencode-free"]);

// The free models are the fallback chain in every case. Hermes wants a JSON
// array of {provider, model}; pass it shell-free so quotes survive on Windows.
// Skip whichever model is already the primary, so a failing primary rolls over
// to a DIFFERENT model instead of retrying itself.
function setFreeFallbacks(primaryModel) {
  const chain = FREE_MODELS.filter((model) => model !== primaryModel).map(
    (model) => ({ provider: "opencode-free", model }),
  );
  return hermesArgs(["config", "set", "fallback_providers", JSON.stringify(chain)]).ok;
}

if (!managedProviders.has(currentProvider)) {
  say(`  ✓ Leaving your existing model choice untouched  (${currentProvider}).`);
} else if (openaiKey) {
  // Prefer OpenAI. openai-api is Hermes's built-in OpenAI provider; it reads
  // OPENAI_API_KEY from Hermes's env. Make sure the key is in Hermes's .env,
  // and clear any leftover custom base_url so it talks to OpenAI directly.
  updateEnvFile(hermesEnvPath, { OPENAI_API_KEY: openaiKey });
  const p = hermes(`config set model.provider openai-api`);
  const m = hermes(`config set model.default ${OPENAI_MODEL}`);
  hermes(`config unset model.base_url`); // harmless if it wasn't set
  const fb = setFreeFallbacks(null); // OpenAI is primary → keep all free models
  if (p.ok && m.ok) {
    say(`  ✓ Using OpenAI                  (${OPENAI_MODEL})`);
    say(`  ✓ Free models set as fallbacks${fb ? "" : "  (couldn't save — not critical)"}`);
  } else {
    console.error("  Couldn't configure OpenAI. Run these in a new terminal:");
    console.error("       hermes config set model.provider openai-api");
    console.error(`       hermes config set model.default ${OPENAI_MODEL}`);
    console.error("  If either command fails, ask a workshop helper before continuing.");
    process.exit(1);
  }
} else {
  // No OpenAI key → free model is the primary, the rest are fallbacks.
  const p = hermes(`config set model.provider opencode-free`);
  const m = hermes(`config set model.default ${FREE_MODELS[0]}`);
  hermes(`config unset model.base_url`); // a leftover base_url breaks opencode-free
  const fb = setFreeFallbacks(FREE_MODELS[0]); // primary is a free model → don't list it twice
  if (p.ok && m.ok) {
    say(`  ✓ Picked a free, no-sign-up model  (${FREE_MODELS[0]})`);
    say(`  ✓ Other free models set as fallbacks${fb ? "" : "  (couldn't save — not critical)"}`);
  } else {
    console.error("  Couldn't configure the free model. Run these in a new terminal:");
    console.error("       hermes config set model.provider opencode-free");
    console.error(`       hermes config set model.default ${FREE_MODELS[0]}`);
    console.error("  If either command fails, ask a workshop helper before continuing.");
    process.exit(1);
  }
}

// 6. Quiet one recurring error. Hermes tries to auto-name each chat using a
//    small side model; our web app never shows those names, and at home that
//    call routes to a provider you haven't set up, so `hermes gateway` prints a
//    "Title generation failed" error on every message. Turning it off removes
//    that noise. Safe to run repeatedly; if it doesn't stick it's not fatal —
//    the app still works, so we don't stop setup over it.
const t = hermes("config set auxiliary.title_generation.enabled false");
if (t.ok) {
  say("  ✓ Turned off an unused feature that logged errors each message.");
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
