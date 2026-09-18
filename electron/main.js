const path = require('path');
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');

// Desktop wrapper for the Owner Console. The member-facing app stays a
// plain web app (members use their own phone's browser) - this packages
// only the staff/owner side as native software for the front desk.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// Some machines (VMs, remote desktop sessions, flaky/outdated GPU drivers)
// crash Chromium's GPU process on ordinary navigation, leaving the window
// showing a blank frame instead of the new page - "GPU process exited
// unexpectedly" in the console, then a blank screen on the next tab click.
// Forcing software rendering means there's no GPU process to crash.
app.disableHardwareAcceleration();

let mainWindow = null;
let httpServer = null;
let boundPort = null;

async function boot() {
  const { startServer } = require('../server/index.js');
  const { server, port } = await startServer();
  httpServer = server;
  boundPort = port;

  // A restore-from-backup needs the whole process to come back, not just
  // the embedded server - relaunching the Electron app does that cleanly,
  // instead of the plain-Node default of just exiting.
  require('../server/backup').setRestoreHandler(() => {
    app.relaunch();
    app.exit(0);
  });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow && mainWindow.reload(),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Kiosk Fullscreen',
          accelerator: 'F11',
          type: 'checkbox',
          click: (item) => mainWindow && mainWindow.setFullScreen(item.checked),
        },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Forge Room Owner Console',
          click: () => dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Forge Room Owner Console',
            message: 'Forge Room Owner Console',
            detail: `Local gym management desktop app.\nServer: http://localhost:${boundPort}\n\nAll data stays on this machine.`,
          }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Forge Room — Owner Console',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: '#f4f4f1',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    show: false,
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(`http://localhost:${boundPort}/console/`);

  // Keep the app window on the console/kiosk UI; anything that would
  // navigate to an outside URL (e.g. a future "help" link) opens in the
  // system browser instead of hijacking the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://localhost:${boundPort}`)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`http://localhost:${boundPort}`)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  try {
    await boot();
  } catch (err) {
    dialog.showErrorBox('Forge Room failed to start', String(err && err.stack || err));
    app.quit();
    return;
  }
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (httpServer) httpServer.close();
});
