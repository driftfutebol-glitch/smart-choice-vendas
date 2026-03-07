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

let adminToken = localStorage.getItem("scv_admin_token") || "";
let currentAdmin = null;
let permissionsCatalog = [];
let usersCache = [];
let productsCache = [];
let ordersCache = [];
let ticketsCache = [];
let logsCache = [];
let analyticsCache = { visitors: [], signups: [] };
let autoRefreshInterval = null;

function buildAutoPhoneTag(seed = "") {
  const safeSeed = String(seed).replace(/[^a-z0-9]/gi, "").toLowerCase().slice(-6) || "admin";
  const timePart = Date.now().toString(36);
  const randPart = Math.random().toString(36).slice(2, 8);
  return `AUTO-${timePart}-${randPart}-${safeSeed}`;
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

function showSectionMessage(targetId, message) {
  const target = document.getElementById(targetId);
  if (target) {
    target.innerHTML = `<p>${message}</p>`;
  }
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("pt-BR");
}

function hasPermission(permission) {
  if (!currentAdmin) return false;
  if (currentAdmin.is_owner) return true;
  return (currentAdmin.permissions || []).includes(permission);
}

async function apiRequest(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (adminToken) {
    headers.Authorization = `Bearer ${adminToken}`;
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers
    });
  } catch (_error) {
    throw new Error("Servidor offline. Verifique se o backend está ativo.");
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Erro inesperado");
  }
  return data;
}

function renderTable(headers, rowsHtml) {
  return `
    <table>
      <thead>
        <tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${rowsHtml || `<tr><td colspan="${headers.length}">Sem dados.</td></tr>`}
      </tbody>
    </table>
  `;
}

function showApp() {
  document.getElementById("adminApp")?.classList.remove("hidden");
}

function hideApp() {
  document.getElementById("adminApp")?.classList.add("hidden");
}

function updateAdminHeader() {
  if (!currentAdmin) return;

  const identity = document.getElementById("adminIdentity");
  const summary = document.getElementById("adminPermissionSummary");

  if (identity) {
    identity.textContent = `Conectado: ${currentAdmin.name} | ${currentAdmin.role}${currentAdmin.is_owner ? " | OWNER" : ""}`;
  }

  if (summary) {
    const perms = currentAdmin.is_owner
      ? "Acesso total de owner"
      : `${(currentAdmin.permissions || []).length} permissões ativas`;
    summary.textContent = perms;
  }
}

function applyPermissionGates() {
  const nodes = document.querySelectorAll("[data-permission-gate]");
  nodes.forEach((node) => {
    const permission = node.getAttribute("data-permission-gate");
    const allowed = hasPermission(permission);
    node.classList.toggle("blocked-section", !allowed);
    node.querySelectorAll("input,select,textarea,button").forEach((el) => {
      el.disabled = !allowed;
    });
  });
}

function openTab(tabId) {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-tab-target") === tabId);
  });

  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("hidden", panel.id !== tabId);
  });
}

function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.getAttribute("data-tab-target");
      if (target) {
        openTab(target);
      }
    });
  });
}

function setAutoRefresh(enabled) {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }

  if (enabled) {
    autoRefreshInterval = setInterval(() => {
      refreshAll().catch(() => {});
    }, 60000);
  }
}

function renderTrend(listId, rows) {
  const target = document.getElementById(listId);
  if (!target) return;

  if (!rows || rows.length === 0) {
    target.innerHTML = "<li>Sem dados.</li>";
    return;
  }

  target.innerHTML = rows
    .slice(-14)
    .map((row) => `<li><span>${row.day}</span><strong>${row.total}</strong></li>`)
    .join("");
}

function renderPermissionOptions(selected = []) {
  const target = document.getElementById("permissionOptions");
  if (!target) return;

  if (!permissionsCatalog.length) {
    target.innerHTML = "<p>Sem catálogo de permissões.</p>";
    return;
  }

  const selectedSet = new Set(selected);
  target.innerHTML = permissionsCatalog
    .map((permission) => {
      const checked = selectedSet.has(permission) ? "checked" : "";
      return `
        <label class="perm-item">
          <input type="checkbox" value="${permission}" ${checked} />
          <span>${permission}</span>
        </label>
      `;
    })
    .join("");
}

function getSelectedPermissionsFromForm() {
  const container = document.getElementById("permissionOptions");
  if (!container) return [];

  return [...container.querySelectorAll("input[type='checkbox']:checked")]
    .map((input) => input.value)
    .filter(Boolean);
}

async function loadAdminContext() {
  const result = await apiRequest("/admin/me");
  currentAdmin = result.user;
  updateAdminHeader();
}

async function loadPermissionsCatalog() {
  if (!hasPermission("USERS_PERMISSIONS")) {
    permissionsCatalog = [];
    renderPermissionOptions([]);
    return;
  }

  const result = await apiRequest("/admin/permissions/catalog");
  permissionsCatalog = result.permissions || [];
  renderPermissionOptions([]);
}

async function loadAnalytics() {
  if (!hasPermission("ANALYTICS_VIEW")) {
    return;
  }

  const data = await apiRequest("/admin/analytics");
  analyticsCache = {
    visitors: data.visitors || [],
    signups: data.signups || []
  };

  const totalVisitors = analyticsCache.visitors.reduce((acc, item) => acc + Number(item.total || 0), 0);
  document.getElementById("kpiVisitors").textContent = String(totalVisitors);
  document.getElementById("kpiSales").textContent = formatCurrency(data.total_sales_cash || 0);
  document.getElementById("kpiOrders").textContent = String(data.total_orders_approved || 0);

  renderTrend("visitorsTrend", analyticsCache.visitors);
  renderTrend("signupsTrend", analyticsCache.signups);
}

function formatPermissions(permissions) {
  if (!permissions || permissions.length === 0) return "-";
  return permissions.join(", ");
}

function renderUsers() {
  const target = document.getElementById("usersList");
  if (!target) return;

  if (!hasPermission("USERS_VIEW")) {
    target.innerHTML = "<p>Sem permissão para visualizar usuários.</p>";
    return;
  }

  const term = normalizeText(document.getElementById("usersSearchInput")?.value);
  const onlyAdmins = Boolean(document.getElementById("onlyAdminsToggle")?.checked);
  const onlyBanned = Boolean(document.getElementById("onlyBannedToggle")?.checked);

  const rows = usersCache
    .filter((user) => {
      const searchable = normalizeText(`${user.id} ${user.name} ${user.email} ${user.phone}`);
      if (term && !searchable.includes(term)) return false;
      if (onlyAdmins && user.role !== "ADMIN") return false;
      if (onlyBanned && !user.is_banned) return false;
      return true;
    })
    .map((user) => {
      const roleToggle = user.role === "ADMIN" ? "Remover admin" : "Promover admin";
      const banToggle = user.is_banned ? "Desbanir" : "Banir";
      const partnerToggle = user.partner_active ? "Remover parceiro" : "Ativar parceiro";
      const ownerTag = Number(user.is_owner) === 1 ? "OWNER" : "";

      const actions = [];
      if (hasPermission("USERS_ROLE")) {
        actions.push(`<button data-action="toggle-role" data-id="${user.id}" data-role="${user.role}">${roleToggle}</button>`);
      }
      if (hasPermission("USERS_BAN")) {
        actions.push(`<button data-action="toggle-ban" data-id="${user.id}" data-banned="${user.is_banned}">${banToggle}</button>`);
      }
      if (hasPermission("PARTNER_MANAGE")) {
        actions.push(`<button data-action="toggle-partner" data-id="${user.id}" data-partner="${user.partner_active}">${partnerToggle}</button>`);
      }
      if (user.role === "ADMIN" && hasPermission("USERS_PERMISSIONS") && Number(user.is_owner) !== 1) {
        actions.push(`<button data-action="load-user-permissions" data-id="${user.id}">Permissões</button>`);
      }
      if (hasPermission("USERS_DELETE") && Number(user.is_owner) !== 1) {
        actions.push(`<button class="danger" data-action="remove-user" data-id="${user.id}">Remover</button>`);
      }

      return `
        <tr>
          <td>${user.id}</td>
          <td>${user.name}</td>
          <td>${user.email}</td>
          <td>${user.phone || "-"}</td>
          <td>${user.role} ${ownerTag}</td>
          <td>${user.status_usuario}</td>
          <td>${user.credits}</td>
          <td>${user.is_banned ? "Sim" : "Não"}</td>
          <td>${formatPermissions(user.permissions)}</td>
          <td class="actions">${actions.join("") || "-"}</td>
        </tr>
      `;
    })
    .join("");

  target.innerHTML = renderTable(
    ["ID", "Nome", "Email", "Telefone", "Role", "Status", "Créditos", "Banido", "Permissões", "Ações"],
    rows
  );
}

async function loadUsers() {
  if (!hasPermission("USERS_VIEW")) {
    showSectionMessage("usersList", "Sem permissão para visualizar usuários.");
    return;
  }

  const result = await apiRequest("/admin/users");
  usersCache = result.users || [];
  renderUsers();
}

function fillProductForm(product) {
  const form = document.getElementById("productCreateForm");
  if (!form || !product) return;

  form.querySelector("input[name='productId']").value = String(product.id || "");
  form.querySelector("input[name='title']").value = product.title || "";
  form.querySelector("input[name='brand']").value = product.brand || "";
  form.querySelector("select[name='category']").value = product.category || "CELULAR";
  form.querySelector("input[name='description']").value = product.description || "";
  form.querySelector("input[name='technical_specs']").value = product.technical_specs || "";
  form.querySelector("input[name='price_cash']").value = Number(product.price_cash || 0);
  form.querySelector("input[name='price_credits']").value = Number(product.price_credits || 0);
  form.querySelector("input[name='beginner_price']").value = product.beginner_price == null ? "" : Number(product.beginner_price);
  form.querySelector("input[name='image_url']").value = product.image_url || "";
  form.querySelector("input[name='video_url']").value = product.video_url || "";
  form.querySelector("input[name='stock']").value = Number(product.stock || 0);
  form.querySelector("input[name='is_beginner_offer']").checked = Boolean(product.is_beginner_offer);

  const submitBtn = document.getElementById("productSubmitBtn");
  if (submitBtn) {
    submitBtn.textContent = `Salvar edição #${product.id}`;
  }
}

function resetProductForm() {
  const form = document.getElementById("productCreateForm");
  if (!form) return;
  form.reset();
  form.querySelector("input[name='productId']").value = "";

  const submitBtn = document.getElementById("productSubmitBtn");
  if (submitBtn) {
    submitBtn.textContent = "Salvar produto";
  }
}

function renderProducts() {
  const target = document.getElementById("productsList");
  if (!target) return;

  if (!hasPermission("PRODUCTS_MANAGE")) {
    target.innerHTML = "<p>Sem permissão para visualizar produtos no admin.</p>";
    return;
  }

  const term = normalizeText(document.getElementById("productsSearchInput")?.value);
  const onlyActive = Boolean(document.getElementById("onlyActiveProductsToggle")?.checked);

  const rows = productsCache
    .filter((item) => {
      if (onlyActive && !item.is_active) return false;
      const searchable = normalizeText(`${item.id} ${item.title} ${item.brand} ${item.category}`);
      return !term || searchable.includes(term);
    })
    .map((item) => {
      const actions = [];
      actions.push(`<button data-action="edit-product" data-id="${item.id}">Editar</button>`);
      if (item.is_active) {
        actions.push(`<button class="danger" data-action="disable-product" data-id="${item.id}">Desativar</button>`);
      }
      if (hasPermission("DISCOUNTS_MANAGE")) {
        actions.push(`<button data-action="load-discount-product" data-id="${item.id}">Aplicar desconto</button>`);
      }

      return `
        <tr>
          <td>${item.id}</td>
          <td>${item.title}</td>
          <td>${item.brand}</td>
          <td>${item.category}</td>
          <td>${formatCurrency(item.price_cash)}</td>
          <td>${item.price_credits}</td>
          <td>${item.discount_percent || 0}%</td>
          <td>${item.stock}</td>
          <td>${item.is_active ? "Ativo" : "Inativo"}</td>
          <td class="actions">${actions.join("")}</td>
        </tr>
      `;
    })
    .join("");

  target.innerHTML = renderTable(
    ["ID", "Título", "Marca", "Categoria", "Preço R$", "Créditos", "Desconto", "Estoque", "Status", "Ações"],
    rows
  );
}

async function loadProducts() {
  if (!hasPermission("PRODUCTS_MANAGE")) {
    showSectionMessage("productsList", "Sem permissão para visualizar produtos.");
    return;
  }

  try {
    const result = await apiRequest("/admin/products");
    productsCache = result.products || [];
  } catch (_error) {
    // Fallback para backend antigo sem rota /admin/products.
    const result = await apiRequest("/products?onlyBeginner=0");
    productsCache = (result.products || []).map((item) => ({
      ...item,
      is_active: 1
    }));
  }

  renderProducts();
}

function renderOrders() {
  const target = document.getElementById("ordersList");
  if (!target) return;

  if (!hasPermission("ORDERS_MANAGE")) {
    target.innerHTML = "<p>Sem permissão para visualizar pedidos.</p>";
    return;
  }

  const rows = ordersCache
    .map((order) => {
      const approveButton = order.status === "APPROVED"
        ? "<span>Aprovado</span>"
        : `<button data-action="approve-order" data-id="${order.id}">Aprovar</button>`;

      return `
        <tr>
          <td>${order.id}</td>
          <td>${order.user_name}</td>
          <td>${order.product_title}</td>
          <td>${order.quantity}</td>
          <td>${formatCurrency(order.total_cash)}</td>
          <td>${order.credit_reward}</td>
          <td>${order.status}</td>
          <td>${formatDate(order.created_at)}</td>
          <td class="actions">${approveButton}</td>
        </tr>
      `;
    })
    .join("");

  target.innerHTML = renderTable(
    ["Pedido", "Cliente", "Produto", "Qtd", "Valor", "Prêmio crédito", "Status", "Criado em", "Ação"],
    rows
  );
}

async function loadOrders() {
  if (!hasPermission("ORDERS_MANAGE")) {
    showSectionMessage("ordersList", "Sem permissão para visualizar pedidos.");
    return;
  }

  const result = await apiRequest("/admin/orders");
  ordersCache = result.orders || [];
  renderOrders();
}

function renderTickets() {
  const target = document.getElementById("ticketsList");
  if (!target) return;

  if (!hasPermission("TICKETS_MANAGE")) {
    target.innerHTML = "<p>Sem permissão para visualizar tickets.</p>";
    return;
  }

  const onlyOpen = Boolean(document.getElementById("onlyOpenTicketsToggle")?.checked);
  const rows = ticketsCache
    .filter((ticket) => (onlyOpen ? ticket.status !== "ANSWERED" : true))
    .map((ticket) => {
      const responseField = ticket.status === "ANSWERED"
        ? `<p><strong>Resposta:</strong> ${ticket.admin_response || "-"}</p>`
        : `
          <div class="ticket-response-box">
            <textarea data-ticket-response="${ticket.id}" rows="2" placeholder="Digite a resposta para o cliente"></textarea>
            <button data-action="respond-ticket" data-id="${ticket.id}">Responder ticket</button>
          </div>
        `;

      return `
        <tr>
          <td>${ticket.id}</td>
          <td>${ticket.name}</td>
          <td>${ticket.order_number || "-"}</td>
          <td>${ticket.subject}</td>
          <td>${ticket.message}</td>
          <td>${ticket.status}</td>
          <td>
            ${responseField}
          </td>
        </tr>
      `;
    })
    .join("");

  target.innerHTML = renderTable(
    ["Ticket", "Cliente", "Pedido", "Assunto", "Mensagem", "Status", "Ação"],
    rows
  );
}

async function loadTickets() {
  if (!hasPermission("TICKETS_MANAGE")) {
    showSectionMessage("ticketsList", "Sem permissão para visualizar tickets.");
    return;
  }

  const result = await apiRequest("/admin/tickets");
  ticketsCache = result.tickets || [];
  renderTickets();
}

function renderLogs() {
  const target = document.getElementById("logsList");
  if (!target) return;

  if (!hasPermission("LOGS_VIEW")) {
    target.innerHTML = "<p>Sem permissão para visualizar logs.</p>";
    return;
  }

  const term = normalizeText(document.getElementById("logsSearchInput")?.value);
  const rows = logsCache
    .filter((log) => {
      if (!term) return true;
      const searchable = normalizeText(`${log.action} ${log.details || ""} ${log.actor_name || ""}`);
      return searchable.includes(term);
    })
    .slice(0, 300)
    .map((log) => `
      <tr>
        <td>${log.id}</td>
        <td>${log.actor_name || "Sistema"}</td>
        <td>${log.action}</td>
        <td>${log.details || "-"}</td>
        <td>${formatDate(log.created_at)}</td>
      </tr>
    `)
    .join("");

  target.innerHTML = renderTable(
    ["ID", "Ator", "Ação", "Detalhes", "Data"],
    rows
  );
}

async function loadLogs() {
  if (!hasPermission("LOGS_VIEW")) {
    showSectionMessage("logsList", "Sem permissão para visualizar logs.");
    return;
  }

  const result = await apiRequest("/admin/logs");
  logsCache = result.logs || [];
  renderLogs();
}

async function refreshAll() {
  await Promise.all([loadAnalytics(), loadUsers(), loadProducts(), loadOrders(), loadTickets(), loadLogs()]);
}

function loadPermissionsFromUser(userId) {
  const target = usersCache.find((item) => Number(item.id) === Number(userId));
  if (!target) {
    setFeedback("permissionsFeedback", "Admin não encontrado na lista atual.", "error");
    return;
  }

  const input = document.querySelector("#permissionsForm input[name='targetAdminId']");
  if (input) {
    input.value = String(userId);
  }

  renderPermissionOptions(target.permissions || []);
  setFeedback("permissionsFeedback", `Permissões carregadas para ${target.name}.`, "success");
}

async function handleAdminLogin(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));

  try {
    const result = await apiRequest("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        identifier: data.identifier,
        password: data.password
      })
    });

    if (!result.user || result.user.role !== "ADMIN") {
      throw new Error("Acesso negado. Usuário não é admin.");
    }

    adminToken = result.token;
    localStorage.setItem("scv_admin_token", adminToken);

    await loadAdminContext();
    await loadPermissionsCatalog();

    showApp();
    applyPermissionGates();
    openTab("tab-dashboard");
    await refreshAll();
    setFeedback("adminLoginFeedback", "Login admin realizado com sucesso.", "success");
  } catch (error) {
    setFeedback("adminLoginFeedback", error.message, "error");
  }
}

function logoutAdmin() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }

  localStorage.removeItem("scv_admin_token");
  adminToken = "";
  currentAdmin = null;
  hideApp();
  window.location.reload();
}

async function handleCreateUser(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget));

  try {
    const effectivePhone = String(payload.phone || "").trim() || buildAutoPhoneTag(payload.email);

    await apiRequest("/admin/users", {
      method: "POST",
      body: JSON.stringify({
        name: payload.name,
        email: payload.email,
        phone: effectivePhone,
        password: payload.password,
        role: payload.role,
        status_usuario: payload.status_usuario,
        initialCredits: Number(payload.initialCredits || 0)
      })
    });

    setFeedback("createUserFeedback", "Usuário criado com sucesso.", "success");
    event.currentTarget.reset();
    await refreshAll();
  } catch (error) {
    setFeedback("createUserFeedback", error.message, "error");
  }
}

async function handleSavePermissions(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const targetAdminId = Number(new FormData(form).get("targetAdminId"));
  const selectedPermissions = getSelectedPermissionsFromForm();

  if (!targetAdminId) {
    setFeedback("permissionsFeedback", "Informe o ID do admin.", "error");
    return;
  }

  try {
    await apiRequest(`/admin/users/${targetAdminId}/permissions`, {
      method: "PUT",
      body: JSON.stringify({ permissions: selectedPermissions })
    });

    setFeedback("permissionsFeedback", "Permissões atualizadas com sucesso.", "success");
    await refreshAll();
  } catch (error) {
    setFeedback("permissionsFeedback", error.message, "error");
  }
}

async function handleCreditAdjust(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget));

  try {
    await apiRequest("/admin/credits/adjust", {
      method: "POST",
      body: JSON.stringify({
        userId: Number(payload.userId),
        delta: Number(payload.delta),
        reason: payload.reason,
        masterKey: payload.masterKey
      })
    });

    setFeedback("creditFeedback", "Créditos atualizados com sucesso.", "success");
    event.currentTarget.reset();
    await refreshAll();
  } catch (error) {
    setFeedback("creditFeedback", error.message, "error");
  }
}

async function handlePasswordReset(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget));

  try {
    await apiRequest(`/admin/users/${Number(payload.userId)}/password`, {
      method: "POST",
      body: JSON.stringify({
        newPassword: payload.newPassword,
        masterKey: payload.masterKey
      })
    });

    setFeedback("passwordResetFeedback", "Senha redefinida com sucesso.", "success");
    event.currentTarget.reset();
  } catch (error) {
    setFeedback("passwordResetFeedback", error.message, "error");
  }
}

async function handleNotification(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget));

  try {
    await apiRequest("/admin/notifications/send", {
      method: "POST",
      body: JSON.stringify({
        userId: payload.userId ? Number(payload.userId) : undefined,
        title: payload.title || "Aviso",
        message: payload.message
      })
    });

    setFeedback("notificationFeedback", "Notificação enviada com sucesso.", "success");
    event.currentTarget.reset();
  } catch (error) {
    setFeedback("notificationFeedback", error.message, "error");
  }
}

async function handleDiscount(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);

  try {
    await apiRequest("/admin/discounts", {
      method: "POST",
      body: JSON.stringify({
        productId: Number(formData.get("productId")),
        discountPercent: Number(formData.get("discountPercent")),
        beginnerOnly: formData.get("beginnerOnly") === "on"
      })
    });

    setFeedback("discountFeedback", "Desconto atualizado com sucesso.", "success");
    await refreshAll();
  } catch (error) {
    setFeedback("discountFeedback", error.message, "error");
  }
}

async function clearDiscount() {
  const form = document.getElementById("discountForm");
  if (!form) return;

  const productId = Number(new FormData(form).get("productId"));
  if (!productId) {
    setFeedback("discountFeedback", "Informe o ID do produto para remover desconto.", "error");
    return;
  }

  try {
    await apiRequest("/admin/discounts", {
      method: "POST",
      body: JSON.stringify({
        productId,
        discountPercent: 0,
        beginnerOnly: false
      })
    });

    setFeedback("discountFeedback", "Desconto removido com sucesso.", "success");
    await refreshAll();
  } catch (error) {
    setFeedback("discountFeedback", error.message, "error");
  }
}

function productPayloadFromForm(formData) {
  return {
    title: String(formData.get("title") || "").trim(),
    brand: String(formData.get("brand") || "").trim(),
    category: String(formData.get("category") || "CELULAR"),
    description: String(formData.get("description") || "").trim(),
    technical_specs: String(formData.get("technical_specs") || "").trim(),
    price_cash: Number(formData.get("price_cash") || 0),
    price_credits: Number(formData.get("price_credits") || 0),
    beginner_price: formData.get("beginner_price") ? Number(formData.get("beginner_price")) : null,
    image_url: String(formData.get("image_url") || "").trim(),
    video_url: String(formData.get("video_url") || "").trim(),
    stock: Number(formData.get("stock") || 0),
    is_beginner_offer: formData.get("is_beginner_offer") === "on"
  };
}

async function handleProductSave(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const payload = productPayloadFromForm(formData);
  const productId = Number(formData.get("productId"));

  try {
    if (productId) {
      await apiRequest(`/admin/products/${productId}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      setFeedback("productFeedback", `Produto #${productId} atualizado.`, "success");
    } else {
      await apiRequest("/admin/products", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setFeedback("productFeedback", "Produto criado com sucesso.", "success");
    }

    resetProductForm();
    await refreshAll();
  } catch (error) {
    setFeedback("productFeedback", error.message, "error");
  }
}

async function updateUser(id, payload) {
  await apiRequest(`/admin/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

function bindFilters() {
  document.getElementById("usersSearchInput")?.addEventListener("input", renderUsers);
  document.getElementById("onlyAdminsToggle")?.addEventListener("change", renderUsers);
  document.getElementById("onlyBannedToggle")?.addEventListener("change", renderUsers);
  document.getElementById("productsSearchInput")?.addEventListener("input", renderProducts);
  document.getElementById("onlyActiveProductsToggle")?.addEventListener("change", renderProducts);
  document.getElementById("onlyOpenTicketsToggle")?.addEventListener("change", renderTickets);
  document.getElementById("logsSearchInput")?.addEventListener("input", renderLogs);
}

function bindActions() {
  document.getElementById("adminLoginForm")?.addEventListener("submit", handleAdminLogin);
  document.getElementById("createUserForm")?.addEventListener("submit", handleCreateUser);
  document.getElementById("permissionsForm")?.addEventListener("submit", handleSavePermissions);
  document.getElementById("creditForm")?.addEventListener("submit", handleCreditAdjust);
  document.getElementById("passwordResetForm")?.addEventListener("submit", handlePasswordReset);
  document.getElementById("notificationForm")?.addEventListener("submit", handleNotification);
  document.getElementById("discountForm")?.addEventListener("submit", handleDiscount);
  document.getElementById("productCreateForm")?.addEventListener("submit", handleProductSave);
  document.getElementById("clearDiscountBtn")?.addEventListener("click", clearDiscount);
  document.getElementById("cancelProductEditBtn")?.addEventListener("click", resetProductForm);

  document.getElementById("refreshAllBtn")?.addEventListener("click", async () => {
    await refreshAll();
  });

  document.getElementById("logoutAdminBtn")?.addEventListener("click", logoutAdmin);
  document.getElementById("autoRefreshToggle")?.addEventListener("change", (event) => {
    setAutoRefresh(Boolean(event.target.checked));
  });

  document.getElementById("loadAdminPermissionsBtn")?.addEventListener("click", () => {
    const input = document.querySelector("#permissionsForm input[name='targetAdminId']");
    if (!input || !input.value) {
      setFeedback("permissionsFeedback", "Informe o ID do admin para carregar.", "error");
      return;
    }
    loadPermissionsFromUser(Number(input.value));
  });

  document.body.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const action = button.getAttribute("data-action");
    const id = Number(button.getAttribute("data-id"));
    if (!action || !id) return;

    try {
      if (action === "approve-order") {
        await apiRequest(`/admin/orders/${id}/approve`, { method: "POST" });
      }

      if (action === "respond-ticket") {
        const textarea = document.querySelector(`textarea[data-ticket-response='${id}']`);
        const response = String(textarea?.value || "").trim();
        if (!response) {
          throw new Error("Digite uma resposta para o ticket.");
        }

        await apiRequest(`/admin/tickets/${id}/respond`, {
          method: "POST",
          body: JSON.stringify({ response })
        });
      }

      if (action === "toggle-role") {
        const current = button.getAttribute("data-role");
        await updateUser(id, { role: current === "ADMIN" ? "USER" : "ADMIN" });
      }

      if (action === "toggle-ban") {
        const current = Number(button.getAttribute("data-banned"));
        await updateUser(id, { is_banned: current ? false : true });
      }

      if (action === "toggle-partner") {
        const current = Number(button.getAttribute("data-partner"));
        await updateUser(id, { partner_active: current ? false : true });
      }

      if (action === "remove-user") {
        const confirmed = window.confirm("Confirmar remoção definitiva do usuário?");
        if (!confirmed) return;
        await apiRequest(`/admin/users/${id}`, { method: "DELETE" });
      }

      if (action === "load-user-permissions") {
        loadPermissionsFromUser(id);
        openTab("tab-users");
        return;
      }

      if (action === "edit-product") {
        const product = productsCache.find((item) => Number(item.id) === id);
        if (product) {
          fillProductForm(product);
          openTab("tab-products");
          setFeedback("productFeedback", `Editando produto #${id}.`, "success");
        }
        return;
      }

      if (action === "disable-product") {
        const confirmed = window.confirm("Desativar este produto da vitrine?");
        if (!confirmed) return;
        await apiRequest(`/admin/products/${id}`, { method: "DELETE" });
      }

      if (action === "load-discount-product") {
        const discountForm = document.getElementById("discountForm");
        if (discountForm) {
          discountForm.querySelector("input[name='productId']").value = String(id);
        }
        openTab("tab-products");
        return;
      }

      await refreshAll();
    } catch (error) {
      alert(error.message);
    }
  });
}

async function bootstrap() {
  setupTabs();
  bindActions();
  bindFilters();

  if (!adminToken) {
    return;
  }

  try {
    await loadAdminContext();
    await loadPermissionsCatalog();
    showApp();
    applyPermissionGates();
    openTab("tab-dashboard");
    await refreshAll();
  } catch (_error) {
    localStorage.removeItem("scv_admin_token");
    adminToken = "";
    currentAdmin = null;
    hideApp();
  }
}

bootstrap();
