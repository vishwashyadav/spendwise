# Spendwise

A mobile-friendly personal expenditure tracker built with React + Vite and hosted on Cloudflare Pages.

## Features
- PhonePe CSV import and CSV export
- Manual income and expense entry
- Payee-to-category rules remembered across imports
- Monthly expense trend and category-wise breakdown
- Private cross-device sync to a separate GitHub repository
- GitHub OAuth sign-in restricted to one allowed account


## Expense Groups

Users can select multiple existing transactions and create an Expense Group, or add ungrouped transactions to an existing group. Groups retain the original transaction records and store only their transaction IDs, name, category, optional description and creation timestamp in the private `data/spendwise.json` payload. Group detail views show gross payments, money received and net personal expense. Removing a transaction from a group never deletes the underlying transaction. A transaction can belong to only one group at a time.

## AI spending insights

The dashboard can generate on-demand spending analysis through a Cloudflare Pages Function at `/api/insights`. It sends only aggregated totals, month buckets and category summaries to the OpenAI API; it does not send transaction descriptions, payee names or raw transaction rows. The endpoint requires an authenticated Spendwise session and the server-side `OPENAI_API_KEY` secret. AI observations are informational and are not financial advice.

## Architecture
- This repository contains the public frontend and Cloudflare Pages Functions.
- The private data repository is `vishwashyadav/spendwise-data`; data lives in `data/spendwise.json`.
- The browser never receives the private repository access token.
- OAuth sign-in uses the GitHub `read:user` scope; a separate fine-grained GitHub token, scoped only to the private data repository with Contents read/write, is held as a Cloudflare secret.

## Deploy to Cloudflare Pages
Connect this GitHub repository to Cloudflare Pages:
- Build command: `npm run build`
- Build output directory: `dist`

Add these environment variables to the Pages project (Production and Preview as appropriate):
- `GITHUB_CLIENT_ID`: GitHub OAuth App client ID
- `GITHUB_CLIENT_SECRET`: GitHub OAuth App client secret (secret)
- `GITHUB_ALLOWED_USER`: `vishwashyadav`
- `GITHUB_DATA_REPO`: `vishwashyadav/spendwise-data`
- `GITHUB_DATA_TOKEN`: fine-grained PAT restricted to the private data repo; Contents read/write only (secret)
- `SESSION_SECRET`: long random secret (secret)
- `OPENAI_API_KEY`: OpenAI API key used only by the server-side AI insights endpoint (secret). Create one in the OpenAI platform and add it under Cloudflare Pages → Settings → Variables and Secrets. Never add it as a `VITE_` variable.

Create a GitHub OAuth App with:
- Homepage URL: `https://YOUR-DOMAIN`
- Authorization callback URL: `https://YOUR-DOMAIN/api/auth/callback`
- Requested scope: `read:user` only

For the fine-grained PAT, select only the `spendwise-data` repository and grant Contents read/write. Store it only as the Cloudflare Pages secret `GITHUB_DATA_TOKEN`.

Never put OAuth secrets, the data token, or session secret in Vite variables or frontend code.


## Spendwise AI Agent (Milestone 1)

The AI Agent is available from the **AI Agent** navigation item. It uses the server-side Cloudflare Pages Function at `/api/agent`, the existing authenticated Spendwise session, and the existing private GitHub data repository. It requires the same `OPENAI_API_KEY`, `GITHUB_DATA_REPO`, and `GITHUB_DATA_TOKEN` secrets already used by Spendwise.

The first milestone is intentionally read-only. The agent uses OpenAI Responses API tool calling with five deterministic server-side tools:

- `get_spending_summary`: personal expenses, personal income and net cash flow, with reimbursements excluded from earned income.
- `search_transactions`: search transactions by text, month and type.
- `get_category_breakdown`: category totals using net expense-group costs.
- `get_monthly_trend`: month-by-month personal spending and income.
- `list_expense_groups`: group payment, reimbursement and net-cost totals.

The browser sends the user's question and a short conversation history. The server authenticates the session, loads private data directly from GitHub, executes only the tools selected by the model, and returns the answer plus the names of tools used. The private data token and OpenAI key never reach the browser. Transaction-level results needed to answer a question are sent to OpenAI; avoid asking questions that expose information you do not want processed by the AI provider.

No transaction, category, group, budget or other financial record can be changed by this first version. Mutating tools and approval workflows are planned for a later milestone.
