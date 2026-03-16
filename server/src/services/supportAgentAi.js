const { triageFaq } = require("./triage");

const SUPPORT_AGENT_PROVIDER = String(process.env.SUPPORT_AGENT_PROVIDER || "AUTO").trim().toUpperCase();
const SUPPORT_AGENT_TIMEOUT_MS = Math.max(
  5000,
  Math.min(45000, Number(process.env.SUPPORT_AGENT_TIMEOUT_MS || process.env.OPENAI_TIMEOUT_MS || 16000))
);
const SUPPORT_AGENT_MAX_REPLY_CHARS = Math.max(250, Math.min(3000, Number(process.env.SUPPORT_AGENT_MAX_REPLY_CHARS || 900)));
const SUPPORT_AGENT_SIGNATURE = String(process.env.SUPPORT_AGENT_SIGNATURE || "Agente IA Smart Choice").trim();
const SUPPORT_AGENT_RULES = String(
  process.env.SUPPORT_AGENT_RULES ||
    "Atender com empatia, ser objetivo, nao prometer acao fora da politica, pedir dados faltantes quando necessario e manter linguagem profissional."
).trim();

const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || "").trim();
const OPENAI_MODEL = String(process.env.SUPPORT_AGENT_OPENAI_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
const OPENAI_API_BASE = String(process.env.OPENAI_API_BASE || "https://api.openai.com/v1")
  .trim()
  .replace(/\/+$/, "");

const GROQ_API_KEY = String(process.env.GROQ_API_KEY || "").trim();
const GROQ_MODEL = String(process.env.SUPPORT_AGENT_GROQ_MODEL || process.env.GROQ_MODEL || "llama-3.3-70b-versatile").trim();
const GROQ_API_BASE = String(process.env.GROQ_API_BASE || "https://api.groq.com/openai/v1")
  .trim()
  .replace(/\/+$/, "");

function safeText(value, maxLen = 500) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

function extractJsonFromText(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (_error) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (_innerError) {
      return null;
    }
  }
}

function resolveProviderConfig() {
  const wantsGroq = SUPPORT_AGENT_PROVIDER === "GROQ";
  const wantsOpenAi = SUPPORT_AGENT_PROVIDER === "OPENAI";

  if (wantsGroq) {
    return {
      provider: "groq",
      apiKey: GROQ_API_KEY,
      model: GROQ_MODEL,
      chatUrl: `${GROQ_API_BASE}/chat/completions`,
      supportsMaxCompletionTokens: true,
      missingReason: "GROQ_KEY_MISSING"
    };
  }

  if (wantsOpenAi) {
    return {
      provider: "openai",
      apiKey: OPENAI_API_KEY,
      model: OPENAI_MODEL,
      chatUrl: `${OPENAI_API_BASE}/chat/completions`,
      supportsMaxCompletionTokens: false,
      missingReason: "OPENAI_KEY_MISSING"
    };
  }

  if (GROQ_API_KEY) {
    return {
      provider: "groq",
      apiKey: GROQ_API_KEY,
      model: GROQ_MODEL,
      chatUrl: `${GROQ_API_BASE}/chat/completions`,
      supportsMaxCompletionTokens: true,
      missingReason: "GROQ_KEY_MISSING"
    };
  }

  return {
    provider: "openai",
    apiKey: OPENAI_API_KEY,
    model: OPENAI_MODEL,
    chatUrl: `${OPENAI_API_BASE}/chat/completions`,
    supportsMaxCompletionTokens: false,
    missingReason: "OPENAI_KEY_MISSING"
  };
}

function buildFaqHints(faqRows = []) {
  return (Array.isArray(faqRows) ? faqRows : [])
    .slice(0, 14)
    .map((row) => ({
      question: safeText(row?.question, 120),
      answer: safeText(row?.answer, 180),
      keywords: safeText(row?.keywords, 100)
    }));
}

function addAgentIntro(baseReply, delayMinutes) {
  const intro = `Olá! Sou a ${SUPPORT_AGENT_SIGNATURE}. Como nosso atendimento humano ainda não respondeu em até ${delayMinutes} minuto(s), assumi seu chat para te ajudar agora.`;
  const merged = `${intro}\n\n${String(baseReply || "").trim()}`.trim();
  return merged.slice(0, SUPPORT_AGENT_MAX_REPLY_CHARS);
}

function buildFallbackReply({ ticket, customerMessage }) {
  const subject = safeText(ticket?.subject, 120);
  const name = safeText(ticket?.name, 80) || "cliente";
  const orderNumber = safeText(ticket?.order_number, 80);
  const messageHint = safeText(customerMessage, 180);

  const lines = [
    `Oi ${name}, eu já estou cuidando do seu atendimento no assunto "${subject || "suporte"}".`,
    "Recebi sua mensagem e vou te orientar com prioridade."
  ];

  if (!orderNumber) {
    lines.push("Se tiver número do pedido, me envie para agilizar a validação.");
  }

  if (messageHint) {
    lines.push(`Entendi seu ponto: "${messageHint}".`);
  }

  lines.push("Se precisar de confirmação final da equipe humana, eu aciono o time sem você perder seu histórico.");
  return lines.join("\n");
}

async function askSupportModel({ ticket, customerMessage, faqRows }) {
  const config = resolveProviderConfig();
  if (!config.apiKey) {
    return { ok: false, reason: config.missingReason };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUPPORT_AGENT_TIMEOUT_MS);

  const systemPrompt = [
    "Voce e a agente oficial de suporte da Smart Choice Vendas.",
    "Responda em portugues-BR, com empatia e objetividade.",
    "Sua resposta sera enviada diretamente ao cliente no chat.",
    "Siga as regras do dono:",
    SUPPORT_AGENT_RULES,
    "Nao invente politicas ou promessas fora do contexto.",
    "Se faltar dado, peca no maximo 1 informacao por vez (ex: numero do pedido).",
    "Formato de saida: retorne apenas JSON com reply (string) e confidence ('low'|'medium'|'high')."
  ].join(" ");

  try {
    const payload = {
      model: config.model,
      temperature: 0.25,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: JSON.stringify({
            ticket: {
              id: Number(ticket?.id || 0),
              subject: safeText(ticket?.subject, 140),
              orderNumber: safeText(ticket?.order_number, 120),
              customerName: safeText(ticket?.name, 80)
            },
            lastCustomerMessage: safeText(customerMessage, 900),
            faqHints: buildFaqHints(faqRows)
          })
        }
      ]
    };

    if (config.supportsMaxCompletionTokens) {
      payload.max_completion_tokens = 650;
      payload.top_p = 1;
      payload.stream = false;
    } else {
      payload.max_tokens = 650;
    }

    const response = await fetch(config.chatUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      signal: controller.signal,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const detail = safeText(await response.text().catch(() => ""), 240);
      return {
        ok: false,
        reason: `${config.provider.toUpperCase()}_HTTP_ERROR`,
        detail
      };
    }

    const json = await response.json().catch(() => ({}));
    const content = json?.choices?.[0]?.message?.content || "";
    const parsed = extractJsonFromText(content);
    const reply = safeText(parsed?.reply, SUPPORT_AGENT_MAX_REPLY_CHARS);
    if (!reply) {
      return {
        ok: false,
        reason: `${config.provider.toUpperCase()}_PARSE_ERROR`
      };
    }

    return {
      ok: true,
      data: {
        source: config.provider,
        reply
      }
    };
  } catch (error) {
    return {
      ok: false,
      reason: `${config.provider.toUpperCase()}_REQUEST_FAILED`,
      detail: safeText(error?.message || "Falha de requisicao", 200)
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function generateSupportAgentReply({ ticket, customerMessage, faqRows = [], delayMinutes = 5 }) {
  const messageText = safeText(customerMessage, 900);

  const faqAttempt = triageFaq(`${safeText(ticket?.subject, 160)} ${messageText}`, faqRows);
  if (faqAttempt?.resolved && faqAttempt?.answer) {
    return {
      source: "faq",
      reply: addAgentIntro(faqAttempt.answer, delayMinutes)
    };
  }

  const modelResult = await askSupportModel({ ticket, customerMessage: messageText, faqRows });
  if (modelResult.ok) {
    return {
      source: modelResult.data.source,
      reply: addAgentIntro(modelResult.data.reply, delayMinutes)
    };
  }

  return {
    source: "fallback",
    reply: addAgentIntro(buildFallbackReply({ ticket, customerMessage: messageText }), delayMinutes),
    fallbackReason: modelResult.reason || "MODEL_UNAVAILABLE"
  };
}

module.exports = {
  generateSupportAgentReply
};

