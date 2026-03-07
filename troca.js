function resolveApiBase() {
  const params = new URLSearchParams(window.location.search);
  const apiFromQuery = (params.get("api") || "").trim();
  if (apiFromQuery) {
    localStorage.setItem("scv_api_base", apiFromQuery);
    return apiFromQuery.replace(/\/+$/, "");
  }

  const stored = (localStorage.getItem("scv_api_base") || "").trim();
  if (stored) {
    return stored.replace(/\/+$/, "");
  }

  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  const hostname = window.location.hostname || "localhost";
  return `${protocol}//${hostname}:4000/api`;
}

const API_BASE = resolveApiBase();let token = localStorage.getItem("scv_token") || "";

async function request(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Erro");
  return data;
}

function renderProducts(products) {
  const grid = document.getElementById("productsGrid");
  if (!grid) return;

  grid.innerHTML = products
    .map((product) => `
      <article class="product">
        <img src="${product.image_url || "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=60"}" alt="${product.title}" />
        <h3>${product.title}</h3>
        <p>${product.description}</p>
        <div class="product-meta">
          <span class="tag">${product.brand}</span>
          <span class="tag">${product.price_credits} creditos</span>
        </div>
        <button class="btn btn-primary buy" data-id="${product.id}">Trocar agora</button>
      </article>
    `)
    .join("");
}

async function loadWallet() {
  const feedback = document.getElementById("walletFeedback");
  if (!token) {
    if (feedback) feedback.textContent = "Faca login na pagina inicial para usar esta area.";
    return;
  }

  try {
    const me = await request("/me");
    document.getElementById("walletCredits").textContent = String(me.user.credits);
    document.getElementById("walletUser").textContent = me.user.name;
  } catch (error) {
    if (feedback) feedback.textContent = error.message;
  }
}

async function loadProducts() {
  try {
    const data = await request("/products");
    renderProducts(data.products || []);
  } catch (error) {
    const grid = document.getElementById("productsGrid");
    if (grid) grid.innerHTML = `<p>${error.message}</p>`;
  }
}

async function buy(productId) {
  if (!token) {
    alert("Faca login primeiro.");
    return;
  }

  try {
    await request("/orders/credits/purchase", {
      method: "POST",
      body: JSON.stringify({ productId, quantity: 1 })
    });
    alert("Troca concluida.");
    await loadWallet();
  } catch (error) {
    alert(error.message);
  }
}

function bind() {
  document.getElementById("productsGrid")?.addEventListener("click", async (event) => {
    const button = event.target.closest("button.buy");
    if (!button) return;
    await buy(Number(button.getAttribute("data-id")));
  });
}

async function init() {
  bind();
  await loadWallet();
  await loadProducts();
}

init();
