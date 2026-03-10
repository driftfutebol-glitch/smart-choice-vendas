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
let reviewsCache = [];
let campaignsCache = [];
let stockReportCache = { threshold: 5, out_of_stock: [], low_stock: [] };
let activeTicketChatId = null;
let activeTicketChatStatus = "";
let logsCache = [];
let analyticsCache = { visitors: [], signups: [] };
let autoRefreshInterval = null;
let crmCache = null;

const ORDER_KANBAN_COLUMNS = ["PENDING", "PAID", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"];

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

function isRouteNotFoundError(error) {
  return String(error?.message || "").toLowerCase().includes("rota nao encontrada");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function uniqueSortedValues(list, key) {
  return [...new Set((list || []).map((item) => String(item?.[key] || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
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

function normalizeTicketStatus(status) {
  return String(status || "").trim().toUpperCase();
}

function isFinalTicketStatus(status) {
  return ["ANSWERED", "CLOSED", "RESOLVED"].includes(normalizeTicketStatus(status));
}

function toDateTimeLocalValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const tzOffsetMs = date.getTimezoneOffset() * 60 * 1000;
  const local = new Date(date.getTime() - tzOffsetMs);
  return local.toISOString().slice(0, 16);
}

function parseInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatOrderStatusLabel(status) {
  const map = {
    PENDING: "Pendente",
    PAID: "Pago",
    PROCESSING: "Em separação",
    SHIPPED: "Enviado",
    DELIVERED: "Entregue",
    CANCELLED: "Cancelado"
  };
  return map[String(status || "").toUpperCase()] || String(status || "-");
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
  let activeButton = null;
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    const isActive = btn.getAttribute("data-tab-target") === tabId;
    btn.classList.toggle("active", isActive);
    if (isActive) {
      activeButton = btn;
    }
  });

  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("hidden", panel.id !== tabId);
  });

  const activeModuleLabel = document.getElementById("activeModuleLabel");
  if (activeModuleLabel && activeButton) {
    const titleNode = activeButton.querySelector(".tab-title");
    activeModuleLabel.textContent = titleNode ? titleNode.textContent.trim() : activeButton.textContent.trim();
  }
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

function renderCampaigns() {
  const target = document.getElementById("campaignsList");
  if (!target) return;

  if (!hasPermission("DISCOUNTS_MANAGE")) {
    target.innerHTML = "<p>Sem permissão para visualizar campanhas.</p>";
    return;
  }

  const rows = campaignsCache
    .map((campaign) => {
      const statusBadge = Number(campaign.is_active) === 1
        ? `<span class="badge ok">ATIVA</span>`
        : `<span class="badge warn">INATIVA</span>`;

      const actions = [
        `<button data-action="edit-campaign" data-id="${campaign.id}">Editar</button>`
      ];

      if (Number(campaign.is_active) === 1) {
        actions.push(`<button class="danger" data-action="disable-campaign" data-id="${campaign.id}">Desativar</button>`);
      }

      return `
        <tr>
          <td>${campaign.id}</td>
          <td>${escapeHtml(campaign.name || "-")}</td>
          <td>${parseInteger(campaign.discount_percent, 0)}%</td>
          <td>${parseInteger(campaign.campaign_markup_percent, 0)}%</td>
          <td>${formatDate(campaign.start_at)}</td>
          <td>${formatDate(campaign.end_at)}</td>
          <td>${campaign.priority ?? 0}</td>
          <td>${statusBadge}</td>
          <td class="actions">${actions.join("")}</td>
        </tr>
      `;
    })
    .join("");

  target.innerHTML = renderTable(
    ["ID", "Nome", "Desconto", "Markup", "Início", "Fim", "Prioridade", "Status", "Ações"],
    rows
  );
}

function fillCampaignForm(campaign) {
  const form = document.getElementById("campaignForm");
  if (!form || !campaign) return;

  form.querySelector("input[name='campaignId']").value = String(campaign.id || "");
  form.querySelector("input[name='name']").value = campaign.name || "";
  form.querySelector("input[name='discountPercent']").value = parseInteger(campaign.discount_percent, 0);
  form.querySelector("input[name='markupPercent']").value = parseInteger(campaign.campaign_markup_percent, 0);
  form.querySelector("input[name='startAt']").value = toDateTimeLocalValue(campaign.start_at);
  form.querySelector("input[name='endAt']").value = toDateTimeLocalValue(campaign.end_at);
  form.querySelector("input[name='priority']").value = parseInteger(campaign.priority, 0);
  form.querySelector("input[name='isActive']").checked = Number(campaign.is_active) === 1;
}

function resetCampaignForm() {
  const form = document.getElementById("campaignForm");
  if (!form) return;
  form.reset();
  form.querySelector("input[name='campaignId']").value = "";
}

function campaignPayloadFromForm(formData) {
  return {
    name: String(formData.get("name") || "").trim(),
    discountPercent: parseInteger(formData.get("discountPercent"), 0),
    campaignMarkupPercent: parseInteger(formData.get("markupPercent"), 0),
    startAt: String(formData.get("startAt") || "").trim(),
    endAt: String(formData.get("endAt") || "").trim(),
    priority: parseInteger(formData.get("priority"), 0),
    isActive: formData.get("isActive") === "on"
  };
}

async function loadCampaigns() {
  const targetId = "campaignsList";
  if (!hasPermission("DISCOUNTS_MANAGE")) {
    showSectionMessage(targetId, "Sem permissão para visualizar campanhas.");
    return;
  }

  try {
    const result = await apiRequest("/admin/campaigns");
    campaignsCache = result.campaigns || [];
    renderCampaigns();
  } catch (error) {
    campaignsCache = [];
    renderCampaigns();
    if (isRouteNotFoundError(error)) {
      showSectionMessage(targetId, "Backend sem módulo de campanhas. Faça deploy do backend mais recente.");
      return;
    }
    showSectionMessage(targetId, `Falha ao carregar campanhas: ${error.message}`);
  }
}

async function handleCampaignSave(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const payload = campaignPayloadFromForm(formData);
  const campaignId = parseInteger(formData.get("campaignId"), 0);

  if (!payload.name) {
    setFeedback("campaignFeedback", "Informe o nome da campanha.", "error");
    return;
  }

  if (!payload.startAt || !payload.endAt) {
    setFeedback("campaignFeedback", "Informe as datas de início e fim.", "error");
    return;
  }

  try {
    if (campaignId) {
      await apiRequest(`/admin/campaigns/${campaignId}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      setFeedback("campaignFeedback", `Campanha #${campaignId} atualizada com sucesso.`, "success");
    } else {
      await apiRequest("/admin/campaigns", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setFeedback("campaignFeedback", "Campanha criada com sucesso.", "success");
    }

    resetCampaignForm();
    await loadCampaigns();
  } catch (error) {
    setFeedback("campaignFeedback", error.message, "error");
  }
}

function renderStockReport() {
  const target = document.getElementById("stockReportList");
  if (!target) return;

  if (!hasPermission("ANALYTICS_VIEW")) {
    target.innerHTML = "<p>Sem permissão para visualizar estoque crítico.</p>";
    return;
  }

  const outOfStock = stockReportCache.out_of_stock || [];
  const lowStock = stockReportCache.low_stock || [];
  const merged = [...outOfStock, ...lowStock];

  const rows = merged
    .map((item) => {
      const status = Number(item.stock) <= 0
        ? `<span class="badge warn">Sem estoque</span>`
        : `<span class="badge">Baixo</span>`;

      return `
        <tr>
          <td>${item.id}</td>
          <td>${escapeHtml(item.title || "-")}</td>
          <td>${escapeHtml(item.brand || "-")}</td>
          <td>${escapeHtml(item.category || "-")}</td>
          <td>${item.stock}</td>
          <td>${formatCurrency(item.price_cash || 0)}</td>
          <td>${status}</td>
        </tr>
      `;
    })
    .join("");

  target.innerHTML = renderTable(
    ["ID", "Produto", "Marca", "Categoria", "Estoque", "Preço", "Alerta"],
    rows
  );
}

async function loadStockReport() {
  const targetId = "stockReportList";
  if (!hasPermission("ANALYTICS_VIEW")) {
    showSectionMessage(targetId, "Sem permissão para visualizar estoque crítico.");
    return;
  }

  const thresholdInput = document.getElementById("stockThresholdInput");
  const threshold = Math.max(1, Math.min(100, parseInteger(thresholdInput?.value, 5)));
  if (thresholdInput) {
    thresholdInput.value = String(threshold);
  }

  try {
    const result = await apiRequest(`/admin/reports/stock?threshold=${threshold}`);
    stockReportCache = {
      threshold: parseInteger(result.threshold, threshold),
      out_of_stock: result.out_of_stock || [],
      low_stock: result.low_stock || []
    };
    renderStockReport();
  } catch (error) {
    stockReportCache = { threshold, out_of_stock: [], low_stock: [] };
    renderStockReport();
    if (isRouteNotFoundError(error)) {
      showSectionMessage(targetId, "Backend sem rota de relatório de estoque. Faça deploy do backend atualizado.");
      return;
    }
    showSectionMessage(targetId, `Falha ao carregar estoque crítico: ${error.message}`);
  }
}

function renderCrmOverview() {
  const target = document.getElementById("crmOverview");
  if (!target) return;

  if (!hasPermission("USERS_VIEW")) {
    target.innerHTML = "<p>Sem permissão para visualizar CRM.</p>";
    return;
  }

  if (!crmCache || !crmCache.user) {
    target.innerHTML = "<p>Digite o ID do usuário para carregar o CRM.</p>";
    return;
  }

  const { user, crm } = crmCache;
  const ordersRows = (crm.orders || [])
    .slice(0, 10)
    .map((order) => `
      <tr>
        <td>${order.id}</td>
        <td>${escapeHtml(order.product_title || "-")}</td>
        <td>${formatCurrency(order.total_cash || 0)}</td>
        <td>${formatOrderStatusLabel(order.status)}</td>
        <td>${formatDate(order.created_at)}</td>
      </tr>
    `)
    .join("");

  const transactionsRows = (crm.transactions || [])
    .slice(0, 10)
    .map((tx) => `
      <tr>
        <td>${tx.id}</td>
        <td>${tx.delta}</td>
        <td>${escapeHtml(tx.reason || "-")}</td>
        <td>${formatDate(tx.created_at)}</td>
      </tr>
    `)
    .join("");

  const ticketsRows = (crm.tickets || [])
    .slice(0, 10)
    .map((ticket) => `
      <tr>
        <td>${ticket.id}</td>
        <td>${escapeHtml(ticket.subject || "-")}</td>
        <td>${escapeHtml(ticket.status || "-")}</td>
        <td>${formatDate(ticket.created_at)}</td>
      </tr>
    `)
    .join("");

  const userSummary = `
    <article class="panel">
      <h3>Cliente #${user.id} • ${escapeHtml(user.name || "-")}</h3>
      <p>${escapeHtml(user.email || "-")} • ${escapeHtml(user.phone || "-")}</p>
      <p>Créditos: <strong>${user.credits || 0}</strong> • Status: <strong>${escapeHtml(user.status_usuario || "-")}</strong></p>
      <p>Role: ${escapeHtml(user.role || "USER")} • Parceiro: ${Number(user.partner_active) === 1 ? "Sim" : "Não"} • Banido: ${Number(user.is_banned) === 1 ? "Sim" : "Não"}</p>
      <p>Cadastrado em: ${formatDate(user.created_at)} • Avaliações: ${crm.reviews_total || 0}</p>
    </article>
  `;

  target.innerHTML = `
    <div class="stack">
      ${userSummary}
      <div class="table-wrap">${renderTable(["Pedido", "Produto", "Valor", "Status", "Data"], ordersRows)}</div>
      <div class="table-wrap">${renderTable(["Transação", "Delta", "Motivo", "Data"], transactionsRows)}</div>
      <div class="table-wrap">${renderTable(["Ticket", "Assunto", "Status", "Data"], ticketsRows)}</div>
    </div>
  `;
}

async function loadCrmOverview(userId = null) {
  const targetId = "crmOverview";
  if (!hasPermission("USERS_VIEW")) {
    showSectionMessage(targetId, "Sem permissão para visualizar CRM.");
    return;
  }

  const input = document.getElementById("crmUserIdInput");
  const parsedUserId = Number(userId || input?.value || 0);
  if (!parsedUserId) {
    crmCache = null;
    renderCrmOverview();
    setFeedback("crmFeedback", "Informe o ID do usuário para carregar o CRM.", "error");
    return;
  }

  try {
    const result = await apiRequest(`/admin/users/${parsedUserId}/overview`);
    crmCache = { user: result.user, crm: result.crm || {} };
    setFeedback("crmFeedback", `CRM do usuário #${parsedUserId} carregado.`, "success");
    renderCrmOverview();
  } catch (error) {
    crmCache = null;
    renderCrmOverview();
    if (isRouteNotFoundError(error)) {
      setFeedback("crmFeedback", "Backend sem módulo CRM. Faça deploy do backend atualizado.", "error");
      return;
    }
    setFeedback("crmFeedback", error.message, "error");
  }
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
      if (hasPermission("USERS_VIEW")) {
        actions.push(`<button data-action="open-user-crm" data-id="${user.id}">CRM</button>`);
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
  form.querySelector("input[name='category']").value = product.category || "CELULAR";
  form.querySelector("textarea[name='description']").value = product.description || "";
  form.querySelector("textarea[name='technical_specs']").value = product.technical_specs || "";
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
  form.querySelector("input[name='category']").value = "CELULAR";

  const submitBtn = document.getElementById("productSubmitBtn");
  if (submitBtn) {
    submitBtn.textContent = "Salvar produto";
  }
}

function renderProductQuickStats() {
  const target = document.getElementById("productQuickStats");
  if (!target) return;

  const total = productsCache.length;
  const active = productsCache.filter((item) => Number(item.is_active) === 1).length;
  const promoted = productsCache.filter((item) => Number(item.promoted) === 1).length;
  const categories = uniqueSortedValues(productsCache, "category");

  target.innerHTML = `
    <article><span>Total</span><strong>${total}</strong></article>
    <article><span>Ativos</span><strong>${active}</strong></article>
    <article><span>Promovidos</span><strong>${promoted}</strong></article>
    <article><span>Categorias</span><strong>${categories.length}</strong></article>
  `;
}

function hydrateProductCategorySources() {
  const categories = uniqueSortedValues(productsCache, "category");
  const datalist = document.getElementById("categorySuggestions");
  if (datalist) {
    datalist.innerHTML = categories.map((category) => `<option value="${category}"></option>`).join("");
  }

  const categoryFilter = document.getElementById("productsCategoryFilter");
  if (categoryFilter) {
    const selected = categoryFilter.value;
    categoryFilter.innerHTML = `<option value="">Todas as categorias</option>${categories
      .map((category) => `<option value="${category}">${category}</option>`)
      .join("")}`;
    categoryFilter.value = categories.includes(selected) ? selected : "";
  }

  const brands = uniqueSortedValues(productsCache, "brand");
  const brandFilter = document.getElementById("productsBrandFilter");
  if (brandFilter) {
    const selected = brandFilter.value;
    brandFilter.innerHTML = `<option value="">Todas as marcas</option>${brands
      .map((brand) => `<option value="${brand}">${brand}</option>`)
      .join("")}`;
    brandFilter.value = brands.includes(selected) ? selected : "";
  }
}

function applyQuickCategoryPreset() {
  const form = document.getElementById("productCreateForm");
  if (!form) return;

  const quickBrand = String(document.getElementById("quickBrandSelect")?.value || "").trim();
  const quickCategory = String(document.getElementById("quickCategoryInput")?.value || "").trim();

  if (quickBrand) {
    form.querySelector("input[name='brand']").value = quickBrand;
  }
  if (quickCategory) {
    form.querySelector("input[name='category']").value = quickCategory;
  }
}

function renderProducts() {
  const target = document.getElementById("productsList");
  if (!target) return;

  if (!hasPermission("PRODUCTS_MANAGE")) {
    target.innerHTML = "<p>Sem permissão para visualizar produtos no admin.</p>";
    return;
  }

  hydrateProductCategorySources();
  renderProductQuickStats();

  const term = normalizeText(document.getElementById("productsSearchInput")?.value);
  const onlyActive = Boolean(document.getElementById("onlyActiveProductsToggle")?.checked);
  const onlyPromoted = Boolean(document.getElementById("onlyPromotedProductsToggle")?.checked);
  const brandFilter = String(document.getElementById("productsBrandFilter")?.value || "").trim();
  const categoryFilter = String(document.getElementById("productsCategoryFilter")?.value || "").trim();

  const rows = productsCache
    .filter((item) => {
      if (onlyActive && !item.is_active) return false;
      if (onlyPromoted && !item.promoted) return false;
      if (brandFilter && String(item.brand || "") !== brandFilter) return false;
      if (categoryFilter && String(item.category || "") !== categoryFilter) return false;
      const searchable = normalizeText(`${item.id} ${item.title} ${item.brand} ${item.category}`);
      return !term || searchable.includes(term);
    })
    .map((item) => {
      const actions = [];
      actions.push(`<button data-action="edit-product" data-id="${item.id}">Editar</button>`);
      actions.push(`<button data-action="duplicate-product" data-id="${item.id}">Duplicar</button>`);
      if (item.is_active) {
        actions.push(`<button class="danger" data-action="disable-product" data-id="${item.id}">Desativar</button>`);
      }
      if (hasPermission("DISCOUNTS_MANAGE")) {
        actions.push(`<button data-action="load-discount-product" data-id="${item.id}">Aplicar desconto</button>`);
      }

      const image = item.image_url || "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=300&q=60";
      const promotedBadge = item.promoted ? `<span class="badge ok">PROMO</span>` : `<span class="badge">NORMAL</span>`;
      const statusBadge = item.is_active ? `<span class="badge ok">ATIVO</span>` : `<span class="badge warn">INATIVO</span>`;

      return `
        <tr>
          <td>${item.id}</td>
          <td>
            <div class="product-cell">
              <img class="product-thumb" src="${image}" alt="${item.title}" />
              <div>
                <strong>${item.title}</strong>
                <div>${promotedBadge} ${statusBadge}</div>
              </div>
            </div>
          </td>
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
    ["ID", "Produto", "Marca", "Categoria", "Preço R$", "Créditos", "Desconto", "Estoque", "Status", "Ações"],
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
      const status = String(order.status || "").toUpperCase();
      const actions = [];
      if (status === "PENDING") {
        actions.push(`<button data-action="approve-order" data-id="${order.id}">Aprovar</button>`);
      }
      if (status === "PAID") {
        actions.push(`<button data-action="set-order-status" data-id="${order.id}" data-status="PROCESSING">Separação</button>`);
        actions.push(`<button data-action="set-order-status" data-id="${order.id}" data-status="SHIPPED">Enviar</button>`);
      }
      if (status === "PROCESSING") {
        actions.push(`<button data-action="set-order-status" data-id="${order.id}" data-status="SHIPPED">Marcar enviado</button>`);
      }
      if (status === "SHIPPED") {
        actions.push(`<button data-action="set-order-status" data-id="${order.id}" data-status="DELIVERED">Marcar entregue</button>`);
      }
      if (["PAID", "PROCESSING", "SHIPPED"].includes(status)) {
        actions.push(`<button class="danger" data-action="set-order-status" data-id="${order.id}" data-status="CANCELLED">Cancelar</button>`);
      }

      const actionHtml = actions.length ? actions.join("") : "<span>-</span>";

      return `
        <tr>
          <td>${order.id}</td>
          <td>${order.user_name}</td>
          <td>${order.product_title}</td>
          <td>${order.quantity}</td>
          <td>${formatCurrency(order.total_cash)}</td>
          <td>${order.payment_method || "-"}</td>
          <td>${order.checkout_channel || "-"}</td>
          <td>${order.coupon_discount_percent ? `${order.coupon_discount_percent}%` : "-"}</td>
          <td>${order.credit_reward}</td>
          <td>${formatOrderStatusLabel(order.status)}</td>
          <td>${formatDate(order.created_at)}</td>
          <td class="actions">${actionHtml}</td>
        </tr>
      `;
    })
    .join("");

  target.innerHTML = renderTable(
    ["Pedido", "Cliente", "Produto", "Qtd", "Valor", "Pagamento", "Canal", "Cupom", "Prêmio crédito", "Status", "Criado em", "Ação"],
    rows
  );
}

function renderOrdersKanban() {
  const target = document.getElementById("ordersKanban");
  if (!target) return;

  if (!hasPermission("ORDERS_MANAGE")) {
    target.innerHTML = "<p>Sem permissão para visualizar kanban.</p>";
    return;
  }

  const columnsHtml = ORDER_KANBAN_COLUMNS.map((status) => {
    const orders = ordersCache.filter((item) => String(item.status).toUpperCase() === status);
    const cards = orders.length
      ? orders
          .slice(0, 40)
          .map((order) => {
            const quickActions = [];
            if (status === "PENDING") {
              quickActions.push(`<button data-action="approve-order" data-id="${order.id}">Aprovar</button>`);
            }
            if (status === "PAID") {
              quickActions.push(`<button data-action="set-order-status" data-id="${order.id}" data-status="PROCESSING">Separação</button>`);
              quickActions.push(`<button data-action="set-order-status" data-id="${order.id}" data-status="SHIPPED">Enviar</button>`);
            }
            if (status === "PROCESSING") {
              quickActions.push(`<button data-action="set-order-status" data-id="${order.id}" data-status="SHIPPED">Enviar</button>`);
            }
            if (status === "SHIPPED") {
              quickActions.push(`<button data-action="set-order-status" data-id="${order.id}" data-status="DELIVERED">Entregue</button>`);
            }
            if (["PAID", "PROCESSING", "SHIPPED"].includes(status)) {
              quickActions.push(`<button class="danger" data-action="set-order-status" data-id="${order.id}" data-status="CANCELLED">Cancelar</button>`);
            }

            return `
              <article class="kanban-card">
                <div class="kanban-card-top">
                  <strong>#${order.id}</strong>
                  <span class="badge">${formatOrderStatusLabel(order.status)}</span>
                </div>
                <p>${escapeHtml(order.user_name || "-")} • ${escapeHtml(order.product_title || "-")}</p>
                <p>${formatCurrency(order.total_cash)} • ${escapeHtml(order.payment_method || "-")}</p>
                <div class="actions">${quickActions.join("") || "<span>-</span>"}</div>
              </article>
            `;
          })
          .join("")
      : "<p class=\"muted\">Sem pedidos.</p>";

    return `
      <section class="kanban-col">
        <div class="kanban-col-head">
          <h4>${formatOrderStatusLabel(status)}</h4>
          <span class="kanban-count">${orders.length}</span>
        </div>
        <div class="kanban-list">${cards}</div>
      </section>
    `;
  }).join("");

  target.innerHTML = columnsHtml;
}

async function loadOrders() {
  if (!hasPermission("ORDERS_MANAGE")) {
    showSectionMessage("ordersList", "Sem permissão para visualizar pedidos.");
    showSectionMessage("ordersKanban", "Sem permissão para visualizar kanban.");
    return;
  }

  try {
    const result = await apiRequest("/admin/orders/kanban").catch(async () => apiRequest("/admin/orders"));
    ordersCache = (result.orders || []).map((item) => ({
      ...item,
      status: String(item.status || "").toUpperCase()
    }));
    renderOrdersKanban();
    renderOrders();
  } catch (error) {
    ordersCache = [];
    renderOrdersKanban();
    renderOrders();

    if (isRouteNotFoundError(error)) {
      showSectionMessage("ordersList", "Backend sem rota de pedidos do admin. Faça deploy do backend atualizado.");
      showSectionMessage("ordersKanban", "Kanban indisponível até atualizar o backend.");
      return;
    }

    showSectionMessage("ordersList", `Falha ao carregar pedidos: ${error.message}`);
  }
}

function resetReviewForm() {
  const form = document.getElementById("reviewEditForm");
  if (!form) return;
  form.reset();
  const idInput = form.querySelector("input[name='reviewId']");
  if (idInput) idInput.value = "";
}

function fillReviewForm(review) {
  const form = document.getElementById("reviewEditForm");
  if (!form || !review) return;

  form.querySelector("input[name='reviewId']").value = String(review.id || "");
  form.querySelector("input[name='rating']").value = String(review.rating || 5);
  form.querySelector("input[name='photo_url']").value = review.photo_url || "";
  form.querySelector("input[name='comment']").value = review.comment || "";
}

function renderReviewsAdmin() {
  const target = document.getElementById("reviewsAdminList");
  if (!target) return;

  if (!hasPermission("REVIEWS_MANAGE")) {
    target.innerHTML = "<p>Sem permissão para visualizar avaliações.</p>";
    return;
  }

  const term = normalizeText(document.getElementById("reviewsSearchInput")?.value);
  const ratingFilter = Number(document.getElementById("reviewsRatingFilter")?.value || 0);

  const rows = reviewsCache
    .filter((review) => {
      if (ratingFilter && Number(review.rating) !== ratingFilter) return false;
      if (!term) return true;
      const searchable = normalizeText(`${review.id} ${review.user_name} ${review.product_title} ${review.comment}`);
      return searchable.includes(term);
    })
    .map((review) => {
      const photoLink = review.photo_url ? `<a href="${escapeHtml(review.photo_url)}" target="_blank" rel="noopener noreferrer">Abrir foto</a>` : "-";

      return `
        <tr>
          <td>${review.id}</td>
          <td>${escapeHtml(review.user_name || "-")}</td>
          <td>${escapeHtml(review.product_title || "-")}</td>
          <td><span class="rating-pill">${"★".repeat(Number(review.rating || 0))}</span></td>
          <td>${Number(review.verified_purchase) === 1 ? `<span class="badge ok">Verificada</span>` : `<span class="badge">Livre</span>`}</td>
          <td class="review-comment-cell">${escapeHtml(review.comment || "-")}</td>
          <td>${photoLink}</td>
          <td>${formatDate(review.created_at)}</td>
          <td class="actions">
            <button data-action="edit-review" data-id="${review.id}">Editar</button>
            <button class="danger" data-action="delete-review" data-id="${review.id}">Excluir</button>
          </td>
        </tr>
      `;
    })
    .join("");

  target.innerHTML = renderTable(
    ["ID", "Cliente", "Produto", "Nota", "Compra", "Comentário", "Foto", "Data", "Ações"],
    rows
  );
}

async function loadReviewsAdmin() {
  if (!hasPermission("REVIEWS_MANAGE")) {
    showSectionMessage("reviewsAdminList", "Sem permissão para visualizar avaliações.");
    return;
  }

  try {
    const result = await apiRequest("/admin/reviews");
    reviewsCache = result.reviews || [];
    renderReviewsAdmin();
  } catch (error) {
    reviewsCache = [];
    renderReviewsAdmin();

    if (isRouteNotFoundError(error)) {
      showSectionMessage("reviewsAdminList", "Backend atual ainda sem rota de avaliações. Faça deploy do backend para liberar este módulo.");
      return;
    }

    showSectionMessage("reviewsAdminList", `Falha ao carregar avaliações: ${error.message}`);
  }
}

async function handleReviewEdit(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const reviewId = Number(formData.get("reviewId"));

  if (!reviewId) {
    setFeedback("reviewEditFeedback", "Informe o ID da avaliação.", "error");
    return;
  }

  try {
    await apiRequest(`/admin/reviews/${reviewId}`, {
      method: "PUT",
      body: JSON.stringify({
        rating: Number(formData.get("rating")),
        comment: String(formData.get("comment") || "").trim(),
        photo_url: String(formData.get("photo_url") || "").trim()
      })
    });

    setFeedback("reviewEditFeedback", "Avaliação atualizada com sucesso.", "success");
    resetReviewForm();
    await loadReviewsAdmin();
  } catch (error) {
    setFeedback("reviewEditFeedback", error.message, "error");
  }
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
    .filter((ticket) => {
      const status = normalizeTicketStatus(ticket.status);
      return onlyOpen ? !isFinalTicketStatus(status) : true;
    })
    .map((ticket) => {
      const status = normalizeTicketStatus(ticket.status);
      const responseField = isFinalTicketStatus(status)
        ? `<p><strong>Resposta:</strong> ${ticket.admin_response || "-"}</p>`
        : `
          <div class="ticket-response-box">
            <textarea data-ticket-response="${ticket.id}" rows="2" placeholder="Digite a resposta para o cliente"></textarea>
            <button data-action="respond-ticket" data-id="${ticket.id}">Responder ticket</button>
          </div>
        `;
      const lifecycleAction = status === "CLOSED"
        ? `<button data-action="reopen-ticket" data-id="${ticket.id}">Reabrir</button>`
        : `<button class="danger" data-action="close-ticket" data-id="${ticket.id}">Encerrar</button>`;

      return `
        <tr>
          <td>${ticket.id}</td>
          <td>${ticket.name}</td>
          <td>${ticket.order_number || "-"}</td>
          <td>${ticket.subject}</td>
          <td>${ticket.message}</td>
          <td>${ticket.status}</td>
          <td>
            <button data-action="open-ticket-chat" data-id="${ticket.id}">Ver chat</button>
            ${lifecycleAction}
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

function renderTicketChat(messages = []) {
  const box = document.getElementById("ticketChatMessages");
  const hint = document.getElementById("ticketChatHint");
  if (!box || !hint) return;

  if (!activeTicketChatId) {
    box.innerHTML = "";
    hint.textContent = "Selecione um ticket para ver o chat.";
    activeTicketChatStatus = "";
    return;
  }

  if (!messages.length) {
    box.innerHTML = "<p class=\"muted\">Sem mensagens ainda.</p>";
  } else {
    box.innerHTML = messages
      .map(
        (m) =>
          `<div class="chat-message ${m.sender_type === "ADMIN" ? "admin" : "user"}">
            <strong>${m.sender_type === "ADMIN" ? "Admin" : "Cliente"}</strong>
            <p>${m.body}</p>
            <small>${m.created_at || ""}</small>
          </div>`
      )
      .join("");
  }

  const statusLabel = activeTicketChatStatus ? ` (${activeTicketChatStatus})` : "";
  hint.textContent = `Chat do ticket #${activeTicketChatId}${statusLabel}`;
}

async function loadTicketChat(ticketId) {
  if (!hasPermission("TICKETS_MANAGE")) return;
  activeTicketChatId = ticketId;
  try {
    const result = await apiRequest(`/admin/tickets/${ticketId}/messages`);
    activeTicketChatStatus = normalizeTicketStatus(result.ticketStatus);
    renderTicketChat(result.messages || []);
    setFeedback("ticketChatFeedback", "", "");
  } catch (error) {
    setFeedback("ticketChatFeedback", error.message, "error");
  }
}

async function sendTicketChat(event) {
  event.preventDefault();
  if (!activeTicketChatId) {
    setFeedback("ticketChatFeedback", "Selecione um ticket primeiro.", "error");
    return;
  }

  const input = document.querySelector("#ticketChatForm input[name='message']");
  const message = String(input?.value || "").trim();
  if (!message) return;

  if (normalizeTicketStatus(activeTicketChatStatus) === "CLOSED") {
    setFeedback("ticketChatFeedback", "Ticket fechado. Reabra o ticket para enviar nova mensagem.", "error");
    return;
  }

  try {
    await apiRequest(`/admin/tickets/${activeTicketChatId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message })
    });
    if (input) input.value = "";
    await loadTicketChat(activeTicketChatId);
  } catch (error) {
    setFeedback("ticketChatFeedback", error.message, "error");
  }
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
  const tasks = [
    loadAnalytics(),
    loadUsers(),
    loadProducts(),
    loadReviewsAdmin(),
    loadOrders(),
    loadTickets(),
    loadLogs()
  ];

  if (hasPermission("DISCOUNTS_MANAGE")) {
    tasks.push(loadCampaigns());
  }

  if (hasPermission("ANALYTICS_VIEW")) {
    tasks.push(loadStockReport());
  }

  const crmUserId = parseInteger(document.getElementById("crmUserIdInput")?.value, 0);
  if (crmUserId > 0 && hasPermission("USERS_VIEW")) {
    tasks.push(loadCrmOverview(crmUserId));
  } else {
    crmCache = null;
    renderCrmOverview();
  }

  await Promise.allSettled(tasks);
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
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form));

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
    form.reset();
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
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form));

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
    form.reset();
    await refreshAll();
  } catch (error) {
    setFeedback("creditFeedback", error.message, "error");
  }
}

async function handlePasswordReset(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form));

  try {
    await apiRequest(`/admin/users/${Number(payload.userId)}/password`, {
      method: "POST",
      body: JSON.stringify({
        newPassword: payload.newPassword,
        masterKey: payload.masterKey
      })
    });

    setFeedback("passwordResetFeedback", "Senha redefinida com sucesso.", "success");
    form.reset();
  } catch (error) {
    setFeedback("passwordResetFeedback", error.message, "error");
  }
}

async function handleNotification(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form));

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
    form.reset();
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
  const categoryRaw = String(formData.get("category") || "CELULAR").trim();
  return {
    title: String(formData.get("title") || "").trim(),
    brand: String(formData.get("brand") || "").trim(),
    category: categoryRaw || "CELULAR",
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
  document.getElementById("productsBrandFilter")?.addEventListener("change", renderProducts);
  document.getElementById("productsCategoryFilter")?.addEventListener("change", renderProducts);
  document.getElementById("onlyActiveProductsToggle")?.addEventListener("change", renderProducts);
  document.getElementById("onlyPromotedProductsToggle")?.addEventListener("change", renderProducts);
  document.getElementById("reviewsSearchInput")?.addEventListener("input", renderReviewsAdmin);
  document.getElementById("reviewsRatingFilter")?.addEventListener("change", renderReviewsAdmin);
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
  document.getElementById("campaignForm")?.addEventListener("submit", handleCampaignSave);
  document.getElementById("productCreateForm")?.addEventListener("submit", handleProductSave);
  document.getElementById("reviewEditForm")?.addEventListener("submit", handleReviewEdit);
  document.getElementById("ticketChatForm")?.addEventListener("submit", sendTicketChat);
  document.getElementById("applyQuickCategoryBtn")?.addEventListener("click", applyQuickCategoryPreset);
  document.getElementById("newProductBtn")?.addEventListener("click", () => {
    resetProductForm();
    setFeedback("productFeedback", "Formulário limpo para novo produto.", "success");
  });
  document.getElementById("clearDiscountBtn")?.addEventListener("click", clearDiscount);
  document.getElementById("campaignFormResetBtn")?.addEventListener("click", () => {
    resetCampaignForm();
    setFeedback("campaignFeedback", "Formulário de campanha limpo.", "success");
  });
  document.getElementById("refreshStockReportBtn")?.addEventListener("click", async () => {
    await loadStockReport();
  });
  document.getElementById("loadCrmBtn")?.addEventListener("click", async () => {
    await loadCrmOverview();
  });
  document.getElementById("crmUserIdInput")?.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    await loadCrmOverview();
  });
  document.getElementById("cancelProductEditBtn")?.addEventListener("click", resetProductForm);
  document.getElementById("cancelReviewEditBtn")?.addEventListener("click", resetReviewForm);

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

      if (action === "set-order-status") {
        const nextStatus = String(button.getAttribute("data-status") || "").trim().toUpperCase();
        if (!nextStatus) {
          throw new Error("Status de pedido inválido.");
        }
        await apiRequest(`/admin/orders/${id}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: nextStatus })
        });
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
        await loadTickets();
        await loadTicketChat(id);
      }

      if (action === "open-ticket-chat") {
        await loadTicketChat(id);
        document.getElementById("ticketChatForm")?.scrollIntoView({ behavior: "smooth" });
        return;
      }

      if (action === "close-ticket") {
        await apiRequest(`/admin/tickets/${id}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: "CLOSED" })
        });
        await loadTickets();
        if (activeTicketChatId === id) {
          await loadTicketChat(id);
        }
        return;
      }

      if (action === "reopen-ticket") {
        await apiRequest(`/admin/tickets/${id}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: "OPEN" })
        });
        await loadTickets();
        if (activeTicketChatId === id) {
          await loadTicketChat(id);
        }
        return;
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

      if (action === "open-user-crm") {
        const crmInput = document.getElementById("crmUserIdInput");
        if (crmInput) {
          crmInput.value = String(id);
        }
        openTab("tab-users");
        await loadCrmOverview(id);
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

      if (action === "duplicate-product") {
        const product = productsCache.find((item) => Number(item.id) === id);
        if (product) {
          fillProductForm({
            ...product,
            id: "",
            title: `${product.title} (Copia)`
          });
          const form = document.getElementById("productCreateForm");
          if (form) {
            const hiddenId = form.querySelector("input[name='productId']");
            if (hiddenId) hiddenId.value = "";
          }
          openTab("tab-products");
          setFeedback("productFeedback", `Produto #${id} carregado como cópia.`, "success");
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

      if (action === "edit-review") {
        const review = reviewsCache.find((item) => Number(item.id) === id);
        if (review) {
          fillReviewForm(review);
          openTab("tab-reviews");
          setFeedback("reviewEditFeedback", `Editando avaliação #${id}.`, "success");
        }
        return;
      }

      if (action === "delete-review") {
        const confirmed = window.confirm("Excluir esta avaliação?");
        if (!confirmed) return;
        await apiRequest(`/admin/reviews/${id}`, { method: "DELETE" });
      }

      if (action === "edit-campaign") {
        const campaign = campaignsCache.find((item) => Number(item.id) === id);
        if (campaign) {
          fillCampaignForm(campaign);
          openTab("tab-dashboard");
          setFeedback("campaignFeedback", `Editando campanha #${id}.`, "success");
        }
        return;
      }

      if (action === "disable-campaign") {
        const confirmed = window.confirm("Desativar esta campanha?");
        if (!confirmed) return;
        await apiRequest(`/admin/campaigns/${id}`, { method: "DELETE" });
        setFeedback("campaignFeedback", `Campanha #${id} desativada.`, "success");
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
