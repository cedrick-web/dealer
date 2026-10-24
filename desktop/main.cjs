const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');

const devUrl = process.env.DEALER_DEV_URL;

function isTrustedNavigation(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (devUrl && url.origin === new URL(devUrl).origin) return true;
    return url.protocol === 'file:' && url.pathname.endsWith('/web/index.html');
  } catch {
    return false;
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 360,
    minHeight: 540,
    show: false,
    title: 'Dealer Property Desk',
    backgroundColor: '#f7f8f4',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => window.show());

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedNavigation(url)) {
      event.preventDefault();
      if (url.startsWith('https://')) void shell.openExternal(url);
    }
  });

  if (devUrl) {
    void window.loadURL(devUrl);
  } else {
    void window.loadFile(path.join(process.resourcesPath, 'web', 'index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
