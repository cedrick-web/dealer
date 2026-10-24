const { app, BrowserWindow, protocol, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const devUrl = process.env.DEALER_DEV_URL;

protocol.registerSchemesAsPrivileged([{
  scheme: 'dealer',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
    allowServiceWorkers: false,
  },
}]);

function isTrustedNavigation(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (devUrl && url.origin === new URL(devUrl).origin) return true;
    return url.protocol === 'dealer:' && url.hostname === 'app';
  } catch {
    return false;
  }
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json',
  };
  return types[ext] || 'application/octet-stream';
}

async function servePackagedWeb(request) {
  const root = path.resolve(process.resourcesPath, 'web');
  const url = new URL(request.url);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return new Response('Bad path', { status: 400 });
  }

  let filePath = path.resolve(root, '.' + pathname);
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    // Client-side routes fall back to the application shell. Missing asset
    // URLs remain 404s rather than returning HTML disguised as JavaScript.
    if (path.extname(pathname)) return new Response('Not found', { status: 404 });
    filePath = path.join(root, 'index.html');
  }

  try {
    const body = await fs.readFile(filePath);
    return new Response(body, {
      headers: {
        'content-type': contentType(filePath),
        'x-content-type-options': 'nosniff',
        'cache-control': path.extname(filePath) ? 'public, max-age=3600' : 'no-store',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

async function createWindow() {
  if (!devUrl) await protocol.handle('dealer', servePackagedWeb);

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
    void window.loadURL('dealer://app/index.html');
  }
}

app.whenReady().then(() => {
  void createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
