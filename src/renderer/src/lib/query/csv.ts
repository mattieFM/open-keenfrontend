import type { SemanticResult } from '@shared/types';

function escapeCell(value: unknown): string {
  const text = value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function semanticResultToRows(result: SemanticResult): Array<Record<string, unknown>> {
  switch (result.kind) {
    case 'scalar': return [{ result: result.value }];
    case 'grouped':
    case 'interval':
    case 'records': return result.rows;
    case 'unique': return result.values.map((value) => ({ value }));
    case 'funnel': return result.values.map((value, index) => ({ step: index + 1, result: value }));
    case 'multi': return Object.entries(result.values).map(([analysis, value]) => ({ analysis, value }));
    case 'unknown': return [{ value: result.value }];
  }
}

export function toCsv(result: SemanticResult): string {
  const rows = semanticResultToRows(result);
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return [headers.map(escapeCell).join(','), ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join(','))].join('\n');
}
