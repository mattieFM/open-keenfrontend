import type { KeenFilter, QueryDraft } from '@shared/types';

export const ANALYSIS_TYPES = [
  'count', 'count_unique', 'sum', 'average', 'minimum', 'maximum', 'median',
  'percentile', 'select_unique', 'standard_deviation', 'extraction', 'funnel', 'multi_analysis'
] as const;

const TARGET_REQUIRED = new Set(['count_unique', 'sum', 'average', 'minimum', 'maximum', 'median', 'percentile', 'select_unique', 'standard_deviation']);
const VALUE_OPTIONAL = new Set(['exists']);

function orOperands(filter: KeenFilter): KeenFilter[] | undefined {
  if (filter.operator !== 'or') return undefined;
  return Array.isArray(filter.operands) ? filter.operands as KeenFilter[] : undefined;
}

function walkFilters(filters: KeenFilter[], path = 'filters'): string[] {
  const errors: string[] = [];
  filters.forEach((filter, index) => {
    const itemPath = `${path}[${index}]`;
    if (filter.operator === 'or') {
      const operands = orOperands(filter);
      if (!operands || operands.length < 2) errors.push(`${itemPath} OR requires at least two operands.`);
      else errors.push(...walkFilters(operands, `${itemPath}.operands`));
      return;
    }
    const propertyName = typeof filter.property_name === 'string' ? filter.property_name : '';
    const operator = typeof filter.operator === 'string' ? filter.operator : '';
    if (!propertyName.trim()) errors.push(`${itemPath} needs property_name.`);
    if (!operator.trim()) errors.push(`${itemPath} needs operator.`);
    if (!VALUE_OPTIONAL.has(operator) && !('property_value' in filter)) errors.push(`${itemPath} needs property_value.`);
    if (operator === 'in' && !Array.isArray(filter.property_value)) errors.push(`${itemPath} in requires an array value.`);
    if (operator === 'within' && (!filter.property_value || typeof filter.property_value !== 'object')) errors.push(`${itemPath} within requires a geographic value object.`);
  });
  return errors;
}

function hasOperator(filters: KeenFilter[] | undefined, operator: string): boolean {
  return Boolean(filters?.some((filter) => filter.operator === operator || hasOperator(orOperands(filter), operator)));
}

function validTimeframe(timeframe: QueryDraft['timeframe']): string[] {
  if (!timeframe) return ['Timeframe is required.'];
  if (typeof timeframe === 'string') return timeframe.trim() ? [] : ['Timeframe is required.'];
  const errors: string[] = [];
  if (!timeframe.start || !timeframe.end) errors.push('Absolute timeframe needs start and end values.');
  const start = Date.parse(timeframe.start); const end = Date.parse(timeframe.end);
  if (timeframe.start && Number.isNaN(start)) errors.push('Absolute timeframe start must be valid ISO-8601.');
  if (timeframe.end && Number.isNaN(end)) errors.push('Absolute timeframe end must be valid ISO-8601.');
  if (Number.isFinite(start) && Number.isFinite(end) && start >= end) errors.push('Absolute timeframe end must be after start and is exclusive.');
  return errors;
}

export function validateQuery(query: QueryDraft): string[] {
  const errors: string[] = [];
  if (!ANALYSIS_TYPES.includes(query.analysis_type as (typeof ANALYSIS_TYPES)[number])) errors.push('Choose a supported analysis type.');

  if (query.analysis_type === 'funnel') {
    if (!Array.isArray(query.steps) || query.steps.length < 2) errors.push('A funnel requires at least two steps.');
    query.steps?.forEach((step, index) => {
      if (!step.event_collection?.trim()) errors.push(`Funnel step ${index + 1} requires an event collection.`);
      if (!step.actor_property?.trim()) errors.push(`Funnel step ${index + 1} requires an actor property.`);
      if (index === 0 && (step.optional || step.inverted)) errors.push('The first funnel step cannot be optional or inverted.');
      if (step.filters) errors.push(...walkFilters(step.filters, `steps[${index}].filters`));
      if (step.timeframe) errors.push(...validTimeframe(step.timeframe).map((message) => `Funnel step ${index + 1}: ${message}`));
    });
    if (!query.timeframe && !query.steps?.every((step) => Boolean(step.timeframe))) errors.push('Funnel needs a shared timeframe or a timeframe on every step.');
    if (query.timeframe) errors.push(...validTimeframe(query.timeframe));
    if (query.interval || query.group_by) errors.push('Funnels do not support interval or group_by.');
  } else {
    if (!query.event_collection?.trim()) errors.push('Event collection is required.');
    errors.push(...validTimeframe(query.timeframe));
  }

  if (query.analysis_type === 'multi_analysis') {
    if (!query.analyses || Object.keys(query.analyses).length === 0) errors.push('Multi-analysis requires at least one named analysis.');
    for (const [name, analysis] of Object.entries(query.analyses ?? {})) {
      if (!name.trim()) errors.push('Multi-analysis names cannot be blank.');
      if (!analysis.analysis_type || typeof analysis.analysis_type !== 'string') errors.push(`Multi-analysis “${name}” needs analysis_type.`);
    }
  }
  if (TARGET_REQUIRED.has(query.analysis_type) && !query.target_property?.trim()) errors.push('Target property is required for this analysis.');
  if (query.analysis_type === 'percentile' && (query.percentile === undefined || !Number.isFinite(query.percentile) || query.percentile < 0 || query.percentile > 100)) errors.push('Percentile must be between 0 and 100.');
  if (query.analysis_type === 'extraction' && query.latest !== undefined && (!Number.isInteger(query.latest) || query.latest <= 0)) errors.push('Extraction latest must be a positive integer.');
  if (hasOperator(query.filters, 'within') && query.group_by) errors.push('Geo within filters cannot be combined with group_by.');
  if (query.filters) errors.push(...walkFilters(query.filters));
  if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit <= 0)) errors.push('Limit must be a positive integer.');
  query.order_by?.forEach((clause, index) => {
    if (!clause.property_name?.trim()) errors.push(`Order clause ${index + 1} needs property_name.`);
    if (clause.direction && !['ASC', 'DESC'].includes(clause.direction)) errors.push(`Order clause ${index + 1} direction must be ASC or DESC.`);
  });
  return [...new Set(errors)];
}

export function queryBody(query: QueryDraft): Record<string, unknown> {
  const { analysis_type: _analysisType, ...body } = query;
  if (body.timeframe && typeof body.timeframe === 'object') delete body.timezone;
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined && value !== ''));
}
