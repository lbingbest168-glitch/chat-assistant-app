const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const port = Number(process.env.PORT || 8787);

const defaultProvider = "openai";
const provider = (process.env.AI_PROVIDER || defaultProvider).trim().toLowerCase();
const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
const model = process.env.AI_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini";

const providerConfig = {
  openai: {
    type: "responses",
    defaultUrl: "https://api.openai.com/v1/responses",
  },
  qwen: {
    type: "chat_completions",
    defaultUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
  },
  deepseek: {
    type: "chat_completions",
    defaultUrl: "https://api.deepseek.com/chat/completions",
  },
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 50_000) {
        reject(new Error("请求内容太长"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function getProviderConfig() {
  const config = providerConfig[provider];
  if (!config) {
    const supported = Object.keys(providerConfig).join(", ");
    throw new Error(`不支持的 AI_PROVIDER：${provider}。可用值：${supported}`);
  }
  return config;
}

function getEndpoint(config) {
  const customUrl = (process.env.AI_BASE_URL || "").trim();
  if (!customUrl) return config.defaultUrl;

  if (customUrl.endsWith("/responses") || customUrl.endsWith("/chat/completions")) {
    return customUrl;
  }

  const trimmed = customUrl.replace(/\/+$/, "");
  return config.type === "responses"
    ? `${trimmed}/responses`
    : `${trimmed}/chat/completions`;
}

function buildSystemPrompt() {
  return [
    "你是一个中文聊天回复助手。",
    "目标是帮用户生成自然、有分寸、像真人写的回复。",
    "必须遵守：",
    "1. 只输出 JSON，不要 Markdown。",
    "2. JSON 格式必须是 {\"replies\":[\"回复1\",\"回复2\",\"回复3\"]}。",
    "3. 每条回复适合直接发给对方，不要解释写作思路。",
    "4. 不要替用户承诺现实行动，不要诱导骚扰、操控或欺骗。",
    "5. 如果用户人设里有边界感，就保持尊重和克制。",
  ].join("\n");
}

function buildUserPrompt(data) {
  return [
    `对方消息：${data.incoming || "无"}`,
    `用户人设：${data.persona || "自然、真诚、有边界"}`,
    `聊天关系：${data.relationship || "未说明"}`,
    `禁用表达：${data.avoid || "不要油腻，不要像客服"}`,
    `语气：${data.tone || "自然"}`,
    `目的：${data.intent || "继续聊天"}`,
    `最近聊天摘要：${data.context || "无"}`,
    `快捷要求：${data.quick || "无"}`,
  ].join("\n");
}

function buildOpenAiBody(data) {
  return {
    model,
    input: `${buildSystemPrompt()}\n\n${buildUserPrompt(data)}`,
    temperature: 0.8,
  };
}

function buildChatCompletionsBody(data) {
  return {
    model,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(data) },
    ],
    response_format: { type: "json_object" },
    temperature: 0.8,
    stream: false,
  };
}

function extractOpenAiText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;

  const chunks = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n");
}

function extractChatCompletionsText(payload) {
  return payload?.choices?.[0]?.message?.content || "";
}

function parseReplies(text) {
  const clean = String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  if (!clean) {
    throw new Error("AI 返回内容为空，无法解析候选回复");
  }

  let payload;
  try {
    payload = JSON.parse(clean);
  } catch {
    throw new Error(`AI 返回内容不是有效 JSON：${clean.slice(0, 160)}`);
  }

  if (!Array.isArray(payload.replies)) {
    throw new Error("AI 返回 JSON 中缺少 replies 数组");
  }

  const replies = payload.replies
    .map((reply) => String(reply).trim())
    .filter(Boolean)
    .slice(0, 5);

  if (replies.length === 0) {
    throw new Error("AI 返回的 replies 数组为空");
  }

  return replies;
}

async function callAiModel(data) {
  if (!apiKey) {
    throw new Error("后端没有配置 AI_API_KEY");
  }

  const config = getProviderConfig();
  const endpoint = getEndpoint(config);
  const body = config.type === "responses"
    ? buildOpenAiBody(data)
    : buildChatCompletionsBody(data);

  const aiResponse = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await aiResponse.json().catch(() => ({}));
  if (!aiResponse.ok) {
    throw new Error(payload.error?.message || `${provider} 请求失败：HTTP ${aiResponse.status}`);
  }

  const text = config.type === "responses"
    ? extractOpenAiText(payload)
    : extractChatCompletionsText(payload);

  return parseReplies(text);
}

async function handleReply(request, response) {
  try {
    const body = await readBody(request);
    const data = JSON.parse(body || "{}");
    const replies = await callAiModel(data);
    sendJson(response, 200, { replies });
  } catch (error) {
    sendJson(response, 500, {
      error: error.message || "请求处理失败",
    });
  }
}

function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(root, safePath));

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    const type = mimeTypes[path.extname(filePath)] || "application/octet-stream";
    response.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": type.startsWith("text/html") ? "no-cache" : "public, max-age=3600",
    });
    response.end(data);
  });
}

const server = http.createServer((request, response) => {
  if (request.method === "POST" && request.url === "/api/reply") {
    handleReply(request, response);
    return;
  }

  if (request.method === "GET" || request.method === "HEAD") {
    serveStatic(request, response);
    return;
  }

  response.writeHead(405);
  response.end("Method not allowed");
});

if (require.main === module) {
  server.listen(port, () => {
    console.log(`Echo Keyboard app running at http://127.0.0.1:${port}`);
    console.log(`AI provider: ${provider}`);
    console.log(`AI model: ${model}`);
  });
}

module.exports = {
  server,
  callAiModel,
  parseReplies,
};
