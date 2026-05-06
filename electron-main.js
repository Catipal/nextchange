import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isDev = !app.isPackaged;

let serverPort = 3001;
let mainWindow;
let serverInstance = null;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'NextChange Hub',
    backgroundColor: '#0B0E11',
    webPreferences: {
      preload: path.join(__dirname, 'electron-preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'public', 'logo_circular.png')
  });

  // Start embedded server with dynamic port fallback
  const { startServer } = await import('./server/index.js');
  for (let port = 3001; port <= 3010; port++) {
    try {
      serverInstance = await startServer({ port, freshStart: false });
      serverPort = port;
      console.log(`[Electron] Server started on port ${port}`);
      break;
    } catch (err) {
      if (port === 3010) console.error('[Electron] Failed to start server on all ports:', err);
    }
  }

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

// IPC handlers
ipcMain.handle('get-server-port', () => serverPort);

ipcMain.handle('get-network-status', async () => {
  try {
    const { getP2PNode } = await import('./server/p2p/node.js');
    return getP2PNode().getStats();
  } catch { return { peerCount: 0, connected: [], listening: false }; }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  console.log('[Electron] App closing, shutting down services...');
  if (serverInstance?.server) serverInstance.server.close();
  if (serverInstance?.p2pNode) serverInstance.p2pNode.stop();
  
  // Stop the BPS node if it was running
  import('./server/services/nodeManager.js').then(({ getNodeManager }) => {
    getNodeManager().stop();
    app.quit();
  }).catch(() => {
    app.quit();
  });
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
