# Hermes 🪽

A tiny AI chat bot you can run in a few minutes — then build on top of.

This is the starting point for the workshop. Get it running as-is first,
then we'll use an AI coding IDE to add your own features.

## Quickstart

You'll need [Node.js](https://nodejs.org) (LTS) and [Git](https://git-scm.com) installed.

```bash
# 1. Get the code
git clone <REPO_URL>
cd hermes-bot

# 2. Install the pieces it needs
npm install

# 3. Add your OpenAI key
#    Mac/Linux:
cp .env.example .env
#    Windows:
copy .env.example .env
#    ...then open .env and paste your key.

# 4. Run it!
npm run dev
```

Now open **http://localhost:3000** in your browser and say hi to Hermes.

## What's inside

| File | What it does |
| --- | --- |
| `server.js` | The backend. Receives messages and asks OpenAI for a reply. |
| `public/index.html` | The chat page you see in the browser. |
| `public/style.css` | The colors and layout. |
| `public/app.js` | Sends your messages to the server. |
| `.env` | Your secret API key (never shared). |

## Ideas to build next

- Give Hermes a new personality (edit `SYSTEM_PROMPT` in `server.js`).
- Change the colors (edit `public/style.css`).
- Make Hermes remember the whole conversation.
- Add a "clear chat" button.

Have fun! 🚀
