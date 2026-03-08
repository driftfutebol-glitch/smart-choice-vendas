const form = document.getElementById("settingsForm");
const feedback = document.getElementById("feedback");
const resetBtn = document.getElementById("resetBtn");

function setFeedback(message) {
  feedback.textContent = message || "";
}

function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

async function loadConfig() {
  const config = await window.desktopConfig.get();
  form.panelUrl.value = config.panelUrl || "";
  form.apiUrl.value = config.apiUrl || "";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setFeedback("Salvando...");

  const panelUrl = normalizeUrl(form.panelUrl.value);
  const apiUrl = normalizeUrl(form.apiUrl.value);

  try {
    new URL(panelUrl);
    new URL(apiUrl);
  } catch (_error) {
    setFeedback("URL inválida. Corrija os campos e tente novamente.");
    return;
  }

  try {
    await window.desktopConfig.save({ panelUrl, apiUrl });
    setFeedback("Configuração salva com sucesso.");
  } catch (error) {
    setFeedback(`Falha ao salvar: ${String(error.message || error)}`);
  }
});

resetBtn.addEventListener("click", async () => {
  setFeedback("Restaurando padrão...");
  try {
    const config = await window.desktopConfig.reset();
    form.panelUrl.value = config.panelUrl || "";
    form.apiUrl.value = config.apiUrl || "";
    setFeedback("Padrão restaurado.");
  } catch (error) {
    setFeedback(`Falha ao restaurar: ${String(error.message || error)}`);
  }
});

loadConfig().catch((error) => {
  setFeedback(`Falha ao carregar: ${String(error.message || error)}`);
});
