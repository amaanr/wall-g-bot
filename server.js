// Hermes workshop bot — the web chat page you see in the browser talks to
// THIS little server, and this server talks to your own Hermes agent running
// on your computer. Read the comments to understand each part, then change things!

import express from "express";
import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import OpenAI from "openai";

// Load the settings from your .env file (like HERMES_API_URL and API_SERVER_KEY).
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Where your local Hermes agent is listening, and the key to talk to it.
// `npm run setup` fills these in for you.
const HERMES_API_URL = process.env.HERMES_API_URL || "http://127.0.0.1:8642/v1";
const API_SERVER_KEY = process.env.API_SERVER_KEY;

// Let the server read JSON from the browser and serve the files in /public.
app.use(express.json());
app.use(express.static("public"));

// If the key is missing, stop early with a friendly message instead of a
// confusing crash. (This is the #1 setup mistake!)
if (!API_SERVER_KEY) {
  console.log("");
  console.log("  ⚠️  No API_SERVER_KEY found.");
  console.log("  Run the setup once to connect this app to Hermes:");
  console.log("");
  console.log("      npm run setup");
  console.log("");
  process.exit(1);
}

// Connect to YOUR Hermes agent. It speaks the same language as OpenAI, so we
// can use the same friendly library — we just point it at your computer.
const hermes = new OpenAI({
  baseURL: HERMES_API_URL,
  apiKey: API_SERVER_KEY,
});

// The bot's personality lives in SOUL.md so it's easy to edit. We read it fresh
// on every message, so when you change SOUL.md you just send a new message —
// no need to restart the server. Try it!
function readPersonality() {
  try {
    return readFileSync(new URL("./SOUL.md", import.meta.url), "utf8");
  } catch {
    return "You are Hermes, a friendly and upbeat AI assistant. Keep answers short and helpful.";
  }
}

// When the web page sends a message, this runs.
app.post("/api/chat", async (req, res) => {
  try {
    const userMessage = req.body.message;

    // Ask Hermes for a reply. We send your personality first, then the message.
    // We don't name a model here on purpose — Hermes uses whatever model you
    // picked (the free one at home, or OpenAI at the workshop). No code change!
    const completion = await hermes.chat.completions.create({
      model: "hermes-agent",
      messages: [
        { role: "system", content: readPersonality() },
        { role: "user", content: userMessage },
      ],
    });

    const reply = completion.choices[0].message.content;
    res.json({ reply });
  } catch (error) {
    // The most common problem is that Hermes isn't running yet, so say so clearly.
    const hermesIsDown =
      error?.code === "ECONNREFUSED" ||
      error?.cause?.code === "ECONNREFUSED" ||
      error?.status === 502 ||
      error?.status === 503;

    console.error("Something went wrong talking to Hermes:", error.message);

    res.status(500).json({
      reply: hermesIsDown
        ? "I can't reach Hermes. In another terminal, run  hermes gateway  and wait for it to say the API server is listening, then try again."
        : "Sorry, I hit an error talking to Hermes. Check the terminal running `hermes gateway` for details.",
    });
  }
});

// A tiny endpoint the web page uses to check if Hermes is awake.
app.get("/api/health", async (_req, res) => {
  try {
    const base = HERMES_API_URL.replace(/\/v1\/?$/, "");
    const r = await fetch(`${base}/health`);
    res.json({ hermes: r.ok ? "up" : "down" });
  } catch {
    res.json({ hermes: "down" });
  }
});

// Start the server.
app.listen(PORT, () => {
  console.log("");
  console.log("  ✅ Hermes web app is running!");
  console.log(`  → Open this in your browser: http://localhost:${PORT}`);
  console.log("");
  console.log("  (Make sure `hermes gateway` is also running in another terminal.)");
  console.log("");
});
