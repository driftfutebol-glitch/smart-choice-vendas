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
const params = new URLSearchParams(window.location.search);
const selectedProductId = Number(params.get("productId") || 0);

let authToken = localStorage.getItem("scv_token") || "";
let selectedProduct = null;
let currentUser = null;

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

function updateSummary() {
  if (!selectedProduct) return;

  const qtyInput = document.querySelector("#checkoutForm input[name='quantity']");
  const quantity = clampQuantity(qtyInput?.value || 1);
  if (qtyInput) {
    qtyInput.value = String(quantity);
  }

  const subtotal = Number(selectedProduct.display_price || selectedProduct.price_cash || 0) * quantity;
  const reward = Math.max(10, Math.round(subtotal / 100));

  const subtotalEl = document.getElementById("summarySubtotal");
  const rewardEl = document.getElementById("summaryReward");
  if (subtotalEl) subtotalEl.textContent = formatMoney(subtotal);
  if (rewardEl) rewardEl.textContent = `${reward} créditos`;
}

function renderProduct(product) {
  const card = document.getElementById("checkoutProductCard");
  if (!card) return;

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
      <p class="checkout-price">${formatMoney(product.display_price || product.price_cash)}</p>
      <small>Preço em créditos: ${product.price_credits} créditos</small>
    </div>
  `;
}

function openWhatsappCheckout(message) {
  const encoded = encodeURIComponent(message);
  const url = `https://wa.me/${STORE_WHATSAPP}?text=${encoded}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

function buildCheckoutMessage({ buyerName, buyerEmail, quantity, notes, orderId }) {
  const lines = [
    "Olá Smart Choice Vendas, quero finalizar minha compra.",
    orderId ? `Pedido: #${orderId}` : "Pedido: Pré-checkout (sem login)",
    `Cliente: ${buyerName}`,
    `Contato: ${buyerEmail}`,
    `Produto: ${selectedProduct?.title || "-"}`,
    `Marca: ${selectedProduct?.brand || "-"}`,
    `Quantidade: ${quantity}`,
    `Total estimado: ${formatMoney((selectedProduct?.display_price || selectedProduct?.price_cash || 0) * quantity)}`
  ];

  if (notes) {
    lines.push(`Observações: ${notes}`);
  }

  return lines.join("\n");
}

async function loadProduct() {
  if (!selectedProductId) {
    setFeedback("checkoutFeedback", "Produto não identificado. Volte para a loja e selecione novamente.", "error");
    const form = document.getElementById("checkoutForm");
    if (form) {
      form.querySelectorAll("input,select,textarea,button").forEach((el) => {
        el.disabled = true;
      });
    }
    return;
  }

  try {
    const result = await apiRequest("/products?onlyBeginner=0");
    const found = (result.products || []).find((item) => Number(item.id) === selectedProductId);

    if (!found) {
      throw new Error("Produto não encontrado. Ele pode ter sido removido ou desativado.");
    }

    selectedProduct = found;
    renderProduct(found);
    updateSummary();
  } catch (error) {
    setFeedback("checkoutFeedback", error.message, "error");
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
  } catch (_error) {
    localStorage.removeItem("scv_token");
    authToken = "";
    if (status) {
      status.textContent = "Sessão expirada. Faça login novamente na página inicial para registrar pedidos com seu usuário.";
    }
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
  const notes = String(formData.get("notes") || "").trim();

  if (!buyerName || !buyerEmail) {
    setFeedback("checkoutFeedback", "Nome e e-mail são obrigatórios.", "error");
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
          quantity
        })
      });
      order = orderResult.order || null;
    }

    const humanMessage = buildCheckoutMessage({
      buyerName,
      buyerEmail,
      quantity,
      notes,
      orderId: order?.id
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
}

async function bootstrap() {
  const year = document.getElementById("year");
  if (year) {
    year.textContent = String(new Date().getFullYear());
  }

  bindEvents();
  await loadCurrentUser();
  await loadProduct();
}

bootstrap();
