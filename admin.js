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
  const isLocalLike = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
  if (isLocalLike) {
    return `${protocol}//${hostname}:4000/api`;
  }

  return "https://smart-choice-vendas.onrender.com/api";
}

const API_BASE = resolveApiBase();

let adminToken = localStorage.getItem("scv_admin_token") || "";
let currentAdmin = null;
let permissionsCatalog = [];
let usersCache = [];

function setFeedback(targetId, message, type = "") {
  const el = document.getElementById(targetId);
  if (!el) return;
  el.textContent = message || "";
  el.classList.remove("error", "success");
  if (type) {
    el.classList.add(type);
  }
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

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Erro inesperado");
  }

  return data;
}

function showApp() {
  document.getElementById("adminApp")?.classList.remove("hidden");
}

function renderTable(headers, rowsHtml) {
  return `
    <table>
      <thead>
        <tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${rowsHtml || `<tr><td colspan="${headers.length}">Sem dados</td></tr>`}
      </tbody>
    </table>
  `;
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

function applyPermissionGates() {
  const gates = [
    { selector: "#createUserForm", permission: "USERS_CREATE" },
    { selector: "#permissionsForm", permission: "USERS_PERMISSIONS" },
    { selector: "#creditForm", permission: "CREDITS_ADJUST" },
    { selector: "#passwordResetForm", permission: "USERS_PASSWORD_RESET" },
    { selector: "#notificationForm", permission: "NOTIFICATIONS_MANAGE" },
    { selector: "#discountForm", permission: "DISCOUNTS_MANAGE" },
    { selector: "#productCreateForm", permission: "PRODUCTS_MANAGE" }
  ];

  for (const gate of gates) {
    const form = document.querySelector(gate.selector);
    if (!form) continue;

    const allowed = hasPermission(gate.permission);
    form.querySelectorAll("input,select,textarea,button").forEach((el) => {
      el.disabled = !allowed;
    });

    form.classList.toggle("disabled-form", !allowed);
  }
}

async function loadAdminContext() {
  const result = await apiRequest("/admin/me");
  currentAdmin = result.user;
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
  if (!hasPermission("ANALYTICS_VIEW")) return;

  const data = await apiRequest("/admin/analytics");
  const totalVisitors = (data.visitors || []).reduce((acc, item) => acc + Number(item.total || 0), 0);

  document.getElementById("kpiVisitors").textContent = String(totalVisitors);
  document.getElementById("kpiSales").textContent = `R$ ${Number(data.total_sales_cash || 0).toFixed(2)}`;
  document.getElementById("kpiOrders").textContent = String(data.total_orders_approved || 0);
}

function formatPermissions(permissions) {
  if (!permissions || permissions.length === 0) return "-";
  return permissions.join(", ");
}

async function loadUsers() {
  if (!hasPermission("USERS_VIEW")) return;

  const data = await apiRequest("/admin/users");
  usersCache = data.users || [];

  const rows = usersCache
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
          <td>${user.role} ${ownerTag}</td>
          <td>${user.status_usuario}</td>
          <td>${user.credits}</td>
          <td>${user.is_banned ? "Sim" : "Nao"}</td>
          <td>${formatPermissions(user.permissions)}</td>
          <td class="actions">${actions.join("") || "-"}</td>
        </tr>
      `;
    })
    .join("");

  document.getElementById("usersList").innerHTML = renderTable(
    ["ID", "Nome", "Email", "Role", "Status", "Creditos", "Banido", "Permissões", "Ações"],
    rows
  );
}

async function loadOrders() {
  if (!hasPermission("ORDERS_MANAGE")) return;

  const data = await apiRequest("/admin/orders");
  const rows = (data.orders || [])
    .map((order) => {
      const approveButton = order.status === "APPROVED"
        ? "<span>Aprovado</span>"
        : `<button data-action="approve-order" data-id="${order.id}">Aprovar</button>`;

      return `
        <tr>
          <td>${order.id}</td>
          <td>${order.user_name}</td>
          <td>${order.product_title}</td>
          <td>${order.total_cash}</td>
          <td>${order.credit_reward}</td>
          <td>${order.status}</td>
          <td class="actions">${approveButton}</td>
        </tr>
      `;
    })
    .join("");

  document.getElementById("ordersList").innerHTML = renderTable(
    ["Pedido", "Cliente", "Produto", "Valor", "Prêmio Crédito", "Status", "Ação"],
    rows
  );
}

async function loadTickets() {
  if (!hasPermission("TICKETS_MANAGE")) return;

  const data = await apiRequest("/admin/tickets");
  const rows = (data.tickets || [])
    .map((ticket) => {
      const action = ticket.status === "ANSWERED"
        ? "Respondido"
        : `<button data-action="respond-ticket" data-id="${ticket.id}">Responder</button>`;

      return `
        <tr>
          <td>${ticket.id}</td>
          <td>${ticket.name}</td>
          <td>${ticket.order_number || "-"}</td>
          <td>${ticket.subject}</td>
          <td>${ticket.message}</td>
          <td>${ticket.status}</td>
          <td>${action}</td>
        </tr>
      `;
    })
    .join("");

  document.getElementById("ticketsList").innerHTML = renderTable(
    ["Ticket", "Cliente", "Pedido", "Assunto", "Mensagem", "Status", "Ação"],
    rows
  );
}

async function loadLogs() {
  if (!hasPermission("LOGS_VIEW")) return;

  const data = await apiRequest("/admin/logs");
  const rows = (data.logs || [])
    .slice(0, 150)
    .map((log) => `
      <tr>
        <td>${log.id}</td>
        <td>${log.actor_name || "Sistema"}</td>
        <td>${log.action}</td>
        <td>${log.details || ""}</td>
        <td>${log.created_at}</td>
      </tr>
    `)
    .join("");

  document.getElementById("logsList").innerHTML = renderTable(
    ["ID", "Ator", "Ação", "Detalhes", "Data"],
    rows
  );
}

async function refreshAll() {
  await Promise.all([loadAnalytics(), loadUsers(), loadOrders(), loadTickets(), loadLogs()]);
}

async function handleAdminLogin(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget));

  try {
    const result = await apiRequest("/auth/login", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    if (!result.user || result.user.role !== "ADMIN") {
      throw new Error("Acesso negado. Usuario nao e admin.");
    }

    adminToken = result.token;
    localStorage.setItem("scv_admin_token", adminToken);

    await loadAdminContext();
    await loadPermissionsCatalog();

    setFeedback("adminLoginFeedback", "Login admin realizado.", "success");
    showApp();
    applyPermissionGates();
    await refreshAll();
  } catch (error) {
    setFeedback("adminLoginFeedback", error.message, "error");
  }
}

async function handleCreateUser(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget));

  try {
    await apiRequest("/admin/users", {
      method: "POST",
      body: JSON.stringify({
        name: payload.name,
        email: payload.email,
        phone: payload.phone,
        password: payload.password,
        role: payload.role,
        status_usuario: payload.status_usuario,
        initialCredits: Number(payload.initialCredits || 0)
      })
    });

    setFeedback("createUserFeedback", "Usuario criado com sucesso.", "success");
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

    setFeedback("permissionsFeedback", "Permissoes atualizadas com sucesso.", "success");
    await refreshAll();
  } catch (error) {
    setFeedback("permissionsFeedback", error.message, "error");
  }
}

function loadPermissionsFromUser(userId) {
  const target = usersCache.find((item) => Number(item.id) === Number(userId));
  if (!target) {
    setFeedback("permissionsFeedback", "Admin nao encontrado na lista atual.", "error");
    return;
  }

  const input = document.querySelector("#permissionsForm input[name='targetAdminId']");
  if (input) {
    input.value = String(userId);
  }

  renderPermissionOptions(target.permissions || []);
  setFeedback("permissionsFeedback", `Permissoes carregadas para ${target.name}.`, "success");
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

    setFeedback("creditFeedback", "Creditos atualizados com sucesso.", "success");
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

    setFeedback("passwordResetFeedback", "Senha redefinida.", "success");
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
        title: payload.title,
        message: payload.message
      })
    });

    setFeedback("notificationFeedback", "Notificacao enviada.", "success");
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

    setFeedback("discountFeedback", "Desconto aplicado com sucesso.", "success");
    await refreshAll();
  } catch (error) {
    setFeedback("discountFeedback", error.message, "error");
  }
}

async function handleProductCreate(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);

  try {
    await apiRequest("/admin/products", {
      method: "POST",
      body: JSON.stringify({
        title: formData.get("title"),
        brand: formData.get("brand"),
        category: formData.get("category") || "CELULAR",
        description: formData.get("description"),
        technical_specs: formData.get("technical_specs"),
        price_cash: Number(formData.get("price_cash")),
        price_credits: Number(formData.get("price_credits")),
        beginner_price: formData.get("beginner_price") ? Number(formData.get("beginner_price")) : null,
        image_url: formData.get("image_url"),
        video_url: formData.get("video_url"),
        stock: Number(formData.get("stock")),
        is_beginner_offer: formData.get("is_beginner_offer") === "on"
      })
    });

    setFeedback("productFeedback", "Produto adicionado.", "success");
    event.currentTarget.reset();
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

function bindActions() {
  document.getElementById("adminLoginForm")?.addEventListener("submit", handleAdminLogin);
  document.getElementById("createUserForm")?.addEventListener("submit", handleCreateUser);
  document.getElementById("permissionsForm")?.addEventListener("submit", handleSavePermissions);
  document.getElementById("creditForm")?.addEventListener("submit", handleCreditAdjust);
  document.getElementById("passwordResetForm")?.addEventListener("submit", handlePasswordReset);
  document.getElementById("notificationForm")?.addEventListener("submit", handleNotification);
  document.getElementById("discountForm")?.addEventListener("submit", handleDiscount);
  document.getElementById("productCreateForm")?.addEventListener("submit", handleProductCreate);

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

    try {
      if (action === "approve-order") {
        await apiRequest(`/admin/orders/${id}/approve`, { method: "POST" });
      }

      if (action === "respond-ticket") {
        const response = prompt("Digite a resposta para este ticket:");
        if (!response) return;

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
        const confirmed = confirm("Confirmar remocao definitiva do usuario?");
        if (!confirmed) return;
        await apiRequest(`/admin/users/${id}`, { method: "DELETE" });
      }

      if (action === "load-user-permissions") {
        loadPermissionsFromUser(id);
        return;
      }

      await refreshAll();
    } catch (error) {
      alert(error.message);
    }
  });
}

async function bootstrap() {
  bindActions();

  if (!adminToken) {
    return;
  }

  try {
    await loadAdminContext();
    await loadPermissionsCatalog();
    showApp();
    applyPermissionGates();
    await refreshAll();
  } catch (_error) {
    localStorage.removeItem("scv_admin_token");
    adminToken = "";
    currentAdmin = null;
  }
}

bootstrap();
