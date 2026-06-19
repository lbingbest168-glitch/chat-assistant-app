const state = {
  chosenReply: "",
  lastQuick: "",
};

const storageKey = "echo-keyboard-settings";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const incomingText = $("#incomingText");
const personaText = $("#personaText");
const relationshipInput = $("#relationshipInput");
const avoidInput = $("#avoidInput");
const toneSelect = $("#toneSelect");
const intentSelect = $("#intentSelect");
const contextText = $("#contextText");
const suggestionList = $("#suggestionList");
const confirmPanel = $("#confirmPanel");
const chosenReply = $("#chosenReply");
const toast = $("#toast");

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
    if (saved.persona) personaText.value = saved.persona;
    if (saved.relationship) relationshipInput.value = saved.relationship;
    if (saved.avoid) avoidInput.value = saved.avoid;
    if (saved.tone) toneSelect.value = saved.tone;
    if (saved.intent) intentSelect.value = saved.intent;
    if (saved.context) contextText.value = saved.context;
    if (saved.endpoint) $("#apiEndpoint").value = saved.endpoint;
    if (saved.safetyWord) $("#safetyWord").value = saved.safetyWord;
    if (saved.lightMode) document.body.classList.add("light");
  } catch {
    localStorage.removeItem(storageKey);
  }
}

function saveSettings(silent = false) {
  const payload = {
    persona: personaText.value.trim(),
    relationship: relationshipInput.value.trim(),
    avoid: avoidInput.value.trim(),
    tone: toneSelect.value,
    intent: intentSelect.value,
    context: contextText.value.trim(),
    endpoint: $("#apiEndpoint").value.trim(),
    safetyWord: $("#safetyWord").value.trim(),
    lightMode: document.body.classList.contains("light"),
  };
  localStorage.setItem(storageKey, JSON.stringify(payload));
  if (!silent) showToast("设置已保存");
}

const templates = {
  "继续聊天": [
    "{soft}可以呀，听起来不错。你想吃什么类型的？",
    "{soft}我有点心动，不过想先看看时间。你那边大概几点方便？",
    "{soft}哈哈可以聊聊，最近确实也想找个地方好好吃一顿。"
  ],
  "礼貌拒绝": [
    "{soft}谢谢你约我，不过今晚我这边不太方便。改天有合适时间再说。",
    "{soft}今晚可能不行，我已经有安排了。谢谢你想到我。",
    "{soft}我先不答应啦，最近节奏有点满，不想临时让你等。"
  ],
  "推进邀约": [
    "{soft}可以，那我们定个轻松点的地方？我比较想吃不用太赶的。",
    "{soft}好呀。你发两个你想去的地方，我来选一个。",
    "{soft}可以见面聊聊。时间别太晚的话我会更舒服。"
  ],
  "缓和尴尬": [
    "{soft}没事，我懂你的意思。我们不用把话说得太重，慢慢聊就好。",
    "{soft}哈哈刚才那句我可能理解偏了，不尴尬，我们换个轻松点的话题。",
    "{soft}别有压力，我没有往坏处想，只是想确认一下你的意思。"
  ],
  "表达边界": [
    "{soft}我愿意聊，但节奏想慢一点。太突然的安排我会有点压力。",
    "{soft}我希望我们可以自然一点，不用太快推进。",
    "{soft}我可以认真回复你，但也想保留一点自己的空间。"
  ],
};

const toneMap = {
  "自然": ["嗯，", "我觉得", "可以呀，"],
  "温柔": ["听起来挺好的，", "谢谢你这么说，", "我会认真想一下，"],
  "幽默": ["哈哈，", "这邀请有点突然但不坏，", "你这个提议还挺会挑时间，"],
  "克制": ["可以考虑，", "我先确认一下，", "这件事我想慢一点，"],
  "暧昧": ["那我会有点期待，", "你这样说我会多想一点，", "如果是和你，也不是不可以，"],
};

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 1500);
}

function scoreReply(reply, index) {
  const lengthScore = reply.length < 32 ? "短句" : reply.length < 58 ? "自然" : "完整";
  const confidence = 92 - index * 5;
  return `${lengthScore} · 匹配 ${confidence}%`;
}

function buildPromptSummary() {
  return {
    incoming: incomingText.value.trim(),
    persona: personaText.value.trim(),
    relationship: relationshipInput.value.trim(),
    avoid: avoidInput.value.trim(),
    tone: toneSelect.value,
    intent: intentSelect.value,
    context: contextText.value.trim(),
    quick: state.lastQuick,
  };
}

function getApiEndpoint() {
  return $("#apiEndpoint").value.trim();
}

async function fetchAiReplies(data) {
  const endpoint = getApiEndpoint();
  if (!endpoint) return null;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "AI 服务暂时不可用");
  }

  if (!Array.isArray(payload.replies) || payload.replies.length === 0) {
    throw new Error("AI 没有返回可用回复");
  }

  return payload.replies.map((reply) => String(reply).trim()).filter(Boolean);
}

function createReplies() {
  const data = buildPromptSummary();
  const base = templates[data.intent] || templates["继续聊天"];
  const softWords = toneMap[data.tone] || toneMap["自然"];
  const incoming = data.incoming || "对方刚刚发来一条消息";
  const contextHint = data.context ? "我记得你前面说的事，" : "";
  const quickHint = data.quick.includes("短") ? "我简单说，" : "";

  return base.map((template, index) => {
    let reply = template.replace("{soft}", softWords[index % softWords.length]);

    if (data.quick.includes("委婉")) {
      reply = reply.replace("可以", "可以考虑").replace("不行", "可能不太方便");
    }

    if (data.quick.includes("暧昧") && !reply.includes("期待")) {
      reply += " 但我承认，和你聊这件事还挺有意思。";
    }

    if (data.quick.includes("尴尬")) {
      reply = `没关系，我们轻松一点说。${reply}`;
    }

    if (data.intent === "继续聊天" && incoming.includes("吗")) {
      reply = reply.replace("？", "？你是临时想到，还是已经计划好了？");
    }

    if (index === 2 && data.relationship) {
      reply = `${contextHint}${quickHint}${reply}`;
    }

    return reply;
  });
}

function renderSuggestions(replies) {
  suggestionList.innerHTML = "";
  $("#resultCount").textContent = `${replies.length} 条`;

  replies.forEach((reply, index) => {
    const card = document.createElement("article");
    card.className = "reply-card";
    card.innerHTML = `
      <p>${escapeHtml(reply)}</p>
      <footer>
        <span class="score">${scoreReply(reply, index)}</span>
        <button class="use-btn" type="button">选择</button>
      </footer>
    `;
    card.querySelector("button").addEventListener("click", () => chooseReply(reply));
    suggestionList.appendChild(card);
  });
}

function chooseReply(reply) {
  state.chosenReply = reply;
  chosenReply.textContent = reply;
  confirmPanel.classList.add("show");
  confirmPanel.setAttribute("aria-hidden", "false");
}

async function generateReplies() {
  $("#previewIncoming").textContent = incomingText.value.trim() || "等待粘贴对方消息。";
  $("#personaPreview").textContent = personaText.value.trim() || "还没有设置人设。";
  const data = buildPromptSummary();

  if (getApiEndpoint()) {
    renderSuggestions(["正在让 AI 生成更自然的回复，请稍等..."]);
    try {
      const aiReplies = await fetchAiReplies(data);
      renderSuggestions(aiReplies);
      showToast("已用 AI 生成候选回复");
      return;
    } catch (error) {
      renderSuggestions(createReplies());
      showToast(`${error.message}，已使用本地备用回复`);
      return;
    }
  }

  renderSuggestions(createReplies());
  showToast("已生成本地候选回复");
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function switchView(viewName) {
  $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === viewName));
  $$(".view").forEach((view) => view.classList.remove("active"));
  $(`#${viewName}View`).classList.add("active");
}

async function copyReply() {
  if (!state.chosenReply) {
    showToast("先选择一条回复");
    return;
  }

  try {
    await navigator.clipboard.writeText(state.chosenReply);
    showToast("已复制，可粘贴到聊天框");
  } catch {
    showToast("复制失败，请长按文本复制");
  }
}

function confirmReply() {
  if (!state.chosenReply) {
    showToast("先选择一条回复");
    return;
  }
  showToast("已确认，仍由你手动发送");
}

function setupEvents() {
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
  });

  $$(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      personaText.value = chip.dataset.persona;
      $("#personaPreview").textContent = chip.dataset.persona;
      showToast("已切换人设");
    });
  });

  $$(".keyboard-bar button").forEach((button) => {
    button.addEventListener("click", () => {
      state.lastQuick = button.dataset.quick;
      generateReplies();
    });
  });

  $("#generateBtn").addEventListener("click", () => {
    state.lastQuick = "";
    generateReplies();
  });

  $("#clearBtn").addEventListener("click", () => {
    incomingText.value = "";
    state.chosenReply = "";
    confirmPanel.classList.remove("show");
    showToast("已清空");
  });

  $("#autoBtn").addEventListener("click", () => {
    state.lastQuick = "根据上下文自主推进";
    if (!incomingText.value.trim() && contextText.value.trim()) {
      incomingText.value = "结合最近聊天，帮我自然接下一句。";
    }
    generateReplies();
    switchView("reply");
  });

  $("#copyBtn").addEventListener("click", copyReply);
  $("#confirmBtn").addEventListener("click", confirmReply);

  $("#themeToggle").addEventListener("click", () => {
    document.body.classList.toggle("light");
    saveSettings(true);
  });

  $("#saveSettingsBtn").addEventListener("click", () => saveSettings());

  personaText.addEventListener("input", () => {
    $("#personaPreview").textContent = personaText.value.trim() || "还没有设置人设。";
    saveSettings(true);
  });

  incomingText.addEventListener("input", () => {
    $("#previewIncoming").textContent = incomingText.value.trim() || "等待粘贴对方消息。";
  });

  [relationshipInput, avoidInput, toneSelect, intentSelect, contextText, $("#apiEndpoint"), $("#safetyWord")].forEach((control) => {
    control.addEventListener("input", () => saveSettings(true));
    control.addEventListener("change", () => saveSettings(true));
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol === "file:") return;

  navigator.serviceWorker.register("./service-worker.js").catch(() => {
    showToast("离线缓存暂不可用");
  });
}

loadSettings();
setupEvents();
registerServiceWorker();
$("#previewIncoming").textContent = incomingText.value.trim() || "等待粘贴对方消息。";
$("#personaPreview").textContent = personaText.value.trim() || "还没有设置人设。";
renderSuggestions(createReplies());
