import { HashRouter, Route, Routes } from 'react-router-dom';
import { PublicViewerPage } from '../features/publicViewer/PublicViewerPage';

/**
 * Public viewer bootstrap. This route intentionally excludes workspace, editor,
 * IndexedDB repository, and credential-vault initialization.
 */
export function PublicApp(): JSX.Element {
  return (
    <HashRouter>
      <Routes>
        <Route path="/public/:projectId/:dashboardId" element={<PublicViewerPage />} />
        <Route path="*" element={<main className="public-shell"><p>Invalid public dashboard link.</p></main>} />
      </Routes>
    </HashRouter>
  );
}
