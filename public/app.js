import { renderMarkdown } from "./markdown.js";
import { readEvents } from "./stream.js";
import { createVoice } from "./voice.js";

const $ = id => document.getElementById(id);
const STORAGE = "wall-g.conversations.v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const mobile = matchMedia("(max-width: 760px)");
const input = $("input");
const chat = $("chat");
let conversations = [];
let activeId;
let generation = null;
let attachments = [];
let stickToBottom = true;
let toastTimer;
let saveTimer;
let storageWarning = false;
let voiceMode = "dictate";
let audioFile = null;
let voiceApproved = false;
let voiceTurnChat = null;
let voicePhase = "idle";
let draftVersion = 0;
const savedSnapshots = new Map();
const deletedIds = new Set();

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS(svg.namespaceURI, "use");
  use.setAttribute("href", `#i-${name}`);
  svg.setAttribute("aria-hidden", "true");
  svg.append(use);
  return svg;
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function iconButton(name, label, action) {
  const button = element("button", "icon-button");
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(icon(name));
  if (action) button.addEventListener("click", action);
  return button;
}
function toast(message) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").hidden = false;
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, 6500);
}
function currentChat() { return conversations.find(item => item.id === activeId); }
function save() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const changes = conversations.map(item => [item.id, JSON.stringify(item)]).filter(([id, snapshot]) => snapshot !== savedSnapshots.get(id));
  const removed = [...deletedIds];
  const selectedId = activeId;
  const persist = () => {
    // Merge only this tab's edits, so closing an old tab cannot erase newer chats.
    const stored = JSON.parse(localStorage.getItem(STORAGE) || "null");
    const latest = Array.isArray(stored?.conversations) ? stored.conversations : [];
    const changedIds = new Set(changes.map(([id]) => id));
    const merged = [...changes.map(([, snapshot]) => JSON.parse(snapshot)), ...latest.filter(item => !changedIds.has(item.id))].filter(item => !removed.includes(item.id));
    localStorage.setItem(STORAGE, JSON.stringify({ activeId: selectedId, conversations: merged }));
    changes.forEach(([id, snapshot]) => savedSnapshots.set(id, snapshot));
    removed.forEach(id => { deletedIds.delete(id); savedSnapshots.delete(id); });
    storageWarning = false;
  };
  // A cross-tab lock keeps two read/merge/write operations from racing.
  const write = navigator.locks ? navigator.locks.request(STORAGE, persist) : Promise.resolve().then(persist);
  return write.catch(() => {
    if (!storageWarning) toast("Browser storage is full or unavailable. This chat still works, but export it before leaving.");
    storageWarning = true;
  });
}
function load() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE) || "null");
    if (!stored) return;
    if (!Array.isArray(stored.conversations)) throw new Error();
    conversations = stored.conversations.filter(item => UUID.test(item.id) && typeof item.title === "string" && Array.isArray(item.messages)).map(item => ({
      id: item.id, title: item.title.slice(0, 80), createdAt: Number(item.createdAt) || Date.now(),
      messages: item.messages.filter(message => ["user", "assistant"].includes(message.role) && typeof message.text === "string").map(message => ({
        id: UUID.test(message.id) ? message.id : crypto.randomUUID(), role: message.role, text: message.text,
        status: message.status === "streaming" ? "interrupted" : ["complete", "error", "interrupted"].includes(message.status) ? message.status : "complete",
        note: typeof message.note === "string" ? message.note : "", createdAt: Number(message.createdAt) || Date.now(),
        attachments: (Array.isArray(message.attachments) ? message.attachments : []).filter(file => UUID.test(file.id) && typeof file.name === "string").map(file => ({
          id: file.id, name: file.name, size: Number(file.size) || 0, kind: file.kind === "image" ? "image" : "document", url: `/api/attachments/${file.id}`,
        })),
      })),
    }));
    activeId = conversations.some(item => item.id === stored.activeId) ? stored.activeId : conversations[0]?.id;
    conversations.forEach(item => savedSnapshots.set(item.id, JSON.stringify(item)));
  } catch { toast("Saved conversations could not be loaded. You can still start a new chat."); }
}
async function newChat() {
  voice.cancel();
  clearAttachments();
  const empty = conversations.find(item => !item.messages.length);
  if (empty) activeId = empty.id;
  else {
    const conversation = { id: crypto.randomUUID(), title: "New conversation", createdAt: Date.now(), messages: [] };
    conversations.unshift(conversation);
    activeId = conversation.id;
  }
  input.value = "";
  resizeInput();
  stickToBottom = true;
  await save();
  renderChat();
  renderHistory();
  setSidebar(false);
  input.focus();
}
async function selectChat(id) {
  if (id === activeId) { setSidebar(false); return; }
  voice.cancel();
  clearAttachments();
  activeId = id;
  input.value = "";
  resizeInput();
  stickToBottom = true;
  await save();
  renderChat();
  renderHistory();
  setSidebar(false);
}
function renderHistory() {
  const history = $("history");
  const query = $("search").value.trim().toLowerCase();
  history.replaceChildren();
  $("chat-count").textContent = conversations.filter(item => item.messages.length).length;
  const matches = conversations.filter(item => item.messages.length && (!query || item.title.toLowerCase().includes(query) || item.messages.some(message => message.text.toLowerCase().includes(query))));
  for (const item of matches) {
    const button = element("button", "history-item");
    button.title = item.title;
    if (item.id === activeId) button.setAttribute("aria-current", "page");
    button.append(generation?.chatId === item.id ? element("span", "spinner") : icon("chat"), element("span", "", item.title));
    button.addEventListener("click", () => selectChat(item.id));
    history.append(button);
  }
  if (!matches.length) history.append(element("p", "history-empty", query ? "No conversations found. Try another word." : "Good conversations start here. Your chats will appear as you go."));
}
function attachmentCard(file, { draft = false } = {}) {
  const card = element(draft ? "div" : "a", `attachment${file.kind === "image" ? " image" : ""}`);
  if (!draft) { card.href = `/api/attachments/${file.id}`; card.target = "_blank"; card.rel = "noopener"; card.setAttribute("aria-label", `Open ${file.name}`); }
  if (file.kind === "image" && file.url) {
    const image = document.createElement("img");
    image.src = file.url;
    image.alt = file.name;
    image.addEventListener("error", () => { image.replaceWith(icon("file")); card.classList.remove("image"); });
    card.append(image);
  } else card.append(file.uploading ? element("span", "spinner") : icon("file"));
  const label = element("span", "attachment-label");
  label.append(element("span", "", file.name), element("span", "secondary", file.uploading ? "Adding file..." : `${file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`} ${file.kind === "image" ? "image" : "document"}`));
  card.append(label);
  if (draft) {
    const remove = iconButton("close", `Remove ${file.name}`, () => removeAttachment(file));
    remove.classList.add("remove-file");
    card.append(remove);
  }
  return card;
}
function renderAttachments() {
  $("attachments").replaceChildren(...attachments.map(file => attachmentCard(file, { draft: true })));
  $("attachments").hidden = !attachments.length;
  updateComposer();
}
function removeAttachment(file) {
  file.controller?.abort();
  attachments = attachments.filter(item => item !== file);
  if (file.preview) URL.revokeObjectURL(file.preview);
  if (file.id) fetch(`/api/attachments/${file.id}`, { method: "DELETE" }).catch(() => {});
  renderAttachments();
}
function clearAttachments() { draftVersion++; [...attachments].forEach(removeAttachment); }
async function uploadFiles(files) {
  const version = draftVersion;
  for (const file of files) {
    if (version !== draftVersion) break;
    if (file.type.startsWith("audio/") || /\.(wav|mp3|m4a|ogg|webm|flac)$/i.test(file.name)) {
      if (files.length > 1) toast("Transcribe one audio file at a time. Other files can be attached separately.");
      requestVoice("file", file);
      break;
    }
    if (attachments.length >= 8) { toast("You can attach up to 8 files in one message."); break; }
    const image = /\.(png|jpe?g|gif|webp)$/i.test(file.name);
    if (file.size > (image ? 4 : 10) * 1024 * 1024) { toast(`${file.name}: ${image ? "images must be under 4 MB" : "files must be under 10 MB"}.`); continue; }
    const draft = { name: file.name, size: file.size, kind: image ? "image" : "document", uploading: true, controller: new AbortController() };
    if (image) draft.url = draft.preview = URL.createObjectURL(file);
    attachments.push(draft);
    renderAttachments();
    try {
      const response = await fetch("/api/attachments", { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Filename": encodeURIComponent(file.name) }, body: file, signal: draft.controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || "This file could not be added.");
      if (version !== draftVersion || !attachments.includes(draft)) { fetch(data.url, { method: "DELETE" }).catch(() => {}); continue; }
      if (draft.preview) URL.revokeObjectURL(draft.preview);
      Object.assign(draft, data, { uploading: false, preview: null });
    } catch (error) {
      if (!draft.controller.signal.aborted) toast(error.message);
      attachments = attachments.filter(item => item !== draft);
      if (draft.preview) URL.revokeObjectURL(draft.preview);
    }
    renderAttachments();
  }
}
function makeMessage(message, animate = false) {
  const article = element("article", `message ${message.role}${animate ? " entering" : ""}`);
  article.id = `message-${message.id}`;
  article.setAttribute("aria-label", message.role === "user" ? "You" : "WALL-G");
  if (message.role === "assistant") {
    const head = element("div", "message-head");
    const mark = element("span", "brand-mark", "w");
    mark.setAttribute("aria-hidden", "true");
    mark.append(element("span", "", "."));
    head.append(mark, element("span", "", "WALL-G"), element("span", "message-time", new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })));
    article.append(head, element("div", "tool-activity"));
  }
  if (message.attachments?.length) {
    const files = element("div", "message-attachments");
    files.append(...message.attachments.map(file => attachmentCard(file)));
    article.append(files);
  }
  article.append(element("div", `message-content${message.role === "assistant" ? " markdown" : ""}`));
  if (message.role === "assistant") article.append(element("div", "message-status"), element("div", "message-actions"));
  updateMessage(article, message);
  return article;
}
function updateMessage(article, message) {
  const content = article.querySelector(".message-content");
  const streaming = message.status === "streaming";
  article.classList.toggle("streaming", streaming && !!message.text);
  if (message.role === "user") { content.textContent = message.text; content.hidden = !message.text; return; }
  if (message.text) renderMarkdown(content, message.text, { streaming });
  else if (streaming) {
    const dots = element("div", "thinking-dots");
    dots.setAttribute("aria-label", "WALL-G is thinking");
    dots.append(element("span"), element("span"), element("span"));
    content.replaceChildren(dots);
  } else content.replaceChildren();
  const status = article.querySelector(".message-status");
  status.textContent = message.note || (message.status === "interrupted" ? "Response stopped. You can keep chatting below." : "");
  status.classList.toggle("error", message.status === "error");
  status.hidden = !status.textContent;
  const actions = article.querySelector(".message-actions");
  actions.replaceChildren();
  if (!streaming && message.text) {
    actions.append(iconButton("copy", "Copy response", () => copyText(message.text)), iconButton("volume", "Read aloud using a local voice", () => voice.speak(message.text)));
  }
  const activity = article.querySelector(".tool-activity");
  activity.replaceChildren();
  if (streaming && generation?.message.id === message.id) {
    for (const tool of generation.tools.values()) {
      const pill = element("span", "tool-pill");
      pill.append(tool.status === "running" ? element("span", "spinner") : icon("check"), element("span", "", tool.label || tool.tool || "Using a tool"));
      activity.append(pill);
    }
  }
}
function renderChat() {
  const conversation = currentChat();
  if (!conversation) return;
  $("welcome").hidden = !!conversation.messages.length;
  $("messages").replaceChildren(...conversation.messages.map(message => makeMessage(message)));
  $("conversation-title").textContent = conversation.title;
  document.title = conversation.messages.length ? `${conversation.title} | WALL-G` : "WALL-G | Your space to think";
  $("rename-chat").disabled = !conversation.messages.length;
  $("export-chat").disabled = !conversation.messages.length;
  $("delete-chat").disabled = !conversation.messages.length || generation?.chatId === activeId;
  updateComposer();
  requestAnimationFrame(scrollToBottom);
}
function scrollToBottom() {
  if (stickToBottom) chat.scrollTop = chat.scrollHeight;
  $("jump-latest").hidden = stickToBottom || !currentChat()?.messages.length;
}
function resizeInput() { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 180)}px`; }
function updateComposer() {
  const speaking = ["listening", "transcribing", "downloading"].includes(voicePhase);
  $("send").hidden = !!generation && generation.chatId === activeId;
  $("stop").hidden = !generation || generation.chatId !== activeId;
  $("send").disabled = !!generation || speaking || attachments.some(file => file.uploading) || (!input.value.trim() && !attachments.length);
  $("dictate").disabled = !!generation || speaking;
  $("voice-chat").disabled = !!generation || speaking;
  $("attach").disabled = speaking;
}
async function sendMessage({ text = input.value.trim(), spoken = false } = {}) {
  if (generation || attachments.some(file => file.uploading) || (!text && !attachments.length)) return;
  const conversation = currentChat();
  const files = attachments.map(({ id, name, size, kind, url }) => ({ id, name, size, kind, url }));
  const userMessage = { id: crypto.randomUUID(), role: "user", text, attachments: files, status: "complete", createdAt: Date.now() };
  const reply = { id: crypto.randomUUID(), role: "assistant", text: "", status: "streaming", createdAt: Date.now() };
  if (!conversation.messages.length) conversation.title = (text || files[0]?.name || "Voice conversation").replace(/\s+/g, " ").slice(0, 48);
  conversation.messages.push(userMessage, reply);
  conversations = [conversation, ...conversations.filter(item => item !== conversation)];
  const turn = { chatId: conversation.id, message: reply, controller: new AbortController(), tools: new Map(), stopped: false };
  generation = turn;
  draftVersion++;
  attachments = [];
  renderAttachments();
  input.value = "";
  resizeInput();
  stickToBottom = true;
  renderChat();
  $(`message-${reply.id}`)?.classList.add("entering");
  renderHistory();
  save();
  $("announcer").textContent = "WALL-G is replying.";
  let paintTimer;
  const paint = () => {
    clearTimeout(paintTimer);
    if (activeId !== turn.chatId) return;
    const article = $(`message-${reply.id}`);
    if (article) updateMessage(article, reply);
    scrollToBottom();
  };
  try {
    const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, signal: turn.controller.signal, body: JSON.stringify({ message: text, conversationId: conversation.id, attachments: files.map(file => file.id) }) });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error?.message || "The local server could not send your message.");
    }
    await readEvents(response, (event, data) => {
      if (event === "error" || data.error) throw new Error(data.error?.message || "Hermes had a problem while replying.");
      if (event === "hermes.tool.progress") {
        const key = data.toolCallId || data.tool || "tool";
        const previous = turn.tools.get(key);
        turn.tools.set(key, { ...previous, ...data });
      } else {
        const choice = data.choices?.[0];
        if (choice?.finish_reason === "error") throw new Error("Hermes could not finish this reply. Check the gateway terminal and try again.");
        if (choice?.finish_reason === "length") reply.note = "The model reached its response limit. Ask WALL-G to continue.";
        if (typeof choice?.delta?.content === "string") reply.text += choice.delta.content;
        if (reply.text.length > 120_000) throw new Error("This reply reached the display limit. Ask WALL-G for a shorter response.");
      }
      if (!paintTimer) paintTimer = setTimeout(() => { paintTimer = null; paint(); }, 65);
      if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = null; save(); }, 1000);
    });
    if (!reply.text.trim()) throw new Error("No response text arrived. Check that your Hermes model supports streaming and try again.");
    reply.status = "complete";
    $("announcer").textContent = "WALL-G has finished replying.";
  } catch (error) {
    reply.status = turn.stopped ? "interrupted" : "error";
    reply.note = turn.stopped ? "Response stopped. You can keep chatting below." : error.message || "The connection was lost. Check that the web server and Hermes are running.";
    $("announcer").textContent = reply.note;
  } finally {
    turn.controller.abort();
    generation = null;
    await save();
    paint();
    renderHistory();
    updateComposer();
    $("delete-chat").disabled = !currentChat()?.messages.length;
    if (activeId === turn.chatId && !$("voice-dialog").open && !mobile.matches) input.focus();
  }
  if (spoken && reply.status === "complete" && $("voice-dialog").open && activeId === turn.chatId) {
    $("voice-transcript").textContent = reply.text;
    $("voice-transcript").hidden = false;
    await voice.speak(reply.text);
  }
  if ($("voice-dialog").open) updateVoiceState({ phase: voice.phase });
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast("Copied to clipboard."); }
  catch { toast("Clipboard access is unavailable. Select the text to copy it."); }
}

// Voice is lazy: this object alone loads neither models nor microphone access.
const voice = createVoice({
  onState: updateVoiceState,
  onError: message => { toast(message); if ($("voice-dialog").open) $("voice-detail").textContent = message; },
  onTranscript: (text, { mode }) => {
    if (voiceTurnChat !== activeId) { toast("Voice input was cancelled when you left that conversation."); return; }
    if (mode === "conversation") {
      if (voiceTurnChat !== activeId || !$("voice-dialog").open) { toast("Voice input was cancelled when you left that conversation."); return; }
      $("voice-transcript").hidden = false;
      $("voice-transcript").textContent = text;
      $("voice-title").textContent = "A little thinking time.";
      $("voice-action").disabled = true;
      $("voice-detail").textContent = "Your transcript has been sent to WALL-G.";
      sendMessage({ text, spoken: true });
    } else {
      input.value = `${input.value}${input.value.trim() ? "\n" : ""}${text}`.slice(0, 32000);
      resizeInput();
      updateComposer();
      closeVoice();
      input.focus();
      toast("Transcribed locally. Review your text, then send when you're ready.");
    }
  },
});
function updateVoiceState(state) {
  voicePhase = state.phase;
  const active = ["listening", "speaking", "transcribing", "downloading"].includes(state.phase);
  const listening = state.phase === "listening";
  $("voice-orb").classList.toggle("active", active);
  $("voice-orb").style.transform = listening ? `scale(${1 + (state.level || 0) * .12})` : "";
  $("voice-progress").hidden = state.phase !== "downloading";
  if (Number.isFinite(state.progress)) $("voice-progress").value = state.progress;
  $("voice-strip").hidden = !active || $("voice-dialog").open;
  const titles = { downloading: "Making room for your voice.", ready: "Ready when you are.", listening: "I'm all ears.", transcribing: "Turning thoughts into words.", speaking: "Here's what I'm thinking.", idle: "Your turn, whenever." };
  $("voice-title").textContent = titles[state.phase] || titles.idle;
  const descriptions = {
    downloading: "Whisper is loading on your device. Just a moment.",
    ready: "Speak naturally. Your microphone turns off when you finish.",
    listening: voiceMode === "conversation" ? "Finish recording to send your words to WALL-G." : "Finish recording to put your words in the composer.",
    transcribing: "Your audio is being transcribed here, on your device.",
    speaking: "Spoken with an installed local voice. No speech service involved.",
    idle: "Tap below to speak. Nothing records in the background.",
  };
  $("voice-description").textContent = descriptions[state.phase] || descriptions.idle;
  const seconds = Math.floor(state.seconds || 0);
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const detail = listening ? `${time} / 2:00 - microphone on` : state.detail || (state.phase === "idle" || state.phase === "ready" ? "Whisper for transcription. Local device voices for replies." : "");
  $("voice-detail").textContent = detail;
  $("voice-strip-text").textContent = listening ? `Listening locally - ${time}` : state.phase === "transcribing" ? "Transcribing on your device..." : state.phase === "speaking" ? "Reading aloud with a local voice" : `Loading Whisper${Number.isFinite(state.progress) ? ` - ${Math.round(state.progress)}%` : "..."}`;
  $("voice-finish").hidden = !listening;
  const button = $("voice-action");
  button.disabled = ["downloading", "transcribing"].includes(state.phase) || !!generation;
  button.replaceChildren(icon(listening || state.phase === "speaking" ? "stop" : "mic"), element("span", "", listening ? (voiceMode === "conversation" ? "Finish & send" : "Finish dictation") : state.phase === "speaking" ? "Stop speaking" : state.phase === "downloading" ? "Loading local Whisper..." : state.phase === "transcribing" ? "Transcribing..." : "Start speaking"));
  updateComposer();
}
function requestVoice(mode, file = null) {
  if (generation) { toast("Wait for WALL-G to finish, or stop the current reply first."); return; }
  if (mode === "conversation" && (input.value.trim() || attachments.length)) { toast("Send or clear your draft before starting voice chat. The microphone button can add dictation to it."); return; }
  voice.cancel();
  voiceMode = mode;
  audioFile = file;
  voiceTurnChat = activeId;
  $("voice-transcript").hidden = true;
  if (!voiceApproved) {
    $("voice-title").textContent = mode === "file" ? "Give audio a voice." : "Think out loud.";
    $("voice-description").textContent = "OpenAI's open-source Whisper transcribes on your device. No speech API, no account, no extra cost.";
    $("voice-detail").textContent = "First use downloads about 100 MB of model files. After that, they're cached in this browser.";
    $("voice-action").replaceChildren(icon("download"), element("span", "", "Enable local voice"));
  } else updateVoiceState({ phase: "ready" });
  $("voice-dialog").showModal();
  $("voice-strip").hidden = true;
  if (voiceApproved && mode !== "conversation") beginVoice();
}
async function beginVoice() {
  voiceApproved = true;
  if (voiceMode === "file" && audioFile) { await voice.transcribeFile(audioFile); return; }
  if (voiceMode === "dictate") $("voice-dialog").close();
  await voice.start(voiceMode === "conversation" ? "conversation" : "dictate");
}
function closeVoice() {
  voice.cancel();
  audioFile = null;
  if ($("voice-dialog").open) $("voice-dialog").close();
  $("voice-strip").hidden = true;
}

function setSidebar(open) {
  if (mobile.matches) {
    document.body.classList.toggle("sidebar-mobile-open", open);
    $("sidebar-backdrop").hidden = !open;
    $("sidebar").inert = !open;
    $("main").inert = open;
    $("sidebar").setAttribute("role", open ? "dialog" : "complementary");
    if (open) { $("sidebar").setAttribute("aria-modal", "true"); $("close-sidebar").focus(); }
    else { $("sidebar").removeAttribute("aria-modal"); $("open-sidebar").focus({ preventScroll: true }); }
  } else {
    document.body.classList.remove("sidebar-mobile-open");
    $("sidebar-backdrop").hidden = true;
    $("sidebar").inert = false;
    $("main").inert = false;
    $("sidebar").removeAttribute("aria-modal");
    $("sidebar").setAttribute("role", "complementary");
  }
  $("open-sidebar").setAttribute("aria-expanded", String(mobile.matches ? open : !document.body.classList.contains("sidebar-collapsed")));
}
function showInfo() { setSidebar(false); $("info-dialog").showModal(); }
let checking = false;
async function checkConnection() {
  if (checking) return;
  checking = true;
  let connected = false;
  try { const response = await fetch("/api/health", { signal: AbortSignal.timeout(4500) }); connected = response.ok && (await response.json()).hermes === "up"; } catch { /* The status is a hint, not proof that the model can reply. */ }
  $("banner").hidden = connected;
  $("connection").classList.toggle("connected", connected);
  $("connection-text").textContent = connected ? "Connected" : "Not connected";
  $("connection").title = connected ? "Local Hermes gateway is reachable. Model availability is checked when you send." : "Start hermes gateway in another terminal.";
  checking = false;
}

$("form").addEventListener("submit", event => { event.preventDefault(); if (!$("send").disabled) sendMessage(); });
input.addEventListener("input", () => { resizeInput(); updateComposer(); });
input.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !mobile.matches) { event.preventDefault(); if (!$("send").disabled) sendMessage(); }
});
$("stop").addEventListener("click", () => { if (generation) { generation.stopped = true; generation.controller.abort(); } });
$("new-chat").addEventListener("click", newChat);
$("mobile-new-chat").addEventListener("click", newChat);
$("search").addEventListener("input", renderHistory);
document.querySelectorAll("[data-prompt]").forEach(button => button.addEventListener("click", () => { input.value = button.dataset.prompt; resizeInput(); updateComposer(); input.focus(); }));
for (const id of ["attach", "suggest-file"]) $(id).addEventListener("click", () => $("file-input").click());
$("file-input").addEventListener("change", event => { uploadFiles([...event.target.files]); event.target.value = ""; });
input.addEventListener("paste", event => {
  const files = [...(event.clipboardData?.files || [])];
  if (files.length) { event.preventDefault(); uploadFiles(files); }
});
let dragDepth = 0;
document.addEventListener("dragenter", event => {
  if (!event.dataTransfer?.types.includes("Files") || document.querySelector("dialog[open]")) return;
  event.preventDefault(); dragDepth++; $("drop-zone").hidden = false;
});
document.addEventListener("dragover", event => { if (event.dataTransfer?.types.includes("Files")) event.preventDefault(); });
document.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $("drop-zone").hidden = true; });
document.addEventListener("drop", event => {
  event.preventDefault(); dragDepth = 0; $("drop-zone").hidden = true;
  if (!document.querySelector("dialog[open]")) uploadFiles([...(event.dataTransfer?.files || [])]);
});
window.addEventListener("blur", () => { dragDepth = 0; $("drop-zone").hidden = true; });
chat.addEventListener("scroll", () => { stickToBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 85; $("jump-latest").hidden = stickToBottom || !currentChat()?.messages.length; }, { passive: true });
$("jump-latest").addEventListener("click", () => { stickToBottom = true; scrollToBottom(); });
$("messages").addEventListener("click", event => { const button = event.target.closest("[data-copy-code]"); if (button) copyText(button.closest("pre").querySelector("code").textContent); });
$("dictate").addEventListener("click", () => requestVoice("dictate"));
$("voice-chat").addEventListener("click", () => requestVoice("conversation"));
$("voice-action").addEventListener("click", () => {
  if (voice.phase === "listening") voice.stop();
  else if (voice.phase === "speaking") voice.cancel();
  else beginVoice();
});
$("voice-finish").addEventListener("click", () => voice.stop());
$("voice-cancel").addEventListener("click", closeVoice);
$("close-voice").addEventListener("click", closeVoice);
$("voice-dialog").addEventListener("cancel", event => { event.preventDefault(); closeVoice(); });
$("about").addEventListener("click", showInfo);
$("privacy").addEventListener("click", showInfo);
$("retry-connection").addEventListener("click", checkConnection);
$("open-sidebar").addEventListener("click", () => {
  document.body.classList.remove("sidebar-collapsed");
  setSidebar(!document.body.classList.contains("sidebar-mobile-open"));
});
$("close-sidebar").addEventListener("click", () => { if (!mobile.matches) document.body.classList.add("sidebar-collapsed"); setSidebar(false); });
$("sidebar-backdrop").addEventListener("click", () => setSidebar(false));
mobile.addEventListener("change", () => setSidebar(false));
document.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => $(button.dataset.close).close()));
document.addEventListener("click", event => { if (!$("chat-menu").contains(event.target)) $("chat-menu").open = false; });
document.addEventListener("keydown", event => {
  if (event.key === "Escape") { $("chat-menu").open = false; if (document.body.classList.contains("sidebar-mobile-open")) setSidebar(false); }
  if (document.body.classList.contains("sidebar-mobile-open") && event.key === "Tab") {
    const focusable = [...$("sidebar").querySelectorAll("a, button, input")].filter(node => !node.disabled);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  if (document.querySelector("dialog[open]") || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  if (event.key === "/" || (event.key === "k" && (event.metaKey || event.ctrlKey))) { event.preventDefault(); document.body.classList.remove("sidebar-collapsed"); setSidebar(true); $("search").focus(); }
  if (event.key.toLowerCase() === "n" && !event.metaKey && !event.ctrlKey) { event.preventDefault(); newChat(); }
});
$("rename-chat").addEventListener("click", () => { $("chat-menu").open = false; $("chat-name").value = currentChat().title; $("edit-dialog").showModal(); $("chat-name").select(); });
$("edit-form").addEventListener("submit", async event => { event.preventDefault(); const title = $("chat-name").value.trim(); if (!title) return; currentChat().title = title; await save(); renderHistory(); renderChat(); $("edit-dialog").close(); });
$("delete-chat").addEventListener("click", () => { $("chat-menu").open = false; $("delete-dialog").showModal(); });
$("confirm-delete").addEventListener("click", () => {
  if (generation?.chatId === activeId) return;
  deletedIds.add(activeId);
  conversations = conversations.filter(item => item.id !== activeId);
  $("delete-dialog").close();
  newChat();
  toast("Conversation removed from this browser. Hermes memory and saved files were not erased.");
});
$("export-chat").addEventListener("click", () => {
  $("chat-menu").open = false;
  const conversation = currentChat();
  const text = `# ${conversation.title}\n\n${conversation.messages.map(message => `## ${message.role === "user" ? "You" : "WALL-G"}\n\n${message.text}${message.attachments?.length ? `\n\nAttachments: ${message.attachments.map(file => file.name).join(", ")}` : ""}${message.note ? `\n\n[${message.note}]` : ""}`).join("\n\n---\n\n")}\n`;
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const link = document.createElement("a"); link.href = url; link.download = `wall-g-${conversation.title.replace(/[^a-z0-9]+/gi, "-").slice(0, 50)}.md`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
window.addEventListener("pagehide", () => { save(); generation?.controller.abort(); voice.cancel(); });
load();
if (!activeId) newChat();
else { renderHistory(); renderChat(); }
setSidebar(false);
resizeInput();
checkConnection();
setInterval(() => { if (!document.hidden) checkConnection(); }, 5000);
