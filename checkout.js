function resolveApiBase() {
  const hostname = window.location.hostname || "localhost";
  const isLocalLikeHost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
  const params = new URLSearchParams(window.location.search);
  const apiFromQuery = (params.get("api") || "").trim();
  if (apiFromQuery) {
    localStorage.setItem("scv_api_base", apiFromQuery);
    return apiFromQuery.replace(/\/+$/, "");
  }

  const stored = (localStorage.getItem("scv_api_base") || "").trim();
  if (stored) {
    const storedIsLocal = /localhost|127\.0\.0\.1|::1/.test(stored);
    if (!storedIsLocal || isLocalLikeHost) {
      return stored.replace(/\/+$/, "");
    }
  }

  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  if (isLocalLikeHost) {
    return `${protocol}//${hostname}:4000/api`;
  }

  return "https://smart-choice-vendas.onrender.com/api";
}

const API_BASE = resolveApiBase();
const STORE_WHATSAPP = "556684330286";
const DEFAULT_TEMP_CAMPAIGN = Object.freeze({
  name: "Especial Dia da Mulher",
  discount_percent: 10,
  campaign_markup_percent: 12,
  start_at: "2026-03-08T00:00:00-03:00",
  end_at: "2026-03-10T00:00:00-03:00"
});
const params = new URLSearchParams(window.location.search);
const selectedProductId = Number(params.get("productId") || 0);
const CREDIT_COUPON_COST = 50;
const CREDIT_COUPON_PERCENT = 5;

let authToken = localStorage.getItem("scv_token") || "";
let selectedProduct = null;
let currentUser = null;
let campaignState = normalizeCampaign(DEFAULT_TEMP_CAMPAIGN);

function revealAll() {
  document.querySelectorAll(".reveal").forEach((el) => el.classList.add("visible"));
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

function formatMoney(value) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function roundCash(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function normalizeCampaign(rawCampaign = {}) {
  const merged = { ...DEFAULT_TEMP_CAMPAIGN, ...(rawCampaign || {}) };
  const startMs = new Date(String(merged.start_at)).getTime();
  const endMs = new Date(String(merged.end_at)).getTime();
  const nowMs = Date.now();

  let active = false;
  if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs > startMs) {
    active = nowMs >= startMs && nowMs < endMs;
  } else {
    active = Boolean(merged.active);
  }

  return {
    ...merged,
    discount_percent: Math.max(0, Math.min(80, Number(merged.discount_percent || DEFAULT_TEMP_CAMPAIGN.discount_percent))),
    campaign_markup_percent: Math.max(0, Math.min(80, Number(merged.campaign_markup_percent || DEFAULT_TEMP_CAMPAIGN.campaign_markup_percent))),
    active
  };
}

function resolveCheckoutPrice(product) {
  const displayFromApi = Number(product.display_price ?? product.price_cash ?? 0);
  if (!campaignState.active) {
    return roundCash(displayFromApi);
  }

  if (product.campaign_applied) {
    return roundCash(displayFromApi);
  }

  const base = roundCash(displayFromApi * (1 + Number(campaignState.campaign_markup_percent || 0) / 100));
  return roundCash(base * (1 - Number(campaignState.discount_percent || 0) / 100));
}

async function apiRequest(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers
    });
  } catch (_error) {
    throw new Error("Servidor offline. Inicie o backend para continuar.");
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Erro inesperado");
  }

  return data;
}

function clampQuantity(value) {
  const qty = Number(value);
  if (!Number.isFinite(qty)) return 1;
  return Math.min(10, Math.max(1, Math.round(qty)));
}

function isCreditCouponSelected() {
  return Boolean(document.getElementById("useCreditCoupon")?.checked);
}

function canUseCreditCoupon() {
  return Boolean(authToken && currentUser && Number(currentUser.credits || 0) >= CREDIT_COUPON_COST);
}

function getCheckoutBreakdown(quantity) {
  const unitBase = resolveCheckoutPrice(selectedProduct);
  const subtotalBeforeCoupon = roundCash(unitBase * quantity);
  const couponSelected = isCreditCouponSelected();
  const couponEligible = couponSelected && canUseCreditCoupon();
  const couponDiscount = couponEligible
    ? roundCash(subtotalBeforeCoupon * (CREDIT_COUPON_PERCENT / 100))
    : 0;
  const totalCash = roundCash(subtotalBeforeCoupon - couponDiscount);
  const reward = Math.max(10, Math.round(totalCash / 100));

  return {
    unitBase,
    subtotalBeforeCoupon,
    totalCash,
    couponSelected,
    couponEligible,
    couponDiscount,
    reward
  };
}

function refreshCouponUi() {
  const couponInput = document.getElementById("useCreditCoupon");
  const couponHint = document.getElementById("couponHint");
  const couponCard = document.getElementById("creditCouponCard");

  if (!couponInput || !couponHint || !couponCard) return;

  if (!authToken || !currentUser) {
    couponInput.checked = false;
    couponInput.disabled = true;
    couponHint.textContent = "Faça login para habilitar o cupom de 50 créditos.";
    couponCard.classList.remove("coupon-ready");
    return;
  }

  const credits = Number(currentUser.credits || 0);
  if (credits < CREDIT_COUPON_COST) {
    couponInput.checked = false;
    couponInput.disabled = true;
    couponHint.textContent = `Saldo insuficiente para cupom. Você tem ${credits} créditos e precisa de ${CREDIT_COUPON_COST}.`;
    couponCard.classList.remove("coupon-ready");
    return;
  }

  couponInput.disabled = false;
  couponHint.textContent = `Cupom disponível: ao ativar, serão consumidos ${CREDIT_COUPON_COST} créditos e aplicado ${CREDIT_COUPON_PERCENT}% OFF.`;
  couponCard.classList.add("coupon-ready");
}

function updateSummary() {
  if (!selectedProduct) return;

  const qtyInput = document.querySelector("#checkoutForm input[name='quantity']");
  const quantity = clampQuantity(qtyInput?.value || 1);
  if (qtyInput) {
    qtyInput.value = String(quantity);
  }

  const breakdown = getCheckoutBreakdown(quantity);

  const subtotalEl = document.getElementById("summarySubtotal");
  const couponDiscountEl = document.getElementById("summaryCouponDiscount");
  const totalEl = document.getElementById("summaryTotal");
  const rewardEl = document.getElementById("summaryReward");
  if (subtotalEl) subtotalEl.textContent = formatMoney(breakdown.subtotalBeforeCoupon);
  if (couponDiscountEl) couponDiscountEl.textContent = `- ${formatMoney(breakdown.couponDiscount)}`;
  if (totalEl) totalEl.textContent = formatMoney(breakdown.totalCash);
  if (rewardEl) rewardEl.textContent = `${breakdown.reward} créditos`;
}

function renderProduct(product) {
  const card = document.getElementById("checkoutProductCard");
  if (!card) return;
  const unitCash = resolveCheckoutPrice(product);

  card.innerHTML = `
    <img src="${product.image_url || "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=60"}" alt="${product.title}" />
    <div class="checkout-product-info">
      <h3>${product.title}</h3>
      <p>${product.description || "-"}</p>
      <div class="product-meta">
        <span class="tag">${product.brand}</span>
        <span class="tag">${product.category || "CELULAR"}</span>
        <span class="tag">Estoque: ${product.stock}</span>
      </div>
      <p class="checkout-price">${formatMoney(unitCash)}</p>
      <small>Preço em créditos: ${product.price_credits} créditos</small>
    </div>
  `;
}

function openWhatsappCheckout(message) {
  const encoded = encodeURIComponent(message);
  const url = `https://wa.me/${STORE_WHATSAPP}?text=${encoded}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

function buildCheckoutMessage({ buyerName, buyerEmail, quantity, notes, orderId, breakdown }) {
  const lines = [
    "Olá Smart Choice Vendas, quero finalizar minha compra.",
    orderId ? `Pedido: #${orderId}` : "Pedido: Pré-checkout (sem login)",
    `Cliente: ${buyerName}`,
    `Contato: ${buyerEmail}`,
    `Produto: ${selectedProduct?.title || "-"}`,
    `Marca: ${selectedProduct?.brand || "-"}`,
    `Quantidade: ${quantity}`,
    `Total estimado: ${formatMoney(breakdown.totalCash)}`
  ];

  if (breakdown.couponEligible) {
    lines.push(`Cupom aplicado: ${CREDIT_COUPON_PERCENT}% OFF com ${CREDIT_COUPON_COST} créditos`);
  }

  if (notes) {
    lines.push(`Observações: ${notes}`);
  }

  return lines.join("\n");
}

async function loadProduct() {
  if (!selectedProductId) {
    window.location.replace("index.html#loja");
    return;
  }

  try {
    const result = await apiRequest("/products?onlyBeginner=0");
    campaignState = normalizeCampaign(result.campaign || campaignState);
    const found = (result.products || []).find((item) => Number(item.id) === selectedProductId);
    if (!found) {
      throw new Error("Produto não encontrado. Selecione novamente na vitrine.");
    }

    selectedProduct = found;
    renderProduct(found);
    updateSummary();
  } catch (error) {
    setFeedback("checkoutFeedback", error.message, "error");
    setTimeout(() => {
      window.location.replace("index.html#loja");
    }, 900);
  }
}

async function loadCurrentUser() {
  const status = document.getElementById("checkoutStatus");
  const nameInput = document.querySelector("#checkoutForm input[name='buyerName']");
  const emailInput = document.querySelector("#checkoutForm input[name='buyerEmail']");

  if (!authToken) {
    if (status) {
      status.textContent = "Você está sem login. Ainda dá para enviar ao WhatsApp, mas com login o pedido fica registrado e gera créditos após aprovação.";
    }
    refreshCouponUi();
    return;
  }

  try {
    const result = await apiRequest("/me");
    currentUser = result.user;

    if (status) {
      status.textContent = `Logado como ${currentUser.name} | Saldo atual: ${currentUser.credits} créditos`;
    }

    if (nameInput && !nameInput.value) nameInput.value = currentUser.name || "";
    if (emailInput && !emailInput.value) emailInput.value = currentUser.email || "";
    refreshCouponUi();
  } catch (_error) {
    localStorage.removeItem("scv_token");
    authToken = "";
    currentUser = null;
    if (status) {
      status.textContent = "Sessão expirada. Faça login novamente na página inicial para registrar pedidos com seu usuário.";
    }
    refreshCouponUi();
  }
}

async function openHumanSupportTicket(payload) {
  return apiRequest("/support/triage", {
    method: "POST",
    body: JSON.stringify({
      name: payload.name,
      orderNumber: payload.orderNumber,
      subject: "Checkout - Finalizar Pagamento",
      question: payload.message,
      forceHuman: true
    })
  });
}

async function submitCheckout(event) {
  event.preventDefault();
  if (!selectedProduct) {
    setFeedback("checkoutFeedback", "Produto inválido para finalizar.", "error");
    return;
  }

  const formData = new FormData(event.currentTarget);
  const buyerName = String(formData.get("buyerName") || "").trim();
  const buyerEmail = String(formData.get("buyerEmail") || "").trim();
  const quantity = clampQuantity(formData.get("quantity"));
  const paymentChannel = String(formData.get("paymentChannel") || "CHAT_HUMANO");
  const useCreditCoupon = Boolean(formData.get("useCreditCoupon"));
  const notes = String(formData.get("notes") || "").trim();
  const breakdown = getCheckoutBreakdown(quantity);

  if (!buyerName || !buyerEmail) {
    setFeedback("checkoutFeedback", "Nome e e-mail são obrigatórios.", "error");
    return;
  }

  if (useCreditCoupon && !authToken) {
    setFeedback("checkoutFeedback", "Faça login para usar o cupom de créditos.", "error");
    return;
  }

  if (useCreditCoupon && !breakdown.couponEligible) {
    setFeedback("checkoutFeedback", "Saldo insuficiente para usar o cupom de 50 créditos.", "error");
    return;
  }

  setFeedback("checkoutFeedback", "Processando checkout...", "");

  let order = null;
  try {
    if (authToken) {
      const orderResult = await apiRequest("/orders/cash", {
        method: "POST",
        body: JSON.stringify({
          productId: selectedProduct.id,
          quantity,
          useCreditCoupon: breakdown.couponEligible
        })
      });
      order = orderResult.order || null;

      if (orderResult.user?.credits != null) {
        currentUser = {
          ...(currentUser || {}),
          credits: Number(orderResult.user.credits)
        };
      }
      refreshCouponUi();
    }

    const humanMessage = buildCheckoutMessage({
      buyerName,
      buyerEmail,
      quantity,
      notes,
      orderId: order?.id,
      breakdown
    });

    const ticketResult = await openHumanSupportTicket({
      name: buyerName,
      orderNumber: order?.id ? String(order.id) : "PRE-CHECKOUT",
      message: humanMessage
    });

    if (paymentChannel === "WHATSAPP") {
      openWhatsappCheckout(humanMessage);
      setFeedback(
        "checkoutFeedback",
        `Pedido enviado. Ticket humano #${ticketResult.ticketId || "-"} criado e WhatsApp aberto para finalizar.`,
        "success"
      );
      return;
    }

    if (order?.id) {
      setFeedback(
        "checkoutFeedback",
        `Pedido #${order.id} criado e encaminhado ao atendimento humano (ticket #${ticketResult.ticketId || "-"}) para finalizar pagamento no chat.`,
        "success"
      );
    } else {
      setFeedback(
        "checkoutFeedback",
        `Pré-checkout enviado (ticket #${ticketResult.ticketId || "-"}) para atendimento humano. Faça login para registrar pedido oficial e receber créditos.`,
        "success"
      );
    }
  } catch (error) {
    setFeedback("checkoutFeedback", error.message, "error");
  }
}

function bindEvents() {
  document.getElementById("checkoutForm")?.addEventListener("submit", submitCheckout);
  document.querySelector("#checkoutForm input[name='quantity']")?.addEventListener("input", updateSummary);
  document.getElementById("useCreditCoupon")?.addEventListener("change", updateSummary);
}

async function bootstrap() {
  const year = document.getElementById("year");
  if (year) {
    year.textContent = String(new Date().getFullYear());
  }

  bindEvents();
  revealAll();
  refreshCouponUi();
  await loadCurrentUser();
  await loadProduct();
}

bootstrap();
