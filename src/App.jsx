import React, { useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
ModuleRegistry.registerModules([AllCommunityModule]);
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell, BarChart, Bar } from 'recharts';
import { Wallet, Plus, Upload, Download, LogIn, LogOut, RefreshCw, Search, Trash2, TrendingUp, IndianRupee, CalendarDays, Tags, ShieldCheck, SlidersHorizontal, ChevronDown, ArrowDownRight, ArrowUpRight, Activity, ReceiptText, WalletCards, Sparkles } from 'lucide-react';

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
  return transactions.map(t=>{const haystack=`${t.payee||''} ${t.description||''}`.toLowerCase();const date=t.date||t.transactionDate||'';const match=(mappings||[]).filter(m=>m.active!==false&&m.matchText&&haystack.includes(m.matchText.toLowerCase())&&(!m.effectiveFrom||date>=m.effectiveFrom)&&(!m.effectiveTo||date<=m.effectiveTo)).sort((a,b)=>(b.effectiveFrom||'').localeCompare(a.effectiveFrom||''))[0];return match?{...t,category:match.category,subcategory:match.subcategory||''}:{...t,category:categoryForTransaction(t,mappings,legacyRules)};});
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
  const [categoryFilter,setCategoryFilter] = useState('all');
  const [typeFilter,setTypeFilter] = useState('all');
  const [dateFrom,setDateFrom] = useState('');
  const [dateTo,setDateTo] = useState('');
  const [minAmount,setMinAmount] = useState('');
  const [maxAmount,setMaxAmount] = useState('');
  const [sortBy,setSortBy] = useState('date');
  const [sortDirection,setSortDirection] = useState('desc');
  const [transactionPage,setTransactionPage] = useState(1);
  const transactionPageSize=20;
  const transactionPageCount=Math.max(1,Math.ceil(filtered.length/transactionPageSize));
  const transactionPageRows=filtered.slice((transactionPage-1)*transactionPageSize,transactionPage*transactionPageSize);
  const [showForm,setShowForm] = useState(false);
  const [deleteTarget,setDeleteTarget] = useState(null);
  const [editTarget,setEditTarget] = useState(null);
  const [editForm,setEditForm] = useState(null);
  const [editSaving,setEditSaving] = useState(false);
  const [transactionGridApi,setTransactionGridApi] = useState(null);
  const [showColumnPicker,setShowColumnPicker] = useState(false);
  const [otherMappingSearch,setOtherMappingSearch] = useState('');
  const [form,setForm] = useState({date:localDate(),description:'',payee:'',category:'Other',subcategory:'',amount:'',type:'expense'});
  const [mapping,setMapping] = useState({payee:'',category:'Other',subcategory:'',effectiveFrom:'',effectiveTo:''});
  const [csvImport,setCsvImport] = useState(null);
  const [activeScreen,setActiveScreen] = useState('dashboard');
  const [navOpen,setNavOpen] = useState(false);
  const [showMobileFilters,setShowMobileFilters] = useState(false);
  const [insightQuestion,setInsightQuestion] = useState('');
  const [insightResult,setInsightResult] = useState('');
  const [insightLoading,setInsightLoading] = useState(false);
  const [insightError,setInsightError] = useState('');
  const [otherCategoryChoices,setOtherCategoryChoices] = useState({});
  const [newCategory,setNewCategory] = useState('');
  const [categoryToDelete,setCategoryToDelete] = useState('');
  const [replacementCategory,setReplacementCategory] = useState('');
  const [subcategoryCategory,setSubcategoryCategory] = useState('Groceries');
  const [newSubcategory,setNewSubcategory] = useState('');
  const [otherSubcategoryChoices,setOtherSubcategoryChoices] = useState({});
  const categoryOptions=data.categories?.length?data.categories:CATEGORIES;
  const subcategoryOptions=(category)=>data.subcategories?.[category]||[];

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
      return true;
    } catch(e) { setError(e.message); return false; }
    finally { setSyncing(false); }
  }
  function openEditTransaction(transaction){
    setEditTarget(transaction);
    setEditForm({...transaction,date:transaction.date||transaction.transactionDate||localDate(),description:transaction.description||'',payee:transaction.payee||'',category:transaction.category||'Other',subcategory:transaction.subcategory||'',amount:String(transaction.amount??''),type:transaction.type||'expense',reference:transaction.reference||'',source:transaction.source||'',currency:transaction.currency||'INR'});
  }
  async function saveEditedTransaction(e){
    e.preventDefault();if(!editTarget||!editForm||editSaving)return;
    const amount=Number(editForm.amount);
    if(!editForm.description.trim()||!Number.isFinite(amount)||amount<=0){setError('Enter a description and a valid amount greater than zero.');return;}
    const updated={...editTarget,...editForm,date:editForm.date,transactionDate:editForm.date,description:editForm.description.trim(),payee:editForm.payee.trim()||editForm.description.trim(),category:editForm.category,subcategory:editForm.subcategory||'',amount,type:editForm.type};
    setEditSaving(true);
    try {
      const saved = await save({...data,transactions:data.transactions.map(t=>t.id===editTarget.id?updated:t)});
      if(saved){setEditTarget(null);setEditForm(null);}
    } finally { setEditSaving(false); }
  }
  async function deleteTransaction(transaction) {
    if(!transaction)return;
    // Close confirmation immediately; the save request may take time or fail.
    setDeleteTarget(null);
    const next={...data,transactions:data.transactions.filter(t=>t.id!==transaction.id)};
    await save(next);
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
      setCsvImport({fileName:file.name,headers,rows,mapping:map,payees,payeeCategories:cats,payeeSubcategories:{}});
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
  function updatePayeeCategory(payee,category){setCsvImport(c=>({...c,payeeCategories:{...c.payeeCategories,[payee]:category},payeeSubcategories:{...c.payeeSubcategories,[payee]:''}}));}
  function updatePayeeSubcategory(payee,subcategory){setCsvImport(c=>({...c,payeeSubcategories:{...c.payeeSubcategories,[payee]:subcategory}}));}
  function confirmCsvImport(){
    if(!csvImport)return;
    const {rows,mapping:m,fileName,payeeCategories,payeeSubcategories={}}=csvImport;
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
      imported.push({id:crypto.randomUUID(),date,transactionDate:date,description,payee,amount,currency:'INR',type,category:payeeCategories[payee]||'Other',subcategory:payeeSubcategories[payee]||'',reference:val('reference')||undefined,source:fileName});
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
      categoryMappings.push({id:crypto.randomUUID(),matchText:payee,category,subcategory:payeeSubcategories[payee]||'',effectiveFrom:dates.slice().sort()[0],effectiveTo:'',createdAt:new Date().toISOString()});
    });
    const combined=[...unique,...data.transactions];
    const transactions=recategorizeTransactions(combined,categoryMappings,data.rules);
    save({...data,categoryMappings,transactions});setCsvImport(null);setError(duplicateCount?`Imported ${unique.length} new transactions; skipped ${duplicateCount} duplicates.`:`Imported ${unique.length} transactions. No duplicates found.`);
  }
  function addMapping(e) {
    e.preventDefault();
    const matchText=mapping.payee.trim();
    if(!matchText)return;
    const rule={id:crypto.randomUUID(),matchText,category:mapping.category,subcategory:mapping.subcategory||'',effectiveFrom:mapping.effectiveFrom||'',effectiveTo:mapping.effectiveTo||'',createdAt:new Date().toISOString()};
    if(rule.effectiveFrom&&rule.effectiveTo&&rule.effectiveFrom>rule.effectiveTo){setError('Start date must be on or before end date.');return;}
    const categoryMappings=[...(data.categoryMappings||[]),rule];
    const transactions=recategorizeTransactions(data.transactions,categoryMappings,data.rules);
    save({...data,categoryMappings,transactions});
    setMapping({payee:'',category:'Other',subcategory:'',effectiveFrom:'',effectiveTo:''});
  }
  async function updateOtherMappings(){
    const pending=Object.entries(otherCategoryChoices).filter(([,category])=>category&&category!=='Other');
    if(!pending.length){setError('Choose a category for at least one description before updating.');return;}
    const categoryMappings=[...(data.categoryMappings||[])];
    for(const [description,category] of pending){
      const matchText=String(description||'').trim();
      if(!matchText)continue;
      const existing=categoryMappings.findIndex(m=>m.matchText?.toLowerCase()===matchText.toLowerCase()&&!m.effectiveFrom&&!m.effectiveTo);
      const rule={id:existing>=0?categoryMappings[existing].id:crypto.randomUUID(),matchText,category,effectiveFrom:'',effectiveTo:'',createdAt:new Date().toISOString()};
      if(existing>=0)categoryMappings[existing]=rule;else categoryMappings.push(rule);
    }
    const withSubcategories=categoryMappings.map(m=>{const subcategory=otherSubcategoryChoices[m.matchText];return subcategory?{...m,subcategory}:m;});
    const transactions=recategorizeTransactions(data.transactions,withSubcategories,data.rules);
    await save({...data,categoryMappings:withSubcategories,transactions});
    setOtherCategoryChoices({});setOtherSubcategoryChoices({});
    await refresh();
  }
  async function addCategory(e){
    e.preventDefault();
    const name=newCategory.trim();
    if(!name)return;
    if(categoryOptions.some(c=>c.toLowerCase()===name.toLowerCase())){setError('That category already exists.');return;}
    await save({...data,categories:[...categoryOptions,name]});setNewCategory('');
  }
  async function addSubcategory(e){
    e.preventDefault();const name=newSubcategory.trim();if(!name)return;
    const existing=subcategoryOptions(subcategoryCategory);
    if(existing.some(x=>x.toLowerCase()===name.toLowerCase())){setError('That subcategory already exists.');return;}
    await save({...data,subcategories:{...(data.subcategories||{}),[subcategoryCategory]:[...existing,name]}});
    setNewSubcategory('');
  }
  async function deleteSubcategory(category,name){
    const subcategories={...(data.subcategories||{}),[category]:subcategoryOptions(category).filter(x=>x!==name)};
    const transactions=data.transactions.map(t=>t.category===category&&t.subcategory===name?{...t,subcategory:''}:t);
    const categoryMappings=(data.categoryMappings||[]).map(m=>m.category===category&&m.subcategory===name?{...m,subcategory:''}:m);
    await save({...data,subcategories,transactions,categoryMappings});
  }
  async function deleteCategory(){
    const name=categoryToDelete;if(!name)return;
    const used=data.transactions.some(t=>t.category===name)||(data.categoryMappings||[]).some(m=>m.category===name)||Object.values(data.rules||{}).includes(name);
    if(used&&!replacementCategory){setError('Choose a replacement category before deleting this category.');return;}
    if(used&&replacementCategory===name){setError('Replacement category must be different.');return;}
    const target=used?replacementCategory:'';
    const transactions=data.transactions.map(t=>t.category===name?{...t,category:target,subcategory:''}:t);
    const categoryMappings=(data.categoryMappings||[]).map(m=>m.category===name?{...m,category:target}:m);
    const rules=Object.fromEntries(Object.entries(data.rules||{}).map(([k,v])=>[k,v===name?target:v]));
    const subcategories={...(data.subcategories||{})};delete subcategories[name];
    await save({...data,categories:categoryOptions.filter(c=>c!==name),subcategories,transactions,categoryMappings,rules});
    setCategoryToDelete('');setReplacementCategory('');await refresh();
  }
  function removeCategoryMapping(id){
    const categoryMappings=(data.categoryMappings||[]).filter(m=>m.id!==id);
    const transactions=recategorizeTransactions(data.transactions,categoryMappings,data.rules);
    save({...data,categoryMappings,transactions});
  }
  const months=useMemo(()=>['all',...Array.from(new Set(data.transactions.map(t=>monthKey(t.date)))).filter(x=>x!=='Unknown')],[data.transactions]);
  const filtered=useMemo(()=>{
    const rows=data.transactions.filter(t=>(month==='all'||monthKey(t.date)===month)
      &&(categoryFilter==='all'||t.category===categoryFilter)
      &&(typeFilter==='all'||(typeFilter==='expense'?t.type!=='income':t.type==='income'))
      &&(!dateFrom||t.date>=dateFrom)&&(!dateTo||t.date<=dateTo)
      &&(minAmount===''||Number(t.amount)>=Number(minAmount))
      &&(maxAmount===''||Number(t.amount)<=Number(maxAmount))
      &&(`${t.description||''} ${t.payee||''} ${t.category||''}`.toLowerCase().includes(query.toLowerCase())));
    return rows.sort((a,b)=>{
      let av=a[sortBy]??'',bv=b[sortBy]??'';
      if(sortBy==='amount'){av=Number(av)||0;bv=Number(bv)||0;}
      else {av=String(av).toLowerCase();bv=String(bv).toLowerCase();}
      const result=av>bv?1:av<bv?-1:0;
      return sortDirection==='asc'?result:-result;
    });
  },[data.transactions,month,categoryFilter,typeFilter,dateFrom,dateTo,minAmount,maxAmount,query,sortBy,sortDirection]);
  useEffect(()=>{setTransactionPage(1);},[query,month,categoryFilter,typeFilter,dateFrom,dateTo,minAmount,maxAmount,sortBy,sortDirection]);
  const transactionColumnOptions=[{key:'date',label:'Date'},{key:'description',label:'Description'},{key:'payee',label:'Payee'},{key:'category',label:'Category'},{key:'subcategory',label:'Subcategory'},{key:'type',label:'Transaction type'},{key:'amount',label:'Amount'},{key:'actions',label:'Actions'}];
  function setTransactionColumnVisible(key,visible){transactionGridApi?.setColumnsVisible([key],visible);}
  function setAllTransactionColumnsVisible(visible){transactionGridApi?.setColumnsVisible(transactionColumnOptions.map(c=>c.key),visible);}
  const transactionColumns=useMemo(()=>[
    {headerName:'Date',field:'date',minWidth:132,filter:'agDateColumnFilter',valueFormatter:p=>p.value?new Date(p.value+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):''},
    {headerName:'Description',field:'description',flex:2,minWidth:230,filter:'agTextColumnFilter',tooltipField:'description',tooltipValueGetter:p=>p.value||'',cellClass:'description-grid-cell'},
    {headerName:'Payee',field:'payee',flex:1.3,minWidth:170,filter:'agTextColumnFilter'},
    {headerName:'Category',field:'category',minWidth:150,filter:'agTextColumnFilter',cellClass:'category-grid-cell'},
    {headerName:'Subcategory',field:'subcategory',minWidth:160,filter:'agSetColumnFilter',valueFormatter:p=>p.value||'—'},
    {headerName:'Type',field:'type',minWidth:120,filter:'agSetColumnFilter',valueFormatter:p=>p.value==='income'?'Credit':'Debit'},
    {headerName:'Amount',field:'amount',minWidth:150,filter:'agNumberColumnFilter',type:'numericColumn',valueFormatter:p=>money(p.value),cellClass:p=>p.data?.type==='income'?'grid-income':'grid-expense'},
    {headerName:'Actions',colId:'actions',pinned:'right',lockPinned:true,width:176,minWidth:176,maxWidth:176,sortable:false,filter:false,resizable:false,suppressHeaderMenuButton:true,cellStyle:{overflow:'visible',display:'flex',alignItems:'center'},cellRenderer:p=><div className="grid-row-actions"><button type="button" className="grid-edit-button" title="Edit transaction" aria-label="Edit transaction" onClick={e=>{e.stopPropagation();openEditTransaction(p.data);}}><Tags size={14}/> Edit</button><button type="button" className="grid-delete-button" title="Delete transaction" aria-label="Delete transaction" onClick={e=>{e.stopPropagation();setDeleteTarget(p.data);}}><Trash2 size={14}/> Delete</button></div>},
  ],[]);
  function changeSort(field){if(sortBy===field)setSortDirection(d=>d==='asc'?'desc':'asc');else{setSortBy(field);setSortDirection(field==='date'||field==='amount'?'desc':'asc');}}
  function sortLabel(field,label){return <button type="button" className="sort-header" onClick={()=>changeSort(field)}>{label}<span>{sortBy===field?(sortDirection==='asc'?'↑':'↓'):'↕'}</span></button>;}
  function clearTransactionFilters(){setQuery('');setMonth('all');setCategoryFilter('all');setTypeFilter('all');setDateFrom('');setDateTo('');setMinAmount('');setMaxAmount('');}
  const expenses=filtered.filter(t=>t.type!=='income');
  const total=expenses.reduce((s,t)=>s+Number(t.amount),0);
  const income=filtered.filter(t=>t.type==='income').reduce((s,t)=>s+Number(t.amount),0);
  const trend=useMemo(()=>{
    const map={}; filtered.filter(t=>t.type!=='income').forEach(t=>{const d=new Date(t.date+'T00:00:00');const k=d.toLocaleString('en-IN',{month:'short',year:'2-digit'});map[k]=(map[k]||0)+Number(t.amount);});
    return Object.entries(map).map(([name,amount])=>({name,amount})).slice(-8);
  },[filtered]);
  const categoryData=useMemo(()=>{const map={};expenses.forEach(t=>map[t.category]=(map[t.category]||0)+Number(t.amount));return Object.entries(map).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value);},[expenses]);
  const avg=trend.length?trend.reduce((s,x)=>s+x.amount,0)/trend.length:0;
  const dashboardRows=filtered.slice(0,10);
  async function generateInsights(question=insightQuestion){
    if(insightLoading)return;
    setInsightLoading(true);setInsightError('');setInsightResult('');
    const expenseRows=filtered.filter(t=>t.type!=='income');
    const incomeRows=filtered.filter(t=>t.type==='income');
    const byMonth={};const byCategory={};
    for(const t of filtered){
      const period=monthKey(t.date);
      const bucket=byMonth[period]||(byMonth[period]={income:0,expenses:0,transactions:0});
      bucket.transactions++;
      if(t.type==='income')bucket.income+=Number(t.amount)||0;else bucket.expenses+=Number(t.amount)||0;
      if(t.type!=='income'){const category=t.category||'Other';const group=byCategory[category]||(byCategory[category]={amount:0,count:0});group.amount+=Number(t.amount)||0;group.count++;}
    }
    const report={currency:'INR',period:{from:dateFrom||null,to:dateTo||null,month:month==='all'?'All selected months':month},totals:{expenses:expenseRows.reduce((sum,t)=>sum+(Number(t.amount)||0),0),income:incomeRows.reduce((sum,t)=>sum+(Number(t.amount)||0),0),expenseCount:expenseRows.length,incomeCount:incomeRows.length,transactionCount:filtered.length},monthly:Object.entries(byMonth).map(([period,v])=>({period,...Object.fromEntries(Object.entries(v).map(([k,n])=>[k,Math.round(n)]))})).slice(-18),categories:Object.entries(byCategory).map(([category,v])=>({category,amount:Math.round(v.amount),count:v.count})).sort((x,y)=>y.amount-x.amount).slice(0,15)};
    try{const response=await fetch('/api/insights',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({report,question:question.trim()})});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||'Could not generate insights. Please try again.');setInsightResult(result.insight||'No insight was returned.');}
    catch(error){setInsightError(error.message||'Something went wrong while generating insights.');}
    finally{setInsightLoading(false);}
  }
  function exportCsv(){const csv=Papa.unparse(data.transactions);const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='spendwise-transactions.csv';a.click();URL.revokeObjectURL(a.href);}
  async function logout(){await fetch('/api/auth/logout',{method:'POST'});setUser(null);setData(initial);}
  return <div className="app-shell">
    <header className="topbar"><button type="button" className="brand brand-menu-trigger" aria-label="Open navigation menu" aria-expanded={navOpen} onClick={()=>setNavOpen(v=>!v)}><div className="brand-icon"><Wallet size={21}/></div><div><b>Spendwise</b><small>Personal finance, made clear</small></div></button>
      <div className="auth-actions">{user?<><span className="sync-state">{syncing?<RefreshCw size={14} className="spin"/>:<ShieldCheck size={14}/>} {syncing?'Syncing':'Private sync'}</span><span className="user-label">{user.login}</span><button className="icon-button" title="Sign out" onClick={logout}><LogOut size={17}/></button></>:<a className="primary-button" href="/api/auth/login"><LogIn size={16}/> Sign in with GitHub</a>}</div>
    </header>
    {navOpen&&<><button className="nav-drawer-backdrop" aria-label="Close navigation" onClick={()=>setNavOpen(false)}></button><nav className="nav-drawer" aria-label="Main navigation"><div className="nav-drawer-heading"><b>Menu</b><button type="button" className="icon-button" onClick={()=>setNavOpen(false)} aria-label="Close menu">×</button></div><button className={activeScreen==='dashboard'?'active':''} onClick={()=>{setActiveScreen('dashboard');setNavOpen(false)}}>Dashboard</button><button className={activeScreen==='insights'?'active':''} onClick={()=>{setActiveScreen('insights');setNavOpen(false)}}><Sparkles size={15}/> AI Insights</button><button className={activeScreen==='transactions'?'active':''} onClick={()=>{setActiveScreen('transactions');setNavOpen(false)}}>Transactions</button><button className={activeScreen==='import'?'active':''} onClick={()=>{setCsvImport(null);setActiveScreen('import');setNavOpen(false)}}>Import CSV</button><button className={activeScreen==='mapping'?'active':''} onClick={()=>{setActiveScreen('mapping');setNavOpen(false)}}>Categorize Other ({data.transactions.filter(t=>t.category==='Other').length})</button><button className={activeScreen==='categories'?'active':''} onClick={()=>{setActiveScreen('categories');setNavOpen(false)}}>Manage Categories</button></nav></>}
    <main className={`main ${activeScreen==='import'?'import-mode':activeScreen==='mapping'?'mapping-mode':activeScreen==='transactions'?'transactions-mode':activeScreen==='insights'?'insights-mode':'dashboard-mode'}`}>
      {activeScreen==='dashboard'&&<><div className="welcome"><div><p className="eyebrow">YOUR MONEY OVERVIEW</p><h1>Spending at a glance</h1><p className="muted">Charts and transactions update together using the filters below.</p></div><button className="secondary-button" onClick={refresh}><RefreshCw size={15}/> Refresh</button></div>
      {error&&<div className="notice">{error}</div>}
      {!user&&<div className="login-banner"><ShieldCheck size={20}/><div><b>Your data stays private</b><p>Sign in with the authorized GitHub account to load and sync your private data repository.</p></div><a href="/api/auth/login">Continue with GitHub →</a></div>}
      <button type="button" className="mobile-filter-toggle secondary-button" aria-expanded={showMobileFilters} onClick={()=>setShowMobileFilters(v=>!v)}><SlidersHorizontal size={16}/>{showMobileFilters?'Hide filters':'Show filters'}<ChevronDown size={15} className={showMobileFilters?'chevron-open':''}/></button>
      <div className={`transaction-filters ag-filter-toolbar dashboard-global-filters ${showMobileFilters?'mobile-filters-open':''}`}>

        <div className="filter-search search-box"><Search size={16}/><input placeholder="Search description, payee, category..." value={query} onChange={e=>setQuery(e.target.value)}/></div>
        <select value={month} onChange={e=>setMonth(e.target.value)}><option value="all">All months</option>{months.filter(m=>m!=='all').map(m=><option key={m}>{m}</option>)}</select>
        <select value={categoryFilter} onChange={e=>setCategoryFilter(e.target.value)}><option value="all">All categories</option>{categoryOptions.map(c=><option key={c}>{c}</option>)}</select>
        <select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}><option value="all">All types</option><option value="expense">Expenses / Debit</option><option value="income">Income / Credit</option></select>
        <label>From<input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/></label><label>To<input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)}/></label>
        <label>Min ₹<input type="number" min="0" placeholder="Any" value={minAmount} onChange={e=>setMinAmount(e.target.value)}/></label><label>Max ₹<input type="number" min="0" placeholder="Any" value={maxAmount} onChange={e=>setMaxAmount(e.target.value)}/></label>
        <button className="secondary-button clear-filters" onClick={clearTransactionFilters}>Clear filters</button>
      </div>
      <section className="financial-kpis" aria-label="Financial summary">
        <article className="kpi-card kpi-expense"><div className="kpi-top"><span>Total expenses</span><span className="kpi-icon"><ArrowDownRight size={18}/></span></div><strong>{money(total)}</strong><small><span className="kpi-dot expense-dot"></span>{expenses.length} debit transactions</small></article>
        <article className="kpi-card kpi-income"><div className="kpi-top"><span>Total income</span><span className="kpi-icon"><ArrowUpRight size={18}/></span></div><strong>{money(income)}</strong><small><span className="kpi-dot income-dot"></span>{filtered.filter(t=>t.type==='income').length} credit transactions</small></article>
        <article className={`kpi-card ${income-total>=0?'kpi-positive':'kpi-negative'}`}><div className="kpi-top"><span>Net cash flow</span><span className="kpi-icon"><Activity size={18}/></span></div><strong>{money(income-total)}</strong><small>{income-total>=0?'Income exceeds expenses':'Expenses exceed income'}</small></article>
        <article className="kpi-card kpi-volume"><div className="kpi-top"><span>Transactions</span><span className="kpi-icon"><ReceiptText size={18}/></span></div><strong>{filtered.length.toLocaleString('en-IN')}</strong><small>Across selected filters</small></article>
      </section>
      <section className="charts-grid">
        <article className="panel"><div className="panel-heading"><div><h2>Expense trend</h2><p>Monthly spending over time</p></div><span className="chart-label">Last 8 months</span></div>
          {trend.length?<ResponsiveContainer width="100%" height={245}><AreaChart data={trend} margin={{top:10,right:8,left:0,bottom:0}}><defs><linearGradient id="fillSpend" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7666e8" stopOpacity={.25}/><stop offset="100%" stopColor="#7666e8" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ececf2"/><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill:'#9292a1',fontSize:12}}/><YAxis axisLine={false} tickLine={false} tick={{fill:'#9292a1',fontSize:11}} tickFormatter={v=>v>=1000?(v/1000)+'k':v}/><Tooltip formatter={v=>money(v)}/><Area type="monotone" dataKey="amount" stroke="#7666e8" strokeWidth={2.5} fill="url(#fillSpend)"/></AreaChart></ResponsiveContainer>:<div className="empty-chart">Add transactions to see your spending trend.</div>}
        </article>
        <article className="panel"><div className="panel-heading"><div><h2>By category</h2><p>Where your money goes</p></div></div>
          {categoryData.length?<><div className="donut-wrap"><ResponsiveContainer width="58%" height={220}><PieChart><Pie data={categoryData} dataKey="value" nameKey="name" innerRadius={57} outerRadius={88} paddingAngle={3}>{categoryData.map((x,i)=><Cell key={x.name} fill={COLORS[i%COLORS.length]}/>)}</Pie><Tooltip formatter={v=>money(v)}/></PieChart></ResponsiveContainer><div className="legend">{categoryData.slice(0,6).map((x,i)=><div key={x.name}><i style={{background:COLORS[i%COLORS.length]}}/><span>{x.name}</span><b>{money(x.value)}</b></div>)}</div></div><div className="category-share-list">{categoryData.slice(0,5).map((x,i)=><div className="category-share-row" key={x.name}><div className="category-share-meta"><span><i style={{background:COLORS[i%COLORS.length]}}/>{x.name}</span><b>{money(x.value)}</b></div><div className="category-share-track"><span style={{width:`${Math.max(2,(x.value/categoryData[0].value)*100)}%`,background:COLORS[i%COLORS.length]}}/></div><small>{Math.round((x.value/total)*100)}% of expenses</small></div>)}</div></>:<div className="empty-chart">Category breakdown appears after you add data.</div>}
        </article>
      </section>
      <section className="panel dashboard-transactions-panel"><div className="panel-heading"><div><h2>Transactions</h2><p>Latest 10 matching records · {filtered.length} transactions match your filters</p></div><button className="secondary-button" onClick={()=>setActiveScreen('transactions')}>View all transactions →</button></div>
        <div className="spendwise-grid ag-theme-quartz"><AgGridReact theme="legacy" rowData={dashboardRows} columnDefs={transactionColumns} defaultColDef={{sortable:true,filter:true,resizable:true}} pagination={false} animateRows={true} rowHeight={50} headerHeight={44} suppressCellFocus={true} enableCellTextSelection={true} domLayout="autoHeight" overlayNoRowsTemplate="No transactions match your filters."/></div>
        <div className="transaction-mobile-list">
          {transactionPageRows.map((t,i)=><article className="transaction-mobile-card" key={t.id||`${t.date}-${i}`}>
            <div className="transaction-mobile-main"><div className="transaction-mobile-icon" style={{'--transaction-accent':t.type==='income'?'#079669':COLORS[(categoryOptions.indexOf(t.category)+COLORS.length)%COLORS.length]}}>{(t.category||'O').trim().charAt(0).toUpperCase()}</div><div className="transaction-mobile-copy"><b>{t.description||t.payee||'Transaction'}</b><span>{t.category||'Other'}{t.subcategory? ` · ${t.subcategory}`:''}</span><small>{t.date?new Date(t.date+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):'Date unavailable'}{t.payee? ` · ${t.payee}`:''}</small></div><strong className={t.type==='income'?'mobile-amount-income':'mobile-amount-expense'}>{t.type==='income'?'+':'−'}{money(t.amount)}</strong></div>
            <div className="transaction-mobile-actions"><button type="button" className="secondary-button" onClick={()=>openEditTransaction(t)}>Edit</button><button type="button" className="secondary-button danger-text" onClick={()=>setDeleteTarget(t)}>Delete</button></div>
          </article>)}
          {!filtered.length&&<div className="mobile-transactions-empty">No transactions match your filters.</div>}
        </div>
        <div className="transaction-mobile-pagination"><span>Showing {filtered.length?((transactionPage-1)*transactionPageSize+1):0}–{Math.min(transactionPage*transactionPageSize,filtered.length)} of {filtered.length}</span><div><button type="button" className="secondary-button" disabled={transactionPage<=1} onClick={()=>setTransactionPage(p=>Math.max(1,p-1))}>Previous</button><b>Page {transactionPage} of {transactionPageCount}</b><button type="button" className="secondary-button" disabled={transactionPage>=transactionPageCount} onClick={()=>setTransactionPage(p=>Math.min(transactionPageCount,p+1))}>Next</button></div></div>
        <div className="dashboard-mobile-transactions">{dashboardRows.map((t,i)=><article className="mobile-transaction-card" key={t.id||`${t.date}-${i}`}><div className="mobile-transaction-icon" style={{'--transaction-accent':t.type==='income'?'#079669':COLORS[(categoryOptions.indexOf(t.category)+COLORS.length)%COLORS.length]}}>{(t.category||'O').trim().charAt(0).toUpperCase()}</div><div className="mobile-transaction-info"><b>{t.description||t.payee||'Transaction'}</b><span>{t.category||'Other'}{t.subcategory? ` · ${t.subcategory}`:''}</span><small>{t.date?new Date(t.date+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):'Date unavailable'}{t.payee? ` · ${t.payee}`:''}</small></div><strong className={t.type==='income'?'mobile-amount-income':'mobile-amount-expense'}>{t.type==='income'?'+':'−'}{money(t.amount)}</strong></article>)}{!dashboardRows.length&&<div className="mobile-transactions-empty">No transactions match your filters.</div>}</div>
      </section>
      </>}
      {(activeScreen==='transactions'||activeScreen==='import')&&<section className={`panel transactions-panel ${activeScreen==='transactions'?'transactions-page-panel':''}`}><div className="panel-heading transaction-heading"><div><h2>{activeScreen==='import'?'Import transactions':'Transactions'}</h2><p>{activeScreen==='import'?'Upload a CSV, map its columns, and review categories before importing.':'Review and manage your activity'}</p></div><div className="action-row"><label className="secondary-button upload-button"><Upload size={15}/> {activeScreen==='import'?'Choose CSV file':'Import PhonePe CSV'}<input type="file" accept=".csv,text/csv" onChange={e=>importCsv(e.target.files?.[0])}/></label>{activeScreen==='transactions'&&<><button className="secondary-button" onClick={exportCsv}><Download size={15}/> Export</button><button className="primary-button" onClick={()=>setShowForm(!showForm)}><Plus size={16}/> Add expense</button></>}</div></div>
        {csvImport&&<div className="csv-mapper"><div className="csv-mapper-head"><div><h3>Map CSV columns and payee categories</h3><p>{csvImport.fileName} · {csvImport.rows.length} rows · {csvImport.payees.length} payees</p></div><button type="button" className="icon-button" onClick={()=>setCsvImport(null)}>✕</button></div>
          <p className="mapper-help">Match the CSV headers to Spendwise fields, then assign a category to each payee. Your payee rules are saved privately and reused on future imports.</p>
          <div className="mapper-grid">{[['date','Transaction date'],['amount','Amount'],['type','Transaction type'],['description','Description'],['payee','Paid to / Payee'],['reference','Reference / UTR'],['status','Status']].map(([k,label])=><label className="mapper-field" key={k}><span>{label}{['date','amount','type'].includes(k)?' *':''}</span><select value={csvImport.mapping[k]||''} onChange={e=>updateCsvMapping(k,e.target.value)}><option value="">— Not mapped —</option>{csvImport.headers.map(h=><option key={h}>{h}</option>)}</select></label>)}</div>
          <div className="payee-category-map"><h4>Payee → Category</h4><p>Example: map “Paid to Rahul” to Family. The mapping will be remembered next time.</p><div className="payee-category-list">{csvImport.payees.map(p=><label className="payee-category-row" key={p}><span title={p}>{p}</span><div className="other-category-selects"><select value={csvImport.payeeCategories[p]||'Other'} onChange={e=>updatePayeeCategory(p,e.target.value)}>{categoryOptions.map(c=><option key={c}>{c}</option>)}</select>{csvImport.payeeCategories[p]&&csvImport.payeeCategories[p]!=='Other'&&<select value={csvImport.payeeSubcategories?.[p]||''} onChange={e=>updatePayeeSubcategory(p,e.target.value)}><option value="">No subcategory</option>{subcategoryOptions(csvImport.payeeCategories[p]).map(sub=><option key={sub}>{sub}</option>)}</select>}</div></label>)}</div></div>
          <div className="mapper-preview"><b>Preview (first 5 rows)</b><div className="table-scroll"><table><thead><tr><th>Date</th><th>Payee</th><th>Description</th><th>Transaction type</th><th>Category</th><th className="right">Amount</th></tr></thead><tbody>{csvImport.rows.slice(0,5).map((r,i)=>{const m=csvImport.mapping,p=String((m.payee?r[m.payee]:'')||(m.description?r[m.description]:'')||'Unknown payee').trim();return <tr key={i}><td>{m.date?r[m.date]:''}</td><td>{p}</td><td>{m.description?r[m.description]:''}</td><td>{m.type?r[m.type]:''}</td><td>{csvImport.payeeCategories[p]||'Other'}</td><td className="right">{m.amount?r[m.amount]:''}</td></tr>})}</tbody></table></div></div>
          <div className="mapper-actions"><button type="button" className="secondary-button" onClick={()=>setCsvImport(null)}>Cancel</button><button type="button" className="primary-button" onClick={confirmCsvImport}>Confirm and import</button></div></div>}
        {activeScreen==='insights'&&<><div className="welcome"><div><p className="eyebrow">SPENDWISE INTELLIGENCE</p><h1>AI spending insights</h1><p className="muted">Ask questions and explore practical insights from your selected financial data.</p></div><button className="secondary-button" onClick={refresh}><RefreshCw size={15}/> Refresh data</button></div>
      {error&&<div className="notice">{error}</div>}
      <section className="ai-insights-panel panel">
        <div className="ai-insights-heading"><div className="ai-sparkle-icon"><Sparkles size={19}/></div><div><span className="ai-kicker">SPENDWISE INTELLIGENCE</span><h2>Ask your money a question</h2><p>Get practical insights from your spending patterns.</p></div></div>
        <div className="ai-insights-input"><textarea value={insightQuestion} onChange={e=>setInsightQuestion(e.target.value)} placeholder="e.g. Where am I spending more than usual? How can I save ₹5,000 next month?" rows={2} maxLength={500}/><button className="primary-button" onClick={()=>generateInsights()} disabled={insightLoading||!filtered.length}><Sparkles size={16}/>{insightLoading?'Analysing…':'Generate insights'}</button></div>
        <div className="ai-suggested-questions"><button type="button" onClick={()=>{setInsightQuestion('Which categories should I focus on to reduce my expenses?');setInsightResult('');}}>Where can I save?</button><button type="button" onClick={()=>{setInsightQuestion('What changed in my spending month over month?');setInsightResult('');}}>Spending trends</button><button type="button" onClick={()=>{setInsightQuestion('What unusual patterns or potential overspending do you see?');setInsightResult('');}}>Spot unusual spending</button></div>
        {insightLoading&&<div className="ai-loading"><span className="ai-spinner"></span>Reviewing your spending summary…</div>}
        {insightError&&<div className="ai-error" role="alert">{insightError}</div>}
        {insightResult&&<div className="ai-result"><div className="ai-result-title"><Sparkles size={15}/> Your spending insights</div><div className="ai-result-content">{insightResult}</div><small>AI-generated observations based on the selected report. Verify figures before making financial decisions.</small></div>}
        <div className="ai-privacy-note"><ShieldCheck size={14}/> Only totals, monthly aggregates and category summaries are sent for analysis. Transaction descriptions and payee names are not shared.</div>
      </section>
      </>}
      {activeScreen==='transactions'&&showForm&&<form className="entry-form" onSubmit={addTransaction}><input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/><input placeholder="Description" required value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/><input placeholder="Payee / merchant" value={form.payee} onChange={e=>setForm({...form,payee:e.target.value})}/><select value={form.category} onChange={e=>setForm({...form,category:e.target.value,subcategory:''})}>{categoryOptions.map(c=><option key={c}>{c}</option>)}</select><select value={form.subcategory} onChange={e=>setForm({...form,subcategory:e.target.value})}><option value=''>No subcategory</option>{subcategoryOptions(form.category).map(c=><option key={c}>{c}</option>)}</select><input type="number" min="0.01" step="0.01" placeholder="Amount ₹" required value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/><select value={form.type} onChange={e=>setForm({...form,type:e.target.value})}><option value="expense">Expense</option><option value="income">Income</option></select><button className="primary-button" type="submit">Save transaction</button></form>}
        {activeScreen==='transactions'&&<><div className="transaction-filters ag-filter-toolbar">
          <div className="filter-search search-box"><Search size={16}/><input placeholder="Search description, payee, category..." value={query} onChange={e=>setQuery(e.target.value)}/></div>
          <select value={month} onChange={e=>setMonth(e.target.value)}><option value="all">All months</option>{months.filter(m=>m!=='all').map(m=><option key={m}>{m}</option>)}</select>
          <select value={categoryFilter} onChange={e=>setCategoryFilter(e.target.value)}><option value="all">All categories</option>{categoryOptions.map(c=><option key={c}>{c}</option>)}</select>
          <select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}><option value="all">All types</option><option value="expense">Expenses / Debit</option><option value="income">Income / Credit</option></select>
          <label>Date from<input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/></label><label>Date to<input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)}/></label>
          <label>Min amount<input type="number" min="0" placeholder="Any" value={minAmount} onChange={e=>setMinAmount(e.target.value)}/></label><label>Max amount<input type="number" min="0" placeholder="Any" value={maxAmount} onChange={e=>setMaxAmount(e.target.value)}/></label>
          <button className="secondary-button clear-filters" onClick={clearTransactionFilters}>Clear filters</button>
        </div><div className="table-tools transaction-grid-tools"><span>{filtered.length} of {data.transactions.length} transactions</span><div className="column-picker-wrap"><button type="button" className="secondary-button column-picker-trigger" onClick={()=>setShowColumnPicker(v=>!v)}><SlidersHorizontal size={15}/> Columns <ChevronDown size={14}/></button>{showColumnPicker&&<><button type="button" className="column-picker-backdrop" aria-label="Close column options" onClick={()=>setShowColumnPicker(false)}></button><div className="column-picker-menu"><div className="column-picker-head"><b>Show / hide columns</b><button type="button" onClick={()=>setShowColumnPicker(false)} aria-label="Close">×</button></div><div className="column-picker-actions"><button type="button" onClick={()=>setAllTransactionColumnsVisible(true)}>Show all</button><button type="button" onClick={()=>setAllTransactionColumnsVisible(false)}>Hide all</button></div>{transactionColumnOptions.map(col=><label className="column-picker-option" key={col.key}><input type="checkbox" checked={transactionGridApi?.getColumn(col.key)?.isVisible()??true} onChange={e=>setTransactionColumnVisible(col.key,e.target.checked)}/><span>{col.label}</span></label>)}<p>Choose which columns appear in the grid.</p></div></>}</div></div>
        <div className="spendwise-grid ag-theme-quartz"><AgGridReact theme="legacy" onGridReady={e=>setTransactionGridApi(e.api)} rowData={filtered} columnDefs={transactionColumns} defaultColDef={{sortable:true,filter:true,floatingFilter:true,resizable:true,wrapHeaderText:true,autoHeaderHeight:true,menuTabs:['filterMenuTab','generalMenuTab','columnsMenuTab']}} pagination={true} paginationPageSize={20} paginationPageSizeSelector={[20]} animateRows={true} ensureDomOrder={true} rowHeight={54} headerHeight={48} suppressCellFocus={true} enableCellTextSelection={true} suppressCellFocus={true} domLayout="autoHeight" overlayNoRowsTemplate="No transactions match your filters."/></div>
      </>}
      </section>}
      {activeScreen==='mapping'&&(()=>{const groups=Object.values(data.transactions.filter(t=>t.category==='Other').reduce((acc,t)=>{const key=String(t.description||'').trim()||'Unspecified description';if(!acc[key])acc[key]={description:key,count:0,total:0};acc[key].count++;acc[key].total+=Number(t.amount)||0;return acc;},{})).sort((a,b)=>b.total-a.total);const visibleGroups=groups.filter(g=>g.description.toLowerCase().includes(otherMappingSearch.trim().toLowerCase()));return <section className="panel mapping-panel review-other-panel"><div className="panel-heading"><div><h2>Descriptions needing categories</h2><p>Each description is listed once, even if it appears in many transactions. Choose categories, then update all mappings together.</p><small>{groups.length} unique descriptions · {data.transactions.filter(t=>t.category==='Other').length} transactions currently in Other</small></div><button className="primary-button" onClick={updateOtherMappings} disabled={!Object.values(otherCategoryChoices).some(v=>v&&v!=='Other')}>Update mappings</button></div><div className="other-mapping-search"><Search size={16}/><input type="search" placeholder="Filter descriptions or payees…" value={otherMappingSearch} onChange={e=>setOtherMappingSearch(e.target.value)}/>{otherMappingSearch&&<button type="button" onClick={()=>setOtherMappingSearch('')}>Clear</button>}<span>{visibleGroups.length} of {groups.length}</span></div>{groups.length?(visibleGroups.length?<div className="description-mapping-list">{visibleGroups.map(g=><div className="description-mapping-row" key={g.description}><div className="description-mapping-text"><b>{g.description}</b><small>{g.count} transaction{g.count===1?'':'s'} · Total {money(g.total)}</small></div><div className="other-category-selects"><select value={otherCategoryChoices[g.description]||'Other'} onChange={e=>{setOtherCategoryChoices(c=>({...c,[g.description]:e.target.value}));setOtherSubcategoryChoices(c=>({...c,[g.description]:''}));}}><option value="Other">Select category…</option>{categoryOptions.filter(c=>c!=='Other').map(c=><option key={c}>{c}</option>)}</select>{otherCategoryChoices[g.description]&&otherCategoryChoices[g.description]!=='Other'&&<select value={otherSubcategoryChoices[g.description]||''} onChange={e=>setOtherSubcategoryChoices(c=>({...c,[g.description]:e.target.value}))}><option value="">No subcategory</option>{subcategoryOptions(otherCategoryChoices[g.description]).map(sub=><option key={sub}>{sub}</option>)}</select>}</div></div>)}</div>:<div className="empty-table">No descriptions match your filter.</div>):<div className="empty-table">All transactions are categorized. Nothing needs review.</div>}</section>})()}}

      {activeScreen==='categories'&&<section className="panel category-management-panel"><div className="panel-heading"><div><h2>Manage categories</h2><p>Add categories or safely remove one. Existing transactions and rules will be reassigned before deletion.</p></div></div><form className="category-add-form" onSubmit={addCategory}><input value={newCategory} onChange={e=>setNewCategory(e.target.value)} placeholder="New category name" maxLength={40} required/><button className="primary-button" type="submit"><Plus size={15}/> Add category</button></form><div className="subcategory-manager"><h3>Subcategories</h3><p>Optional detail under each category, such as Groceries → Milk, Vegetables, Rice or Family → Rahul.</p><form className="category-add-form" onSubmit={addSubcategory}><select value={subcategoryCategory} onChange={e=>setSubcategoryCategory(e.target.value)}>{categoryOptions.filter(c=>c!=='Other').map(c=><option key={c}>{c}</option>)}</select><input value={newSubcategory} onChange={e=>setNewSubcategory(e.target.value)} placeholder="New subcategory name" maxLength={40} required/><button className="primary-button" type="submit"><Plus size={15}/> Add subcategory</button></form><div className="subcategory-chip-groups">{categoryOptions.filter(c=>(data.subcategories?.[c]||[]).length).map(c=><div key={c}><b>{c}</b><div>{subcategoryOptions(c).map(sub=><span className="subcategory-chip" key={sub}>{sub}<button type="button" onClick={()=>deleteSubcategory(c,sub)} aria-label={'Delete '+sub}>×</button></span>)}</div></div>)}</div></div><div className="category-admin-list">{categoryOptions.map(c=><div className="category-admin-row" key={c}><span>{c}</span><small>{data.transactions.filter(t=>t.category===c).length} transactions</small><button type="button" className="secondary-button" onClick={()=>{setCategoryToDelete(c);setReplacementCategory(categoryOptions.find(x=>x!==c)||'');}}>Delete</button></div>)}</div>{categoryToDelete&&<div className="category-delete-dialog" role="dialog" aria-modal="true"><div className="category-delete-card"><h3>Delete “{categoryToDelete}”?</h3><p>{data.transactions.some(t=>t.category===categoryToDelete)?'This category contains transactions. Choose a replacement category; all affected transactions and mapping rules will be reassigned.':'This category is unused and can be safely deleted.'}</p>{(data.transactions.some(t=>t.category===categoryToDelete)||(data.categoryMappings||[]).some(m=>m.category===categoryToDelete)||Object.values(data.rules||{}).includes(categoryToDelete))&&<label>Move everything to<select value={replacementCategory} onChange={e=>setReplacementCategory(e.target.value)}><option value="">Choose replacement category</option>{categoryOptions.filter(c=>c!==categoryToDelete).map(c=><option key={c}>{c}</option>)}</select></label>}<div className="category-dialog-actions"><button className="secondary-button" type="button" onClick={()=>{setCategoryToDelete('');setReplacementCategory('');}}>Cancel</button><button className="primary-button danger-button" type="button" onClick={deleteCategory}>Confirm delete & recalculate</button></div></div></div>}</section>}
      {activeScreen==='categories'&&<section className="panel mapping-panel"><div className="panel-heading"><div><h2>Date-wise category mappings</h2><p>Change a payee's category for any date range. Saving a mapping recalculates all matching transactions, including previously imported ones.</p></div></div><form className="mapping-form date-mapping-form" onSubmit={addMapping}><input placeholder="Payee / description contains (e.g. Rahul)" value={mapping.payee} onChange={e=>setMapping({...mapping,payee:e.target.value})} required/><select value={mapping.category} onChange={e=>setMapping({...mapping,category:e.target.value,subcategory:''})}>{categoryOptions.map(c=><option key={c}>{c}</option>)}</select><select value={mapping.subcategory} onChange={e=>setMapping({...mapping,subcategory:e.target.value})}><option value=''>No subcategory</option>{subcategoryOptions(mapping.category).map(c=><option key={c}>{c}</option>)}</select><label>From<input type="date" value={mapping.effectiveFrom} onChange={e=>setMapping({...mapping,effectiveFrom:e.target.value})}/></label><label>To (optional)<input type="date" value={mapping.effectiveTo} onChange={e=>setMapping({...mapping,effectiveTo:e.target.value})}/><small>Leave blank to apply indefinitely</small></label><button className="secondary-button"><Plus size={15}/> Save & recalculate</button></form><p className="mapping-hint">Leave To empty to keep this mapping active indefinitely, including future transactions. If rules overlap, the rule with the latest start date takes precedence.</p><div className="rules-list date-rules">{(data.categoryMappings||[]).map(m=><span key={m.id}><b>{m.matchText}</b> → {m.category}{m.subcategory?` / ${m.subcategory}`:''} <small>{m.effectiveFrom||'Beginning'} to {m.effectiveTo||'No end date'}</small><button type="button" onClick={()=>removeCategoryMapping(m.id)} title="Remove mapping">×</button></span>)}{!data.categoryMappings?.length&&Object.entries(data.rules||{}).map(([k,v])=><span key={k}>{k} → {v} <small>Legacy mapping · all dates</small></span>)}</div></section>}
      {editTarget&&editForm&&<div className="transaction-delete-overlay" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget){setEditTarget(null);setEditForm(null);}}}><div className="transaction-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-transaction-title"><div className="transaction-edit-heading"><div><h3 id="edit-transaction-title">Edit transaction</h3><p>Update the transaction details below.</p></div><button type="button" className="icon-button" onClick={()=>{setEditTarget(null);setEditForm(null);}} aria-label="Close">×</button></div><form onSubmit={saveEditedTransaction}><div className="transaction-edit-fields"><label>Date<input type="date" required value={editForm.date} onChange={e=>setEditForm({...editForm,date:e.target.value})}/></label><label>Description<input required value={editForm.description} onChange={e=>setEditForm({...editForm,description:e.target.value})}/></label><label>Payee / recipient<input value={editForm.payee} onChange={e=>setEditForm({...editForm,payee:e.target.value})}/></label><label>Amount (₹)<input type="number" min="0.01" step="0.01" required value={editForm.amount} onChange={e=>setEditForm({...editForm,amount:e.target.value})}/></label><label>Transaction type<select value={editForm.type} onChange={e=>setEditForm({...editForm,type:e.target.value})}><option value="expense">Debit / Expense</option><option value="income">Credit / Income</option></select></label><label>Category<select value={editForm.category} onChange={e=>setEditForm({...editForm,category:e.target.value,subcategory:''})}>{categoryOptions.map(c=><option key={c}>{c}</option>)}</select></label><label>Subcategory (optional)<select value={editForm.subcategory} onChange={e=>setEditForm({...editForm,subcategory:e.target.value})}><option value="">No subcategory</option>{subcategoryOptions(editForm.category).map(c=><option key={c}>{c}</option>)}</select></label><label>Reference / UTR<input value={editForm.reference} onChange={e=>setEditForm({...editForm,reference:e.target.value})}/></label><label>Source<input value={editForm.source} onChange={e=>setEditForm({...editForm,source:e.target.value})}/></label><label>Currency<input value={editForm.currency} onChange={e=>setEditForm({...editForm,currency:e.target.value})}/></label></div><div className="transaction-edit-actions"><button type="button" className="secondary-button" onClick={()=>{setEditTarget(null);setEditForm(null);}}>Cancel</button><button type="submit" className="primary-button" disabled={editSaving}>{editSaving?<><span className="button-spinner" aria-hidden="true"></span> Saving…</>:<><ShieldCheck size={15}/> Save changes</>}</button></div></form></div></div>}
      {deleteTarget&&<div className="transaction-delete-overlay" role="presentation"><div className="transaction-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-transaction-title"><h3 id="delete-transaction-title">Delete transaction?</h3><p>This will permanently remove <b>{deleteTarget.description||'this transaction'}</b> ({money(deleteTarget.amount)}) from your private Spendwise data.</p><div className="category-dialog-actions"><button type="button" className="secondary-button" onClick={()=>setDeleteTarget(null)}>Cancel</button><button type="button" className="primary-button danger-button" onClick={()=>deleteTransaction(deleteTarget)}><Trash2 size={15}/> Delete transaction</button></div></div></div>}
      <footer>Spendwise · Private data stored in your GitHub repository · <a href="https://github.com/vishwashyadav/spendwise-data" target="_blank" rel="noreferrer">Data repository</a></footer>
    </main>
  </div>;
}
