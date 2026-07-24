import { contextBridge, ipcRenderer } from 'electron';
import type { ApiRequestPayload, DesktopBridge } from '../shared/types';

const bridge: DesktopBridge = {
  getVersion: () => ipcRenderer.invoke('app:version'),
  approveHosts: (hosts) => ipcRenderer.invoke('keen:approveHosts', hosts),
  request: (payload: ApiRequestPayload) => ipcRenderer.invoke('keen:request', payload),
  cancel: (requestId: string) => ipcRenderer.send('keen:cancel', requestId),
  saveText: (input) => ipcRenderer.invoke('file:saveText', input),
  saveBinary: (input) => ipcRenderer.invoke('file:saveBinary', input),
  openText: () => ipcRenderer.invoke('file:openText'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url)
};

contextBridge.exposeInMainWorld('keenDesktop', bridge);
