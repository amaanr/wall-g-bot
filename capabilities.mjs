// Finish setting up computer use, and install optional helper tools.
//
// `npm run setup` already turns computer use ON for the web app, so most people
// only need this for the ONE thing setup can't do for you: approve the macOS
// screen/accessibility permission (a human has to click that). It's also where
// the optional per-skill helper CLIs live. Safe to run as many times as you like.
//
// This is separate from `npm run setup` on purpose: it can pop system dialogs
// and download helper tools, so you run it when you're ready — the automated
// tests never touch it, and `npm run dev` never triggers it.
//
// What it does (all safe to run more than once):
//   1. Re-asserts the `computer_use` toolset on the `api_server` platform (the
//      one the web app talks to) as a safety net — setup already did this, and
//      enabling twice is harmless.
//   2. Makes sure the cua-driver that powers computer-use is installed.
//   3. Reports macOS Accessibility / Screen Recording status, and grants them
//      with `--grant` (opens the system dialog). THIS is the step most people
//      come here for.
//   4. With `--mac-skills`, installs the little CLIs a few bundled skills need
//      (Reminders, Notes, iMessage) via Homebrew. macOS only.
//   5. With `--xurl`, installs the official X/Twitter CLI (you still do its
//      one-time OAuth yourself afterwards).
//
// Usage:
//   node capabilities.mjs                 # check driver + report permission status
//   node capabilities.mjs --grant         # pop the macOS permission dialog (main use)
//   node capabilities.mjs --mac-skills    # also install Reminders/Notes/iMessage CLIs (macOS)
//   node capabilities.mjs --xurl          # also install the X/Twitter CLI
//   node capabilities.mjs --all           # grant + mac-skills + xurl
//
// After running, restart Hermes so it re-reads the toolset config:
//   Ctrl+C in the `hermes gateway` terminal, then `hermes gateway` again.

import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, delimiter } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const want = {
  grant: args.has("--grant") || args.has("--all"),
  macSkills: args.has("--mac-skills") || args.has("--all"),
  xurl: args.has("--xurl") || args.has("--all"),
};
const IS_MAC = platform() === "darwin";
const IS_WIN = platform() === "win32";

// Toolsets we turn ON for the web app (the `api_server` platform). computer_use
// is the headline: it lets the agent see and click real apps in the background.
// Everything else the demos need (web search, browser, files, terminal, image
// generation, memory, skills) is already enabled on api_server by default.
const WEB_APP_PLATFORM = "api_server";
const TOOLSETS = ["computer_use"];

// ---- small helpers -------------------------------------------------------

// Put Hermes's usual install dir on PATH so this works even in a fresh shell.
function hermesPath() {
  const binDirs = [join(homedir(), ".local", "bin")];
  if (IS_WIN && process.env.LOCALAPPDATA)
    binDirs.push(join(process.env.LOCALAPPDATA, "hermes", "bin"));
  return `${binDirs.join(delimiter)}${delimiter}${process.env.PATH || ""}`;
}

// Run `hermes ...` capturing output. Returns {ok, out}.
function hermes(argv) {
  try {
    const out = execFileSync("hermes", argv, {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      env: { ...process.env, PATH: hermesPath() },
    });
    return { ok: true, out: (out || "").trim() };
  } catch (e) {
    return { ok: false, out: `${e.stdout || ""}${e.stderr || ""}`.trim() };
  }
}

// Run a command so the user SEES its live output (installers, permission grabs).
// Returns the exit code (0 = success).
function run(cmd, argv) {
  const res = spawnSync(cmd, argv, {
    stdio: "inherit",
    env: { ...process.env, PATH: hermesPath() },
  });
  return res.status ?? 1;
}

function hermesHome() {
  if (process.env.HERMES_HOME) return process.env.HERMES_HOME;
  if (IS_WIN && process.env.LOCALAPPDATA) {
    const winHome = join(process.env.LOCALAPPDATA, "hermes");
    if (existsSync(winHome)) return winHome;
  }
  return join(homedir(), ".hermes");
}

const ok = (m) => console.log(`  \u2713 ${m}`);
const info = (m) => console.log(`  \u2022 ${m}`);
const warn = (m) => console.log(`  \u26a0 ${m}`);

// ---- go ------------------------------------------------------------------

console.log("");
console.log("  WALL-G capabilities \u2014 finish computer use");
console.log("  -----------------------------------------");
console.log("  Setup already turned computer use on. This grants the macOS");
console.log("  permission and installs optional helper tools (README has the details).");

// 0. Hermes must be installed.
const HOME = hermesHome();
if (!existsSync(HOME)) {
  console.log("");
  warn("I can't find Hermes on this computer.");
  console.log(`      (Looked in: ${HOME})`);
  console.log("      Install Hermes first (see the README), then run this again.");
  console.log("");
  process.exit(1);
}

// 1. Re-assert the web-app toolsets (setup already did this; enabling twice is
//    harmless, and it self-heals a config that got turned off).
console.log("");
console.log("  1) Web-app toolsets (double-checking setup's work)");
for (const toolset of TOOLSETS) {
  const r = hermes(["tools", "enable", toolset, "--platform", WEB_APP_PLATFORM]);
  if (r.ok) ok(`${toolset} is on for the web app (${WEB_APP_PLATFORM}).`);
  else {
    warn(`Couldn't enable ${toolset} on ${WEB_APP_PLATFORM}.`);
    if (r.out) console.log(`      ${r.out.split("\n")[0]}`);
  }
}
// Also make sure it's on for the terminal, so `hermes` chats can demo it too.
hermes(["tools", "enable", ...TOOLSETS, "--platform", "cli"]);

// 2. Make sure cua-driver (the thing that drives the desktop) is installed.
console.log("");
console.log("  2) Computer-use driver");
const status = hermes(["computer-use", "status"]);
if (status.ok && /installed/i.test(status.out) && !/not installed/i.test(status.out)) {
  ok(status.out.split("\n")[0]);
} else {
  info("Installing cua-driver (one-time, downloads a small binary)\u2026");
  const code = run("hermes", ["computer-use", "install"]);
  if (code === 0) ok("cua-driver installed.");
  else warn("cua-driver install didn't finish. Re-run: hermes computer-use install");
}

// 3. macOS permissions. Computer-use needs Accessibility + Screen Recording,
//    attributed to the CuaDriver app (not the terminal).
if (IS_MAC) {
  console.log("");
  console.log("  3) macOS permissions (Accessibility + Screen Recording)");
  const perm = hermes(["computer-use", "permissions", "status"]);
  const granted = perm.ok && !/pending|denied|not granted|missing/i.test(perm.out);
  if (granted) {
    ok("Permissions look granted.");
  } else if (want.grant) {
    info("Opening the macOS permission dialog (attributed to CuaDriver)\u2026");
    info("Approve BOTH Accessibility and Screen Recording, then re-run to verify.");
    run("hermes", ["computer-use", "permissions", "grant"]);
  } else {
    warn("Permissions are still pending. Grant them with:");
    console.log("      node capabilities.mjs --grant");
    console.log("      (or: hermes computer-use permissions grant)");
  }
} else {
  console.log("");
  info(IS_WIN
    ? "3) On Windows, run the demo from the interactive desktop (not an SSH session)."
    : "3) On Linux, make sure DISPLAY is set (X11). Check: hermes computer-use doctor");
}

// 4. Optional: macOS skill CLIs (Reminders / Notes / iMessage).
if (want.macSkills) {
  console.log("");
  console.log("  4) macOS skill CLIs (Reminders / Notes / iMessage)");
  if (!IS_MAC) {
    warn("These skills are macOS-only \u2014 skipping on this platform.");
  } else if (run("brew", ["--version"]) !== 0) {
    warn("Homebrew isn't installed. Get it from https://brew.sh, then re-run with --mac-skills.");
  } else {
    const brews = [
      { name: "remindctl (Reminders)", argv: ["install", "steipete/tap/remindctl"] },
      { name: "memo (Apple Notes)", argv: ["install", "antoniorodr/memo/memo"], tap: ["tap", "antoniorodr/memo"] },
      { name: "imsg (iMessage)", argv: ["install", "steipete/tap/imsg"] },
    ];
    for (const b of brews) {
      info(`Installing ${b.name}\u2026`);
      if (b.tap) run("brew", b.tap);
      const code = run("brew", b.argv);
      if (code === 0) ok(`${b.name} installed.`);
      else warn(`${b.name} didn't install cleanly. You can retry: brew ${b.argv.join(" ")}`);
    }
    info("These may prompt for macOS permissions the first time the agent uses them.");
  }
}

// 5. Optional: xurl (official X/Twitter API CLI).
if (want.xurl) {
  console.log("");
  console.log("  5) X/Twitter CLI (xurl)");
  if (IS_WIN) {
    warn("Install xurl manually on Windows: npm install -g @xdevplatform/xurl");
  } else {
    info("Installing xurl\u2026");
    const code = run("bash", ["-c", "curl -fsSL https://raw.githubusercontent.com/xdevplatform/xurl/main/install.sh | bash"]);
    if (code === 0) {
      ok("xurl installed.");
      info("One-time auth is yours to do: run `xurl auth` and follow the X login.");
      info("Tip: for a very visual demo, skip xurl and just say \u201copen twitter.com and post\u2026\u201d");
    } else {
      warn("xurl install didn't finish. See https://github.com/xdevplatform/xurl");
    }
  }
}

// Wrap up with a health snapshot and the one thing people forget.
console.log("");
console.log("  Health check");
const doctor = hermes(["computer-use", "doctor"]);
if (doctor.out) {
  const line = doctor.out.split("\n")[0];
  console.log(`  ${line}`);
}
console.log("");
console.log("  Almost done \u2014 restart Hermes so it picks up the new toolsets:");
console.log("     Ctrl+C in the `hermes gateway` terminal, then run `hermes gateway` again.");
console.log("");
console.log("  Then try in the web app:");
console.log("     \u201cOpen Calendar and tell me what I\u2019ve got this week.\u201d");
console.log("     \u201cOpen twitter.com in the browser and post: hello from WALL-G!\u201d");
console.log("");
console.log("  Safety: with these on, WALL-G can control this computer. Use it on a");
console.log("  machine you own, and never expose the web app beyond localhost.");
console.log("");
