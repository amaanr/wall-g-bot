// Hermes — a tiny AI chat bot.
// This file starts a small web server and connects it to OpenAI.
// Read the comments to understand each part, then try changing things!

import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";

// Load the secrets from your .env file (like your OPENAI_API_KEY).
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Let the server read JSON from the browser and serve the files in /public.
app.use(express.json());
app.use(express.static("public"));

// This is the "personality" of your bot. Change it to make Hermes your own!
const SYSTEM_PROMPT =
  "You are Hermes, a friendly and upbeat AI assistant. " +
  "Keep your answers short, clear, and helpful.";

// If the API key is missing, we stop early with a friendly message
// instead of a confusing crash. (This is the #1 setup mistake!)
if (!process.env.OPENAI_API_KEY) {
  console.log("");
  console.log("  ⚠️  No OPENAI_API_KEY found.");
  console.log("  1. Make a copy of .env.example and name it .env");
  console.log("  2. Paste your key inside it: OPENAI_API_KEY=sk-...");
  console.log("  3. Run  npm run dev  again.");
  console.log("");
  process.exit(1);
}

// Connect to OpenAI using your key.
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// When the web page sends a message, this runs.
app.post("/api/chat", async (req, res) => {
  try {
    const userMessage = req.body.message;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    });

    const reply = completion.choices[0].message.content;
    res.json({ reply });
  } catch (error) {
    console.error("Something went wrong talking to OpenAI:", error.message);
    res.status(500).json({
      reply: "Sorry, I hit an error. Check that your API key is correct.",
    });
  }
});

// Start the server.
app.listen(PORT, () => {
  console.log("");
  console.log(`  ✅ Hermes is running!`);
  console.log(`  → Open this in your browser: http://localhost:${PORT}`);
  console.log("");
});
