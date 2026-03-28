const { app, BrowserWindow } = require('electron')
const path = require('path')
const { spawn } = require('child_process')

let mainWindow
let backendProcess

function startBackend() {
  const backendDir = path.join(__dirname, '..', '..', '..', 'backend')
  const pythonBin = path.join(backendDir, 'forgeback', 'bin', 'python3')
  backendProcess = spawn(pythonBin, [
    '-m', 'uvicorn', 'src.main:app',
    '--host', '127.0.0.1',
    '--port', '8000',
    '--reload'
  ], {
    cwd: backendDir,
    env: { ...process.env }
  })
  backendProcess.stdout.on('data', (d) => console.log('[backend]', d.toString().trim()))
  backendProcess.stderr.on('data', (d) => console.error('[backend]', d.toString().trim()))
  backendProcess.on('error', (err) => console.error('[backend] Failed to start:', err))
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#0a0a0f',
  })

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
  }
}

app.whenReady().then(() => {
  startBackend()
  // Give backend 2s to boot before opening the window
  setTimeout(createWindow, 2000)
})

app.on('window-all-closed', () => {
  if (backendProcess) backendProcess.kill()
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('before-quit', () => {
  if (backendProcess) backendProcess.kill()
}) 