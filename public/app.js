// This file runs in the browser. It sends your message to the server
// and shows Hermes's reply on the screen.

const chat = document.getElementById("chat");
const form = document.getElementById("form");
const input = document.getElementById("input");
const button = form.querySelector("button");
const banner = document.getElementById("banner");

// Is Hermes awake? Show the hint bar when it isn't. We keep checking on a timer
// so that once you start `hermes gateway` in the other terminal, the bar clears
// itself — you don't have to watch the log or reload the page.
async function checkHermes() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    banner.hidden = data.hermes === "up";
  } catch {
    banner.hidden = false;
  }
}
checkHermes();
// Keep checking every 4s: the bar disappears on its own once Hermes is ready,
// and comes back if it ever stops — no reloading needed.
setInterval(checkHermes, 4000);

// Add a message bubble to the screen. Bot messages get a little ✳ avatar so
// they match the welcome message. `text` is set with textContent, so anything
// Hermes replies is shown safely as plain text (no HTML surprises).
function addMessage(text, who, { thinking = false } = {}) {
  const msg = document.createElement("div");
  msg.className = `msg ${who}${thinking ? " thinking" : ""}`;
  if (who === "bot") {
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = "✳";
    msg.appendChild(avatar);
  }
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  msg.appendChild(bubble);
  chat.appendChild(msg);
  chat.scrollTop = chat.scrollHeight;
  return msg;
}

// When you submit the form, send the message to Hermes.
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message) return;

  addMessage(message, "user");
  input.value = "";
  button.disabled = true;

  const thinking = addMessage("● ● ●", "bot", { thinking: true });

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const data = await response.json();
    thinking.classList.remove("thinking");
    thinking.querySelector(".bubble").textContent = data.reply;
    // If that worked, Hermes is clearly up — hide the warning banner.
    if (response.ok) banner.hidden = true;
  } catch (error) {
    thinking.classList.remove("thinking");
    thinking.querySelector(".bubble").textContent =
      "Sorry, I couldn't reach the server. Is it still running?";
  } finally {
    button.disabled = false;
    input.focus();
    chat.scrollTop = chat.scrollHeight;
  }
});
