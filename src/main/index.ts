import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import type { ApiBridgeResult, ApiRequestPayload } from '../shared/types';
import { approvedBaseIdentity, validateApprovedTarget } from '../shared/url';

const requestControllers = new Map<string, AbortController>();
const approvedBases = new Set<string>();
const MAX_REQUEST_BYTES = 10_500_000;
const MAX_RESPONSE_BYTES = 150_000_000;
const DEFAULT_TIMEOUT_MS = 310_000;

class ResponseLimitError extends Error {
  constructor(message = 'Response exceeds the 150 MB desktop safety limit.') {
    super(message);
    this.name = 'ResponseLimitError';
  }
}

async function readBoundedResponse(
  response: Response,
  responseType: ApiRequestPayload['responseType']
): Promise<{ rawText?: string; binaryBase64?: string }> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new ResponseLimitError();
  }

  if (!response.body) {
    return responseType === 'arrayBuffer' ? { binaryBase64: '' } : { rawText: '' };
  }

  const reader = response.body.getReader();
  const chunks: Array<Uint8Array<ArrayBuffer>> = [];
  let receivedBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new ResponseLimitError();
      }
      chunks.push(new Uint8Array(value));
    }
  } catch (error) {
    if (!(error instanceof ResponseLimitError)) {
      try {
        await reader.cancel();
      } catch {
        // Preserve the original stream error.
      }
    }
    throw error;
  } finally {
    reader.releaseLock();
  }

  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), receivedBytes);
  return responseType === 'arrayBuffer'
    ? { binaryBase64: bytes.toString('base64') }
    : { rawText: bytes.toString('utf8') };
}


function securityHeaders(): Record<string, string[]> {
  return {
    'Content-Security-Policy': [
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-src 'none'; frame-ancestors 'none'"
    ],
    'Referrer-Policy': ['no-referrer'],
    'X-Content-Type-Options': ['nosniff'],
    'Permissions-Policy': ['camera=(), microphone=(), geolocation=()']
  };
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: '#f3f6f8',
    title: 'Keen Key Console',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
      devTools: !app.isPackaged
    }
  });

  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:') void shell.openExternal(url);
    } catch {
      // Invalid external URL: deny without logging potentially sensitive content.
    }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return window;
}

function installSessionSecurity(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...(details.responseHeaders ?? {}),
        ...securityHeaders()
      }
    });
  });
}

function registerIpc(): void {
  ipcMain.handle('app:version', () => app.getVersion());

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new Error('Only HTTPS links can be opened externally.');
    await shell.openExternal(url);
  });

  ipcMain.handle('file:saveText', async (_event, input: { suggestedName: string; content: string }) => {
    const result = await dialog.showSaveDialog({
      defaultPath: input.suggestedName,
      properties: ['createDirectory', 'showOverwriteConfirmation']
    });
    if (result.canceled || !result.filePath) return { saved: false };
    await writeFile(result.filePath, input.content, { encoding: 'utf8', mode: 0o600 });
    return { saved: true, path: result.filePath };
  });

  ipcMain.handle('file:saveBinary', async (_event, input: { suggestedName: string; base64: string }) => {
    const result = await dialog.showSaveDialog({
      defaultPath: input.suggestedName,
      properties: ['createDirectory', 'showOverwriteConfirmation']
    });
    if (result.canceled || !result.filePath) return { saved: false };
    await writeFile(result.filePath, Buffer.from(input.base64, 'base64'), { mode: 0o600 });
    return { saved: true, path: result.filePath };
  });

  ipcMain.handle('file:openText', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'JSON/Text', extensions: ['json', 'txt', 'ndjson', 'csv'] }] });
    if (result.canceled || result.filePaths.length === 0) return { opened: false };
    const content = await readFile(result.filePaths[0], 'utf8');
    if (Buffer.byteLength(content, 'utf8') > MAX_REQUEST_BYTES) throw new Error('Selected file is too large for in-memory import.');
    return { opened: true, path: result.filePaths[0], content };
  });

  ipcMain.handle('keen:approveHosts', (_event, hosts: unknown) => {
    if (!Array.isArray(hosts) || hosts.length < 1 || hosts.length > 4) {
      throw new Error('Approve between one and four Keen service hosts.');
    }
    const identities = hosts.map((host) => {
      if (typeof host !== 'string') throw new Error('Every approved Keen service host must be a URL string.');
      const target = validateApprovedTarget(host, '/', !app.isPackaged);
      return approvedBaseIdentity(target.toString());
    });
    approvedBases.clear();
    for (const identity of identities) approvedBases.add(identity);
  });

  ipcMain.on('keen:cancel', (_event, requestId: string) => {
    requestControllers.get(requestId)?.abort();
  });

  ipcMain.handle('keen:request', async (_event, payload: ApiRequestPayload): Promise<ApiBridgeResult> => {
    try {
      if (!payload.requestId || !payload.baseUrl || !payload.path || !payload.method) {
        return { ok: false, error: { kind: 'validation', message: 'Malformed API request.', retryable: false } };
      }
      if (payload.body && Buffer.byteLength(payload.body, 'utf8') > MAX_REQUEST_BYTES) {
        return { ok: false, error: { kind: 'validation', message: 'Request body exceeds the 10 MB desktop safety limit.', retryable: false } };
      }

      const target = validateApprovedTarget(payload.baseUrl, payload.path, !app.isPackaged, approvedBases);
      const controller = new AbortController();
      requestControllers.set(payload.requestId, controller);
      const timeout = setTimeout(() => controller.abort(), payload.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const started = performance.now();

      try {
        const headers = new Headers(payload.headers ?? {});
        headers.delete('cookie');
        headers.delete('set-cookie');
        if (payload.authorization) headers.set('Authorization', payload.authorization);
        if (payload.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
        headers.set('Accept', headers.get('Accept') ?? 'application/json, text/plain;q=0.9, */*;q=0.8');

        const response = await fetch(target, {
          method: payload.method,
          headers,
          body: payload.method === 'GET' || payload.method === 'HEAD' ? undefined : payload.body,
          signal: controller.signal,
          redirect: 'error',
          credentials: 'omit',
          cache: 'no-store'
        });
        const elapsedMs = Math.round(performance.now() - started);
        const responseHeaders = Object.fromEntries(response.headers.entries());

        const responseBody = await readBoundedResponse(response, payload.responseType);
        return {
          ok: true,
          response: {
            status: response.status,
            ok: response.ok,
            headers: responseHeaders,
            ...responseBody,
            elapsedMs
          }
        };
      } finally {
        clearTimeout(timeout);
        requestControllers.delete(payload.requestId);
      }
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === 'AbortError';
      const limited = error instanceof ResponseLimitError;
      const validation = error instanceof Error && /approved|base URL|invalid URL|HTTPS|origin-relative|path traversal|request URLs?/iu.test(error.message);
      return {
        ok: false,
        error: {
          kind: aborted ? 'abort' : limited || validation ? 'validation' : 'network',
          message: aborted
            ? 'The request was cancelled or timed out.'
            : limited || validation
              ? error instanceof Error ? error.message : 'The request target is invalid.'
              : 'The network request failed. Check the service host and connectivity.',
          retryable: !aborted && !limited && !validation
        }
      };
    }
  });
}

app.whenReady().then(() => {
  installSessionSecurity();
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
