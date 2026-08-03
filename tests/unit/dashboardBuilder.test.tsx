import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { QueryDraft } from '@shared/types';
import { DashboardQueryBuilder } from '@/features/dashboards/DashboardQueryBuilder';

function Harness(): JSX.Element {
  const [query, setQuery] = useState<QueryDraft>({
    analysis_type: 'count',
    event_collection: 'slack_stream',
    timeframe: 'this_30_days',
    filters: []
  });
  return <DashboardQueryBuilder
    query={query}
    onChange={setQuery}
    collections={['slack_stream']}
    properties={['eventType', 'session.sessionId', 'session.gameId', 'session.dwellMs']}
    schemaLoading={false}
    onLoadCollections={() => undefined}
    onLoadProperties={() => undefined}
  />;
}

describe('visual dashboard query builder', () => {
  it('provides guided analysis, timeframe, filter, grouping, and funnel controls without a JSON editor', () => {
    render(<Harness />);

    expect(screen.getByLabelText(/Analysis/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Event stream/i)).toHaveValue('slack_stream');
    expect(screen.getByText('Filters')).toBeInTheDocument();
    expect(screen.getByText('Breakdown and timeline')).toBeInTheDocument();
    expect(screen.queryByLabelText(/json/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Analysis/i), { target: { value: 'funnel' } });
    expect(screen.getByText('Funnel steps')).toBeInTheDocument();
    expect(screen.getAllByLabelText(/Event collection/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: /Add funnel step/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/json/i)).not.toBeInTheDocument();
  });
});
