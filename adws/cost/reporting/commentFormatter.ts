/**
 * Comment formatter for PhaseCostRecord data.
 * Renders cost tables, divergence warnings, and estimate-vs-actual comparisons
 * as markdown for GitHub issue and PR comments.
 */

import type { PhaseCostRecord } from '../types.ts';
import { checkDivergence } from '../computation.ts';
import { fetchExchangeRates, CURRENCY_SYMBOLS } from '../exchangeRates.ts';
import { SHOW_COST_IN_COMMENTS, COST_REPORT_CURRENCIES } from '../../core/config.ts';

/** Fixed superset of token columns always present in every CSV, in display order. */
const FIXED_TOKEN_COLUMNS = ['input', 'output', 'cache_read', 'cache_write', 'reasoning'] as const;

/**
 * Collects all token type keys across all records.
 * Returns FIXED_TOKEN_COLUMNS first, then any unknown types appended alphabetically.
 */
function collectAllTokenTypes(records: readonly PhaseCostRecord[]): string[] {
  const known = new Set<string>(FIXED_TOKEN_COLUMNS);
  const extras = new Set<string>();

  for (const record of records) {
    for (const key of Object.keys(record.tokenUsage)) {
      if (!known.has(key)) {
        extras.add(key);
      }
    }
  }

  return [...FIXED_TOKEN_COLUMNS, ...[...extras].sort()];
}

/** Formats a number with commas as thousands separator. */
function formatTokenCount(n: number): string {
  return n.toLocaleString('en-US');
}

/** Converts a snake_case token type key to a Title Case column header. */
function toColumnHeader(tokenType: string): string {
  return tokenType.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Renders a per-model cost table with dynamic token type columns.
 * Each row represents one PhaseCostRecord (one model per phase).
 * Includes a totals row at the bottom.
 */
export function formatCostTable(records: readonly PhaseCostRecord[]): string {
  if (records.length === 0) return '';

  const tokenTypes = collectAllTokenTypes(records);
  const headers = ['Phase', 'Model', ...tokenTypes.map(toColumnHeader), 'Cost (USD)'];
  const headerRow = `| ${headers.join(' | ')} |`;
  const separatorRow = `| ${headers.map(() => '---').join(' | ')} |`;

  const dataRows = records.map(r => {
    const tokenCols = tokenTypes.map(t => formatTokenCount(r.tokenUsage[t] ?? 0));
    return `| ${r.phase} | ${r.model} | ${tokenCols.join(' | ')} | $${r.computedCostUsd.toFixed(4)} |`;
  });

  const totalCost = records.reduce((sum, r) => sum + r.computedCostUsd, 0);
  const totalTokenCols = tokenTypes.map(t =>
    `**${formatTokenCount(records.reduce((s, r) => s + (r.tokenUsage[t] ?? 0), 0))}**`
  );
  const totalsRow = `| **Total** | | ${totalTokenCols.join(' | ')} | **$${totalCost.toFixed(4)}** |`;

  return [headerRow, separatorRow, ...dataRows, totalsRow].join('\n');
}

/**
 * Checks each record for >5% divergence between computed and reported costs.
 * Returns a blockquote warning listing divergent phases/models, or empty string.
 */
export function formatDivergenceWarning(records: readonly PhaseCostRecord[]): string {
  const divergent = records
    .map(r => ({ record: r, result: checkDivergence(r.computedCostUsd, r.reportedCostUsd) }))
    .filter(({ result }) => result.isDivergent);

  if (divergent.length === 0) return '';

  const items = divergent.map(({ record, result }) => {
    const pct = isFinite(result.percentDiff) ? `${result.percentDiff.toFixed(1)}%` : '∞';
    const reported = result.reportedCostUsd !== undefined
      ? `$${result.reportedCostUsd.toFixed(4)}`
      : 'N/A';
    return `> - **${record.phase}** (${record.model}): computed $${result.computedCostUsd.toFixed(4)} vs reported ${reported} (${pct} diff)`;
  });

  return [
    '> :warning: **Cost Divergence Detected**',
    '>',
    '> Computed vs reported cost differs by >5% for the following phases:',
    '>',
    ...items,
  ].join('\n');
}

/**
 * Compares estimated vs actual token counts for records that have both fields populated.
 * Returns a comparison table with absolute delta and percentage, or empty string.
 */
export function formatEstimateVsActual(records: readonly PhaseCostRecord[]): string {
  const withEstimates = records.filter(r => r.estimatedTokens && r.actualTokens);
  if (withEstimates.length === 0) return '';

  const headerRow = '| Phase | Model | Token Type | Estimated | Actual | Delta | Delta % |';
  const separatorRow = '|-------|-------|------------|-----------|--------|-------|---------|';

  const rows: string[] = [];
  for (const record of withEstimates) {
    const { estimatedTokens, actualTokens } = record;
    if (!estimatedTokens || !actualTokens) continue;

    const tokenTypes = [...new Set([...Object.keys(estimatedTokens), ...Object.keys(actualTokens)])].sort();
    for (const tokenType of tokenTypes) {
      const estimated = estimatedTokens[tokenType] ?? 0;
      const actual = actualTokens[tokenType] ?? 0;
      const delta = actual - estimated;
      const deltaPct = estimated > 0 ? `${((delta / estimated) * 100).toFixed(1)}%` : 'N/A';
      const deltaStr = delta >= 0 ? `+${formatTokenCount(delta)}` : formatTokenCount(delta);
      rows.push(
        `| ${record.phase} | ${record.model} | ${tokenType} | ${formatTokenCount(estimated)} | ${formatTokenCount(actual)} | ${deltaStr} | ${deltaPct} |`
      );
    }
  }

  if (rows.length === 0) return '';
  return ['**Estimate vs Actual Tokens**', '', headerRow, separatorRow, ...rows].join('\n');
}

/**
 * Renders total cost in USD and any additional currencies using the provided rates.
 */
export function formatCurrencyTotals(totalUsd: number, rates: Record<string, number>): string {
  const lines = [`**Total Cost:** $${totalUsd.toFixed(4)} USD`];

  for (const [currency, rate] of Object.entries(rates)) {
    const symbol = CURRENCY_SYMBOLS[currency] ?? currency;
    lines.push(`**Total Cost:** ${symbol}${(totalUsd * rate).toFixed(4)} ${currency}`);
  }

  return lines.join('\n');
}

/**
 * Main entry point. Formats a complete cost section as a `<details>` block.
 * Returns an empty string when `SHOW_COST_IN_COMMENTS` is falsy or records are empty.
 * Fetches live exchange rates for the requested currencies.
 */
export async function formatCostCommentSection(
  records: readonly PhaseCostRecord[],
  currencies: string[] = [...COST_REPORT_CURRENCIES],
): Promise<string> {
  if (!SHOW_COST_IN_COMMENTS) return '';
  if (records.length === 0) return '';

  const nonUsdCurrencies = currencies.filter(c => c !== 'USD');
  const rates = nonUsdCurrencies.length > 0 ? await fetchExchangeRates(nonUsdCurrencies) : {};

  const totalUsd = records.reduce((sum, r) => sum + r.computedCostUsd, 0);

  const sections = [
    formatCostTable(records),
    formatCurrencyTotals(totalUsd, rates),
    formatDivergenceWarning(records),
    formatEstimateVsActual(records),
  ].filter(s => s.length > 0).join('\n\n');

  return `\n\n<details>\n<summary>Cost Breakdown</summary>\n\n${sections}\n\n</details>`;
}
