import React, { useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell, BarChart, Bar } from 'recharts';
import { Wallet, Plus, Upload, Download, LogIn, LogOut, RefreshCw, Search, Trash2, TrendingUp, IndianRupee, CalendarDays, Tags, ShieldCheck } from 'lucide-react';

const CATEGORIES = ['Food & Dining','Groceries','Transport','Shopping','Bills & Utilities','Entertainment','Health','Travel','Education','Rent','Family & Personal','EMI & Loans','Gifts & Donations','Investments','Cash Withdrawal','Home','Other'];
const COLORS = ['#7666e8','#19a78b','#f59e0b','#e76f51','#4c91d8','#b56bd6','#d65d87','#84934b','#5e718b','#c18a52','#929292'];
const money = n => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(Number(n)||0);
const monthKey = d => { const x = new Date(d); return Number.isNaN(+x) ? 'Unknown' : x.toLocaleString('en-IN',{month:'short',year:'2-digit'}); };
const localDate = () => { const d = new Date(); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10); };
const initial = { transactions: [], rules: {}, schemaVersion: 1 };
function extractCounterparty(description) {
  const text=String(description||'').trim();
  const match=text.match(/^(?:paid\s+to|received\s+from)\s+(.+?)\s*$/i);
  return match?match[1].trim():'';
}
function categoryForTransaction(transaction, mappings, legacyRules={}) {
  const haystack=`${transaction.payee||''} ${transaction.description||''}`.toLowerCase();
  const date=transaction.date||transaction.transactionDate||'';
  const matches=(mappings||[]).filter(m=>m.active!==false&&m.matchText&&haystack.includes(m.matchText.toLowerCase())&&(!m.effectiveFrom||date>=m.effectiveFrom)&&(!m.effectiveTo||date<=m.effectiveTo)).sort((a,b)=>(b.effectiveFrom||'').localeCompare(a.effectiveFrom||''));
  if(matches.length)return matches[0].category;
  const legacyKey=Object.keys(legacyRules||{}).find(k=>k&&haystack.includes(k.toLowerCase()));
  return legacyKey?legacyRules[legacyKey]:transaction.category||'Other';
}
function recategorizeTransactions(transactions,mappings,legacyRules={}) {
  return transactions.map(t=>({...t,category:categoryForTransaction(t,mappings,legacyRules)}));
}


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
  const [mapping,setMapping] = useState({payee:'',category:'Other',effectiveFrom:'',effectiveTo:''});
  const [csvImport,setCsvImport] = useState(null);
  const [activeScreen,setActiveScreen] = useState('dashboard');
  const [otherCategoryChoices,setOtherCategoryChoices] = useState({});

  async function refresh() {
    setSyncing(true); setError('');
    try {
      const res = await fetch('/api/data');
      if (res.status===401) { setUser(null); throw new Error('Please sign in with GitHub to access your private expenditure data.'); }
      if (!res.ok) {
        const problem = await res.json().catch(() => ({}));
        const detail = problem.details ? (typeof problem.details === 'string' ? problem.details : JSON.stringify(problem.details)) : '';
        throw new Error([problem.error || 'Could not load your private data.', detail].filter(Boolean).join(' — '));
      }
      const json = await res.json();
      setData({...initial,...json.data,transactions:Array.isArray(json.data?.transactions)?json.data.transactions:[],rules:json.data?.rules||{},categoryMappings:Array.isArray(json.data?.categoryMappings)?json.data.categoryMappings:[]});
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
    Papa.parse(file,{header:true,skipEmptyLines:true,transformHeader:h=>h.trim(),complete:({data:rows,meta})=>{
      const headers=meta.fields||Object.keys(rows[0]||{});
      if(!headers.length||!rows.length){setError('CSV is empty or has no header row.');return;}
      const aliases={date:['date','transactiondate','transactiondatetime','createdat','timestamp'],amount:['amount','transactionamount','totalamount'],debit:['debit','withdrawal','debitamount'],credit:['credit','deposit','creditamount'],type:['type','transactiontype','drcr'],description:['description','remark','narration','details','transactiondetails'],payee:['payee','recipient','paidto','merchant','beneficiary','counterparty','name'],reference:['utr','reference','transactionid'],status:['status','transactionstatus']};
      const norm=h=>h.toLowerCase().replace(/[^a-z0-9]/g,'');
      const map={};Object.entries(aliases).forEach(([k,a])=>map[k]=headers.find(h=>a.includes(norm(h)))||'');
      const payees=[...new Set(rows.map(r=>{const explicit=map.payee&&map.payee!==map.description?String(r[map.payee]||'').trim():'';return explicit||extractCounterparty(r[map.description])||'Unspecified payee';}).filter(Boolean))];
      const cats={};payees.forEach(p=>{const k=Object.keys(data.rules||{}).find(x=>p.toLowerCase().includes(x.toLowerCase()));cats[p]=k?data.rules[k]:guessCategory(p,data.rules);});
      setCsvImport({fileName:file.name,headers,rows,mapping:map,payees,payeeCategories:cats});
    },error:()=>setError('Unable to read CSV file.')});
  }
  function updateCsvMapping(field,value){
    setCsvImport(c=>{
      const mapping={...c.mapping,[field]:value};
      if(field==='payee'||field==='description'){
        const payees=[...new Set(c.rows.map(r=>{const explicit=mapping.payee&&mapping.payee!==mapping.description?String(r[mapping.payee]||'').trim():'';return explicit||extractCounterparty(r[mapping.description])||'Unspecified payee';}).filter(Boolean))];
        const payeeCategories={};payees.forEach(p=>payeeCategories[p]=c.payeeCategories[p]||guessCategory(p,data.rules));
        return {...c,mapping,payees,payeeCategories};
      }
      return {...c,mapping};
    });
  }
  function updatePayeeCategory(payee,category){setCsvImport(c=>({...c,payeeCategories:{...c.payeeCategories,[payee]:category}}));}
  function confirmCsvImport(){
    if(!csvImport)return;
    const {rows,mapping:m,fileName,payeeCategories}=csvImport;
    if(!m.date||!m.amount||!m.type){setError('Please map Transaction date, Amount, and Transaction type.');return;}
    const imported=[];
    for(const row of rows){
      const val=k=>m[k]?String(row[m[k]]??'').trim():'';
      const number=v=>Math.abs(Number(String(v||'').replace(/[^0-9.-]/g,''))||0);
      const amount=number(val('amount'));
      if(!amount)continue;
      const transactionType=val('type').trim().toLowerCase();
      const type=transactionType.startsWith('debit')?'expense':'income';
      const dateRaw=val('date'),dm=dateRaw.match(/^(\\d{1,2})[/-](\\d{1,2})[/-](\\d{2,4})/);
      const date=dm?`${dm[3].length===2?'20'+dm[3]:dm[3]}-${dm[2].padStart(2,'0')}-${dm[1].padStart(2,'0')}`:normalizeDate(dateRaw);
      const description=val('description')||val('payee')||'Imported transaction';
      const explicitPayee=m.payee&&m.payee!==m.description?val('payee'):'';
      const payee=explicitPayee||extractCounterparty(description)||'Unspecified payee';
      if(/fail|declin|revers|cancel/i.test(val('status')))continue;
      imported.push({id:crypto.randomUUID(),date,transactionDate:date,description,payee,amount,currency:'INR',type,category:payeeCategories[payee]||'Other',reference:val('reference')||undefined,source:fileName});
    }
    const normalizeText=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'').trim();
    const transactionKeys=t=>{
      const reference=normalizeText(t.reference);
      if(reference)return [`ref:${reference}`];
      const date=t.date||t.transactionDate||'';
      const amount=Number(t.amount||0).toFixed(2);
      const type=t.type||'expense';
      const payee=normalizeText(t.payee);
      const description=normalizeText(t.description);
      return [`fallback:${date}|${amount}|${type}|${payee}|${description}`];
    };
    const seen=new Set(data.transactions.flatMap(transactionKeys));
    const unique=[];
    let duplicateCount=0;
    imported.forEach(t=>{
      const keys=transactionKeys(t);
      if(keys.some(k=>seen.has(k))){duplicateCount++;return;}
      keys.forEach(k=>seen.add(k));
      unique.push(t);
    });
    if(!unique.length){
      setError(imported.length?`No transactions imported: all ${duplicateCount} valid rows are duplicates already in Spendwise.`:'No valid rows found; verify your mappings.');
      return;
    }
    const categoryMappings=[...(data.categoryMappings||[])];
    const byPayee={};
    unique.forEach(t=>{const p=(t.payee||t.description||'').trim();if(!byPayee[p])byPayee[p]=[];byPayee[p].push(t.date);});
    Object.entries(byPayee).forEach(([payee,dates])=>{
      const category=payeeCategories[payee]||'Other';
      if(category==='Other')return;
      categoryMappings.push({id:crypto.randomUUID(),matchText:payee,category,effectiveFrom:dates.slice().sort()[0],effectiveTo:'',createdAt:new Date().toISOString()});
    });
    const combined=[...unique,...data.transactions];
    const transactions=recategorizeTransactions(combined,categoryMappings,data.rules);
    save({...data,categoryMappings,transactions});setCsvImport(null);setError(duplicateCount?`Imported ${unique.length} new transactions; skipped ${duplicateCount} duplicates.`:`Imported ${unique.length} transactions. No duplicates found.`);
  }
  function addMapping(e) {
    e.preventDefault();
    const matchText=mapping.payee.trim();
    if(!matchText)return;
    const rule={id:crypto.randomUUID(),matchText,category:mapping.category,effectiveFrom:mapping.effectiveFrom||'',effectiveTo:mapping.effectiveTo||'',createdAt:new Date().toISOString()};
    if(rule.effectiveFrom&&rule.effectiveTo&&rule.effectiveFrom>rule.effectiveTo){setError('Start date must be on or before end date.');return;}
    const categoryMappings=[...(data.categoryMappings||[]),rule];
    const transactions=recategorizeTransactions(data.transactions,categoryMappings,data.rules);
    save({...data,categoryMappings,transactions});
    setMapping({payee:'',category:'Other',effectiveFrom:'',effectiveTo:''});
  }
  function createMappingFromOther(transaction){
    const category=otherCategoryChoices[transaction.id];
    const matchText=(transaction.payee||extractCounterparty(transaction.description)||'').trim();
    if(!category||category==='Other'||!matchText){setError('Choose a category and make sure this transaction has a payee.');return;}
    const categoryMappings=[...(data.categoryMappings||[]),{id:crypto.randomUUID(),matchText,category,effectiveFrom:transaction.date||'',effectiveTo:'',createdAt:new Date().toISOString()}];
    const transactions=recategorizeTransactions(data.transactions,categoryMappings,data.rules);
    save({...data,categoryMappings,transactions});
    setOtherCategoryChoices(c=>({...c,[transaction.id]:''}));
  }
  function removeCategoryMapping(id){
    const categoryMappings=(data.categoryMappings||[]).filter(m=>m.id!==id);
    const transactions=recategorizeTransactions(data.transactions,categoryMappings,data.rules);
    save({...data,categoryMappings,transactions});
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
      <div className="top-actions"><button className="secondary-button import-nav" onClick={()=>setActiveScreen('dashboard')}>Dashboard</button><button className="secondary-button import-nav" onClick={()=>{setCsvImport(null);setActiveScreen('import')}}>Import CSV</button><button className="secondary-button import-nav" onClick={()=>setActiveScreen('mapping')}>Categorize Other ({data.transactions.filter(t=>t.category==='Other').length})</button><span className="sync-state">{syncing?<RefreshCw size={14} className="spin"/>:<ShieldCheck size={14}/>} {syncing?'Syncing':'Private sync'}</span>{user?<><span className="user-label">{user.login}</span><button className="icon-button" title="Sign out" onClick={logout}><LogOut size={17}/></button></>:<a className="primary-button" href="/api/auth/login"><LogIn size={16}/> Sign in with GitHub</a>}</div>
    </header>
    <main className={`main ${activeScreen==='import'?'import-mode':activeScreen==='mapping'?'mapping-mode':'dashboard-mode'}`}>
      {activeScreen==='dashboard'&&<><div className="welcome"><div><p className="eyebrow">YOUR MONEY OVERVIEW</p><h1>Spending at a glance</h1><p className="muted">Understand where your money goes, month by month.</p></div><div className="toolbar"><select value={month} onChange={e=>setMonth(e.target.value)}>{months.map(m=><option key={m} value={m}>{m==='all'?'All months':m}</option>)}</select><button className="secondary-button" onClick={refresh}><RefreshCw size={15}/> Refresh</button></div></div>
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
      </>}
      {activeScreen!=='mapping'&&<section className="panel transactions-panel"><div className="panel-heading transaction-heading"><div><h2>{activeScreen==='import'?'Import transactions':'Transactions'}</h2><p>{activeScreen==='import'?'Upload a CSV, map its columns, and review categories before importing.':'Review and manage your activity'}</p></div><div className="action-row"><label className="secondary-button upload-button"><Upload size={15}/> {activeScreen==='import'?'Choose CSV file':'Import PhonePe CSV'}<input type="file" accept=".csv,text/csv" onChange={e=>importCsv(e.target.files?.[0])}/></label>{activeScreen==='dashboard'&&<><button className="secondary-button" onClick={exportCsv}><Download size={15}/> Export</button><button className="primary-button" onClick={()=>setShowForm(!showForm)}><Plus size={16}/> Add expense</button></>}</div></div>
        {csvImport&&<div className="csv-mapper"><div className="csv-mapper-head"><div><h3>Map CSV columns and payee categories</h3><p>{csvImport.fileName} · {csvImport.rows.length} rows · {csvImport.payees.length} payees</p></div><button type="button" className="icon-button" onClick={()=>setCsvImport(null)}>✕</button></div>
          <p className="mapper-help">Match the CSV headers to Spendwise fields, then assign a category to each payee. Your payee rules are saved privately and reused on future imports.</p>
          <div className="mapper-grid">{[['date','Transaction date'],['amount','Amount'],['type','Transaction type'],['description','Description'],['payee','Paid to / Payee'],['reference','Reference / UTR'],['status','Status']].map(([k,label])=><label className="mapper-field" key={k}><span>{label}{['date','amount','type'].includes(k)?' *':''}</span><select value={csvImport.mapping[k]||''} onChange={e=>updateCsvMapping(k,e.target.value)}><option value="">— Not mapped —</option>{csvImport.headers.map(h=><option key={h}>{h}</option>)}</select></label>)}</div>
          <div className="payee-category-map"><h4>Payee → Category</h4><p>Example: map “Paid to Rahul” to Family. The mapping will be remembered next time.</p><div className="payee-category-list">{csvImport.payees.map(p=><label className="payee-category-row" key={p}><span title={p}>{p}</span><select value={csvImport.payeeCategories[p]||'Other'} onChange={e=>updatePayeeCategory(p,e.target.value)}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></label>)}</div></div>
          <div className="mapper-preview"><b>Preview (first 5 rows)</b><div className="table-scroll"><table><thead><tr><th>Date</th><th>Payee</th><th>Description</th><th>Transaction type</th><th>Category</th><th className="right">Amount</th></tr></thead><tbody>{csvImport.rows.slice(0,5).map((r,i)=>{const m=csvImport.mapping,p=String((m.payee?r[m.payee]:'')||(m.description?r[m.description]:'')||'Unknown payee').trim();return <tr key={i}><td>{m.date?r[m.date]:''}</td><td>{p}</td><td>{m.description?r[m.description]:''}</td><td>{m.type?r[m.type]:''}</td><td>{csvImport.payeeCategories[p]||'Other'}</td><td className="right">{m.amount?r[m.amount]:''}</td></tr>})}</tbody></table></div></div>
          <div className="mapper-actions"><button type="button" className="secondary-button" onClick={()=>setCsvImport(null)}>Cancel</button><button type="button" className="primary-button" onClick={confirmCsvImport}>Confirm and import</button></div></div>}
        {activeScreen==='dashboard'&&showForm&&<form className="entry-form" onSubmit={addTransaction}><input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/><input placeholder="Description" required value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/><input placeholder="Payee / merchant" value={form.payee} onChange={e=>setForm({...form,payee:e.target.value})}/><select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select><input type="number" min="0.01" step="0.01" placeholder="Amount ₹" required value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/><select value={form.type} onChange={e=>setForm({...form,type:e.target.value})}><option value="expense">Expense</option><option value="income">Income</option></select><button className="primary-button" type="submit">Save transaction</button></form>}
        {activeScreen==='dashboard'&&<><div className="table-tools"><div className="search-box"><Search size={16}/><input placeholder="Search transactions..." value={query} onChange={e=>setQuery(e.target.value)}/></div><span>{filtered.length} records</span></div>
        <div className="table-scroll"><table><thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Payee</th><th className="right">Amount</th></tr></thead><tbody>{filtered.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,100).map(t=><tr key={t.id}><td>{new Date(t.date+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</td><td className="desc-cell">{t.description}</td><td><span className="category-pill">{t.category}</span></td><td>{t.payee}</td><td className={'right amount '+(t.type==='income'?'income':'')}>{t.type==='income'?'+':'−'}{money(t.amount)}</td></tr>)}</tbody></table>{!filtered.length&&<div className="empty-table">{loading?'Loading your data…':'No transactions yet. Import a PhonePe CSV or add your first expense.'}</div>}</div>
      </>}
      </section>}
      {activeScreen==='mapping'&&<section className="panel mapping-panel review-other-panel"><div className="panel-heading"><div><h2>Uncategorized transactions</h2><p>Review transactions currently assigned to Other. Choose a category to create a date-effective rule and recategorize matching history and future activity.</p></div><span className="chart-label">{data.transactions.filter(t=>t.category==='Other').length} to review</span></div>{data.transactions.filter(t=>t.category==='Other').length?<div className="table-scroll"><table><thead><tr><th>Date</th><th>Description</th><th>Payee extracted</th><th className="right">Amount</th><th>Assign category</th><th></th></tr></thead><tbody>{data.transactions.filter(t=>t.category==='Other').sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(t=><tr key={t.id}><td>{t.date}</td><td className="desc-cell">{t.description}</td><td>{t.payee||'Unspecified payee'}</td><td className="right">{money(t.amount)}</td><td><select value={otherCategoryChoices[t.id]||'Other'} onChange={e=>setOtherCategoryChoices(c=>({...c,[t.id]:e.target.value}))}>{CATEGORIES.filter(c=>c!=='Other').map(c=><option key={c}>{c}</option>)}</select></td><td><button className="primary-button" onClick={()=>createMappingFromOther(t)}>Save rule</button></td></tr>)}</tbody></table></div>:<div className="empty-table">All transactions are categorized. Nothing needs review.</div>}</section>}
      {activeScreen==='dashboard'&&<section className="panel mapping-panel"><div className="panel-heading"><div><h2>Date-wise category mappings</h2><p>Change a payee's category for any date range. Saving a mapping recalculates all matching transactions, including previously imported ones.</p></div></div><form className="mapping-form date-mapping-form" onSubmit={addMapping}><input placeholder="Payee / description contains (e.g. Rahul)" value={mapping.payee} onChange={e=>setMapping({...mapping,payee:e.target.value})} required/><select value={mapping.category} onChange={e=>setMapping({...mapping,category:e.target.value})}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select><label>From<input type="date" value={mapping.effectiveFrom} onChange={e=>setMapping({...mapping,effectiveFrom:e.target.value})}/></label><label>To (optional)<input type="date" value={mapping.effectiveTo} onChange={e=>setMapping({...mapping,effectiveTo:e.target.value})}/><small>Leave blank to apply indefinitely</small></label><button className="secondary-button"><Plus size={15}/> Save & recalculate</button></form><p className="mapping-hint">Leave To empty to keep this mapping active indefinitely, including future transactions. If rules overlap, the rule with the latest start date takes precedence.</p><div className="rules-list date-rules">{(data.categoryMappings||[]).map(m=><span key={m.id}><b>{m.matchText}</b> → {m.category} <small>{m.effectiveFrom||'Beginning'} to {m.effectiveTo||'No end date'}</small><button type="button" onClick={()=>removeCategoryMapping(m.id)} title="Remove mapping">×</button></span>)}{!data.categoryMappings?.length&&Object.entries(data.rules||{}).map(([k,v])=><span key={k}>{k} → {v} <small>Legacy mapping · all dates</small></span>)}</div></section>}
      <footer>Spendwise · Private data stored in your GitHub repository · <a href="https://github.com/vishwashyadav/spendwise-data" target="_blank" rel="noreferrer">Data repository</a></footer>
    </main>
  </div>;
}
