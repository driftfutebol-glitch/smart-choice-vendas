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

let authToken = localStorage.getItem("scv_token") || "";
let currentUser = null;
let selectedBrand = "";

const yearEl = document.getElementById("year");
if (yearEl) {
  yearEl.textContent = String(new Date().getFullYear());
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

function appendDeliveryHint(message, delivery) {
  if (!delivery || delivery.sent) {
    return message;
  }

  if (delivery.hint) {
    return `${message} ${delivery.hint}`;
  }

  return message;
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

function setupReveal() {
  const items = document.querySelectorAll(".reveal");
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

function renderProducts(products) {
  const grid = document.getElementById("productsGrid");
  if (!grid) return;

  if (!products.length) {
    grid.innerHTML = "<p>Nenhum produto encontrado.</p>";
    return;
  }

  grid.innerHTML = products
    .map((product) => {
      const beginnerText = product.beginner_eligible
        ? `<span class="price-beginner">Desconto iniciante ativo: R$ ${Number(product.beginner_price).toFixed(2)}</span>`
        : (product.is_beginner_offer ? '<span class="price-beginner">Oferta para membros novos disponível</span>' : "");

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
            <span class="price-main">R$ ${Number(product.display_price).toFixed(2)}</span>
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

async function loadProducts() {
  const onlyBeginner = document.getElementById("onlyBeginner")?.checked ? "1" : "0";
  const brandQuery = selectedBrand ? `&brand=${encodeURIComponent(selectedBrand)}` : "";

  try {
    const result = await apiRequest(`/products?onlyBeginner=${onlyBeginner}${brandQuery}`);
    renderProducts(result.products || []);
  } catch (error) {
    const grid = document.getElementById("productsGrid");
    if (grid) {
      grid.innerHTML = `<p>Erro ao carregar produtos: ${error.message}</p>`;
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
    if (userEl) userEl.textContent = currentUser.name;
    if (creditsEl) creditsEl.textContent = String(currentUser.credits);

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
    if (result.dev_code) {
      message += ` Código (modo dev): ${result.dev_code}`;
      if (codeInput) {
        codeInput.value = result.dev_code;
      }
    }

    message = appendDeliveryHint(message, result.delivery);
    setFeedback("registerSingleFeedback", message, result.delivery?.sent || result.dev_code ? "success" : "error");
  } catch (error) {
    setFeedback("registerSingleFeedback", error.message, "error");
  } finally {
    if (button) button.disabled = false;
  }
}

async function registerSingleSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form));
  const submitBtn = form.querySelector("button[type='submit']");

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
  const apiParam = encodeURIComponent(API_BASE);
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
    }
  } catch (error) {
    setFeedback("supportPopupFeedback", error.message, "error");
  }
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
  document.getElementById("loginForm")?.addEventListener("submit", login);
  document.getElementById("triageForm")?.addEventListener("submit", submitTriage);
  document.getElementById("supportPopupForm")?.addEventListener("submit", submitSupportPopup);
  document.getElementById("partnerForm")?.addEventListener("submit", submitPartner);

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

  await trackVisit();
  await loadProducts();

  if (authToken) {
    await loadWallet();
  }
}

bootstrap();
