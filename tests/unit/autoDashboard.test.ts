import { describe, expect, it } from 'vitest';
import type { ChartWidget } from '@shared/types';
import { autoDashboardMetadata, automaticDashboardWriteDecision, buildAutomaticDashboards, previousAutomaticDashboardQueryValues } from '@/lib/dashboard/autoDashboard';
import type { StreamSchema } from '@/lib/schema/collections';

const sessionSchema: StreamSchema = {
  name: 'slack_stream',
  properties: {
    'keen.timestamp': 'string',
    eventType: 'string',
    'session.sessionId': 'string',
    'session.eventId': 'string',
    'session.machineId': 'string',
    'session.gameId': 'string',
    'session.status': 'string',
    'session.dwellMs': 'num',
    'session.result': 'num'
  },
  raw: {}
};

function charts(document: ReturnType<typeof buildAutomaticDashboards>[number]): ChartWidget[] {
  return document.widgets.filter((widget): widget is ChartWidget => widget.type === 'chart');
}

describe('automatic dashboard templates', () => {
  it('creates a complete session overview plus dedicated start and end dashboards', () => {
    const documents = buildAutomaticDashboards('workspace-a', [sessionSchema], {}, {
      eventTypeProperty: 'eventType',
      timeframe: 'this_30_days',
      timezone: 'America/Detroit',
      dimensionValues: {
        slack_stream: {
          'session.eventId': ['Builders Lab'],
          'session.machineId': ['tablet-01', 'tablet-02'],
          'session.gameId': ['game-a', 'game-b']
        }
      }
    });

    expect(documents).toHaveLength(3);
    const overview = documents.find((document) => autoDashboardMetadata(document)?.kind === 'stream');
    const start = documents.find((document) => autoDashboardMetadata(document)?.eventType === 'session_start');
    const end = documents.find((document) => autoDashboardMetadata(document)?.eventType === 'session_end');
    expect(overview).toBeDefined();
    expect(start).toBeDefined();
    expect(end).toBeDefined();

    const overviewTitles = charts(overview!).map((widget) => widget.title);
    expect(overviewTitles).toEqual(expect.arrayContaining([
      'Sessions started',
      'Sessions ended',
      'Completed',
      'Abandoned',
      'Start-to-end conversion',
      'Average session duration',
      'Average result by game',
      'Sessions by game',
      'Sessions by machine',
      'Sessions by event'
    ]));

    const startCharts = charts(start!);
    expect(startCharts.map((widget) => widget.title)).toEqual(expect.arrayContaining([
      'Sessions started',
      'Unique sessions',
      'Starts over time',
      'By game',
      'By machine',
      'By event'
    ]));
    expect(startCharts.some((widget) => widget.source.kind === 'ad-hoc' && widget.source.query.target_property === 'session.dwellMs')).toBe(false);

    const endTitles = charts(end!).map((widget) => widget.title);
    expect(endTitles).toEqual(expect.arrayContaining([
      'Sessions ended',
      'Completed',
      'Abandoned',
      'Completion outcomes',
      'Average duration',
      'Duration over time',
      'Average result by game'
    ]));


    const overviewDate = overview!.widgets.find((widget) => widget.type === 'date-range');
    expect(overviewDate).toMatchObject({ type: 'date-range', timezone: 'America/Detroit' });

    const overviewFilters = overview!.widgets.filter((widget) => widget.type === 'filter');
    expect(overviewFilters.find((widget) => widget.type === 'filter' && widget.propertyName === 'session.machineId')).toMatchObject({ options: ['tablet-01', 'tablet-02'], optionSource: 'query' });
    expect(overviewFilters.find((widget) => widget.type === 'filter' && widget.propertyName === 'session.gameId')).toMatchObject({ options: ['game-a', 'game-b'], optionSource: 'query' });

    const completed = charts(overview!).find((widget) => widget.title === 'Completed');
    const abandoned = charts(overview!).find((widget) => widget.title === 'Abandoned');
    const statusFilter = overviewFilters.find((widget) => widget.type === 'filter' && widget.propertyName === 'session.status');
    expect(statusFilter?.type === 'filter' && statusFilter.targetWidgetIds).not.toContain(completed?.id);
    expect(statusFilter?.type === 'filter' && statusFilter.targetWidgetIds).not.toContain(abandoned?.id);

    const startedMetric = charts(overview!).find((widget) => widget.title === 'Sessions started');
    const startedTimeline = charts(overview!).find((widget) => widget.title === 'Starts over time');
    expect(startedMetric?.source.kind === 'ad-hoc' && startedMetric.source.query).not.toHaveProperty('zero_fill');
    expect(startedTimeline?.source.kind === 'ad-hoc' && startedTimeline.source.query.zero_fill).toBe(true);
  });

  it('creates one overview for every stream and one dashboard for every discovered event type', () => {
    const generic: StreamSchema = {
      name: 'device_events',
      properties: {
        eventType: 'string',
        deviceId: 'string',
        durationMs: 'num'
      },
      raw: {}
    };
    const documents = buildAutomaticDashboards('workspace-b', [generic], {
      device_events: ['activated', 'deactivated', 'heartbeat']
    });
    expect(documents.map((document) => autoDashboardMetadata(document)?.key)).toEqual([
      'stream:device_events:*',
      'event-type:device_events:activated',
      'event-type:device_events:deactivated',
      'event-type:device_events:heartbeat'
    ]);
    expect(documents.every((document) => document.layout.length === document.widgets.length)).toBe(true);
  });


  it('refreshes untouched generated dashboards after a template or schema change but preserves customized copies', () => {
    const current = buildAutomaticDashboards('workspace-d', [sessionSchema])[0];
    const changedSchema: StreamSchema = {
      ...sessionSchema,
      properties: { ...sessionSchema.properties, 'session.newDimension': 'string' }
    };
    const generated = buildAutomaticDashboards('workspace-d', [changedSchema])[0];

    expect(automaticDashboardWriteDecision(current, generated)).toBe('refresh');
    const customized = {
      ...current,
      title: 'My customized session board',
      updatedAt: new Date(Date.parse(current.updatedAt) + 1_000).toISOString()
    };
    expect(automaticDashboardWriteDecision(customized, generated)).toBe('preserve');
    expect(automaticDashboardWriteDecision(customized, generated, true)).toBe('refresh');
  });

  it('refreshes untouched dashboards when live filter choices or configured timeframe change', () => {
    const current = buildAutomaticDashboards('workspace-values', [sessionSchema], {}, {
      timeframe: 'this_30_days',
      dimensionValues: { slack_stream: { 'session.machineId': ['tablet-01'] } }
    })[0];
    const nextValues = buildAutomaticDashboards('workspace-values', [sessionSchema], {}, {
      timeframe: 'this_30_days',
      dimensionValues: { slack_stream: { 'session.machineId': ['tablet-01', 'tablet-02'] } }
    })[0];
    const nextTimeframe = buildAutomaticDashboards('workspace-values', [sessionSchema], {}, {
      timeframe: 'this_90_days',
      dimensionValues: { slack_stream: { 'session.machineId': ['tablet-01'] } }
    })[0];

    expect(autoDashboardMetadata(current)?.contentFingerprint).not.toBe(autoDashboardMetadata(nextValues)?.contentFingerprint);
    expect(automaticDashboardWriteDecision(current, nextValues)).toBe('refresh');
    expect(automaticDashboardWriteDecision(current, nextTimeframe)).toBe('refresh');
  });

  it('retains the last successful query-backed filter choices across a later partial discovery failure', () => {
    const documents = buildAutomaticDashboards('workspace-retained-values', [sessionSchema], {}, {
      dimensionValues: {
        slack_stream: {
          'session.eventId': ['Builders Lab'],
          'session.machineId': ['tablet-01', 'tablet-02'],
          'session.gameId': ['game-a']
        }
      }
    });

    expect(previousAutomaticDashboardQueryValues(documents)).toEqual({
      slack_stream: {
        'session.eventId': ['Builders Lab'],
        'session.machineId': ['tablet-01', 'tablet-02'],
        'session.gameId': ['game-a']
      }
    });
  });

  it('uses deterministic dashboard and widget identifiers so repeated syncs do not duplicate records', () => {
    const first = buildAutomaticDashboards('workspace-c', [sessionSchema]);
    const second = buildAutomaticDashboards('workspace-c', [sessionSchema]);
    expect(second.map((document) => document.id)).toEqual(first.map((document) => document.id));
    expect(second.map((document) => document.widgets.map((widget) => widget.id))).toEqual(first.map((document) => document.widgets.map((widget) => widget.id)));
  });
});
