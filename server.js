const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const port = Number(process.env.PORT || 8787);

const provider = (process.env.AI_PROVIDER || "openai").trim().toLowerCase();
const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
const model = process.env.AI_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini";

const providerConfig = {
  openai: {
    requestType: "responses",
    defaultUrl: "https://api.openai.com/v1/responses",
    supportsResponseFormat: false,
  },
  qwen: {
    requestType: "chat_completions",
    defaultUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    supportsResponseFormat: false,
  },
  deepseek: {
    requestType: "chat_completions",
    defaultUrl: "https://api.deepseek.com/chat/completions",
    supportsResponseFormat: true,
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

function logError(message, details = {}) {
  console.error(`[ai-error] ${message}`, {
    provider,
    model,
    ...details,
  });
}

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
        reject(new Error("Request body is too large"));
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
    throw new Error(`Unsupported AI_PROVIDER: ${provider}. Supported values: ${supported}`);
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
  return config.requestType === "responses"
    ? `${trimmed}/responses`
    : `${trimmed}/chat/completions`;
}

function buildSystemPrompt() {
  return [
    "You are a Chinese chat reply assistant.",
    "Generate natural, respectful, human-like Chinese replies for the user.",
    "Return JSON only. Do not use Markdown.",
    "The JSON shape must be exactly: {\"replies\":[\"reply 1\",\"reply 2\",\"reply 3\"]}.",
    "Each reply should be ready to send directly.",
    "Do not explain your reasoning.",
    "Do not make real-world commitments on behalf of the user.",
    "Avoid harassment, manipulation, deception, or pressure.",
    "If the persona asks for boundaries, keep the replies respectful and restrained.",
  ].join("\n");
}

function buildUserPrompt(data) {
  return [
    `Incoming message: ${data.incoming || "none"}`,
    `User persona: ${data.persona || "natural, sincere, and boundaried"}`,
    `Relationship: ${data.relationship || "not specified"}`,
    `Avoid expressions: ${data.avoid || "do not sound greasy or like customer service"}`,
    `Tone: ${data.tone || "natural"}`,
    `Intent: ${data.intent || "continue the conversation"}`,
    `Recent context: ${data.context || "none"}`,
    `Quick instruction: ${data.quick || "none"}`,
  ].join("\n");
}

function buildResponsesBody(data) {
  return {
    model,
    input: `${buildSystemPrompt()}\n\n${buildUserPrompt(data)}`,
    temperature: 0.8,
  };
}

function buildChatCompletionsBody(data, config) {
  const body = {
    model,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(data) },
    ],
    temperature: 0.8,
    stream: false,
  };

  if (config.supportsResponseFormat) {
    body.response_format = { type: "json_object" };
  }

  return body;
}

function extractResponsesText(payload) {
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

function unwrapJsonText(text) {
  const raw = String(text || "").trim();
  if (!raw) return raw;

  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();

  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1).trim();
  }

  return raw;
}

function parseReplies(text) {
  const clean = unwrapJsonText(text);
  if (!clean) {
    throw new Error("AI response was empty; cannot parse replies");
  }

  let payload;
  try {
    payload = JSON.parse(clean);
  } catch {
    throw new Error(`AI response was not valid JSON. Raw response preview: ${clean.slice(0, 300)}`);
  }

  if (!Array.isArray(payload.replies)) {
    throw new Error(`AI JSON did not include a replies array. Parsed keys: ${Object.keys(payload).join(", ")}`);
  }

  const replies = payload.replies
    .map((reply) => String(reply).trim())
    .filter(Boolean)
    .slice(0, 5);

  if (replies.length === 0) {
    throw new Error("AI replies array was empty");
  }

  return replies;
}

async function callAiModel(data) {
  if (!apiKey) {
    throw new Error("Server is missing AI_API_KEY");
  }

  const config = getProviderConfig();
  const endpoint = getEndpoint(config);
  const body = config.requestType === "responses"
    ? buildResponsesBody(data)
    : buildChatCompletionsBody(data, config);

  console.log("[ai-request]", {
    provider,
    model,
    endpoint,
    requestType: config.requestType,
    hasApiKey: Boolean(apiKey),
    incomingLength: String(data.incoming || "").length,
  });

  let aiResponse;
  try {
    aiResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    logError("Network request to AI provider failed", {
      endpoint,
      error: error.message,
    });
    throw new Error(`AI provider network request failed: ${error.message}`);
  }

  const responseText = await aiResponse.text();
  let payload = {};
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    logError("AI provider returned non-JSON HTTP response", {
      endpoint,
      status: aiResponse.status,
      bodyPreview: responseText.slice(0, 500),
    });
    throw new Error(`AI provider returned non-JSON response. HTTP ${aiResponse.status}`);
  }

  if (!aiResponse.ok) {
    logError("AI provider returned an error", {
      endpoint,
      status: aiResponse.status,
      bodyPreview: responseText.slice(0, 1000),
    });
    throw new Error(payload.error?.message || `AI provider request failed. HTTP ${aiResponse.status}`);
  }

  const modelText = config.requestType === "responses"
    ? extractResponsesText(payload)
    : extractChatCompletionsText(payload);

  try {
    return parseReplies(modelText);
  } catch (error) {
    logError("Could not parse AI response into replies", {
      endpoint,
      rawModelTextPreview: String(modelText || "").slice(0, 1000),
      error: error.message,
    });
    throw error;
  }
}

async function handleReply(request, response) {
  try {
    const body = await readBody(request);
    const data = JSON.parse(body || "{}");
    const replies = await callAiModel(data);
    sendJson(response, 200, { replies });
  } catch (error) {
    logError("/api/reply failed", {
      error: error.message,
    });
    sendJson(response, 500, {
      error: error.message || "Reply request failed",
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
    const config = getProviderConfig();
    console.log(`Echo Keyboard app running at http://127.0.0.1:${port}`);
    console.log(`AI provider: ${provider}`);
    console.log(`AI model: ${model}`);
    console.log(`AI endpoint: ${getEndpoint(config)}`);
  });
}

module.exports = {
  server,
  callAiModel,
  parseReplies,
};
