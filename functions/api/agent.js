import { getSession, json } from './_session.js';

const MODEL = 'gpt-4.1-mini';
const MAX_BODY = 12000;
const MAX_TOOL_ROUNDS = 5;
const API = 'https://api.github.com';

const headers = env => ({
  Authorization: 'Bearer ' + env.GITHUB_DATA_TOKEN,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'Spendwise-Agent'
});

async function loadData(env) {
  const repository = env.GITHUB_DATA_REPO || 'vishwashyadav/spendwise-data';
  const response = await fetch(API + '/repos/' + repository + '/contents/data/spendwise.json', { headers: headers(env) });
  if (!response.ok) throw new Error('Could not load your private Spendwise data.');
  const file = await response.json();
  const bytes = Uint8Array.from(atob(String(file.content || '').replace(/\n/g, '')), c => c.charCodeAt(0));
  const data = JSON.parse(new TextDecoder().decode(bytes));
  if (!Array.isArray(data.transactions)) throw new Error('Your Spendwise data format is invalid.');
  return data;
}

const amount = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const monthOf = date => typeof date === 'string' ? date.slice(0, 7) : '';
const isIncome = transaction => transaction.type === 'income';
const dateInMonth = (transaction, month) => !month || monthOf(transaction.date) === month;

function groupContext(data) {
  const byTransaction = new Map();
  const groups = (Array.isArray(data.expenseGroups) ? data.expenseGroups : []).map(group => {
    const members = data.transactions.filter(t => (group.transactionIds || []).includes(t.id));
    members.forEach(t => byTransaction.set(t.id, group));
    const paid = members.filter(t => !isIncome(t)).reduce((sum, t) => sum + amount(t.amount), 0);
    const received = members.filter(isIncome).reduce((sum, t) => sum + amount(t.amount), 0);
    return { id: group.id, name: group.name || 'Expense group', category: group.category || 'Other', description: group.description || '', paid, received, net: paid - received, transactionCount: members.length, members };
  });
  return { byTransaction, groups };
}

function runTool(name, args, data) {
  const transactions = data.transactions;
  const { byTransaction, groups } = groupContext(data);
  const month = typeof args.month === 'string' && /^\d{4}-\d{2}$/.test(args.month) ? args.month : null;

  if (name === 'get_spending_summary') {
    const rows = transactions.filter(t => dateInMonth(t, month));
    const relevantGroups = groups.filter(g => g.members.some(t => dateInMonth(t, month)));
    const groupedIds = new Set(relevantGroups.flatMap(g => g.members.filter(t => dateInMonth(t, month)).map(t => t.id)));
    const ungrouped = rows.filter(t => !groupedIds.has(t.id));
    const personalExpenses = ungrouped.filter(t => !isIncome(t)).reduce((s, t) => s + amount(t.amount), 0) +
      relevantGroups.reduce((s, g) => s + g.members.filter(t => dateInMonth(t, month) && !isIncome(t)).reduce((n, t) => n + amount(t.amount), 0) -
        g.members.filter(t => dateInMonth(t, month) && isIncome(t)).reduce((n, t) => n + amount(t.amount), 0), 0);
    const personalIncome = ungrouped.filter(isIncome).reduce((s, t) => s + amount(t.amount), 0);
    return { period: month || 'all available dates', transactionCount: rows.length, personalExpenses, personalIncome, netCashFlow: personalIncome - personalExpenses, groupedPayments: relevantGroups.reduce((s, g) => s + g.paid, 0), groupedReimbursements: relevantGroups.reduce((s, g) => s + g.received, 0), groupCount: relevantGroups.length, note: 'Expense-group reimbursements reduce personal expense; they are not treated as earned income. Gross group payments and reimbursements are shown separately.' };
  }

  if (name === 'search_transactions') {
    const query = String(args.query || '').trim().toLowerCase();
    const type = args.type === 'income' || args.type === 'expense' ? args.type : null;
    const limit = Math.min(25, Math.max(1, Number(args.limit) || 15));
    return transactions.filter(t => dateInMonth(t, month))
      .filter(t => !type || (isIncome(t) ? 'income' : 'expense') === type)
      .filter(t => !query || [t.description, t.payee, t.category, t.subcategory, t.reference, t.source].some(v => String(v || '').toLowerCase().includes(query)))
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .slice(0, limit)
      .map(t => ({ date: t.date || null, description: t.description || '', payee: t.payee || '', amount: amount(t.amount), type: isIncome(t) ? 'income' : 'expense', category: t.category || 'Other', subcategory: t.subcategory || '', expenseGroup: byTransaction.get(t.id)?.name || null, groupTreatment: byTransaction.has(t.id) ? (isIncome(t) ? 'reimbursement' : 'group payment') : 'ungrouped' }));
  }

  if (name === 'get_category_breakdown') {
    const rows = transactions.filter(t => dateInMonth(t, month));
    const groupedIds = new Set(groups.flatMap(g => g.members.filter(t => dateInMonth(t, month)).map(t => t.id)));
    const totals = new Map();
    rows.filter(t => !isIncome(t) && !groupedIds.has(t.id)).forEach(t => {
      const category = t.category || 'Other';
      totals.set(category, (totals.get(category) || 0) + amount(t.amount));
    });
    groups.forEach(g => {
      const paid = g.members.filter(t => dateInMonth(t, month) && !isIncome(t)).reduce((s, t) => s + amount(t.amount), 0);
      const received = g.members.filter(t => dateInMonth(t, month) && isIncome(t)).reduce((s, t) => s + amount(t.amount), 0);
      if (paid || received) totals.set(g.category, (totals.get(g.category) || 0) + paid - received);
    });
    return [...totals.entries()].map(([category, total]) => ({ category, personalExpense: total }))
      .sort((a, b) => b.personalExpense - a.personalExpense).slice(0, 20);
  }

  if (name === 'get_monthly_trend') {
    const count = Math.min(24, Math.max(1, Number(args.months) || 6));
    const monthly = new Map();
    transactions.forEach(t => {
      const key = monthOf(t.date);
      if (!/^\d{4}-\d{2}$/.test(key)) return;
      const item = monthly.get(key) || { month: key, personalExpenses: 0, personalIncome: 0, transactions: 0, groupReimbursements: 0 };
      item.transactions++;
      if (byTransaction.has(t.id)) {
        if (isIncome(t)) item.groupReimbursements += amount(t.amount);
        else item.personalExpenses += amount(t.amount);
      } else if (isIncome(t)) item.personalIncome += amount(t.amount);
      else item.personalExpenses += amount(t.amount);
      monthly.set(key, item);
    });
    // Allocate reimbursements against the month of the group's first payment to avoid counting them as income.
    groups.forEach(g => {
      const firstPayment = g.members.filter(t => !isIncome(t)).sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
      if (firstPayment) {
        const item = monthly.get(monthOf(firstPayment.date));
        if (item) item.personalExpenses -= g.received;
      }
    });
    return [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-count);
  }

  if (name === 'list_expense_groups') {
    const query = String(args.query || '').trim().toLowerCase();
    return groups.filter(g => !query || [g.name, g.category, g.description].some(v => String(v || '').toLowerCase().includes(query)))
      .slice(0, 25).map(({ members, ...group }) => group);
  }
  throw new Error('Unsupported tool requested.');
}

const tools = [
  { type: 'function', name: 'get_spending_summary', description: 'Get the user’s actual income, personal expenses and net cash flow. Optionally scope to a calendar month in YYYY-MM format. Expense-group reimbursements reduce personal expense and are not earned income.', strict: true, parameters: { type: 'object', properties: { month: { type: ['string', 'null'], description: 'Calendar month YYYY-MM, or null for all dates.' } }, required: ['month'], additionalProperties: false } },
  { type: 'function', name: 'search_transactions', description: 'Search actual transactions by text, optional month and optional type. Returns at most 25 matching records.', strict: true, parameters: { type: 'object', properties: { query: { type: 'string' }, month: { type: ['string', 'null'] }, type: { type: ['string', 'null'], enum: ['expense', 'income', null] }, limit: { type: 'integer' } }, required: ['query', 'month', 'type', 'limit'], additionalProperties: false } },
  { type: 'function', name: 'get_category_breakdown', description: 'Get personal expenses grouped by category, optionally for a calendar month YYYY-MM. Expense group reimbursements reduce the group category total.', strict: true, parameters: { type: 'object', properties: { month: { type: ['string', 'null'] } }, required: ['month'], additionalProperties: false } },
  { type: 'function', name: 'get_monthly_trend', description: 'Get the latest monthly personal expense and income trend. Group reimbursements are netted against the month of the group’s first payment.', strict: true, parameters: { type: 'object', properties: { months: { type: 'integer' } }, required: ['months'], additionalProperties: false } },
  { type: 'function', name: 'list_expense_groups', description: 'List existing expense groups and their paid, reimbursed and net personal expense totals. Optionally search group name, category or description.', strict: true, parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } }
];

function outputText(response) {
  return (response.output || []).flatMap(item => item.content || [])
    .filter(item => item.type === 'output_text').map(item => item.text || '').join('\n').trim();
}

export async function onRequestPost({ request, env }) {
  const user = await getSession(request, env);
  if (!user) return json({ error: 'Please sign in to use the Spendwise agent.' }, 401);
  if (!env.OPENAI_API_KEY || !env.GITHUB_DATA_TOKEN || !env.SESSION_SECRET) return json({ error: 'The AI agent is not configured. Check the server-side OpenAI and private-data secrets.' }, 503);

  let body;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return json({ error: 'Your message is too long. Please shorten it.' }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'Invalid agent request.' }, 400);
  }

  const question = typeof body?.question === 'string' ? body.question.trim().slice(0, 1500) : '';
  if (!question) return json({ error: 'Enter a question for Spendwise.' }, 400);
  const history = Array.isArray(body?.history) ? body.history.slice(-8).filter(m => ['user', 'assistant'].includes(m?.role) && typeof m?.content === 'string').map(m => ({ role: m.role, content: m.content.slice(0, 2000) })) : [];

  try {
    const data = await loadData(env);
    const input = [...history, { role: 'user', content: question }];
    const toolsUsed = [];
    const instructions = [
      'You are Spendwise Agent, a careful personal finance assistant for an Indian user. Currency is INR.',
      'You MUST use the available tools to answer questions about the user’s actual transactions, balances, spending, categories, groups or trends. Never guess financial data.',
      'Plan the minimum set of tool calls needed. You may call multiple read-only tools when useful. Explain the key figures and how you arrived at them.',
      'Treat expense groups correctly: payments and reimbursements belong together; reimbursements are not earned income, and net group expense is the user’s personal cost. Do not double-count group cash flows.',
      'If the user asks for an action that changes data, explain that this first version is read-only and do not claim to have made changes. Never request bank credentials, OTPs or payment details.',
      'If a question is ambiguous, ask one concise clarification. If the data does not support a conclusion, say so. Be concise, practical and non-judgmental. Use ₹ and Indian number formatting where practical.'
    ].join(' ');

    let response;
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const apiResponse = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + env.OPENAI_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, instructions, input, tools, tool_choice: 'auto', max_output_tokens: 900 })
      });
      response = await apiResponse.json().catch(() => ({}));
      if (!apiResponse.ok) return json({ error: response.error?.message || 'The AI provider could not complete your request.' }, apiResponse.status === 429 ? 429 : 502);

      const calls = (response.output || []).filter(item => item.type === 'function_call');
      if (!calls.length) break;
      if (round === MAX_TOOL_ROUNDS) return json({ error: 'The agent reached its tool-call limit. Please narrow your question.' }, 502);

      input.push(...response.output);
      for (const call of calls) {
        let result;
        try {
          const args = JSON.parse(call.arguments || '{}');
          result = runTool(call.name, args, data);
          toolsUsed.push(call.name);
        } catch (error) {
          result = { error: error.message || 'Tool execution failed.' };
        }
        input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) });
      }
    }

    const reply = outputText(response);
    if (!reply) return json({ error: 'The agent returned an empty response. Please try again.' }, 502);
    return json({ reply, toolsUsed: [...new Set(toolsUsed)] });
  } catch (error) {
    return json({ error: error.message || 'Spendwise could not complete your request.' }, 502);
  }
}
