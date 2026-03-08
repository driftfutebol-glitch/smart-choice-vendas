const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");

const DEFAULT_CONFIG = {
  panelUrl: "https://smart-choice-vendas.pages.dev/painel-admin-pedro-oculto.html",
  apiUrl: "https://smart-choice-vendas.onrender.com/api"
};

let panelWindow = null;
let settingsWindow = null;

function getConfigPath() {
  return path.join(app.getPath("userData"), "desktop-admin-config.json");
}

function normalizeConfig(rawConfig = {}) {
  const panelUrl = String(rawConfig.panelUrl || DEFAULT_CONFIG.panelUrl).trim();
  const apiUrl = String(rawConfig.apiUrl || DEFAULT_CONFIG.apiUrl).trim();
  return {
    panelUrl: panelUrl || DEFAULT_CONFIG.panelUrl,
    apiUrl: apiUrl || DEFAULT_CONFIG.apiUrl
  };
}

function readConfig() {
  try {
    const content = fs.readFileSync(getConfigPath(), "utf-8");
    return normalizeConfig(JSON.parse(content));
  } catch (_error) {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(config) {
  const normalized = normalizeConfig(config);
  fs.mkdirSync(path.dirname(getConfigPath()), { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(normalized, null, 2), "utf-8");
  return normalized;
}

function buildPanelUrl(config) {
  const panel = new URL(config.panelUrl);
  panel.searchParams.set("api", config.apiUrl);
  return panel.toString();
}

function loadPanel() {
  if (!panelWindow) return;
  const config = readConfig();
  panelWindow.loadURL(buildPanelUrl(config)).catch((error) => {
    dialog.showErrorBox("Falha ao abrir painel", String(error.message || error));
  });
}

function createPanelWindow() {
  panelWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 760,
    backgroundColor: "#0b1221",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js")
    },
    title: "Smart Choice Admin Desktop"
  });

  panelWindow.on("closed", () => {
    panelWindow = null;
  });

  loadPanel();
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 620,
    height: 520,
    modal: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    parent: panelWindow || null,
    backgroundColor: "#081326",
    title: "Configurações do Admin Desktop",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js")
    }
  });

  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });

  settingsWindow.loadFile(path.join(__dirname, "settings.html"));
}

function createAppMenu() {
  const menuTemplate = [
    {
      label: "Painel",
      submenu: [
        {
          label: "Recarregar painel",
          accelerator: "F5",
          click: () => {
            panelWindow?.reload();
          }
        },
        {
          label: "Abrir configurações",
          accelerator: "Ctrl+,",
          click: () => createSettingsWindow()
        },
        {
          label: "Voltar URLs padrão",
          click: () => {
            saveConfig(DEFAULT_CONFIG);
            loadPanel();
          }
        },
        { type: "separator" },
        {
          label: "Sair",
          accelerator: "Alt+F4",
          click: () => app.quit()
        }
      ]
    },
    {
      label: "Ajuda",
      submenu: [
        {
          label: "Sobre",
          click: () => {
            dialog.showMessageBox({
              type: "info",
              title: "Smart Choice Admin Desktop",
              message: "Painel desktop interligado ao mesmo backend do site.",
              detail: "Tudo que você alterar aqui aparece no site e no painel web."
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
}

ipcMain.handle("desktop-config:get", () => readConfig());

ipcMain.handle("desktop-config:save", (_event, payload = {}) => {
  const saved = saveConfig(payload);
  if (panelWindow) {
    panelWindow.loadURL(buildPanelUrl(saved)).catch(() => {});
  }
  if (settingsWindow) {
    settingsWindow.close();
  }
  return saved;
});

ipcMain.handle("desktop-config:reset", () => {
  const saved = saveConfig(DEFAULT_CONFIG);
  loadPanel();
  return saved;
});

app.whenReady().then(() => {
  createAppMenu();
  createPanelWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createPanelWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
