# Hermes 🪽

Your own AI agent, running on your computer — with a little web chat page to
talk to it. This is the starting point for the workshop. Get it running as-is
first, then we'll use an AI coding IDE to add your own features.

Unlike a bot that just forwards messages to a company's servers, **Hermes runs
on your machine** and remembers what you talk about. This web app is a friendly
face in front of it.

---

## Before the workshop (do this at home!)

The install is the one slow part, so please do it **before** you arrive — on
venue wifi with everyone at once it's painful. It only takes a few minutes at home.

### 1. Install Node.js and Git

- [Node.js](https://nodejs.org) (the "LTS" version)
- [Git](https://git-scm.com)

### 2. Install Hermes

**Mac / Linux:**
```bash
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
```
Then reload your terminal: `source ~/.bashrc`  (or `source ~/.zshrc`)

**Windows (PowerShell):**
```powershell
iex (irm https://hermes-agent.nousresearch.com/install.ps1)
```

### 3. Check it works

```bash
hermes doctor
```
If that looks happy, you're ready. 🎉  Post a screenshot in the group chat so we
know you're set.

> You don't need to pick a model by hand — `npm run setup` (next section) turns
> on a **free, no-sign-up** model for you. At the workshop we'll switch to a
> faster OpenAI model together, using a key we share.

---

## At the workshop: get the web app running

Once Hermes is installed, this part is quick.

```bash
# 1. Get the code
git clone <REPO_URL>
cd hermes-bot

# 2. Install the web app's pieces
npm install

# 3. Connect the web app to your Hermes (one time)
npm run setup
```

Now open **two** terminals:

```bash
# Terminal 1 — start your Hermes agent (leave this running)
hermes gateway

# Terminal 2 — start the web app
npm run dev
```

Open **http://localhost:3000** and say hi to Hermes.

> If the page shows a red "Can't reach Hermes" bar, it just means Terminal 1
> isn't ready yet. Wait until `hermes gateway` says its API server is listening,
> then reload.

> **First reply feels slow?** The free models are shared and their speed varies.
> If yours is sluggish or errors, switch to another free one — no restart of the
> web app needed:
> ```bash
> hermes config set model.default mimo-v2.5-free
> ```
> (Run `hermes model` to see the full list. At the workshop, the OpenAI key
> makes this a non-issue.)

---

## Switching to OpenAI (at the workshop)

When we hand out the OpenAI key, add it to Hermes and pick the model:

```bash
hermes model      # choose OpenAI, paste the key we give you
```

You **don't** need to change any code — the web app just asks Hermes for a
reply, and Hermes uses whatever model you picked.

---

## What's inside

| File | What it does |
| --- | --- |
| `SOUL.md` | Hermes's personality. **Edit this first!** |
| `server.js` | The web app's backend. Passes your messages to your local Hermes. |
| `setup.mjs` | One-time setup that connects the web app to Hermes. |
| `public/index.html` | The chat page you see in the browser. |
| `public/style.css` | The colors and layout. |
| `public/app.js` | Sends your messages to the server. |
| `.env` | Local settings (created by `npm run setup`). |

## Ideas to build next

- Give Hermes a new personality (edit `SOUL.md`).
- Change the colors (edit `public/style.css`).
- Add a "clear chat" button.
- Ask Hermes to use one of its **skills** or **tools** — it can do a lot more
  than chat.

Have fun! 🚀
