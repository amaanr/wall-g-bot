# WALL-G

WALL-G is the web client for your local **Hermes** agent. This is the starting
point for the workshop: get it running as-is, then use an AI coding IDE to make
it your own. The engine is still Hermes, the repository is `wall-g-bot`, and
terminal commands still start with `hermes`.

**A local agent does not mean an offline AI model.** Hermes runs on your
computer, but the default chat models run with online AI providers. When you
send a message, its text, extracted file text, and image content go through
Hermes to the selected AI provider. The at-home and workshop defaults need an
internet connection; the optional speech features below run locally.

---

## Before the workshop (do this at home!)

Please install everything **before** you arrive. Downloads are much easier at
home than on venue wifi with everyone trying at once.

### 1. Install Node.js and Git

- [Node.js](https://nodejs.org): **22.13.0 or newer**, as required by this
  project's package. The **current LTS** release is recommended.
- [Git](https://git-scm.com)

No Docker or separate database service is needed.

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
This checks the install, not the web chat yet. Continue below and get a real
reply in your browser before marking your setup complete.

> On a fresh setup without an OpenAI key, `npm run setup` (next section) chooses
> a **free, no-sign-up** model from OpenCode Free (`opencode-free`), with other
> free models as fallbacks. No provider account or key is needed at home.
> At the workshop we'll switch to OpenAI together, using a shared key.

---

## Before the workshop: get the web app running

Once Hermes is installed, this part is quick.

On Windows, use `npm.cmd` wherever the commands below say `npm`.

```bash
# 1. Get the code
git clone https://github.com/amaanr/wall-g-bot.git
cd wall-g-bot

# 2. Install the web app's pieces
npm install

# 3. Connect the web app to your Hermes (one time)
npm run setup
```

Start Hermes in this terminal and leave it running:

```bash
# Terminal 1: start your Hermes agent
hermes gateway
```

Open a **second** terminal for the web app. Type `cd ` (with a space), drag your
`wall-g-bot` folder into the window, and press Enter. Both terminals should be
inside that same folder.

```bash
# Terminal 2: start WALL-G
npm run dev
```

`npm run dev` also checks the setup automatically. If you started the gateway
before setup finished, stop it with **Ctrl+C** in Terminal 1 and run
`hermes gateway` again so it reads the new settings.

Open the **http://localhost:…** address printed on the "WALL-G is running at…"
line (usually **http://localhost:3000**; if that port is already in use, WALL-G
automatically moves to the next free one, like 3001, and prints it). Send
**"Reply only with: WALL-G is ready."**
A real reply means you're ready; the welcome message alone doesn't count.
**Connected** only means the gateway is reachable, not that authentication or
the selected model works. Sending a message checks those too.

> **Two different keys:** `API_SERVER_KEY` is a local connection password
> automatically generated or reused by setup. It is not a model-provider key
> and costs nothing. At the workshop, add the shared `OPENAI_API_KEY` to Hermes,
> not in place of `API_SERVER_KEY`. Keep both keys private.

> If the page shows "Start `hermes gateway` in another terminal to connect WALL-G.",
> keep Terminal 1 running. The status refreshes automatically; no reload or
> particular gateway log message is needed. Warnings about optional tools are
> not necessarily failures. If the banner stays or the gateway exits with an
> error, check Terminal 1 and ask a facilitator for help.

> **First reply feels slow?** The free models are shared and their speed varies.
> Setup configures free fallbacks, but availability can change. To pick another
> free model, run `hermes model` in a third terminal and check the current list.
> Restart `hermes gateway` in Terminal 1 with Ctrl+C followed by `hermes gateway`,
> then send another message. Leave the web app running.

---

## Switching to OpenAI (at the workshop)

When we hand out the OpenAI key, add it to Hermes and pick the model:

```bash
hermes model      # choose OpenAI, paste the key we give you
```

Choose **OpenAI API** (not a ChatGPT/Codex subscription), then the model named
by the instructors. Restart `hermes gateway` with Ctrl+C followed by
`hermes gateway`. Leave the web app running and send another test message.

You **don't** need to change any code. WALL-G asks Hermes for a reply, and Hermes
uses its configured model. Voice needs no additional paid speech service;
chat-model usage still follows the selected provider's pricing.

---

## What WALL-G can already do (no extra setup)

Out of the box, after `npm run setup`, your WALL-G can already use a big chunk of
Hermes. These are on by default — just ask in the chat:

- **Research the web** — "look up X and summarize it with sources."
- **Read a page** — "open this URL and tell me what it says."
- **Make images and diagrams** — "draw me a poster for a robotics club."
- **Write and run code** — "make a p5js animation of bouncing balls."
- **Look at your uploads** — attach a PDF or image and ask about it.
- **Remember across chats** — it keeps its own memory and past sessions.
- **Use your computer** — open Calendar and read your week, or drive a browser to
  a website (one small permission step on macOS — see below).
- **62 built-in skills** — research papers, documents, infographics, and more.

Most of that needs no keys and no permissions. The one exception is computer use,
which needs a quick approval the first time.

---

## Computer use: let WALL-G open apps and browse for you

`npm run setup` turns this on for you. WALL-G can open Calendar and tell you your
week, or drive a browser to a website — right from the chat. Two small things
finish the setup:

**1. Approve the permission (macOS only, one time).**

```bash
npm run capabilities -- --grant   # opens the permission screen for you
```

In System Settings → Privacy & Security, turn ON **Accessibility** *and* **Screen
Recording** for **CuaDriver**. Re-run `npm run capabilities` to confirm both are
granted. (Windows/Linux: nothing to approve — skip this.)

**2. Restart Hermes so it picks up the change.** Press Ctrl+C in the
`hermes gateway` terminal, then run `hermes gateway` again. A gateway that was
already running won't notice until you restart it — this is the #1 thing people
forget.

Then try, right in the chat:

> Open Calendar and tell me what I've got this week.
>
> Open twitter.com in the browser and compose a post that says hello — then save
> it as a draft, don't post it.

Read what's **on the screen** to judge the result — the play-by-play WALL-G types
isn't always perfectly accurate.

### Please read this — it's powerful

- **WALL-G can see your screen and click real apps.** Keep the web app on
  `localhost` — never expose it to the internet — and only run it on a machine
  you're comfortable letting it drive.
- **At the workshop we share one OpenAI key.** That's fine for chatting, and it
  also means the shared bot can control *your* laptop when you ask it to. Run it
  on your own machine and watch what it does.
- **It never enters passwords or 2FA.** If it hits a login screen it should stop.
  For the Twitter demo, log into a throwaway account yourself first.
- **Turn it off anytime:** `hermes tools disable computer_use --platform api_server`,
  then restart the gateway.

### Optional helper tools for a few skills

```bash
npm run capabilities -- --mac-skills   # Reminders, Notes, iMessage CLIs (macOS)
npm run capabilities -- --xurl         # official X/Twitter CLI (then run `xurl auth`)
npm run capabilities -- --all          # grant + mac-skills + xurl
```

For a Twitter demo, the most visual option needs **no API key** at all: just ask
WALL-G to open twitter.com in the browser. `--xurl` is only if you'd rather use
the official API.

---

## Using WALL-G

- **Real streaming:** replies arrive incrementally from Hermes, not as a typing
  animation over a finished answer. Use Stop to interrupt a response.
- **Readable answers:** Markdown, tables, highlighted code blocks, and buttons
  to copy a response or code. Tool-progress indicators appear while Hermes
  reports tool activity.
- **Conversations:** start and search chats in the sidebar. Use the conversation
  menu to rename, export as Markdown, or delete a chat from the browser.

The conversation list and visible messages persist in browser `localStorage`.
Each conversation also has a stable session ID so Hermes keeps the server-side
history in its own database. Return using the same browser and local address to
continue a saved chat. Browser storage is not a backup or a cross-device sync;
export important conversations.

### Files and images

Use the attach button, paste clipboard files or images into the composer, or
drag and drop them onto the page. Supported attachments include PDFs, UTF-8
text/code files (such as Markdown, CSV, JSON, Python, and JavaScript), and PNG,
JPEG, WebP, or GIF images. SVG and other binary formats are not supported.

| Limit | Maximum |
| --- | --- |
| Attachments | 8 per message |
| PDF or text/code file | 10 MiB per file |
| Image | 4 MiB per image; 40 million decoded pixels, including animation frames |
| Message text | 32,000 characters |
| Attachment text context | Up to 48,000 characters including names, paths, and notes; reduced for long messages to stay within Hermes's text-part limit |
| Complete request to Hermes | Below 10 MB (10,000,000 bytes) of JSON, including encoded images and the personality prompt |

These limits apply together. Encoding images makes them larger, so even two
individually valid large images can exceed the total request limit. Send fewer
or smaller images if that happens.

PDF text is extracted **locally**, from at most the first 100 pages, and long
extractions are shortened to fit the shared text budget. There is **no OCR
engine**: scanned/image-only PDFs are not understood by this text extractor.
Run OCR first or attach a text version. Original files and their local paths
remain available to Hermes tools.

**Image understanding is not guaranteed.** It depends on Hermes's selected
model and tools, and may require a separately configured vision backend. An
image uploading successfully does not mean every model can understand it.

### Optional local voice

Speech-to-text uses **OpenAI's open-source Whisper Tiny**, an ONNX model
(`onnx-community/whisper-tiny`) running in a browser worker with WebAssembly.
This is not the OpenAI speech API. Choose **Enable local voice** to download
about **100 MB** of public model files on first use, with progress shown in the
UI. They are cached in this browser, but clearing storage or browser eviction
can require another download. No speech account, API key, or subscription is
needed.

- **Dictation:** use the microphone button, speak, then finish. The transcript
  goes into the composer for you to review and send.
- **Audio files:** attach or drop one audio file at a time to transcribe it into
  the composer, not upload it as a chat attachment. WAV, MP3, M4A, OGG, WebM,
  and FLAC are offered; actual format/codec decoding depends on your browser.
- **Voice chat:** choose **Let's talk**, start speaking, then choose **Finish &
  send**. This sends the transcript to Hermes's configured chat model and reads
  the reply aloud. Recordings also finish automatically at 120 seconds, which
  sends the transcript in voice-chat mode.

Audio is limited to **120 seconds** and **25 MiB** (shown as "25 MB" in the UI).
Use a current browser at `http://localhost:3000` and allow microphone access
when asked. **Audio is never uploaded**, including to this app's local server;
only the transcript enters chat when sent. The chat model still uses the
selected AI provider.

Spoken replies and **Read aloud** use only installed OS voices that the browser
reports as local. If none is available or playback fails, WALL-G shows a message
and keeps the text reply. There is **no silent fallback to remote speech**.
Install a local/offline voice in your device's speech settings if needed.

## Storage and privacy

Files are saved when attached in the private **`.local/uploads/`** folder,
outside `public/` and ignored by Git. Sent attachments are retained for history
and Hermes tools, even if a reply fails after submission. There is **no automatic
cleanup**. You can remove unsent attachments from a draft; sent files stay on
disk until you deliberately remove them, which can break old file references.

**Delete from browser only removes the browser's chat.** It does not delete
Hermes's database history or memory, uploaded files on disk, or AI-provider
records. Clearing browser storage has the same limitation. Local storage and
local PDF extraction do not stop submitted text/images from reaching the
selected AI provider (or a configured fallback). Avoid sending secrets or
sensitive files, and check your provider's retention policy.

## What's inside

| File | What it does |
| --- | --- |
| `SOUL.md` | WALL-G's personality, read again for every message. **Edit this first!** |
| `server.js` | Local backend: Hermes sessions, streaming, and connection checks. |
| `server-attachments.js` | Private uploads, file validation, and local PDF/text extraction. |
| `setup.mjs` | One-time setup that connects the web app to Hermes. |
| `capabilities.mjs` | Grants the macOS permission for computer use, plus optional helper tools. |
| `public/index.html` | The chat page you see in the browser. |
| `public/style.css` | The colors and layout. |
| `public/app.js` | Conversations, browser storage, attachments, and chat controls. |
| `public/markdown.js` | Markdown rendering, code formatting, and copy buttons. |
| `public/stream.js` | Reads incoming streaming events. |
| `public/voice.js` | Local recording, transcription controls, and OS voice playback. |
| `public/whisper-worker.js` | Loads Whisper and transcribes audio in the browser. |
| `test/` | Automated tests using Node's built-in test runner. |
| `.env` | Local settings (created by `npm run setup`). |
| `.local/uploads/` | Private saved attachments and metadata, ignored by Git. |

## Tests

After `npm install`, run:

```bash
npm test
```

This uses Node's built-in test runner, local mock servers, and temporary files.
It does not need a running Hermes gateway, a model, or real API keys, and does
not change your actual Hermes configuration. On Windows, use `npm.cmd test`.

## Ideas to build next

- Give WALL-G a new personality in `SOUL.md`, then send a message. No restart
  needed.
- Change the colors (edit `public/style.css`).
- Add your own Hermes **skill** for a repeatable task, or connect a tool you want
  it to use.
- Customize the starter prompts in `public/index.html` for your interests.
- **Try computer use:** after the one-time `npm run capabilities -- --grant`
  approval (see "Computer use" above), ask WALL-G to open an app for you. Powerful
  — read the safety notes first, and use your own machine.
