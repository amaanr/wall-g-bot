// This file runs in the browser. It sends your message to the server
// and shows Hermes's reply on the screen.

const chat = document.getElementById("chat");
const form = document.getElementById("form");
const input = document.getElementById("input");
const button = form.querySelector("button");

// Add a message bubble to the screen.
function addMessage(text, who) {
  const msg = document.createElement("div");
  msg.className = `msg ${who}`;
  msg.innerHTML = `<div class="bubble"></div>`;
  msg.querySelector(".bubble").textContent = text;
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

  const thinking = addMessage("…", "bot");

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const data = await response.json();
    thinking.querySelector(".bubble").textContent = data.reply;
  } catch (error) {
    thinking.querySelector(".bubble").textContent =
      "Sorry, I couldn't reach the server. Is it still running?";
  } finally {
    button.disabled = false;
    input.focus();
    chat.scrollTop = chat.scrollHeight;
  }
});
