import React, { useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell, BarChart, Bar } from 'recharts';
import { Wallet, Plus, Upload, Download, LogIn, LogOut, RefreshCw, Search, Trash2, TrendingUp, IndianRupee, CalendarDays, Tags, ShieldCheck } from 'lucide-react';

const CATEGORIES = ['Food & Dining','Groceries','Transport','Shopping','Bills & Utilities','Entertainment','Health','Travel','Education','Home','Other'];
const COLORS = ['#7666e8','#19a78b','#f59e0b','#e76f51','#4c91d8','#b56bd6','#d65d87','#84934b','#5e718b','#c18a52','#929292'];
const money = n => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(Number(n)||0);
const monthKey = d => { const x = new Date(d); return Number.isNaN(+x) ? 'Unknown' : x.toLocaleString('en-IN',{month:'short',year:'2-digit'}); };
const localDate = () => { const d = new Date(); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10); };
const initial = { transactions: [], rules: {}, schemaVersion: 1 };

function guessCategory(text, rules) {
  const s = String(text||'').toLowerCase();
  const matched = Object.keys(rules||{}).find(k => k && s.includes(k.toLowerCase()));
  if (matched) return rules[matched];
  if (/swiggy|zomato|restaurant|cafe|food|pizza|domino|mcdonald/.test(s)) return 'Food & Dining';
  if (/bigbasket|blinkit|zepto|grocery|dmart|supermarket/.test(s)) return 'Groceries';
  if (/uber|ola|rapido|metro|fuel|petrol|fastag|irctc/.test(s)) return 'Transport';
  if (/amazon|flipkart|myntra|ajio/.test(s)) return 'Shopping';
  if (/electricity|bescom|water|broadband|recharge|bill/.test(s)) return 'Bills & Utilities';
  if (/netflix|prime video|hotstar|bookmyshow/.test(s)) return 'Entertainment';
  if (/hospital|pharmacy|apollo|medplus|clinic/.test(s)) return 'Health';
  return 'Other';
}
function normalizeDate(value) {
  if (!value) return localDate();
  const s = String(value).trim();
  const d = new Date(s);
  if (!Number.isNaN(+d)) return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (m) return `${m[3].length===2?'20'+m[3]:m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return localDate();
}
function rowToTransaction(row, rules) {
  const entries = Object.entries(row).map(([k,v])=>[k.toLowerCase().replace(/[^a-z]/g,''),String(v??'').trim()]);
  const get = (...keys) => entries.find(([k,v])=>keys.some(x=>k.includes(x)) && v)?.[1] || '';
  const desc = get('description','remark','merchant','payee','narration','transactiondetails','name','details') || 'Imported transaction';
  const amountRaw = get('amount','debit','withdrawal','paid');
  const creditRaw = get('credit','deposit');
  const amount = Math.abs(Number(String(amountRaw||creditRaw).replace(/[^0-9.-]/g,''))||0);
  if (!amount) return null;
  const typeText = (get('type','transactiontype','drcr')+' '+(creditRaw?'credit':'')).toLowerCase();
  const type = /credit|received|refund|deposit/.test(typeText) ? 'income' : 'expense';
  const payee = get('payee','merchant','name') || desc;
  return { id: crypto.randomUUID(), date: normalizeDate(get('date','transactiondate','createdat','timestamp')), description:desc, payee, category:guessCategory(payee+' '+desc,rules), amount, type, source:'PhonePe CSV' };
}

export default function App() {
  const [user,setUser] = useState(null);
  const [data,setData] = useState(initial);
  const [loading,setLoading] = useState(true);
  const [syncing,setSyncing] = useState(false);
  const [error,setError] = useState('');
  const [query,setQuery] = useState('');
  const [month,setMonth] = useState('all');
  const [showForm,setShowForm] = useState(false);
  const [form,setForm] = useState({date:localDate(),description:'',payee:'',category:'Other',amount:'',type:'expense'});
  const [mapping,setMapping] = useState({payee:'',category:'Other'});

  async function refresh() {
    setSyncing(true); setError('');
    try {
      const res = await fetch('/api/data');
      if (res.status===401) { setUser(null); throw new Error('Please sign in with GitHub to access your private expenditure data.'); }
      if (!res.ok) throw new Error('Could not load your private data.');
      const json = await res.json();
      setData({...initial,...json.data,transactions:Array.isArray(json.data?.transactions)?json.data.transactions:[],rules:json.data?.rules||{}});
      setUser(json.user || user);
      localStorage.setItem('spendwise-cache',JSON.stringify(json.data||initial));
    } catch(e) { setError(e.message); }
    finally { setLoading(false); setSyncing(false); }
  }
  useEffect(()=>{ fetch('/api/me').then(r=>r.ok?r.json():null).then(x=>{if(x?.user)setUser(x.user);}).catch(()=>{}).finally(refresh); },[]);
  async function save(next) {
    setData(next); localStorage.setItem('spendwise-cache',JSON.stringify(next));
    setSyncing(true); setError('');
    try {
      const res=await fetch('/api/data',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(next)});
      if(res.status===401) throw new Error('Your session expired. Sign in again.');
      if(!res.ok) { const j=await res.json().catch(()=>({})); throw new Error(j.error||'Sync failed.'); }
    } catch(e) { setError(e.message); }
    finally { setSyncing(false); }
  }
  function addTransaction(e) {
    e.preventDefault();
    const amount=Number(form.amount);
    if(!form.description.trim()||!amount||amount<=0) return;
    const payee=form.payee.trim()||form.description.trim();
    const next={...data,transactions:[{...form,id:crypto.randomUUID(),payee,amount,source:'Manual'},...data.transactions]};
    save(next); setForm({...form,description:'',payee:'',amount:''}); setShowForm(false);
  }
  async function importCsv(file) {
    if(!file)return;
    Papa.parse(file,{header:true,skipEmptyLines:true,complete:({data:rows})=>{
      const imported=rows.map(r=>rowToTransaction(r,data.rules)).filter(Boolean);
      if(!imported.length){setError('No transactions found. Check that this is a PhonePe transaction CSV.');return;}
      save({...data,transactions:[...imported,...data.transactions]});
    },error:()=>setError('Unable to read this CSV file.')});
  }
  function addMapping(e) {
    e.preventDefault();
    const key=mapping.payee.trim().toLowerCase();
    if(!key)return;
    save({...data,rules:{...data.rules,[key]:mapping.category}});
    setMapping({payee:'',category:'Other'});
  }
  const months=useMemo(()=>['all',...Array.from(new Set(data.transactions.map(t=>monthKey(t.date)))).filter(x=>x!=='Unknown')],[data.transactions]);
  const filtered=useMemo(()=>data.transactions.filter(t=>(month==='all'||monthKey(t.date)===month)&&(`${t.description} ${t.payee} ${t.category}`.toLowerCase().includes(query.toLowerCase()))),[data.transactions,month,query]);
  const expenses=filtered.filter(t=>t.type!=='income');
  const total=expenses.reduce((s,t)=>s+Number(t.amount),0);
  const income=filtered.filter(t=>t.type==='income').reduce((s,t)=>s+Number(t.amount),0);
  const trend=useMemo(()=>{
    const map={}; data.transactions.filter(t=>t.type!=='income').forEach(t=>{const d=new Date(t.date+'T00:00:00');const k=d.toLocaleString('en-IN',{month:'short',year:'2-digit'});map[k]=(map[k]||0)+Number(t.amount);});
    return Object.entries(map).map(([name,amount])=>({name,amount})).slice(-8);
  },[data.transactions]);
  const categoryData=useMemo(()=>{const map={};expenses.forEach(t=>map[t.category]=(map[t.category]||0)+Number(t.amount));return Object.entries(map).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value);},[expenses]);
  const avg=trend.length?trend.reduce((s,x)=>s+x.amount,0)/trend.length:0;
  function exportCsv(){const csv=Papa.unparse(data.transactions);const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='spendwise-transactions.csv';a.click();URL.revokeObjectURL(a.href);}
  async function logout(){await fetch('/api/auth/logout',{method:'POST'});setUser(null);setData(initial);}
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-icon"><Wallet size={21}/></div><div><b>Spendwise</b><small>Personal finance, made clear</small></div></div>
      <div className="top-actions"><span className="sync-state">{syncing?<RefreshCw size={14} className="spin"/>:<ShieldCheck size={14}/>} {syncing?'Syncing':'Private sync'}</span>{user?<><span className="user-label">{user.login}</span><button className="icon-button" title="Sign out" onClick={logout}><LogOut size={17}/></button></>:<a className="primary-button" href="/api/auth/login"><LogIn size={16}/> Sign in with GitHub</a>}</div>
    </header>
    <main className="main">
      <div className="welcome"><div><p className="eyebrow">YOUR MONEY OVERVIEW</p><h1>Spending at a glance</h1><p className="muted">Understand where your money goes, month by month.</p></div><div className="toolbar"><select value={month} onChange={e=>setMonth(e.target.value)}>{months.map(m=><option key={m} value={m}>{m==='all'?'All months':m}</option>)}</select><button className="secondary-button" onClick={refresh}><RefreshCw size={15}/> Refresh</button></div></div>
      {error&&<div className="notice">{error}</div>}
      {!user&&<div className="login-banner"><ShieldCheck size={20}/><div><b>Your data stays private</b><p>Sign in with the authorized GitHub account to load and sync your private data repository.</p></div><a href="/api/auth/login">Continue with GitHub →</a></div>}
      <section className="stats-grid">
        <article className="stat-card accent"><div className="stat-top"><span>Total expenses</span><span className="stat-icon"><IndianRupee size={17}/></span></div><strong>{money(total)}</strong><small>{month==='all'?'Across all months':month}</small></article>
        <article className="stat-card"><div className="stat-top"><span>Income</span><span className="stat-icon green"><TrendingUp size={17}/></span></div><strong>{money(income)}</strong><small>For selected period</small></article>
        <article className="stat-card"><div className="stat-top"><span>Monthly average</span><span className="stat-icon amber"><CalendarDays size={17}/></span></div><strong>{money(avg)}</strong><small>Based on recorded months</small></article>
        <article className="stat-card"><div className="stat-top"><span>Transactions</span><span className="stat-icon blue"><Tags size={17}/></span></div><strong>{filtered.length}</strong><small>In selected period</small></article>
      </section>
      <section className="charts-grid">
        <article className="panel"><div className="panel-heading"><div><h2>Expense trend</h2><p>Monthly spending over time</p></div><span className="chart-label">Last 8 months</span></div>
          {trend.length?<ResponsiveContainer width="100%" height={245}><AreaChart data={trend} margin={{top:10,right:8,left:0,bottom:0}}><defs><linearGradient id="fillSpend" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7666e8" stopOpacity={.25}/><stop offset="100%" stopColor="#7666e8" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ececf2"/><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill:'#9292a1',fontSize:12}}/><YAxis axisLine={false} tickLine={false} tick={{fill:'#9292a1',fontSize:11}} tickFormatter={v=>v>=1000?(v/1000)+'k':v}/><Tooltip formatter={v=>money(v)}/><Area type="monotone" dataKey="amount" stroke="#7666e8" strokeWidth={2.5} fill="url(#fillSpend)"/></AreaChart></ResponsiveContainer>:<div className="empty-chart">Add transactions to see your spending trend.</div>}
        </article>
        <article className="panel"><div className="panel-heading"><div><h2>By category</h2><p>Where your money goes</p></div></div>
          {categoryData.length?<div className="donut-wrap"><ResponsiveContainer width="58%" height={220}><PieChart><Pie data={categoryData} dataKey="value" nameKey="name" innerRadius={57} outerRadius={88} paddingAngle={3}>{categoryData.map((x,i)=><Cell key={x.name} fill={COLORS[i%COLORS.length]}/>)}</Pie><Tooltip formatter={v=>money(v)}/></PieChart></ResponsiveContainer><div className="legend">{categoryData.slice(0,6).map((x,i)=><div key={x.name}><i style={{background:COLORS[i%COLORS.length]}}/><span>{x.name}</span><b>{money(x.value)}</b></div>)}</div></div>:<div className="empty-chart">Category breakdown appears after you add data.</div>}
        </article>
      </section>
      <section className="panel transactions-panel"><div className="panel-heading transaction-heading"><div><h2>Transactions</h2><p>Review and manage your activity</p></div><div className="action-row"><label className="secondary-button upload-button"><Upload size={15}/> Import PhonePe CSV<input type="file" accept=".csv,text/csv" onChange={e=>importCsv(e.target.files?.[0])}/></label><button className="secondary-button" onClick={exportCsv}><Download size={15}/> Export</button><button className="primary-button" onClick={()=>setShowForm(!showForm)}><Plus size={16}/> Add expense</button></div></div>
        {showForm&&<form className="entry-form" onSubmit={addTransaction}><input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/><input placeholder="Description" required value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/><input placeholder="Payee / merchant" value={form.payee} onChange={e=>setForm({...form,payee:e.target.value})}/><select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select><input type="number" min="0.01" step="0.01" placeholder="Amount ₹" required value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/><select value={form.type} onChange={e=>setForm({...form,type:e.target.value})}><option value="expense">Expense</option><option value="income">Income</option></select><button className="primary-button" type="submit">Save transaction</button></form>}
        <div className="table-tools"><div className="search-box"><Search size={16}/><input placeholder="Search transactions..." value={query} onChange={e=>setQuery(e.target.value)}/></div><span>{filtered.length} records</span></div>
        <div className="table-scroll"><table><thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Payee</th><th className="right">Amount</th></tr></thead><tbody>{filtered.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,100).map(t=><tr key={t.id}><td>{new Date(t.date+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</td><td className="desc-cell">{t.description}</td><td><span className="category-pill">{t.category}</span></td><td>{t.payee}</td><td className={'right amount '+(t.type==='income'?'income':'')}>{t.type==='income'?'+':'−'}{money(t.amount)}</td></tr>)}</tbody></table>{!filtered.length&&<div className="empty-table">{loading?'Loading your data…':'No transactions yet. Import a PhonePe CSV or add your first expense.'}</div>}</div>
      </section>
      <section className="panel mapping-panel"><div className="panel-heading"><div><h2>Payee category rules</h2><p>Remember a category for a merchant or payee on future imports.</p></div></div><form className="mapping-form" onSubmit={addMapping}><input placeholder="Payee contains (e.g. swiggy)" value={mapping.payee} onChange={e=>setMapping({...mapping,payee:e.target.value})}/><select value={mapping.category} onChange={e=>setMapping({...mapping,category:e.target.value})}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select><button className="secondary-button"><Plus size={15}/> Save rule</button></form><div className="rules-list">{Object.entries(data.rules).map(([k,v])=><span key={k}>{k} <b>→ {v}</b></span>)}</div></section>
      <footer>Spendwise · Private data stored in your GitHub repository · <a href="https://github.com/vishwashyadav/spendwise-data" target="_blank" rel="noreferrer">Data repository</a></footer>
    </main>
  </div>;
}
