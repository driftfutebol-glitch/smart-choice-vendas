const AGENT_ALLOWED_ACTIONS = Object.freeze([
  "none",
  "diagnose",
  "security-scan",
  "refresh",
  "close-resolved-tickets",
  "restock-critical",
  "notify-maintenance"
]);

const AGENT_ALLOWED_URGENCY = Object.freeze(["low", "medium", "high"]);

const AGENT_AI_PROVIDER = String(process.env.AGENT_AI_PROVIDER || "AUTO").trim().toUpperCase();
const AGENT_AI_TIMEOUT_MS = Math.max(
  5000,
  Math.min(45000, Number(process.env.AGENT_AI_TIMEOUT_MS || process.env.OPENAI_TIMEOUT_MS || 18000))
);

const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || "").trim();
const OPENAI_MODEL = String(process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
const OPENAI_API_BASE = String(process.env.OPENAI_API_BASE || "https://api.openai.com/v1")
  .trim()
  .replace(/\/+$/, "");

const GROQ_API_KEY = String(process.env.GROQ_API_KEY || "").trim();
const GROQ_MODEL = String(process.env.GROQ_MODEL || "llama-3.3-70b-versatile").trim();
const GROQ_API_BASE = String(process.env.GROQ_API_BASE || "https://api.groq.com/openai/v1")
  .trim()
  .replace(/\/+$/, "");

function normalizeAction(value) {
  const action = String(value || "").trim().toLowerCase();
  return AGENT_ALLOWED_ACTIONS.includes(action) ? action : "none";
}

function normalizeUrgency(value) {
  const urgency = String(value || "").trim().toLowerCase();
  return AGENT_ALLOWED_URGENCY.includes(urgency) ? urgency : "medium";
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeText(value, maxLen = 400) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

function clampContext(context = {}) {
  const alerts = Array.isArray(context.alerts)
    ? context.alerts.slice(0, 8).map((item) => ({
        level: safeText(item?.level, 20),
        title: safeText(item?.title, 120),
        detail: safeText(item?.detail, 160)
      }))
    : [];

  return {
    usersTotal: safeNumber(context.usersTotal),
    adminsTotal: safeNumber(context.adminsTotal),
    activeProducts: safeNumber(context.activeProducts),
    outOfStockProducts: safeNumber(context.outOfStockProducts),
    lowStockProducts: safeNumber(context.lowStockProducts),
    pendingOrders: safeNumber(context.pendingOrders),
    openTickets: safeNumber(context.openTickets),
    delayedPendingOrders: safeNumber(context.delayedPendingOrders),
    sensitiveLogs24h: safeNumber(context.sensitiveLogs24h),
    creditAdjustLogs24h: safeNumber(context.creditAdjustLogs24h),
    alerts
  };
}

function buildLocalFallback(command, context) {
  const cmd = safeText(command, 500).toLowerCase();

  if (cmd.includes("segur")) {
    return {
      source: "local",
      reply: [
        "Modo local ativo: analise de seguranca concluida.",
        `- Eventos sensiveis (24h): ${context.sensitiveLogs24h}`,
        `- Ajustes de credito (24h): ${context.creditAdjustLogs24h}`,
        context.sensitiveLogs24h > 10
          ? "- Acao recomendada: revisar auditoria imediatamente."
          : "- Acao recomendada: manter monitoramento preventivo."
      ].join("\n"),
      suggestedAction: "security-scan",
      urgency: context.sensitiveLogs24h > 10 ? "high" : "medium"
    };
  }

  if (cmd.includes("estoque")) {
    return {
      source: "local",
      reply: [
        "Modo local ativo: diagnostico de estoque.",
        `- Produtos sem estoque: ${context.outOfStockProducts}`,
        `- Produtos com estoque baixo: ${context.lowStockProducts}`,
        context.outOfStockProducts > 0
          ? "- Sugestao: executar ajuste de estoque critico."
          : "- Estoque critico sob controle."
      ].join("\n"),
      suggestedAction: context.outOfStockProducts > 0 ? "restock-critical" : "diagnose",
      urgency: context.outOfStockProducts > 0 ? "high" : "low"
    };
  }

  if (cmd.includes("ticket") || cmd.includes("suporte")) {
    return {
      source: "local",
      reply: [
        "Modo local ativo: leitura de suporte.",
        `- Tickets abertos: ${context.openTickets}`,
        context.openTickets > 0
          ? "- Sugestao: fechar tickets resolvidos e responder os pendentes."
          : "- Sem fila critica de suporte neste momento."
      ].join("\n"),
      suggestedAction: context.openTickets > 0 ? "close-resolved-tickets" : "diagnose",
      urgency: context.openTickets >= 10 ? "high" : "medium"
    };
  }

  return {
    source: "local",
    reply: [
      "Modo local ativo: resumo operacional.",
      `- Usuarios: ${context.usersTotal} (admins: ${context.adminsTotal})`,
      `- Produtos ativos: ${context.activeProducts}`,
      `- Pedidos pendentes: ${context.pendingOrders}`,
      `- Tickets abertos: ${context.openTickets}`,
      "Sugestao: peca analise de seguranca, estoque ou suporte."
    ].join("\n"),
    suggestedAction: "diagnose",
    urgency: "low"
  };
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
  const wantsGroq = AGENT_AI_PROVIDER === "GROQ";
  const wantsOpenAi = AGENT_AI_PROVIDER === "OPENAI";

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

async function askModel(command, context) {
  const config = resolveProviderConfig();
  if (!config.apiKey) {
    return {
      ok: false,
      reason: config.missingReason
    };
  }

  const systemPrompt = [
    "Voce e o Agente Administrativo da Smart Choice Vendas.",
    "Responda em portugues-BR, objetivo e pratico.",
    "Nunca invente dados fora do contexto fornecido.",
    "Retorne apenas JSON com as chaves:",
    'reply (string), suggestedAction (one of: "none","diagnose","security-scan","refresh","close-resolved-tickets","restock-critical","notify-maintenance"), urgency ("low"|"medium"|"high").',
    "No campo reply, de diagnostico e proximo passo."
  ].join(" ");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AGENT_AI_TIMEOUT_MS);

  try {
    const payload = {
      model: config.model,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: JSON.stringify({
            command,
            context
          })
        }
      ]
    };

    if (config.supportsMaxCompletionTokens) {
      payload.max_completion_tokens = 900;
      payload.top_p = 1;
      payload.stream = false;
    } else {
      payload.max_tokens = 900;
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
      const errText = await response.text().catch(() => "");
      return {
        ok: false,
        reason: `${config.provider.toUpperCase()}_HTTP_ERROR`,
        detail: safeText(errText, 240)
      };
    }

    const json = await response.json().catch(() => ({}));
    const content = json?.choices?.[0]?.message?.content || "";
    const parsed = extractJsonFromText(content);
    if (!parsed || typeof parsed !== "object") {
      return {
        ok: false,
        reason: `${config.provider.toUpperCase()}_PARSE_ERROR`
      };
    }

    return {
      ok: true,
      data: {
        source: config.provider,
        reply: safeText(parsed.reply || "Analise concluida sem detalhes adicionais.", 2000),
        suggestedAction: normalizeAction(parsed.suggestedAction),
        urgency: normalizeUrgency(parsed.urgency)
      }
    };
  } catch (error) {
    return {
      ok: false,
      reason: `${config.provider.toUpperCase()}_REQUEST_FAILED`,
      detail: safeText(error?.message || "Falha na requisicao", 200)
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runAdminAgent({ command, context }) {
  const safeCommand = safeText(command, 800);
  const safeContext = clampContext(context);

  const modelResult = await askModel(safeCommand, safeContext);
  if (modelResult.ok) {
    return {
      ...modelResult.data,
      fallbackUsed: false
    };
  }

  const local = buildLocalFallback(safeCommand, safeContext);
  return {
    ...local,
    fallbackUsed: true,
    fallbackReason: modelResult.reason || "LOCAL_ONLY"
  };
}

module.exports = {
  runAdminAgent,
  AGENT_ALLOWED_ACTIONS
};
