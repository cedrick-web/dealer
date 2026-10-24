import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowRight, ArrowUpRight, BadgeCheck, Bell, Building2, CalendarClock, Check,
  CheckCircle2, ChevronDown, ChevronRight, CircleAlert, ClipboardList, Download, FileCheck2,
  FilePlus2, FileText, Filter, Globe2, Heart, House, LayoutDashboard, LockKeyhole, LogIn,
  LogOut, MapPin, Menu, MessageCircle, MoreHorizontal, Plus, RefreshCw, Search, Send, Settings,
  ShieldCheck, SlidersHorizontal, Sparkles, Upload, UserCircle, Users, WalletCards, X
} from 'lucide-react';
import { api, type Conversation, type Deal, type EvidenceDocument, type Lead, type Listing, type Message, type User, setSessionToken } from './api';

type View = 'discover'|'dashboard'|'new-listing'|'my-listings'|'saved'|'messages'|'deals'|'trust'|'account'|'admin';
type AuthMode = 'login'|'register';
const money = (amount:number) => new Intl.NumberFormat('en-RW',{style:'currency',currency:'RWF',maximumFractionDigits:0}).format(amount || 0);
const dateLabel = (value?:string) => value ? new Date(value).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}) : 'Not recorded';
const stages = ['proposed','viewing','offer','due_diligence','agreement','completed','cancelled'];
const imageIds = ['photo-1600596542815-ffad4c1539a9','photo-1600607687939-ce8a6c25118c','photo-1600607687920-4e2a09cf159d','photo-1600566753086-00f18fb6b3ea','photo-1500382017468-9049fed747ef','photo-1511818966892-d7d671e672a2'];
const photoFor = (listing:Listing) => {
  const type = listing.propertyType;
  const id = type==='land' ? imageIds[4] : type==='apartment' ? imageIds[1] : type==='commercial' ? imageIds[5] : imageIds[0];
  return 'https://images.unsplash.com/' + id + '?auto=format&fit=crop&w=1000&q=82';
};
const prettyStage = (value:string) => value.replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());

function ErrorNote({text,onClose}:{text:string;onClose:()=>void}) {
  if(!text) return null;
  return <div className="toast" role="status"><CircleAlert size={18}/><span>{text}</span><button onClick={onClose} aria-label="Dismiss"><X size={17}/></button></div>;
}
function EmptyState({icon:Icon=Search,title,body,action,button}:{icon?:any;title:string;body:string;action?:()=>void;button?:string}) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={24}/></span><h3>{title}</h3><p>{body}</p>{action&&button&&<button className="btn btn-primary" onClick={action}>{button}<ArrowRight size={16}/></button>}</div>;
}
function ListingCard({item,saved,onSave,onOpen}:{item:Listing;saved:boolean;onSave:()=>void;onOpen:()=>void}) {
  return <article className="listing-card">
    <button className="listing-photo" style={{backgroundImage:'url('+photoFor(item)+')'}} onClick={onOpen} aria-label={'Open '+item.title}>
      <span className="listing-badge">{item.purpose==='sale'?'FOR SALE':'FOR RENT'}</span>
      <span className="photo-location"><MapPin size={13}/>{item.location.sector ? item.location.sector+', ':''}{item.location.district}</span>
    </button>
    <button className={'favorite-float '+(saved?'is-saved':'')} onClick={onSave} aria-label={saved?'Remove saved property':'Save property'}><Heart size={18} fill={saved?'currentColor':'none'}/></button>
    <div className="listing-content">
      <div className="listing-type">{item.propertyType} <span>·</span> Rwanda</div>
      <button className="listing-title" onClick={onOpen}>{item.title}</button>
      <p className="listing-description">{item.description}</p>
      <div className="listing-price-row"><strong>{money(item.price.amount)}</strong>{item.purpose==='rent'&&<span>/ month</span>}<button className="icon-button" onClick={onOpen} aria-label="View property"><ArrowUpRight size={18}/></button></div>
      <div className="listing-trust"><ShieldCheck size={15}/><span>{item.verification?.status==='reviewed'?'Review recorded':'Review not confirmed'}</span><small>{item.status==='published'?'Published listing':'Status pending'}</small></div>
    </div>
  </article>;
}

export default function App() {
  const [view,setView] = useState<View>('discover');
  const [returnView,setReturnView] = useState<View>('dashboard');
  const [items,setItems] = useState<Listing[]>([]);
  const [myItems,setMyItems] = useState<Listing[]>([]);
  const [savedIds,setSavedIds] = useState<string[]>([]);
  const [savedItems,setSavedItems] = useState<Listing[]>([]);
  const [leads,setLeads] = useState<Lead[]>([]);
  const [conversations,setConversations] = useState<Conversation[]>([]);
  const [messages,setMessages] = useState<Message[]>([]);
  const [deals,setDeals] = useState<Deal[]>([]);
  const [pending,setPending] = useState<Listing[]>([]);
  const [docs,setDocs] = useState<EvidenceDocument[]>([]);
  const [selectedConversation,setSelectedConversation] = useState('');
  const [user,setUser] = useState<User|null>(null);
  const [authMode,setAuthMode] = useState<AuthMode>('login');
  const [authOpen,setAuthOpen] = useState(false);
  const [mobileNav,setMobileNav] = useState(false);
  const [apiOnline,setApiOnline] = useState(false);
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState('');
  const [districts,setDistricts] = useState<string[]>([]);
  const [search,setSearch] = useState('');
  const [district,setDistrict] = useState('All Rwanda');
  const [purpose,setPurpose] = useState<'sale'|'rent'>('sale');
  const [propertyType,setPropertyType] = useState('All properties');
  const [sort,setSort] = useState('newest');
  const [modal,setModal] = useState<Listing|null>(null);
  const [language,setLanguage] = useState<'en'|'rw'>('en');
  const [authForm,setAuthForm] = useState({name:'',email:'',phone:'',password:''});
  const [listingForm,setListingForm] = useState({title:'',description:'',propertyType:'house',purpose:'sale',district:'Gasabo',sector:'',price:''});
  const [viewingForm,setViewingForm] = useState({message:'I would like to arrange a viewing and discuss this property.',preferredAt:''});
  const [messageDraft,setMessageDraft] = useState('');
  const [dealForm,setDealForm] = useState({commissionPercent:'3',commissionTerms:'Commission is payable only after both parties sign the written agreement and the transaction legally closes.'});
  const [hashInput,setHashInput] = useState('');
  const [hashResult,setHashResult] = useState<{exists:boolean;meaning:string}|null>(null);
  const [reviewNotes,setReviewNotes] = useState<Record<string,string>>({});

  const t = (en:string,rw:string) => language==='en'?en:rw;
  const flash = (text:string) => { setNotice(text); window.setTimeout(()=>setNotice(current=>current===text?'':current),6500); };
  const refreshListings = useCallback(async () => {
    try {
      const result = await api.listings({limit:'60'});
      setItems(result.data || []);
      setApiOnline(true);
    } catch (e) { setApiOnline(false); throw e; }
  },[]);
  const refreshWorkspace = useCallback(async (activeUser:User) => {
    const safe = async <T,>(fn:()=>Promise<T>, fallback:T) => { try { return await fn(); } catch { return fallback; } };
    const [owned,favorites,leadData,rooms,dealData] = await Promise.all([
      safe(()=>api.myListings(),{data:[] as Listing[]}),
      safe(()=>api.favorites(),{data:[] as {listingId:string;createdAt:string}[]}),
      safe(()=>api.myLeads(),{data:[] as Lead[]}),
      safe(()=>api.conversations(),{data:[] as Conversation[]}),
      safe(()=>api.deals(),{data:[] as Deal[]}),
    ]);
    setMyItems(owned.data || []);
    setSavedIds((favorites.data || []).map(x=>x.listingId));
    setLeads(leadData.data || []);
    setConversations(rooms.data || []);
    setDeals(dealData.data || []);
    const detailResults = await Promise.all((favorites.data || []).map(x=>safe(()=>api.listing(x.listingId),null as any)));
    setSavedItems(detailResults.filter(Boolean).map((x:any)=>x.data).filter(Boolean));
    if(activeUser.role==='admin') {
      const adminData=await safe(()=>api.adminPending(),{data:[] as Listing[]});
      setPending(adminData.data || []);
    } else setPending([]);
  },[]);
  const refreshMessages = useCallback(async (id:string) => {
    if(!id) { setMessages([]); return; }
    try { const r=await api.messages(id); setMessages(r.data || []); } catch(e) { flash((e as Error).message); }
  },[]);

  useEffect(() => {
    let alive=true;
    api.health().then(()=>{if(alive)setApiOnline(true)}).catch(()=>{if(alive)setApiOnline(false)});
    api.districts().then(r=>{if(alive)setDistricts(r.data || [])}).catch(()=>{});
    refreshListings().catch(()=>{});
    if(localStorage.getItem('dealer.session.v1')) {
      api.me().then(async active=>{if(!alive)return;setUser(active); await refreshWorkspace(active)}).catch(()=>{if(alive){setSessionToken('');setUser(null)}});
    }
    return ()=>{alive=false};
  },[refreshListings,refreshWorkspace]);
  useEffect(()=>{if(view==='messages'&&selectedConversation)refreshMessages(selectedConversation)},[view,selectedConversation,refreshMessages]);

  const filtered = useMemo(()=>{
    let data = view==='saved' ? savedItems : view==='my-listings' ? myItems : items;
    if(view==='discover') data = data.filter(x=>x.purpose===purpose);
    if(propertyType!=='All properties'&&view==='discover') data=data.filter(x=>x.propertyType===propertyType);
    if(district!=='All Rwanda'&&view==='discover') data=data.filter(x=>x.location.district===district);
    const q=search.trim().toLowerCase();
    if(q) data=data.filter(x=>[x.title,x.description,x.location.district,x.location.sector,x.propertyType].join(' ').toLowerCase().includes(q));
    if(sort==='price-low') data=[...data].sort((a,b)=>a.price.amount-b.price.amount);
    else if(sort==='price-high') data=[...data].sort((a,b)=>b.price.amount-a.price.amount);
    else if(sort==='oldest') data=[...data].sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||'')));
    return data;
  },[view,savedItems,myItems,items,purpose,propertyType,district,search,sort]);

  const requireUser = (target?:View) => {
    if(!user) { setAuthMode('login');setAuthOpen(true); setReturnView(target || view); if(target) setView(target); return false; }
    return true;
  };
  const navTo = (target:View) => {
    setMobileNav(false);
    if(['dashboard','new-listing','my-listings','saved','messages','deals','account','admin'].includes(target) && !user) { setReturnView(target); setAuthMode('login'); setAuthOpen(true); setView(target==='new-listing'?'discover':target); return; }
    setView(target);
  };
  const withBusy = async (job:()=>Promise<void>) => {
    if(busy)return; setBusy(true);
    try { await job(); } catch(e) { flash((e as Error).message || 'The request could not be completed.'); }
    finally { setBusy(false); }
  };
  const handleAuth = (event:FormEvent) => {
    event.preventDefault();
    void withBusy(async()=>{
      const active = authMode==='login'
        ? await api.login({email:authForm.email,password:authForm.password})
        : await api.register({name:authForm.name,email:authForm.email,password:authForm.password,phone:authForm.phone});
      setUser(active);setAuthOpen(false);setAuthForm({name:'',email:'',phone:'',password:''});
      await Promise.all([refreshWorkspace(active),refreshListings()]);
      setView(active.role==='admin'?'admin':returnView);flash(t('Signed in securely.','Winjiye neza.'));
    });
  };
  const signOut = () => { setSessionToken('');setUser(null);setMyItems([]);setSavedIds([]);setSavedItems([]);setLeads([]);setConversations([]);setMessages([]);setDeals([]);setView('discover');flash(t('You have signed out.','Wasohotse muri konti.')); };
  const saveListing = (item:Listing) => {
    if(!requireUser()) return;
    void withBusy(async()=>{
      if(savedIds.includes(item.publicId)){await api.removeFavorite(item.publicId);setSavedIds(s=>s.filter(id=>id!==item.publicId));setSavedItems(s=>s.filter(x=>x.publicId!==item.publicId));flash(t('Removed from saved properties.','Byavanywe mu mitungo wabitswe.'))}
      else {await api.saveFavorite(item.publicId);setSavedIds(s=>[...s,item.publicId]);setSavedItems(s=>[item,...s]);flash(t('Property saved to your account.','Umutungo wabitswe muri konti.'))}
    });
  };
  const submitListing = (event:FormEvent) => {
    event.preventDefault();if(!requireUser())return;
    void withBusy(async()=>{
      const result=await api.createListing({
        title:listingForm.title,description:listingForm.description,propertyType:listingForm.propertyType as Listing['propertyType'],
        purpose:listingForm.purpose as Listing['purpose'],location:{district:listingForm.district,sector:listingForm.sector},
        price:{amount:Number(listingForm.price),currency:'RWF',period:listingForm.purpose==='rent'?'month':'once'},
      });
      setListingForm({title:'',description:'',propertyType:'house',purpose:'sale',district:'Gasabo',sector:'',price:''});
      await refreshWorkspace(user!);setView('my-listings');
      flash('Submitted for review. Reference: '+result.id+'. It will not be public until an administrator approves it.');
    });
  };
  const openViewing = (event:FormEvent) => {
    event.preventDefault();if(!modal||!requireUser())return;
    void withBusy(async()=>{
      const result=await api.createLead({listingId:modal.publicId,type:'viewing',message:viewingForm.message,preferredAt:viewingForm.preferredAt});
      setModal(null);await refreshWorkspace(user!);flash('Viewing request recorded. Reference: '+result.data.publicId);
    });
  };
  const startConversation = (item:Listing) => {
    if(!requireUser())return;
    void withBusy(async()=>{
      const result=await api.openConversation(item.publicId);
      await refreshWorkspace(user!);
      setSelectedConversation(result.data.publicId);setModal(null);setView('messages');
    });
  };
  const startDeal = (item:Listing) => {
    if(!requireUser())return;
    void withBusy(async()=>{
      const result=await api.createDeal({listingId:item.publicId,commissionPercent:Number(dealForm.commissionPercent),commissionTerms:dealForm.commissionTerms});
      await refreshWorkspace(user!);setModal(null);setView('deals');flash('Deal workspace created. The other party must review the fee terms separately.');
      void result;
    });
  };
  const sendMessage = (event:FormEvent) => {
    event.preventDefault();if(!selectedConversation||!messageDraft.trim())return;
    void withBusy(async()=>{
      await api.sendMessage(selectedConversation,messageDraft.trim());setMessageDraft('');
      await refreshMessages(selectedConversation);
      const c=conversations.find(x=>x.publicId===selectedConversation);
      if(c) setConversations(prev=>prev.map(x=>x.publicId===c.publicId?{...x,lastMessage:messageDraft.trim(),updatedAt:new Date().toISOString()}:x));
    });
  };
  const acceptFee = (deal:Deal) => void withBusy(async()=>{await api.acceptFee(deal.publicId);await refreshWorkspace(user!);flash('Fee acceptance recorded. This is an in-platform acknowledgement, not a substitute for a signed contract.')});
  const updateStage = (deal:Deal,stage:string) => void withBusy(async()=>{await api.updateDealStage(deal.publicId,stage,'Milestone updated in the deal workspace');await refreshWorkspace(user!)});
  const runReview = (item:Listing,decision:'approve'|'reject'|'request_changes') => void withBusy(async()=>{await api.adminReview(item.publicId,decision,reviewNotes[item.publicId]||'');await refreshWorkspace(user!);await refreshListings();flash('Review decision recorded: '+decision+'.')});
  const doTrustCheck = (event:FormEvent) => {event.preventDefault();void withBusy(async()=>setHashResult(await api.verifyHash(hashInput.trim())))};
  const handleUpload = (listing:Listing,file?:File|null) => {if(!file)return;void withBusy(async()=>{const result=await api.uploadDocument(listing.publicId,file);setDocs(prev=>[result.data,...prev]);flash('Evidence stored privately. SHA-256: '+result.sha256)})};
  const loadDocs = (listing:Listing) => {if(!requireUser())return;void withBusy(async()=>setDocs((await api.documents(listing.publicId)).data||[]))};

  const navigation:{id:View;label:string;icon:any;group:string}[]=[
    {id:'discover',label:t('Discover property','Gushaka umutungo'),icon:Search,group:'Marketplace'},
    {id:'dashboard',label:t('Overview','Incamake'),icon:LayoutDashboard,group:'Workspace'},
    {id:'new-listing',label:t('Create listing','Shyiraho umutungo'),icon:FilePlus2,group:'Workspace'},
    {id:'my-listings',label:t('My listings','Imitungo yanjye'),icon:Building2,group:'Workspace'},
    {id:'saved',label:t('Saved properties','Ibyabitswe'),icon:Heart,group:'Workspace'},
    {id:'messages',label:t('Messages','Ubutumwa'),icon:MessageCircle,group:'Workspace'},
    {id:'deals',label:t('Deals & fees','Amasezerano'),icon:WalletCards,group:'Workspace'},
    {id:'trust',label:t('Evidence checker','Igenzura ry’inyandiko'),icon:ShieldCheck,group:'Tools'},
    ...(user?.role==='admin'?[{id:'admin' as View,label:t('Review queue','Igenzura'),icon:ClipboardList,group:'Administration'}]:[]),
    {id:'account',label:t('Account settings','Konti'),icon:Settings,group:'Account'},
  ];
  const heading:{[key in View]:{title:string;subtitle:string}}={
    discover:{title:t('Find a property with a clearer record.','Shaka umutungo ufite amakuru asobanutse.'),subtitle:t('Explore public listings, compare options and ask questions before making commitments.','Reba amatangazo rusange kandi ubaze mbere yo kwiyemeza.')},
    dashboard:{title:t('Your property workspace','Ahantu hakurikirana imitungo yawe'),subtitle:t('Keep your listings, conversations, viewing requests and deal milestones in one place.')},
    'new-listing':{title:t('Create a property listing','Shyiraho itangazo ry’umutungo'),subtitle:t('Submissions stay private until the review team approves them.')},
    'my-listings':{title:t('Your listings','Amatangazo yawe'),subtitle:t('See review status and continue preparing the evidence for every property.')},
    saved:{title:t('Saved properties','Imitungo wabitse'),subtitle:t('Your shortlist stays attached to your account across devices.')},
    messages:{title:t('Private conversations','Ubutumwa bwihariye'),subtitle:t('Keep deal-related questions attached to the property they concern.')},
    deals:{title:t('Deal room & commission terms','Amasezerano na komisiyo'),subtitle:t('Track milestones, record fee acceptance and keep the activity history readable.')},
    trust:{title:t('Evidence hash checker','Igenzura ry’ibimenyetso'),subtitle:t('Check whether this platform recorded a particular content digest. It cannot validate legal ownership.')},
    account:{title:t('Account settings','Imiterere ya konti'),subtitle:t('Manage session details and review your current access role.')},
    admin:{title:t('Listing review queue','Amatangazo agomba kugenzurwa'),subtitle:t('Review submitted listings and record a clear decision and note.')},
  };
  const title=heading[view];

  return <div className="app-shell">
    <header className="app-header">
      <button className="brand" onClick={()=>navTo('discover')} aria-label="Go to discover"><span className="brand-mark"><House size={22}/></span><span className="brand-name">DEALER<small>PROPERTY, WITH PROOF.</small></span></button>
      <div className="header-search"><Search size={17}/><input aria-label="Search properties" placeholder={t('Search by district, neighborhood or property','Shakisha ahantu cyangwa umutungo')} value={search} onChange={e=>{setSearch(e.target.value);setView('discover')}}/><kbd>⌕</kbd></div>
      <div className="header-actions"><button className="locale-button" onClick={()=>setLanguage(language==='en'?'rw':'en')}><Globe2 size={16}/><span>{language==='en'?'EN':'RW'}</span></button><span className={'api-pill '+(apiOnline?'online':'offline')}><i/>{apiOnline?'API online':'API offline'}</span>{user?<button className="avatar-button" onClick={()=>navTo('account')} title={user.email}>{user.name.slice(0,1).toUpperCase()}</button>:<button className="btn btn-primary btn-sm" onClick={()=>{setAuthMode('login');setAuthOpen(true)}}><LogIn size={15}/>{t('Sign in','Injira')}</button>}<button className="mobile-toggle" onClick={()=>setMobileNav(x=>!x)} aria-label="Toggle navigation"><Menu size={21}/></button></div>
    </header>
    <div className="app-body">
      <aside className={'sidebar '+(mobileNav?'sidebar-open':'')}>
        <div className="sidebar-label">PROPERTY DESK</div>
        {['Marketplace','Workspace','Tools','Administration','Account'].map(group=>{
          const links=navigation.filter(n=>n.group===group);if(!links.length)return null;
          return <div className="nav-group" key={group}><div className="nav-group-title">{group}</div>{links.map(link=>{const Icon=link.icon;return <button key={link.id} className={'nav-link '+(view===link.id?'active':'')} onClick={()=>navTo(link.id)}><Icon size={17}/><span>{link.label}</span>{link.id==='messages'&&conversations.length>0&&<i className="nav-count">{conversations.length}</i>}</button>})}</div>;
        })}
        <div className="sidebar-bottom"><div className="security-callout"><span><ShieldCheck size={16}/></span><b>Trust has a paper trail.</b><p>Keep fee terms, evidence and deal milestones recorded together.</p><button onClick={()=>navTo('trust')}>Check evidence <ArrowUpRight size={14}/></button></div>{user&&<div className="mini-profile"><span className="mini-avatar">{user.name.slice(0,1).toUpperCase()}</span><div><b>{user.name}</b><small>{user.role}</small></div><button onClick={signOut} title="Sign out" aria-label="Sign out"><LogOut size={16}/></button></div>}</div>
      </aside>
      <main className="workspace" onClick={()=>mobileNav&&setMobileNav(false)}>
        <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/>{view==='discover'?'RWANDA PROPERTY EXCHANGE':view.toUpperCase().replaceAll('-',' ')}</div><h1>{title.title}</h1><p>{title.subtitle}</p></div><div className="heading-actions">{view!=='new-listing'&&view!=='trust'&&<button className="btn btn-outline btn-sm" onClick={()=>void withBusy(async()=>{await refreshListings();if(user)await refreshWorkspace(user);flash('Latest server data refreshed.')})}><RefreshCw size={15}/><span>Refresh</span></button>}<button className="btn btn-primary btn-sm" onClick={()=>navTo('new-listing')}><Plus size={16}/>{t('List a property','Shyiraho umutungo')}</button></div></div>
        {view==='discover'&&<section className="view-content">
          <div className="hero-panel"><div className="hero-glow"/><div className="hero-text"><div className="hero-kicker"><Sparkles size={15}/> MORE CLARITY. FEWER SURPRISES.</div><h2>Find a place.<br/><em>Know what comes next.</em></h2><p>Houses, apartments and land, with a trail for questions, viewing requests and deal milestones.</p><div className="hero-stats"><span><b>{items.length}</b><small>Public listings</small></span><span><b>{districts.length||30}</b><small>District options</small></span><span><b>RWF</b><small>Local currency</small></span></div></div><div className="hero-illustration"><div className="illustration-house"><House size={82} strokeWidth={1}/><span/><span/><span/></div><div className="float-chip chip-proof"><ShieldCheck size={16}/>Evidence trail</div><div className="float-chip chip-deal"><CheckCircle2 size={16}/>Deal milestones</div></div></div>
          <div className="quick-actions"><button onClick={()=>navTo('new-listing')}><span className="quick-icon"><FilePlus2 size={19}/></span><span><b>Create a listing</b><small>Submit a house, room or land</small></span><ChevronRight size={17}/></button><button onClick={()=>navTo('saved')}><span className="quick-icon quick-lilac"><Heart size={19}/></span><span><b>Compare your shortlist</b><small>Keep properties in one place</small></span><ChevronRight size={17}/></button><button onClick={()=>navTo('deals')}><span className="quick-icon quick-gold"><WalletCards size={19}/></span><span><b>Track a deal</b><small>Fees, steps and decisions</small></span><ChevronRight size={17}/></button></div>
          <div className="toolbar"><div className="purpose-switch"><button className={purpose==='sale'?'selected':''} onClick={()=>setPurpose('sale')}>Buy</button><button className={purpose==='rent'?'selected':''} onClick={()=>setPurpose('rent')}>Rent</button></div><label className="filter-control"><MapPin size={15}/><select value={district} onChange={e=>setDistrict(e.target.value)}><option>All Rwanda</option>{districts.map(x=><option key={x}>{x}</option>)}</select><ChevronDown size={14}/></label><label className="filter-control"><Building2 size={15}/><select value={propertyType} onChange={e=>setPropertyType(e.target.value)}><option>All properties</option><option value="house">House</option><option value="apartment">Apartment</option><option value="land">Land</option><option value="commercial">Commercial</option><option value="room">Room</option></select><ChevronDown size={14}/></label><label className="filter-control"><SlidersHorizontal size={15}/><select value={sort} onChange={e=>setSort(e.target.value)}><option value="newest">Newest first</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="oldest">Oldest first</option></select></label><button className="btn btn-outline btn-sm" onClick={()=>{setDistrict('All Rwanda');setPropertyType('All properties');setSearch('');setSort('newest')}}><Filter size={14}/>Clear</button></div>
          <div className="section-title-row"><div><h2>Explore properties</h2><p>Only published listings from the API appear here.</p></div><span className="count-pill">{filtered.length} results</span></div>
          {filtered.length?<div className="listing-grid">{filtered.map(item=><ListingCard key={item.publicId} item={item} saved={savedIds.includes(item.publicId)} onSave={()=>saveListing(item)} onOpen={()=>{setModal(item);setViewingForm({message:'I would like to arrange a viewing and discuss this property.',preferredAt:''});setDocs([])}}/>)}</div>:<EmptyState title={apiOnline?'No published properties match yet':'API is not reachable'} body={apiOnline?'There are no published listings for these filters. Create a listing or clear the filters to keep exploring.':'Start Docker Compose, then refresh. Illustrative fake listings are intentionally not presented as genuine homes for sale.'} icon={apiOnline?House:CircleAlert} action={()=>apiOnline?navTo('new-listing'):void withBusy(async()=>refreshListings())} button={apiOnline?'Create a listing':'Retry connection'}/>}
        </section>}

        {view==='dashboard'&&<section className="view-content">
          <div className="welcome-strip"><div><span className="welcome-label">YOUR WORKSPACE</span><h2>Good day, {user?.name.split(' ')[0]||'there'}.</h2><p>Here is what is happening across your property activity.</p></div><div className="welcome-symbol"><LayoutDashboard size={28}/></div></div>
          <div className="metric-grid"><Metric icon={Building2} label="Your listings" value={myItems.length} detail="All review statuses"/><Metric icon={Heart} label="Saved properties" value={savedIds.length} detail="Your shortlist"/><Metric icon={MessageCircle} label="Conversations" value={conversations.length} detail="Private property chats"/><Metric icon={WalletCards} label="Deal workspaces" value={deals.length} detail="Commission terms recorded"/></div>
          <div className="two-column"><div className="panel"><div className="panel-heading"><div><h3>Recent listings</h3><p>Latest submissions from your account</p></div><button className="text-button" onClick={()=>navTo('my-listings')}>View all <ArrowRight size={14}/></button></div>{myItems.length?myItems.slice(0,4).map(item=><div className="compact-row" key={item.publicId}><img src={photoFor(item)} alt="Property preview"/><div className="compact-main"><b>{item.title}</b><small>{item.location.district} · {money(item.price.amount)}</small></div><StatusPill value={item.status||'pending_review'}/></div>):<p className="inline-empty">You haven't submitted a listing yet.</p>}</div><div className="panel"><div className="panel-heading"><div><h3>Recent activity</h3><p>Enquiries and deal changes to follow up</p></div></div>{leads.slice(0,4).map(lead=><div className="activity-row" key={lead.publicId}><span className="activity-icon"><CalendarClock size={16}/></span><span><b>{lead.type==='viewing'?'Viewing request':lead.type==='offer'?'Offer received':'Property question'}</b><small>{lead.listingTitle} · {dateLabel(lead.createdAt)}</small></span><StatusPill value={lead.status}/></div>)}{!leads.length&&!deals.length&&<p className="inline-empty">Activity will appear when you receive enquiries or create a deal workspace.</p>}<button className="btn btn-outline btn-block" onClick={()=>navTo('messages')}>Open conversations <MessageCircle size={15}/></button></div></div>
          <div className="notice-banner"><ShieldCheck size={20}/><div><b>Independent verification still matters.</b><p>Use official land administration channels for parcel identity, ownership and transfer requirements. Platform records do not replace a title, notary or regulator.</p></div><a href="https://support.irembo.gov.rw/en/support/solutions/articles/47001210595-how-to-apply-for-title-transfer-voluntary-sale-" target="_blank" rel="noreferrer">Official guidance <ArrowUpRight size={14}/></a></div>
        </section>}

        {view==='new-listing'&&<section className="view-content form-layout"><form className="panel editor-panel" onSubmit={submitListing}><div className="panel-heading"><div><h3>Property information</h3><p>Complete the facts buyers need to make a useful first decision.</p></div><span className="step-count">01 / 02</span></div><div className="form-grid"><Field label="Listing title"><input required minLength={8} maxLength={120} value={listingForm.title} onChange={e=>setListingForm({...listingForm,title:e.target.value})} placeholder="e.g. Three-bedroom house near transport"/></Field><Field label="Property type"><select value={listingForm.propertyType} onChange={e=>setListingForm({...listingForm,propertyType:e.target.value})}><option value="house">House</option><option value="apartment">Apartment</option><option value="land">Land</option><option value="commercial">Commercial</option><option value="room">Room</option></select></Field><Field label="Purpose"><select value={listingForm.purpose} onChange={e=>setListingForm({...listingForm,purpose:e.target.value})}><option value="sale">For sale</option><option value="rent">For rent</option></select></Field><Field label="Asking price (RWF)"><input required type="number" min="1" step="1" value={listingForm.price} onChange={e=>setListingForm({...listingForm,price:e.target.value})} placeholder="Enter amount in Rwandan francs"/></Field><Field label="District"><select required value={listingForm.district} onChange={e=>setListingForm({...listingForm,district:e.target.value})}>{(districts.length?districts:['Gasabo','Kicukiro','Nyarugenge']).map(d=><option key={d}>{d}</option>)}</select></Field><Field label="Sector / neighborhood"><input value={listingForm.sector} maxLength={80} onChange={e=>setListingForm({...listingForm,sector:e.target.value})} placeholder="Sector or local area"/></Field><Field label="Detailed description" wide><textarea required minLength={30} maxLength={3000} rows={6} value={listingForm.description} onChange={e=>setListingForm({...listingForm,description:e.target.value})} placeholder="Describe condition, rooms, access, utilities, land size (if applicable), any known restrictions and what needs independent confirmation."/><small className="field-help">{listingForm.description.length}/3000 characters. Do not place national ID numbers or sensitive personal information in this public description.</small></Field></div><div className="review-explainer"><LockKeyhole size={19}/><div><b>Private until review</b><p>Your new listing is stored as pending review. It won't show up publicly unless an administrator approves it. Don't describe the platform review as proof of legal ownership.</p></div></div><div className="form-footer"><span>By submitting, you confirm you have permission to advertise the property.</span><button className="btn btn-primary" disabled={busy} type="submit">{busy?'Submitting…':'Submit for review'}<ArrowRight size={16}/></button></div></form><aside className="panel side-checklist"><div className="checklist-icon"><FileCheck2 size={22}/></div><h3>Before you publish</h3><p>High-quality listings are specific, truthful and supported by evidence.</p>{['Provide accurate asking price and location','Describe condition and relevant limitations','Upload evidence from your listing after submission','Verify ownership and parcel details independently','Agree agent fees in writing before moving forward'].map((x,i)=><div className="checklist-item" key={x}><span>{i+1}</span>{x}</div>)}<div className="tip-box"><Sparkles size={16}/><span>Strong descriptions answer the practical questions buyers normally ask first.</span></div></aside></section>}

        {(view==='my-listings'||view==='saved')&&<section className="view-content"><div className="toolbar toolbar-light"><label className="wide-search"><Search size={16}/><input placeholder="Filter your properties" value={search} onChange={e=>setSearch(e.target.value)}/></label><label className="filter-control"><SlidersHorizontal size={15}/><select value={sort} onChange={e=>setSort(e.target.value)}><option value="newest">Newest first</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option></select></label><span className="count-pill">{filtered.length} properties</span></div>{filtered.length?<div className="listing-grid">{filtered.map(item=><ListingCard key={item.publicId} item={item} saved={savedIds.includes(item.publicId)} onSave={()=>saveListing(item)} onOpen={()=>setModal(item)}/>)}</div>:<EmptyState icon={view==='saved'?Heart:Building2} title={view==='saved'?'No saved properties yet':'No listings to show'} body={view==='saved'?'Save properties from Discover to keep a shortlist synced to your account.':'Submit a property to see its review status and evidence trail here.'} action={()=>navTo(view==='saved'?'discover':'new-listing')} button={view==='saved'?'Explore properties':'Create a listing'}/>}</section>}

        {view==='messages'&&<section className="view-content"><div className="messages-layout"><div className="conversation-list panel"><div className="panel-heading"><div><h3>Conversations</h3><p>{conversations.length} property threads</p></div><button className="icon-button" onClick={()=>void withBusy(async()=>{await refreshWorkspace(user!)})} aria-label="Refresh conversations"><RefreshCw size={16}/></button></div>{conversations.map(c=><button className={'conversation-item '+(selectedConversation===c.publicId?'selected':'')} key={c.publicId} onClick={()=>setSelectedConversation(c.publicId)}><span className="conversation-avatar"><House size={18}/></span><span className="conversation-text"><b>{c.listingTitle}</b><small>{c.lastMessage||'No messages yet'} </small><em>{dateLabel(c.updatedAt)}</em></span><ChevronRight size={15}/></button>)}{!conversations.length&&<p className="inline-empty">Open a published property and choose “Message owner” to start a private conversation.</p>}</div><div className="message-pane panel">{selectedConversation&&conversations.find(c=>c.publicId===selectedConversation)?<><div className="message-header"><span className="conversation-avatar"><House size={17}/></span><div><b>{conversations.find(c=>c.publicId===selectedConversation)?.listingTitle}</b><small><LockKeyhole size={12}/> Private, authenticated thread</small></div><button className="icon-button" onClick={()=>void refreshMessages(selectedConversation)} aria-label="Reload messages"><RefreshCw size={15}/></button></div><div className="message-history">{messages.map(m=><div className={'message-bubble '+(m.senderId===user?.publicId?'own':'other')} key={m.publicId}><p>{m.text}</p><small>{m.senderId===user?.publicId?'You':'Property participant'} · {new Date(m.createdAt).toLocaleString()}</small></div>)}{!messages.length&&<div className="message-empty"><MessageCircle size={25}/><b>Start with a clear question.</b><p>Ask about viewing times, property details or the disclosed fee arrangement.</p></div>}</div><form className="message-composer" onSubmit={sendMessage}><textarea rows={2} value={messageDraft} onChange={e=>setMessageDraft(e.target.value)} placeholder="Write a message…" maxLength={3000}/><button type="submit" disabled={!messageDraft.trim()||busy} className="btn btn-primary" aria-label="Send message"><Send size={17}/></button></form></>:<EmptyState icon={MessageCircle} title="Your conversations" body="Choose a conversation on the left, or start one from a property listing."/>}</div></div></section>}

        {view==='deals'&&<section className="view-content"><div className="deal-intro"><span><WalletCards size={21}/></span><div><b>Deal workspaces keep the story together.</b><p>Create a record, write the fee terms plainly, get each party's acknowledgement and update milestones as the deal progresses. Don't hold client funds in this app.</p></div></div>{deals.length?<div className="deal-list">{deals.map(deal=><article className="panel deal-card" key={deal.publicId}><div className="deal-top"><div><span className="deal-label">DEAL WORKSPACE / {deal.publicId.slice(0,8).toUpperCase()}</span><h3>{deal.listingTitle}</h3><p>Opened {dateLabel(deal.updatedAt)}</p></div><StatusPill value={deal.stage}/></div><div className="deal-facts"><div><small>Agreed commission proposal</small><b>{deal.commissionPercent}%</b></div><div><small>Fee acknowledgements</small><b>{deal.feeAcceptedBy?.length||0} / {deal.participants?.length||2} parties</b></div><div><small>Milestones logged</small><b>{deal.history?.length||0}</b></div></div><div className="deal-progress">{stages.slice(0,6).map((stage,i)=><div className={'deal-step '+(stages.indexOf(deal.stage)>=i?'done':'')} key={stage}><i>{stages.indexOf(deal.stage)>i?<Check size={12}/>:i+1}</i><span>{prettyStage(stage)}</span></div>)}</div><div className="commission-terms"><b>Commission terms</b><p>{deal.commissionTerms}</p><div className="accept-row"><span>{deal.feeAcceptedBy?.includes(user?.publicId||'')?'You acknowledged these terms':'Your acknowledgement is not yet recorded.'}</span><button className="btn btn-outline btn-sm" disabled={deal.feeAcceptedBy?.includes(user?.publicId||'')||busy} onClick={()=>acceptFee(deal)}>{deal.feeAcceptedBy?.includes(user?.publicId||'')?'Accepted':'Acknowledge terms'}<CheckCircle2 size={14}/></button></div></div><div className="stage-control"><label>Update milestone<select value={deal.stage} onChange={e=>updateStage(deal,e.target.value)} disabled={['completed','cancelled'].includes(deal.stage)}>{stages.map(s=><option key={s} value={s}>{prettyStage(s)}</option>)}</select></label><span>Changes are timestamped in the API history.</span></div>{deal.history?.length>0&&<details className="history-details"><summary>View activity history</summary>{deal.history.map((h,i)=><div key={i} className="history-item"><i/><span><b>{prettyStage(h.stage)}</b><small>{dateLabel(h.at)} · {h.note||'Milestone updated'}</small></span></div>)}</details>}</article>)}</div>:<EmptyState icon={WalletCards} title="No deals yet" body="Open a published property, choose “Propose deal”, and record the commission terms discussed by the parties." action={()=>navTo('discover')} button="Find a property"/>}<div className="compliance-note"><LockKeyhole size={17}/><span>Fee acceptance is an application record. It does not replace legal advice, a signed contract, regulated payment handling or official land-transfer steps.</span></div></section>}

        {view==='trust'&&<section className="view-content trust-view"><div className="trust-hero-card"><div className="trust-big-icon"><ShieldCheck size={30}/></div><div><h2>Traceable evidence, honest limits.</h2><p>Files are kept in private storage and access is checked by the API. A SHA-256 digest can show whether the same byte sequence was recorded. It does not say who owns a property or whether a document is genuine.</p></div></div><form className="panel hash-form" onSubmit={doTrustCheck}><div className="panel-heading"><div><h3>Check a recorded hash</h3><p>Paste the exact SHA-256 digest returned by an upload or listing submission.</p></div><LockKeyhole size={19}/></div><label className="field-label">SHA-256 digest<input required minLength={32} maxLength={128} value={hashInput} onChange={e=>setHashInput(e.target.value.trim())} placeholder="Paste the hash string here"/></label><button className="btn btn-primary" disabled={busy||!hashInput.trim()} type="submit"><Search size={16}/>Check digest</button>{hashResult&&<div className={'hash-result '+(hashResult.exists?'hash-found':'hash-missing')}><span>{hashResult.exists?<CheckCircle2 size={20}/>:<CircleAlert size={20}/>}</span><div><b>{hashResult.exists?'Digest found in audit records':'No matching audit record found'}</b><p>{hashResult.meaning}</p></div></div>}</form><div className="two-column"><div className="panel"><div className="panel-heading"><div><h3>Document access</h3><p>Evidence downloads are served through authenticated endpoints.</p></div><FileCheck2 size={20}/></div><p className="muted-copy">Only a listing owner, uploader or participant in a deal for that property can request the evidence file. Uploads are limited to PDF, JPEG, PNG and WebP, up to 8 MiB each.</p></div><div className="panel"><div className="panel-heading"><div><h3>Official land verification</h3><p>Platform records do not replace government records.</p></div></div><p className="muted-copy">Confirm the parcel UPI, title holder and any restrictions through the National Land Authority and the official transfer process.</p><a className="btn btn-outline" href="https://support.irembo.gov.rw/en/support/solutions/articles/47001210595-how-to-apply-for-title-transfer-voluntary-sale-" target="_blank" rel="noreferrer">Open IremboGov guidance <ArrowUpRight size={14}/></a></div></div></section>}

        {view==='account'&&<section className="view-content account-view"><div className="panel account-card"><div className="account-banner"><span className="account-avatar">{user?.name.slice(0,1).toUpperCase()}</span><div><h2>{user?.name}</h2><p>{user?.email}</p></div><StatusPill value={user?.role||'member'}/></div><div className="account-fields"><div><small>Account name</small><b>{user?.name}</b></div><div><small>Verified sign-in email</small><b>{user?.email}</b></div><div><small>Phone contact</small><b>{user?.phone||'Not supplied'}</b></div><div><small>Access role</small><b>{user?.role||'member'}</b></div><div><small>Session</small><b>Bearer token · 8-hour expiry</b></div><div><small>API connection</small><b className={apiOnline?'text-success':'text-warning'}>{apiOnline?'Connected':'Offline'}</b></div></div><div className="account-actions"><button className="btn btn-outline" onClick={()=>void withBusy(async()=>{const refreshed=await api.me();setUser(refreshed);flash('Account refreshed from the API.')})}><RefreshCw size={15}/>Refresh account</button><button className="btn btn-danger" onClick={signOut}><LogOut size={15}/>Sign out</button></div></div><div className="panel account-help"><LockKeyhole size={21}/><h3>Account security</h3><p>Use a unique password, sign out on shared computers and avoid sharing sensitive ID information in public listing descriptions or ordinary chat messages.</p></div></section>}

        {view==='admin'&&<section className="view-content">{user?.role!=='admin'?<EmptyState icon={LockKeyhole} title="Administrator access required" body="This queue is only available to an authenticated admin account."/>:pending.length?<div className="admin-list">{pending.map(item=><article className="panel review-card" key={item.publicId}><img src={photoFor(item)} alt="Property preview"/><div className="review-body"><div className="listing-type">{item.propertyType} · {item.purpose}</div><h3>{item.title}</h3><p>{item.location.district}{item.location.sector?', '+item.location.sector:''} · {money(item.price.amount)}</p><p className="review-description">{item.description}</p><label className="field-label">Decision note<textarea rows={2} value={reviewNotes[item.publicId]||''} onChange={e=>setReviewNotes({...reviewNotes,[item.publicId]:e.target.value})} placeholder="Record what was checked, what is missing or what needs correction."/></label><div className="review-actions"><button className="btn btn-outline" onClick={()=>{setDocs([]);setModal(item)}}><FileCheck2 size={15}/>Review evidence</button><button className="btn btn-primary" onClick={()=>runReview(item,'approve')} disabled={busy}><CheckCircle2 size={15}/>Approve</button><button className="btn btn-outline" onClick={()=>runReview(item,'request_changes')} disabled={busy}>Request changes</button><button className="btn btn-danger" onClick={()=>runReview(item,'reject')} disabled={busy}>Reject</button></div></div></article>)}</div>:<EmptyState icon={ClipboardList} title="Review queue is clear" body="New submissions appear here when users send properties for review." action={()=>void withBusy(async()=>{const r=await api.adminPending();setPending(r.data)})} button="Refresh queue"/>}</section>}
      </main>
    </div>

    <nav className="mobile-bottom-nav" aria-label="Quick navigation"><button className={view==='discover'?'active':''} onClick={()=>navTo('discover')}><Search size={18}/><span>Discover</span></button><button className={view==='saved'?'active':''} onClick={()=>navTo('saved')}><Heart size={18}/><span>Saved</span></button><button className={view==='messages'?'active':''} onClick={()=>navTo('messages')}><MessageCircle size={18}/><span>Messages</span></button><button className={view==='dashboard'?'active':''} onClick={()=>navTo('dashboard')}><LayoutDashboard size={18}/><span>Desk</span></button></nav>

    {modal&&<div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setModal(null)}}><section className="property-modal" role="dialog" aria-modal="true" aria-label="Property details"><button className="modal-x" onClick={()=>setModal(null)} aria-label="Close"><X size={20}/></button><div className="modal-photo" style={{backgroundImage:'url('+photoFor(modal)+')'}}><span className="listing-badge">{modal.purpose==='sale'?'FOR SALE':'FOR RENT'}</span></div><div className="modal-body"><div className="listing-type">{modal.propertyType} · {modal.location.district}</div><h2>{modal.title}</h2><div className="modal-price">{money(modal.price.amount)}{modal.purpose==='rent'&&<small> / month</small>}</div><p className="modal-description">{modal.description}</p>{user&&modal.ownerId===user.publicId&&modal.reviewNote&&<div className="review-explainer"><FileCheck2 size={17}/><div><b>Review team note</b><p>{modal.reviewNote}</p></div></div>}<div className="modal-location"><MapPin size={15}/>{modal.location.sector?modal.location.sector+', ':''}{modal.location.district}, Rwanda</div><div className="modal-trust"><ShieldCheck size={18}/><div><b>{modal.verification?.status==='reviewed'?'Review recorded':'Review not confirmed'}</b><small>Request evidence and independently confirm title, parcel details and ownership. This listing is not a legal guarantee.</small></div></div><div className="modal-actions">{(!user||user.publicId!==modal.ownerId)&&<button className="btn btn-primary" onClick={()=>startConversation(modal)}><MessageCircle size={16}/>Message owner</button>}<button className="btn btn-outline" onClick={()=>saveListing(modal)}><Heart size={16}/>{savedIds.includes(modal.publicId)?'Saved':'Save'}</button>{user&&user.publicId===modal.ownerId&&<span className="owner-label"><CheckCircle2 size={14}/>Your listing</span>}</div>{(!user||user.publicId!==modal.ownerId)?<div className="modal-section"><h3>Request a viewing</h3><form onSubmit={openViewing}><label className="field-label">Preferred date and time<input type="datetime-local" value={viewingForm.preferredAt} onChange={e=>setViewingForm({...viewingForm,preferredAt:e.target.value})}/></label><label className="field-label">Message<textarea rows={3} required minLength={5} maxLength={1000} value={viewingForm.message} onChange={e=>setViewingForm({...viewingForm,message:e.target.value})}/></label><button className="btn btn-outline btn-block" type="submit" disabled={busy}><CalendarClock size={16}/>Request a viewing</button></form></div>:<div className="modal-section owner-listing-note"><h3>Your listing workspace</h3><p className="muted-copy">Use the private evidence section below to add documents. Review status and moderator feedback appear here when available.</p><StatusPill value={modal.status||'unknown'}/></div>}{user&&user.publicId!==modal.ownerId&&<div className="modal-section"><h3>Commission agreement proposal</h3><p className="muted-copy">Creates a deal workspace; the other party must separately acknowledge terms.</p><label className="field-label">Commission percentage<input type="number" min="0" max="15" step=".25" value={dealForm.commissionPercent} onChange={e=>setDealForm({...dealForm,commissionPercent:e.target.value})}/></label><label className="field-label">Terms<textarea rows={3} value={dealForm.commissionTerms} onChange={e=>setDealForm({...dealForm,commissionTerms:e.target.value})}/></label><button className="btn btn-outline btn-block" onClick={()=>startDeal(modal)} disabled={busy}>Propose deal <ArrowRight size={15}/></button></div>}{user&&modal.ownerId===user.publicId&&<div className="modal-section"><h3>Private property evidence</h3><p className="muted-copy">PDF, JPEG, PNG or WebP, up to 8 MiB. Files are stored privately and require authorization to download.</p><label className="btn btn-outline upload-label"><Upload size={15}/>Upload evidence<input type="file" accept=".pdf,image/jpeg,image/png,image/webp" onChange={e=>handleUpload(modal,e.target.files?.[0])}/></label><button className="text-button" onClick={()=>loadDocs(modal)}>View stored documents <ArrowRight size={14}/></button>{docs.filter(doc=>doc.listingId===modal.publicId).map(doc=><div className="document-row" key={doc.publicId}><FileText size={16}/><span><b>{doc.fileName}</b><small>{Math.ceil(doc.sizeBytes/1024)} KB · {doc.reviewStatus}</small></span><button className="icon-button" onClick={()=>void api.downloadDocument(doc.publicId,doc.fileName).catch(e=>flash((e as Error).message))} aria-label="Download evidence"><Download size={15}/></button></div>)}</div>}{user?.role==='admin'&&<div className="modal-section"><h3>Submitted evidence</h3><p className="muted-copy">Open the metadata for evidence uploaded by the property owner. This does not verify the legal validity of any document.</p><button className="btn btn-outline btn-block" onClick={()=>loadDocs(modal)} disabled={busy}><RefreshCw size={15}/>Load evidence documents</button>{docs.filter(doc=>doc.listingId===modal.publicId).map(doc=><div className="document-row" key={doc.publicId}><FileText size={16}/><span><b>{doc.fileName}</b><small>{Math.ceil(doc.sizeBytes/1024)} KB · {doc.reviewStatus}</small></span><button className="icon-button" onClick={()=>void api.downloadDocument(doc.publicId,doc.fileName).catch(e=>flash((e as Error).message))} aria-label="Download review evidence"><Download size={15}/></button></div>)}</div>}{user?.role==='admin'&&<div className="modal-section"><h3>Review control</h3><textarea className="standalone-textarea" rows={2} value={reviewNotes[modal.publicId]||''} onChange={e=>setReviewNotes({...reviewNotes,[modal.publicId]:e.target.value})} placeholder="Review note"/><div className="review-actions"><button className="btn btn-primary" onClick={()=>runReview(modal,'approve')}>Approve</button><button className="btn btn-outline" onClick={()=>runReview(modal,'request_changes')}>Request changes</button><button className="btn btn-danger" onClick={()=>runReview(modal,'reject')}>Reject</button></div></div>}</div></section></div>}

    {authOpen&&<div className="overlay auth-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setAuthOpen(false)}}><section className="auth-card" role="dialog" aria-modal="true" aria-label="Account access"><button className="modal-x" onClick={()=>setAuthOpen(false)} aria-label="Close"><X size={20}/></button><div className="auth-brand"><span className="brand-mark"><House size={20}/></span><div><b>DEALER</b><small>PROPERTY, WITH PROOF.</small></div></div><div className="eyebrow">YOUR PROPERTY DESK</div><h2>{authMode==='login'?'Welcome back.':'Create your account.'}</h2><p>{authMode==='login'?'Sign in to manage saved homes, private conversations and deal milestones.':'Create an account to list property and keep your activity connected.'}</p><form onSubmit={handleAuth} className="auth-form">{authMode==='register'&&<Field label="Full name"><input required minLength={2} maxLength={100} value={authForm.name} onChange={e=>setAuthForm({...authForm,name:e.target.value})} placeholder="Your name"/></Field>}<Field label="Email address"><input type="email" required autoComplete="email" value={authForm.email} onChange={e=>setAuthForm({...authForm,email:e.target.value})} placeholder="you@example.com"/></Field>{authMode==='register'&&<Field label="Phone (optional)"><input value={authForm.phone} onChange={e=>setAuthForm({...authForm,phone:e.target.value})} placeholder="+250…"/></Field>}<Field label="Password"><input type="password" required minLength={authMode==='register'?10:1} autoComplete={authMode==='login'?'current-password':'new-password'} value={authForm.password} onChange={e=>setAuthForm({...authForm,password:e.target.value})} placeholder={authMode==='register'?'At least 10 characters':'Your password'}/></Field><button className="btn btn-primary btn-block" type="submit" disabled={busy}>{busy?'Please wait…':authMode==='login'?'Sign in':'Create account'}<ArrowRight size={16}/></button></form><p className="auth-switch">{authMode==='login'?'New to Dealer?':'Already registered?'} <button onClick={()=>setAuthMode(authMode==='login'?'register':'login')}>{authMode==='login'?'Create an account':'Sign in instead'}</button></p><div className="auth-safety"><LockKeyhole size={14}/>Password is hashed on the API. Sessions expire after eight hours.</div></section></div>}
    <ErrorNote text={notice} onClose={()=>setNotice('')}/>
  </div>;
}

function Field({label,children,wide=false}:{label:string;children:ReactNode;wide?:boolean}) {
  return <label className={'field '+(wide?'field-wide':'')}><span>{label}</span>{children}</label>;
}
function Metric({icon:Icon,label,value,detail}:{icon:any;label:string;value:number|string;detail:string}) {
  return <div className="metric-card"><span className="metric-icon"><Icon size={18}/></span><div><small>{label}</small><strong>{value}</strong><span>{detail}</span></div><ArrowUpRight className="metric-arrow" size={15}/></div>;
}
function StatusPill({value}:{value:string}) {
  const type=['published','completed','active','approve','reviewed'].includes(value)?'good':['pending_review','proposed','open','viewing','offer','due_diligence','agreement','changes_requested'].includes(value)?'waiting':['rejected','cancelled'].includes(value)?'bad':'neutral';
  return <span className={'status-pill '+type}><i/>{prettyStage(value)}</span>;
}
