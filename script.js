const CLOUD_API_BASE = "https://smart-choice-vendas.onrender.com/api";
const API_REQUEST_TIMEOUT_MS = 12000;
const DEFAULT_TEMP_CAMPAIGN = Object.freeze({
  name: "Especial Dia da Mulher",
  discount_percent: 10,
  campaign_markup_percent: 12,
  start_at: "2026-03-08T00:00:00-03:00",
  end_at: "2026-03-10T00:00:00-03:00"
});

function isLocalLikeHostName(hostname) {
  if (!hostname) return true;
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return true;
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return false;
  const parts = hostname.split(".").map((n) => Number(n));
  if (parts[0] === 10) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  return false;
}

function normalizeApiBase(rawValue) {
  return String(rawValue || "").trim().replace(/\/+$/, "");
}

function resolveApiBase() {
  const hostname = window.location.hostname || "localhost";
  const isLocalLikeHost = isLocalLikeHostName(hostname);
  const params = new URLSearchParams(window.location.search);
  const apiFromQuery = normalizeApiBase(params.get("api"));
  if (apiFromQuery) {
    localStorage.setItem("scv_api_base", apiFromQuery);
    return apiFromQuery;
  }

  const stored = normalizeApiBase(localStorage.getItem("scv_api_base"));
  if (stored) {
    try {
      const storedUrl = new URL(stored);
      const storedIsLocal = isLocalLikeHostName(storedUrl.hostname);
      const storedIsHttps = storedUrl.protocol === "https:";

      // Em produção (site público), ignora API local/insegura gravada no celular.
      if (!isLocalLikeHost && (storedIsLocal || !storedIsHttps)) {
        localStorage.removeItem("scv_api_base");
      } else if (!storedIsLocal || isLocalLikeHost) {
        return stored;
      }
    } catch (_error) {
      localStorage.removeItem("scv_api_base");
    }
  }

  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  if (isLocalLikeHost) {
    return `${protocol}//${hostname}:4000/api`;
  }

  return CLOUD_API_BASE;
}

let apiBase = resolveApiBase();

let authToken = localStorage.getItem("scv_token") || "";
let currentUser = null;
let selectedBrand = "";
let productsCache = [];
let selectedReviewProductId = "";
let campaignState = normalizeCampaign(DEFAULT_TEMP_CAMPAIGN);
let campaignTicker = null;
let supportTicketId = Number(localStorage.getItem("scv_ticket_id") || 0);
let supportChatTimer = null;
const SUPPORT_FINAL_STATUSES = ["ANSWERED", "CLOSED", "RESOLVED"];

const yearEl = document.getElementById("year");
if (yearEl) {
  yearEl.textContent = String(new Date().getFullYear());
}

function roundCash(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function normalizeCampaign(rawCampaign = {}) {
  const merged = {
    ...DEFAULT_TEMP_CAMPAIGN,
    ...(rawCampaign || {})
  };

  const startAt = String(merged.start_at || DEFAULT_TEMP_CAMPAIGN.start_at);
  const endAt = String(merged.end_at || DEFAULT_TEMP_CAMPAIGN.end_at);
  const startMs = new Date(startAt).getTime();
  const endMs = new Date(endAt).getTime();
  const nowMs = Date.now();

  let active = false;
  if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs > startMs) {
    active = nowMs >= startMs && nowMs < endMs;
  } else {
    active = Boolean(merged.active);
  }

  return {
    name: String(merged.name || DEFAULT_TEMP_CAMPAIGN.name),
    discount_percent: Math.max(0, Math.min(80, Number(merged.discount_percent || DEFAULT_TEMP_CAMPAIGN.discount_percent))),
    campaign_markup_percent: Math.max(0, Math.min(80, Number(merged.campaign_markup_percent || DEFAULT_TEMP_CAMPAIGN.campaign_markup_percent))),
    start_at: startAt,
    end_at: endAt,
    active
  };
}

function formatCampaignDate(dateLike) {
  const value = new Date(dateLike);
  if (Number.isNaN(value.getTime())) return String(dateLike || "-");
  return value.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function getCampaignCountdownText() {
  const endMs = new Date(campaignState.end_at).getTime();
  if (Number.isNaN(endMs)) return "";

  const diff = endMs - Date.now();
  if (diff <= 0) return "Campanha encerrada";

  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `Termina em ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}

function renderCampaignUI() {
  const links = document.querySelectorAll("[data-campaign-link]");
  links.forEach((link) => {
    link.classList.toggle("hidden", !campaignState.active);
  });

  const spotlight = document.getElementById("campaignSpotlight");
  if (!spotlight) return;

  if (!campaignState.active) {
    spotlight.classList.add("hidden");
    return;
  }

  spotlight.classList.remove("hidden");
  const title = document.getElementById("campaignTitle");
  const discountTag = document.getElementById("campaignDiscountTag");
  const periodTag = document.getElementById("campaignPeriodTag");
  const countdownTag = document.getElementById("campaignCountdown");
  const message = document.getElementById("campaignMessage");

  if (title) title.textContent = campaignState.name;
  if (discountTag) discountTag.textContent = `${campaignState.discount_percent}% OFF geral`;
  if (periodTag) periodTag.textContent = `${formatCampaignDate(campaignState.start_at)} até ${formatCampaignDate(campaignState.end_at)}`;
  if (countdownTag) countdownTag.textContent = getCampaignCountdownText();
  if (message) {
    message.textContent = `Por 48 horas, tabela especial com preço-base atualizado e ${campaignState.discount_percent}% OFF em todos os produtos.`;
  }
}

function startCampaignTicker() {
  if (campaignTicker) {
    clearInterval(campaignTicker);
    campaignTicker = null;
  }

  renderCampaignUI();
  if (!campaignState.active) {
    return;
  }

  campaignTicker = window.setInterval(() => {
    campaignState = normalizeCampaign(campaignState);
    renderCampaignUI();
    if (!campaignState.active && campaignTicker) {
      clearInterval(campaignTicker);
      campaignTicker = null;
      if (productsCache.length) {
        renderProducts(productsCache);
      }
    }
  }, 1000);
}

function setFeedback(targetId, message, type = "") {
  const el = document.getElementById(targetId);
  if (!el) return;
  el.textContent = message || "";
  el.classList.remove("error", "success");
  if (type) {
    el.classList.add(type);
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function appendDeliveryHint(message, delivery) {
  if (!delivery || delivery.sent) {
    return message;
  }

  if (delivery.hint) {
    return `${message} ${delivery.hint}`;
  }

  return message;
}

function isRouteNotFoundError(error) {
  return String(error?.message || "").toLowerCase().includes("rota nao encontrada");
}

function normalizeTicketStatus(status) {
  return String(status || "").trim().toUpperCase();
}

function isSupportTicketClosed(status) {
  return SUPPORT_FINAL_STATUSES.includes(normalizeTicketStatus(status));
}

function isStrongPassword(password) {
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/.test(String(password || ""));
}

function buildAutoPhoneTag(seed = "") {
  const safeSeed = String(seed).replace(/[^a-z0-9]/gi, "").toLowerCase().slice(-6) || "user";
  const timePart = Date.now().toString(36);
  const randPart = Math.random().toString(36).slice(2, 8);
  return `AUTO-${timePart}-${randPart}-${safeSeed}`;
}

function shouldExposeDevCode() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("showDevCode") === "1") {
    return true;
  }

  const hostname = window.location.hostname || "localhost";
  const isLocalLike = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
  return isLocalLike;
}

function normalizeFetchError(error) {
  if (error?.name === "AbortError") {
    return new Error("Servidor demorou para responder. Tente novamente.");
  }

  if (String(error?.message || "").trim()) {
    return error;
  }

  return new Error("Servidor offline. Tente atualizar a página no celular.");
}

async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch (_error) {
    return {};
  }
}

function shouldFallbackToCloud(baseUsed, statusCode, errorMessage) {
  if (baseUsed === CLOUD_API_BASE) {
    return false;
  }

  const safeMessage = String(errorMessage || "").toLowerCase();
  if (safeMessage.includes("rota nao encontrada")) {
    return true;
  }

  if (statusCode === 404 || statusCode >= 500) {
    return true;
  }

  return false;
}

async function apiRequest(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  async function fetchWithBase(base) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, API_REQUEST_TIMEOUT_MS);

    try {
      return await fetch(`${base}${path}`, {
        ...options,
        headers,
        signal: controller.signal
      });
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function runWithBase(base) {
    const response = await fetchWithBase(base);
    const data = await parseJsonSafe(response);
    return { response, data };
  }

  let responseBundle;
  try {
    responseBundle = await runWithBase(apiBase);
  } catch (error) {
    if (apiBase !== CLOUD_API_BASE) {
      try {
        responseBundle = await runWithBase(CLOUD_API_BASE);
        apiBase = CLOUD_API_BASE;
        localStorage.setItem("scv_api_base", CLOUD_API_BASE);
      } catch (fallbackError) {
        throw normalizeFetchError(fallbackError);
      }
    } else {
      throw normalizeFetchError(error);
    }
  }

  let { response, data } = responseBundle;
  if (!response.ok) {
    const message = data.error || "Erro inesperado";
    if (shouldFallbackToCloud(apiBase, response.status, message)) {
      try {
        const fallback = await runWithBase(CLOUD_API_BASE);
        response = fallback.response;
        data = fallback.data;
        apiBase = CLOUD_API_BASE;
        localStorage.setItem("scv_api_base", CLOUD_API_BASE);
      } catch (fallbackError) {
        throw normalizeFetchError(fallbackError);
      }
    }
  }

  if (!response.ok) {
    throw new Error(data.error || "Erro inesperado");
  }

  return data;
}

function setupReveal() {
  const items = document.querySelectorAll(".reveal");
  if (!items.length) return;

  if (typeof window.IntersectionObserver !== "function") {
    items.forEach((item) => item.classList.add("visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );

  items.forEach((item) => observer.observe(item));

  // Failsafe para alguns navegadores móveis que não disparam observer corretamente.
  window.setTimeout(() => {
    items.forEach((item) => {
      if (!item.classList.contains("visible")) {
        item.classList.add("visible");
      }
    });
  }, 1400);
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove("hidden");
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add("hidden");
  }
}

function setupAuthModals() {
  document.getElementById("openRegisterModal")?.addEventListener("click", () => {
    closeModal("loginModal");
    openModal("registerModal");
  });

  document.getElementById("openLoginModal")?.addEventListener("click", () => {
    closeModal("registerModal");
    openModal("loginModal");
  });

  document.getElementById("closeRegisterModal")?.addEventListener("click", () => closeModal("registerModal"));
  document.getElementById("closeLoginModal")?.addEventListener("click", () => closeModal("loginModal"));
  document.getElementById("closeSupportModal")?.addEventListener("click", () => closeModal("supportModal"));

  document.getElementById("supportFloatBtn")?.addEventListener("click", () => openModal("supportModal"));
  document.getElementById("openSupportModalFromHero")?.addEventListener("click", () => openModal("supportModal"));

  ["registerModal", "loginModal", "welcomeModal", "supportModal"].forEach((modalId) => {
    document.getElementById(modalId)?.addEventListener("click", (event) => {
      if (event.target.id === modalId) {
        closeModal(modalId);
      }
    });
  });

  if (supportTicketId) {
    startSupportChat();
  }
}

async function trackVisit() {
  try {
    let sessionId = localStorage.getItem("scv_session");
    if (!sessionId) {
      sessionId = `sess_${Math.random().toString(36).slice(2)}`;
      localStorage.setItem("scv_session", sessionId);
    }

    await apiRequest("/track/visit", {
      method: "POST",
      body: JSON.stringify({ sessionId })
    });
  } catch (_error) {
    // nao interromper a experiencia por falha de tracking
  }
}

function toggleAuthOnly(isAuthenticated) {
  document.querySelectorAll("[data-auth-only]").forEach((node) => {
    if (isAuthenticated) {
      node.classList.remove("hidden");
    } else {
      node.classList.add("hidden");
    }
  });

  document.querySelectorAll("[data-guest-only]").forEach((node) => {
    if (isAuthenticated) {
      node.classList.add("hidden");
    } else {
      node.classList.remove("hidden");
    }
  });
}

function logoutUser() {
  authToken = "";
  currentUser = null;
  localStorage.removeItem("scv_token");
  toggleAuthOnly(false);

  const walletUser = document.getElementById("walletUser");
  const walletCredits = document.getElementById("walletCredits");
  const sessionHint = document.getElementById("authSessionHint");
  if (walletUser) walletUser.textContent = "-";
  if (walletCredits) walletCredits.textContent = "0";
  if (sessionHint) sessionHint.textContent = "";

  const txList = document.getElementById("transactionsList");
  const notificationsList = document.getElementById("notificationsList");
  if (txList) txList.innerHTML = "";
  if (notificationsList) notificationsList.innerHTML = "";

  setFeedback("loginFeedback", "Você saiu da conta.", "success");
  stopSupportChat();
}

function showWelcome(message) {
  const modal = document.getElementById("welcomeModal");
  const text = document.getElementById("welcomeText");
  const close = document.getElementById("closeWelcome");

  if (!modal || !text || !close) return;
  text.textContent = message;
  modal.classList.remove("hidden");

  close.onclick = () => {
    modal.classList.add("hidden");
  };
}

function resolveProductPrice(product) {
  const displayFromApi = Number(product.display_price ?? product.price_cash ?? 0);

  if (!campaignState.active) {
    return {
      final_price: roundCash(displayFromApi),
      old_price: null,
      campaign_applied: false
    };
  }

  if (product.campaign_applied) {
    const oldPrice = Number(product.price_before_campaign ?? product.price_cash ?? displayFromApi);
    return {
      final_price: roundCash(displayFromApi),
      old_price: oldPrice > displayFromApi ? roundCash(oldPrice) : null,
      campaign_applied: true
    };
  }

  const fallbackBase = roundCash(displayFromApi * (1 + Number(campaignState.campaign_markup_percent || 0) / 100));
  const fallbackFinal = roundCash(fallbackBase * (1 - Number(campaignState.discount_percent || 0) / 100));
  return {
    final_price: fallbackFinal,
    old_price: fallbackBase > fallbackFinal ? fallbackBase : null,
    campaign_applied: true
  };
}

function renderProducts(products) {
  const grid = document.getElementById("productsGrid");
  if (!grid) return;

  if (!products.length) {
    grid.innerHTML = "<p>Nenhum produto encontrado.</p>";
    return;
  }

  grid.innerHTML = products
    .map((product) => {
      const pricing = resolveProductPrice(product);
      const beginnerText = product.beginner_eligible
        ? `<span class="price-beginner">Desconto iniciante ativo: R$ ${Number(product.beginner_price).toFixed(2)}</span>`
        : (product.is_beginner_offer ? '<span class="price-beginner">Oferta para membros novos disponível</span>' : "");
      const oldPriceHtml = pricing.old_price != null ? `<span class="price-old">De R$ ${Number(pricing.old_price).toFixed(2)}</span>` : "";
      const campaignBadge = pricing.campaign_applied
        ? `<span class="price-campaign-tag">${campaignState.discount_percent}% OFF - Especial Mulheres e Mães</span>`
        : "";

      return `
        <article class="product">
          <img src="${product.image_url || "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=60"}" alt="${product.title}" />
          <h3>${product.title}</h3>
          <p>${product.description}</p>
          <div class="product-meta">
            <span class="tag">${product.brand}</span>
            <span class="tag">${product.category || "CELULAR"}</span>
            <span class="tag">Estoque: ${product.stock}</span>
          </div>
          <div class="price-line">
            <span class="price-main ${pricing.campaign_applied ? "campaign" : ""}">R$ ${Number(pricing.final_price).toFixed(2)}</span>
            ${oldPriceHtml}
            ${campaignBadge}
            <span>${product.price_credits} créditos</span>
            ${beginnerText}
          </div>
          <div class="product-actions">
            <button class="btn btn-ghost action-checkout" data-id="${product.id}">Ir para checkout</button>
            <button class="btn btn-primary action-credits" data-id="${product.id}">Trocar créditos</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function formatReviewDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("pt-BR");
}

function formatChatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function renderStars(rating) {
  const safe = Math.max(1, Math.min(5, Number(rating || 0)));
  return "★".repeat(safe) + "☆".repeat(5 - safe);
}

function hydrateReviewSelectors() {
  const filter = document.getElementById("reviewsProductFilter");
  const reviewProduct = document.getElementById("reviewProductId");
  const optionsHtml = productsCache
    .map((product) => `<option value="${product.id}">${escapeHtml(product.title)}</option>`)
    .join("");

  if (filter) {
    const previous = filter.value;
    filter.innerHTML = `<option value="">Todas as avaliações</option>${optionsHtml}`;
    if (previous && productsCache.some((item) => String(item.id) === String(previous))) {
      filter.value = previous;
      selectedReviewProductId = previous;
    } else {
      filter.value = "";
      selectedReviewProductId = "";
    }
  }

  if (reviewProduct) {
    const previous = reviewProduct.value;
    reviewProduct.innerHTML = `<option value="">Selecione o produto</option>${optionsHtml}`;
    if (previous && productsCache.some((item) => String(item.id) === String(previous))) {
      reviewProduct.value = previous;
    } else if (productsCache.length) {
      reviewProduct.value = String(productsCache[0].id);
    }
  }
}

function renderReviews(reviews = [], summary = { total: 0, average_rating: 0 }) {
  const list = document.getElementById("reviewsList");
  const average = document.getElementById("reviewsAverage");
  const count = document.getElementById("reviewsCount");

  if (average) {
    average.textContent = Number(summary.average_rating || 0).toLocaleString("pt-BR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    });
  }

  if (count) {
    count.textContent = `${Number(summary.total || 0)} avaliação(ões)`;
  }

  if (!list) return;

  if (!reviews.length) {
    list.innerHTML = "<p>Nenhuma avaliação encontrada para este filtro.</p>";
    return;
  }

  list.innerHTML = reviews
    .map((review) => {
      const photo = review.photo_url
        ? `<img class="review-photo" src="${escapeHtml(review.photo_url)}" alt="Foto enviada por cliente" />`
        : "";

      return `
        <article class="review-card">
          <div class="review-top">
            <strong>${escapeHtml(review.user_name || review.name || "Cliente Smart Choice")}</strong>
            <span class="review-stars">${renderStars(review.rating)}</span>
          </div>
          <p>${escapeHtml(review.comment || "Produto excelente, recomendo.")}</p>
          ${photo}
          <p class="review-meta">${escapeHtml(review.product_title || "Produto")} • ${formatReviewDate(review.created_at)}</p>
        </article>
      `;
    })
    .join("");
}

function buildReviewsSummary(reviews = []) {
  const total = reviews.length;
  if (!total) {
    return { total: 0, average_rating: 0 };
  }

  const sum = reviews.reduce((acc, item) => acc + Number(item.rating || 0), 0);
  return {
    total,
    average_rating: Number((sum / total).toFixed(2))
  };
}

async function loadReviewsLegacyFallback() {
  const scopedProducts = selectedReviewProductId
    ? productsCache.filter((item) => String(item.id) === String(selectedReviewProductId))
    : productsCache.slice(0, 40);

  if (!scopedProducts.length) {
    return { reviews: [], summary: { total: 0, average_rating: 0 } };
  }

  const grouped = await Promise.all(
    scopedProducts.map(async (product) => {
      try {
        const result = await apiRequest(`/products/${product.id}/reviews`);
        return (result.reviews || []).map((review) => ({
          ...review,
          user_name: review.name || "Cliente Smart Choice",
          product_id: product.id,
          product_title: product.title,
          product_brand: product.brand
        }));
      } catch (_error) {
        return [];
      }
    })
  );

  const merged = grouped
    .flat()
    .sort((a, b) => {
      const timeA = new Date(a.created_at || 0).getTime();
      const timeB = new Date(b.created_at || 0).getTime();
      return timeB - timeA;
    });

  return {
    reviews: merged.slice(0, 80),
    summary: buildReviewsSummary(merged)
  };
}

async function loadReviews() {
  const query = selectedReviewProductId ? `?productId=${encodeURIComponent(selectedReviewProductId)}` : "";

  try {
    const result = await apiRequest(`/reviews${query}`);
    renderReviews(result.reviews || [], result.summary || { total: 0, average_rating: 0 });
  } catch (error) {
    if (isRouteNotFoundError(error)) {
      const fallback = await loadReviewsLegacyFallback();
      renderReviews(fallback.reviews || [], fallback.summary || { total: 0, average_rating: 0 });
      return;
    }

    const list = document.getElementById("reviewsList");
    if (list) {
      list.innerHTML = `<p>Erro ao carregar avaliações: ${escapeHtml(error.message)}</p>`;
    }
  }
}

async function submitReview(event) {
  event.preventDefault();

  if (!authToken) {
    setFeedback("reviewFeedback", "Faça login para enviar avaliação.", "error");
    openModal("loginModal");
    return;
  }

  const form = event.currentTarget;
  const formData = new FormData(form);
  const payload = {
    productId: Number(formData.get("productId")),
    rating: Number(formData.get("rating")),
    comment: String(formData.get("comment") || "").trim(),
    photoUrl: String(formData.get("photoUrl") || "").trim()
  };

  if (!payload.productId || !payload.rating || !payload.comment) {
    setFeedback("reviewFeedback", "Preencha produto, nota e comentário.", "error");
    return;
  }

  try {
    await apiRequest("/reviews", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    setFeedback("reviewFeedback", "Avaliação enviada com sucesso.", "success");
    form.querySelector("textarea[name='comment']").value = "";
    form.querySelector("input[name='photoUrl']").value = "";
    await loadReviews();
  } catch (error) {
    setFeedback("reviewFeedback", error.message, "error");
  }
}

async function loadProducts() {
  const onlyBeginner = document.getElementById("onlyBeginner")?.checked ? "1" : "0";
  const brandQuery = selectedBrand ? `&brand=${encodeURIComponent(selectedBrand)}` : "";
  const grid = document.getElementById("productsGrid");

  if (grid) {
    grid.innerHTML = "<p class=\"loading-note\">Carregando produtos...</p>";
  }

  try {
    const result = await apiRequest(`/products?onlyBeginner=${onlyBeginner}${brandQuery}`);
    campaignState = normalizeCampaign(result.campaign || campaignState);
    startCampaignTicker();
    productsCache = result.products || [];
    renderProducts(productsCache);
    hydrateReviewSelectors();
    await loadReviews();
  } catch (error) {
    if (grid) {
      const safeMessage = escapeHtml(error.message);
      grid.innerHTML = `
        <div class="products-load-error">
          <p>Erro ao carregar produtos: ${safeMessage}</p>
          <button class="btn btn-ghost action-retry-products" type="button">Tentar novamente</button>
        </div>
      `;
    }
  }
}

async function loadWallet() {
  if (!authToken) return;

  try {
    const [me, tx, notifications, partner] = await Promise.all([
      apiRequest("/me"),
      apiRequest("/me/transactions"),
      apiRequest("/me/notifications"),
      apiRequest("/partner/dashboard")
    ]);

    currentUser = me.user;

    const userEl = document.getElementById("walletUser");
    const creditsEl = document.getElementById("walletCredits");
    const sessionHint = document.getElementById("authSessionHint");
    if (userEl) userEl.textContent = currentUser.name;
    if (creditsEl) creditsEl.textContent = String(currentUser.credits);
    if (sessionHint) {
      sessionHint.textContent = `Logado como ${currentUser.name} (${currentUser.email}). Para cadastrar outro e-mail, clique em "Sair da conta".`;
    }

    const txList = document.getElementById("transactionsList");
    if (txList) {
      txList.innerHTML = (tx.transactions || [])
        .slice(0, 25)
        .map((item) => `<li><strong>${item.delta > 0 ? "+" : ""}${item.delta}</strong> - ${item.reason}</li>`)
        .join("") || "<li>Sem movimentações.</li>";
    }

    const notificationsList = document.getElementById("notificationsList");
    if (notificationsList) {
      notificationsList.innerHTML = (notifications.notifications || [])
        .slice(0, 25)
        .map((item) => `<li>${item.title}: ${item.message}</li>`)
        .join("") || "<li>Sem notificações.</li>";
    }

    const partnerDashboard = document.getElementById("partnerDashboard");
    const partnerStatus = document.getElementById("partnerStatus");
    const partnerGoal = document.getElementById("partnerGoal");

    if (partnerDashboard) partnerDashboard.classList.remove("hidden");
    if (partnerStatus) {
      partnerStatus.textContent = partner.partnerActive
        ? `Status: parceiro ativo. Bônus de ${partner.monthlyBonus} créditos por mês.`
        : "Status: solicitação em análise.";
    }
    if (partnerGoal) {
      partnerGoal.textContent = `Meta mensal: ${partner.goal.current_sales}/${partner.goal.target_sales}`;
    }
  } catch (error) {
    setFeedback("loginFeedback", `Falha ao carregar área do cliente: ${error.message}`, "error");
  }
}

async function sendRegisterCode() {
  const form = document.getElementById("registerSingleForm");
  if (!form) return;

  const formData = new FormData(form);
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const codeInput = form.querySelector("input[name='code']");
  const button = document.getElementById("sendRegisterCodeBtn");

  if (authToken) {
    setFeedback("registerSingleFeedback", "Você já está logado. Saia da conta para cadastrar um novo e-mail.", "error");
    return;
  }

  if (!name || !email) {
    setFeedback("registerSingleFeedback", "Informe nome e e-mail para enviar o código.", "error");
    return;
  }

  if (button) button.disabled = true;
  setFeedback("registerSingleFeedback", "Enviando código...", "");

  try {
    const result = await apiRequest("/auth/register/start", {
      method: "POST",
      body: JSON.stringify({
        name,
        email,
        // Compatibilidade com backend antigo que ainda exige telefone.
        phone: buildAutoPhoneTag(email)
      })
    });

    let message = result.message || "Código enviado.";
    if (result.dev_code && shouldExposeDevCode()) {
      message += ` Código (modo dev): ${result.dev_code}`;
      if (codeInput) {
        codeInput.value = result.dev_code;
      }
    }

    message = appendDeliveryHint(message, result.delivery);
    setFeedback("registerSingleFeedback", message, result.delivery?.sent || result.dev_code ? "success" : "error");
  } catch (error) {
    const rawMessage = String(error.message || "");
    const activeAccountMessage = rawMessage.includes("Conta ja ativa")
      ? "Esse e-mail já está cadastrado e ativo. Faça login ou use outro e-mail novo."
      : rawMessage;
    setFeedback("registerSingleFeedback", activeAccountMessage, "error");
  } finally {
    if (button) button.disabled = false;
  }
}

async function registerSingleSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form));
  const submitBtn = form.querySelector("button[type='submit']");

  if (authToken) {
    setFeedback("registerSingleFeedback", "Você já está logado. Saia da conta para cadastrar um novo e-mail.", "error");
    return;
  }

  if (submitBtn) submitBtn.disabled = true;
  setFeedback("registerSingleFeedback", "Validando cadastro...", "");

  try {
    if (!payload.name || !payload.email || !payload.code || !payload.password) {
      throw new Error("Preencha nome, e-mail, senha e código.");
    }

    if (!isStrongPassword(payload.password)) {
      throw new Error("Senha fraca. Use 8+ caracteres com maiúscula, minúscula, número e símbolo.");
    }

    await apiRequest("/auth/register/complete", {
      method: "POST",
      body: JSON.stringify({
        email: payload.email,
        code: payload.code,
        password: payload.password
      })
    });

    setFeedback("registerSingleFeedback", "Conta ativada. Agora faça login.", "success");
    form.reset();
    setTimeout(() => {
      closeModal("registerModal");
      openModal("loginModal");
    }, 600);
  } catch (error) {
    setFeedback("registerSingleFeedback", error.message, "error");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function login(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = Object.fromEntries(new FormData(form));
  const payload = {
    identifier: formData.identifier,
    password: formData.password
  };

  const submitBtn = form.querySelector("button[type='submit']");
  if (submitBtn) submitBtn.disabled = true;
  setFeedback("loginFeedback", "Entrando...", "");

  try {
    const result = await apiRequest("/auth/login", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    authToken = result.token;
    localStorage.setItem("scv_token", authToken);
    toggleAuthOnly(true);
    setFeedback("loginFeedback", "Login realizado com sucesso.", "success");
    if (supportTicketId) {
      startSupportChat();
    }

    closeModal("loginModal");

    if (result.showWelcome && result.welcomeMessage) {
      showWelcome(result.welcomeMessage);
    }

    await loadWallet();
    await loadProducts();
  } catch (error) {
    setFeedback("loginFeedback", error.message, "error");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function buyWithCredits(productId) {
  if (!authToken) {
    openModal("loginModal");
    return;
  }

  try {
    await apiRequest("/orders/credits/purchase", {
      method: "POST",
      body: JSON.stringify({ productId, quantity: 1 })
    });

    alert("Troca por créditos concluída.");
    await loadWallet();
    await loadProducts();
  } catch (error) {
    alert(error.message);
  }
}

function goToCheckout(productId) {
  const base = window.location.pathname.endsWith("/") ? `${window.location.pathname}checkout.html` : "checkout.html";
  const apiParam = encodeURIComponent(apiBase || CLOUD_API_BASE);
  window.location.href = `${base}?productId=${productId}&api=${apiParam}`;
}

async function submitTriage(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget));

  try {
    const result = await apiRequest("/support/triage", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    if (result.resolved) {
      setFeedback("triageFeedback", `FAQ: ${result.answer}`, "success");
    } else {
      setFeedback("triageFeedback", `Ticket criado: #${result.ticketId}`, "success");
    }
  } catch (error) {
    setFeedback("triageFeedback", error.message, "error");
  }
}

async function submitSupportPopup(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const payload = {
    name: String(formData.get("name") || "").trim(),
    orderNumber: String(formData.get("orderNumber") || "").trim(),
    subject: String(formData.get("subject") || "").trim(),
    question: String(formData.get("question") || "").trim(),
    forceHuman: formData.get("forceHuman") === "on"
  };

  if (!payload.name || !payload.subject || !payload.question) {
    setFeedback("supportPopupFeedback", "Preencha nome, assunto e mensagem.", "error");
    return;
  }

  try {
    const result = await apiRequest("/support/triage", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    if (result.resolved) {
      setFeedback("supportPopupFeedback", `IA respondeu: ${result.answer}`, "success");
    } else {
      setFeedback("supportPopupFeedback", `Ticket humano criado: #${result.ticketId}`, "success");
      supportTicketId = Number(result.ticketId);
      localStorage.setItem("scv_ticket_id", String(supportTicketId));
      startSupportChat();
    }
  } catch (error) {
    setFeedback("supportPopupFeedback", error.message, "error");
  }
}

function renderSupportMessages(messages = []) {
  const box = document.getElementById("supportChatMessages");
  if (!box) return;

  if (!messages.length) {
    box.innerHTML = "<p class=\"auth-tip\">Sem mensagens ainda.</p>";
    return;
  }

  box.innerHTML = messages
    .map(
      (m) =>
        `<div class="chat-message ${m.sender_type === "ADMIN" ? "admin" : "user"}">
          <strong>${m.sender_type === "ADMIN" ? "Atendente" : "Você"}</strong>
          <p>${escapeHtml(m.body)}</p>
          <small>${formatChatDateTime(m.created_at)}</small>
        </div>`
      )
    .join("");

  box.scrollTop = box.scrollHeight;
}

function getSupportMessagesCacheKey(ticketId) {
  return `scv_ticket_messages_${ticketId}`;
}

function saveSupportMessagesCache(ticketId, messages = []) {
  if (!ticketId) return;
  try {
    localStorage.setItem(getSupportMessagesCacheKey(ticketId), JSON.stringify(messages.slice(-120)));
  } catch (_error) {
    // ignore storage errors
  }
}

function loadSupportMessagesCache(ticketId) {
  if (!ticketId) return [];
  try {
    const raw = localStorage.getItem(getSupportMessagesCacheKey(ticketId));
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function clearSupportTicketSession() {
  if (supportTicketId) {
    localStorage.removeItem(getSupportMessagesCacheKey(supportTicketId));
  }
  supportTicketId = 0;
  localStorage.removeItem("scv_ticket_id");
}

function handleClosedSupportTicket(status = "ANSWERED") {
  const box = document.getElementById("supportChatBox");
  const normalized = normalizeTicketStatus(status);
  clearSupportTicketSession();
  stopSupportChat();
  if (box) {
    box.classList.add("hidden");
  }
  setFeedback("supportChatFeedback", `Atendimento finalizado (${normalized}). Abra novo ticket se precisar.`, "success");
}

async function fetchSupportMessages() {
  if (!supportTicketId || !authToken) return;
  try {
    const result = await apiRequest(`/tickets/${supportTicketId}/messages`);
    const ticketStatus = normalizeTicketStatus(result.ticketStatus);
    if (isSupportTicketClosed(ticketStatus)) {
      handleClosedSupportTicket(ticketStatus);
      return;
    }

    const messages = result.messages || [];
    renderSupportMessages(messages);
    saveSupportMessagesCache(supportTicketId, messages);
    setFeedback("supportChatFeedback", "", "");
  } catch (error) {
    if (String(error.message || "").toLowerCase().includes("ticket finalizado")) {
      handleClosedSupportTicket("CLOSED");
      return;
    }
    setFeedback("supportChatFeedback", error.message, "error");
  }
}

function stopSupportChat() {
  if (supportChatTimer) {
    clearInterval(supportChatTimer);
    supportChatTimer = null;
  }
}

function startSupportChat() {
  const box = document.getElementById("supportChatBox");
  const status = document.getElementById("supportChatStatus");
  if (!supportTicketId || !box) return;

  box.classList.remove("hidden");
  const cachedMessages = loadSupportMessagesCache(supportTicketId);
  if (cachedMessages.length) {
    renderSupportMessages(cachedMessages);
  }

  if (status) {
    status.textContent = authToken
      ? `Ticket #${supportTicketId} em atendimento humano. Histórico preservado.`
      : "Para usar o chat, faça login e reabra este atendimento.";
  }

  stopSupportChat();
  if (authToken) {
    fetchSupportMessages();
    supportChatTimer = window.setInterval(fetchSupportMessages, 5000);
  }
}

async function sendSupportChat(event) {
  event.preventDefault();
  if (!supportTicketId) {
    setFeedback("supportChatFeedback", "Abra um ticket primeiro.", "error");
    return;
  }

  if (!authToken) {
    setFeedback("supportChatFeedback", "Entre na conta para enviar mensagem.", "error");
    openModal("loginModal");
    return;
  }

  const input = document.querySelector("#supportChatForm input[name='message']");
  const message = String(input?.value || "").trim();
  if (!message) return;

  try {
    await apiRequest(`/tickets/${supportTicketId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message })
    });
    if (input) input.value = "";
    await fetchSupportMessages();
  } catch (error) {
    if (String(error.message || "").toLowerCase().includes("ticket finalizado")) {
      handleClosedSupportTicket("CLOSED");
      return;
    }
    setFeedback("supportChatFeedback", error.message, "error");
  }
}

function startNewSupportTicketFlow() {
  clearSupportTicketSession();
  const box = document.getElementById("supportChatBox");
  if (box) {
    box.classList.add("hidden");
  }
  setFeedback("supportPopupFeedback", "Novo atendimento habilitado. Envie o formulário para criar outro ticket.", "success");
  setFeedback("supportChatFeedback", "", "");
}

async function submitPartner(event) {
  event.preventDefault();

  if (!authToken) {
    setFeedback("partnerFeedback", "Faça login para solicitar parceria.", "error");
    openModal("loginModal");
    return;
  }

  const payload = Object.fromEntries(new FormData(event.currentTarget));

  try {
    await apiRequest("/partner/apply", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    setFeedback("partnerFeedback", "Solicitação de parceiro enviada.", "success");
    await loadWallet();
  } catch (error) {
    setFeedback("partnerFeedback", error.message, "error");
  }
}

function bindEvents() {
  document.getElementById("registerSingleForm")?.addEventListener("submit", registerSingleSubmit);
  document.getElementById("sendRegisterCodeBtn")?.addEventListener("click", sendRegisterCode);
  document.getElementById("logoutBtn")?.addEventListener("click", logoutUser);
  document.getElementById("loginForm")?.addEventListener("submit", login);
  document.getElementById("triageForm")?.addEventListener("submit", submitTriage);
  document.getElementById("supportPopupForm")?.addEventListener("submit", submitSupportPopup);
  document.getElementById("supportChatForm")?.addEventListener("submit", sendSupportChat);
  document.getElementById("newSupportTicketBtn")?.addEventListener("click", startNewSupportTicketFlow);
  document.getElementById("partnerForm")?.addEventListener("submit", submitPartner);
  document.getElementById("reviewForm")?.addEventListener("submit", submitReview);
  document.getElementById("reviewsProductFilter")?.addEventListener("change", async (event) => {
    selectedReviewProductId = String(event.target.value || "");
    await loadReviews();
  });

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", async () => {
      document.querySelectorAll(".chip").forEach((el) => el.classList.remove("active"));
      chip.classList.add("active");
      selectedBrand = chip.getAttribute("data-brand") || "";
      await loadProducts();
    });
  });

  document.getElementById("onlyBeginner")?.addEventListener("change", loadProducts);

  document.getElementById("productsGrid")?.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;

    if (button.classList.contains("action-retry-products")) {
      await loadProducts();
      return;
    }

    const productId = Number(button.getAttribute("data-id"));
    if (!productId) return;

    if (button.classList.contains("action-credits")) {
      await buyWithCredits(productId);
    }

    if (button.classList.contains("action-checkout")) {
      goToCheckout(productId);
    }
  });
}

async function bootstrap() {
  setupReveal();
  setupAuthModals();
  bindEvents();
  toggleAuthOnly(Boolean(authToken));
  campaignState = normalizeCampaign(campaignState);
  startCampaignTicker();

  await loadProducts();
  trackVisit();

  if (authToken) {
    await loadWallet();
  }
}

bootstrap();
