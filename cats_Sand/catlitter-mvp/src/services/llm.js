import { config } from "../config.js";

function toEtInput(messages) {
  return messages
    .map((m) => {
      const role = m.role || "user";
      return `[${role}]\n${m.content ?? ""}`;
    })
    .join("\n\n");
}

function getEtSystemPrompt(messages) {
  const system = messages.find((m) => m.role === "system");
  return system?.content || "You are a helpful assistant.";
}

function parseEtChatContent(data) {
  if (Array.isArray(data?.output)) {
    const textParts = data.output
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item?.content === "string") return item.content;
        return "";
      })
      .filter(Boolean);
    if (textParts.length) return textParts.join("\n");
  }

  const candidates = [
    data?.output,
    data?.response,
    data?.text,
    data?.answer,
    data?.message?.content,
    data?.choices?.[0]?.message?.content,
  ];

  for (const item of candidates) {
    if (typeof item === "string" && item.trim()) return item;
  }
  return "";
}

export async function chatCompletions({ messages, temperature = 0.1 }) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), config.llm.timeoutMs);

  try {
    const baseUrl = config.llm.baseUrl.replace(/\/$/, "");
    const isEt = String(config.llm.apiStyle || "et").toLowerCase() === "et";
    const url = isEt ? `${baseUrl}/api/v1/chat` : `${baseUrl}/v1/chat/completions`;

    const body = isEt
      ? {
          model: config.llm.model,
          system_prompt: getEtSystemPrompt(messages),
          input: toEtInput(messages.filter((m) => m.role !== "system")),
          temperature,
        }
      : {
          model: config.llm.model,
          messages,
          temperature,
        };

    const resp = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(config.llm.apiKey ? { Authorization: `Bearer ${config.llm.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`LLM HTTP ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    if (isEt) return parseEtChatContent(data);
    return data?.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(t);
  }
}
