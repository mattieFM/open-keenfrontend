import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useWorkspaceStore } from '../lib/db/workspaceStore';
import { WorkspaceLayout } from './WorkspaceLayout';
import { ConnectPage } from '../features/connect/ConnectPage';
import { WorkspacesPage } from '../features/workspaces/WorkspacesPage';
import { OverviewPage } from '../features/overview/OverviewPage';
import { StreamsPage } from '../features/streams/StreamsPage';
import { StreamDetailPage } from '../features/streams/StreamDetailPage';
import { ExplorerPage } from '../features/explorer/ExplorerPage';
import { SavedQueriesPage } from '../features/savedQueries/SavedQueriesPage';
import { DashboardsPage } from '../features/dashboards/DashboardsPage';
import { DashboardEditorPage } from '../features/dashboards/DashboardEditorPage';
import { DashboardViewerPage } from '../features/dashboards/DashboardViewerPage';
import { AccessKeysPage } from '../features/accessKeys/AccessKeysPage';
import { EventWriterPage } from '../features/eventWriter/EventWriterPage';
import { ExtractionsPage } from '../features/extractions/ExtractionsPage';
import { MaintenancePage } from '../features/maintenance/MaintenancePage';
import { DatasetsPage } from '../features/datasets/DatasetsPage';
import { SettingsPage } from '../features/settings/SettingsPage';

export function App(): JSX.Element {
  const load = useWorkspaceStore((state) => state.load);
  const initialized = useWorkspaceStore((state) => state.initialized);

  useEffect(() => {
    void load();
  }, [load]);

  if (!initialized) {
    return <div className="splash" role="status"><div className="brand-mark">K</div><p>Opening Keen Key Console…</p></div>;
  }

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/workspaces" replace />} />
        <Route path="/connect" element={<ConnectPage />} />
        <Route path="/workspaces" element={<WorkspacesPage />} />
        <Route path="/w/:workspaceId" element={<WorkspaceLayout />}>
          <Route index element={<OverviewPage />} />
          <Route path="streams" element={<StreamsPage />} />
          <Route path="streams/:collection" element={<StreamDetailPage />} />
          <Route path="query/new" element={<ExplorerPage />} />
          <Route path="query/:draftId" element={<ExplorerPage />} />
          <Route path="saved-queries" element={<SavedQueriesPage />} />
          <Route path="dashboards" element={<DashboardsPage />} />
          <Route path="dashboards/:dashboardId/view" element={<DashboardViewerPage />} />
          <Route path="dashboards/:dashboardId/edit" element={<DashboardEditorPage />} />
          <Route path="access-keys" element={<AccessKeysPage />} />
          <Route path="events/write" element={<EventWriterPage />} />
          <Route path="extract" element={<ExtractionsPage />} />
          <Route path="maintenance" element={<MaintenancePage />} />
          <Route path="datasets" element={<DatasetsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/workspaces" replace />} />
      </Routes>
    </HashRouter>
  );
}
