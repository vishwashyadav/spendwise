import { getSession, json } from './_session.js';

const MODEL = 'gpt-4.1-mini';
const MAX_BODY = 24000;

export async function onRequestPost({ request, env }) {
  const user = await getSession(request, env);
  if (!user) return json({ error: 'Please sign in with GitHub to use AI insights.' }, 401);
  if (!env.OPENAI_API_KEY) return json({ error: 'AI insights are not configured yet. Add OPENAI_API_KEY to your Cloudflare Pages environment variables.' }, 503);

  let body;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return json({ error: 'The report is too large. Narrow your filters and try again.' }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'Invalid report request.' }, 400);
  }

  const report = body?.report;
  const question = typeof body?.question === 'string' ? body.question.trim().slice(0, 500) : '';
  if (!report || typeof report !== 'object' || !report.totals || !Array.isArray(report.categories) || !Array.isArray(report.monthly)) {
    return json({ error: 'The spending report is incomplete.' }, 400);
  }

  // Accept only aggregate numeric data. Never forward transaction descriptions,
  // payee names, references, account identifiers or raw transaction rows.
  const safeNumber = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  const safeReport = {
    currency: 'INR',
    period: {
      from: typeof report.period?.from === 'string' ? report.period.from.slice(0, 10) : null,
      to: typeof report.period?.to === 'string' ? report.period.to.slice(0, 10) : null,
      month: typeof report.period?.month === 'string' ? report.period.month.slice(0, 40) : 'Selected period'
    },
    totals: {
      expenses: safeNumber(report.totals.expenses),
      income: safeNumber(report.totals.income),
      expenseCount: safeNumber(report.totals.expenseCount),
      incomeCount: safeNumber(report.totals.incomeCount),
      transactionCount: safeNumber(report.totals.transactionCount)
    },
    monthly: report.monthly.slice(-18).map(item => ({
      period: String(item.period || '').slice(0, 20),
      income: safeNumber(item.income),
      expenses: safeNumber(item.expenses),
      transactions: safeNumber(item.transactions)
    })),
    categories: report.categories.slice(0, 15).map(item => ({
      category: String(item.category || 'Other').slice(0, 50),
      amount: safeNumber(item.amount),
      count: safeNumber(item.count)
    }))
  };

  const instructions = [
    'You are Spendwise, a careful personal-finance analysis assistant for an Indian user. Currency is INR.',
    'Analyse only the supplied aggregate report. Do not invent transactions, dates, reasons, merchant names, trends or financial facts.',
    'If there is not enough history to support a comparison, say so explicitly. Distinguish observations from suggestions.',
    'Prioritise 3 to 5 useful, specific insights: largest spending drivers, meaningful month-to-month changes when comparable months exist, savings opportunities, cash-flow observations, and anomalies that can genuinely be inferred from aggregates.',
    'Use exact amounts and percentages only when they can be calculated from the supplied numbers. Do not assume recurring expenses or income stability.',
    'Give practical, achievable actions. Do not recommend investments, loans, tax positions or other regulated financial products. Do not shame the user.',
    'Use concise Markdown with headings: Key takeaways, What stands out, Actions to consider. Address the user’s question if provided. If the report is empty or very small, explain the limitation and suggest what data would make the analysis more useful.'
  ].join(' ');

  const prompt = 'User question: ' + (question || 'Please analyse this report and surface the most important insights.') +
    '\n\nAggregated spending report (INR):\n' + JSON.stringify(safeReport);

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.OPENAI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        instructions,
        input: prompt,
        max_output_tokens: 900
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = result.error?.message || 'The AI provider could not complete the analysis.';
      return json({ error: detail }, response.status === 429 ? 429 : 502);
    }
    const insight = (result.output || [])
      .flatMap(item => item.content || [])
      .filter(item => item.type === 'output_text')
      .map(item => item.text || '')
      .join('\n\n').trim();
    if (!insight) return json({ error: 'The AI returned an empty analysis. Please try again.' }, 502);
    return json({ insight });
  } catch {
    return json({ error: 'Could not reach the AI service. Please try again shortly.' }, 502);
  }
}
