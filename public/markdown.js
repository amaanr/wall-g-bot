import { marked } from "/vendor/marked/marked.esm.js";
import DOMPurify from "/vendor/dompurify/purify.es.mjs";

const escape = text => String(text).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    // Raw model HTML is text, never a second application inside the chat.
    html({ text }) { return escape(text); },
    image({ text }) { return `<span class="image-placeholder">[Image: ${escape(text || "external image")}]</span>`; },
    heading({ tokens, depth }) {
      const level = Math.min(depth + 1, 6);
      return `<h${level}>${this.parser.parseInline(tokens)}</h${level}>`;
    },
  },
});

export function renderMarkdown(element, text, { streaming = false } = {}) {
  element.innerHTML = DOMPurify.sanitize(marked.parse(text), {
    ALLOWED_TAGS: ["p", "br", "strong", "em", "del", "s", "a", "ul", "ol", "li", "blockquote", "pre", "code", "hr", "h2", "h3", "h4", "h5", "h6", "table", "thead", "tbody", "tr", "th", "td", "span", "input"],
    ALLOWED_ATTR: ["href", "title", "class", "start", "align", "type", "checked", "disabled"],
    ALLOW_DATA_ATTR: false,
  });
  element.querySelectorAll("a").forEach(link => {
    const href = link.getAttribute("href") || "";
    if (!/^(https?:\/\/|mailto:)/i.test(href)) link.removeAttribute("href");
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  });
  element.querySelectorAll("input").forEach(input => { input.type = "checkbox"; input.disabled = true; input.setAttribute("aria-label", "Task status"); });
  element.querySelectorAll("table").forEach(table => {
    const wrapper = document.createElement("div");
    wrapper.className = "table-wrap";
    wrapper.tabIndex = 0;
    wrapper.setAttribute("role", "region");
    wrapper.setAttribute("aria-label", "Scrollable table");
    table.replaceWith(wrapper);
    wrapper.append(table);
  });
  element.querySelectorAll("pre > code").forEach(code => {
    const language = [...code.classList].find(name => name.startsWith("language-"))?.slice(9) || "text";
    code.tabIndex = 0;
    code.setAttribute("role", "region");
    code.setAttribute("aria-label", `${language} code`);
    if (!streaming && code.textContent.length < 30_000 && globalThis.hljs?.getLanguage(language)) {
      code.innerHTML = globalThis.hljs.highlight(code.textContent, { language, ignoreIllegals: true }).value;
    }
    const heading = document.createElement("div");
    heading.className = "code-heading";
    const label = document.createElement("span");
    label.textContent = language;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Copy code";
    copy.dataset.copyCode = "";
    heading.append(label, copy);
    code.parentElement.prepend(heading);
  });
}
