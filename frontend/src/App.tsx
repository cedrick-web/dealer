import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig } from 'motion/react';
import { PageTransition } from '@/components/app/page-transition';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ListingCard, PrivateListingImage, PropertyImage } from '@/components/app/property-cards';
import { dateLabel, money, prettyStage } from '@/lib/property-format';
import { EmptyState, ErrorNote, Field, Metric, StatusPill } from '@/components/app/common';
import { EnquiriesView } from '@/components/app/enquiries-view';
import { DashboardView } from '@/components/app/dashboard-view';
import { DealWorkspaceView } from '@/components/app/deal-workspace';
import { MessagingView } from '@/components/app/messaging-view';
import { ListingReviewQueue } from '@/components/app/listing-review-queue';
import { AdminAuditView } from '@/components/app/admin-audit-view';
import { ListingLifecycleNotice } from '@/components/app/listing-lifecycle-notice';
import { ListingEditorView, type ListingEditorForm, type NewListingPhotoDraft, type ListingPhotoPreview } from '@/components/app/listing-editor-view';
import { NotificationsView } from '@/components/app/notifications-view';
import { AgentDirectoryView, AgentApplicationView, AgentReviewQueue, type AgentApplicationForm } from '@/components/app/agent-workspace';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, BadgeCheck, Bell, Building2, CalendarClock, Check,
  CheckCircle2, ChevronDown, ChevronRight, CircleAlert, ClipboardList, Copy, Download, FileCheck2,
  FilePlus2, FileText, Filter, Globe2, Heart, House, LayoutDashboard, LockKeyhole, LogIn,
  LogOut, MapPin, Menu, MessageCircle, MoreHorizontal, Plus, RefreshCw, Search, Send, Settings,
  ShieldCheck, SlidersHorizontal, Sparkles, Upload, UserCircle, Users, WalletCards, X
} from 'lucide-react';
import { api, type Agent, type AgentApplication, type AppNotification, type Conversation, type Deal, type EvidenceDocument, type Lead, type Listing, type ListingImage, type Message, type User, setSessionToken } from './api';

type View = 'discover'|'agents'|'agent-application'|'agent-review'|'notifications'|'dashboard'|'enquiries'|'new-listing'|'my-listings'|'saved'|'messages'|'deals'|'trust'|'account'|'admin';
type AuthMode = 'login'|'register';

const routeForView = (view: View) => view === 'discover' ? '/' : `/${view}`;
const propertyIdFromPath = (pathname: string): string | null => {
  const segments = pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (segments[0] !== 'property' || !segments[1]) return null;
  try { return decodeURIComponent(segments[1]); } catch { return null; }
};
const evidenceStatusLabel = (status: string) => ({not_reviewed:'Awaiting review',verified:'Verified by reviewer',rejected:'Rejected',changes_requested:'Changes requested'}[status] ?? status.replaceAll('_',' '));
const viewFromPath = (pathname: string): View => {
  const segment = pathname.replace(/\/+$/, '').split('/').filter(Boolean)[0] || 'discover';
  const known: View[] = ['discover','agents','agent-application','agent-review','notifications','dashboard','enquiries','new-listing','my-listings','saved','messages','deals','trust','account','admin'];
  return known.includes(segment as View) ? segment as View : 'discover';
};

export default function App() {
  const [view,setView] = useState<View>(() => viewFromPath(window.location.pathname));
  const [returnView,setReturnView] = useState<View>('dashboard');
  const [items,setItems] = useState<Listing[]>([]);
  const [listingPage,setListingPage] = useState(1);
  const [listingTotal,setListingTotal] = useState(0);
  const [listingHasMore,setListingHasMore] = useState(false);
  const [loadingMore,setLoadingMore] = useState(false);
  const [myItems,setMyItems] = useState<Listing[]>([]);
  const [savedIds,setSavedIds] = useState<string[]>([]);
  const [savedItems,setSavedItems] = useState<Listing[]>([]);
  const [compareIds,setCompareIds] = useState<string[]>([]);
  const [leads,setLeads] = useState<Lead[]>([]);
  const [notifications,setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount,setUnreadCount] = useState(0);
  const [conversations,setConversations] = useState<Conversation[]>([]);
  const [messages,setMessages] = useState<Message[]>([]);
  const [deals,setDeals] = useState<Deal[]>([]);
  const [pending,setPending] = useState<Listing[]>([]);
  const [pendingAgents,setPendingAgents] = useState<AgentApplication[]>([]);
  const [agentDirectory,setAgentDirectory] = useState<Agent[]>([]);
  const [agentDirectoryLoading,setAgentDirectoryLoading] = useState(true);
  const [agentApplication,setAgentApplication] = useState<AgentApplication|null>(null);
  const [agentForm,setAgentForm] = useState<AgentApplicationForm>({phone:'',bio:'',experienceYears:'0',districts:['Gasabo'],showPhone:false});
  const [docs,setDocs] = useState<EvidenceDocument[]>([]);
  const [selectedConversation,setSelectedConversation] = useState('');
  const [user,setUser] = useState<User|null>(null);
  const [authMode,setAuthMode] = useState<AuthMode>('login');
  const [authOpen,setAuthOpen] = useState(false);
  const [mobileNav,setMobileNav] = useState(false);
  const [apiOnline,setApiOnline] = useState(false);
  const [busy,setBusy] = useState(false);
  const [activityTableView,setActivityTableView] = useState(true);
  const [notice,setNotice] = useState('');
  const [districts,setDistricts] = useState<string[]>([]);
  const [search,setSearch] = useState('');
  const [district,setDistrict] = useState('All Rwanda');
  const [maxPrice,setMaxPrice] = useState('');
  const [purpose,setPurpose] = useState<'sale'|'rent'>('sale');
  const [propertyType,setPropertyType] = useState('All properties');
  const [sort,setSort] = useState('newest');
  const [modal,setModal] = useState<Listing|null>(null);
  const [locationReady,setLocationReady] = useState(false);
  const [language,setLanguage] = useState<'en'|'rw'>('en');
  const [authForm,setAuthForm] = useState({name:'',email:'',phone:'',password:''});
  const [profileForm,setProfileForm] = useState({name:'',phone:''});
  const [passwordForm,setPasswordForm] = useState({currentPassword:'',newPassword:'',confirmPassword:''});
  const [listingForm,setListingForm] = useState<ListingEditorForm>({title:'',description:'',propertyType:'house',purpose:'sale',district:'Gasabo',sector:'',price:''});
  const [editingListingId,setEditingListingId] = useState<string|null>(null);
  const [existingImages,setExistingImages] = useState<ListingImage[]>([]);
  const [newListingPhotos,setNewListingPhotos] = useState<NewListingPhotoDraft[]>([]);
  const [photoPreviews,setPhotoPreviews] = useState<ListingPhotoPreview[]>([]);
  const [viewingForm,setViewingForm] = useState({message:'I would like to arrange a viewing and discuss this property.',preferredAt:''});
  const [messageDraft,setMessageDraft] = useState('');
  const [dealForm,setDealForm] = useState({commissionPercent:'3',commissionTerms:'Commission is payable only after both parties sign the written agreement and the transaction legally closes.'});
  const [hashInput,setHashInput] = useState('');
  const [hashResult,setHashResult] = useState<{exists:boolean;meaning:string}|null>(null);
  const [reviewNotes,setReviewNotes] = useState<Record<string,string>>({});
  const [documentReviewNotes,setDocumentReviewNotes] = useState<Record<string,string>>({});

  useEffect(() => {
    let active = true;
    const syncLocation = () => {
      const pathname = window.location.pathname;
      const propertyId = propertyIdFromPath(pathname);
      setView(viewFromPath(pathname));
      if (!propertyId) {
        setModal(null);
        setLocationReady(true);
        return;
      }
      setLocationReady(false);
      void api.listing(propertyId).then(result => {
        if (!active) return;
        setModal(result.data);
        setDocs([]);
      }).catch(() => {
        if (active) setModal(null);
      }).finally(() => {
        if (active) setLocationReady(true);
      });
    };
    syncLocation();
    window.addEventListener('popstate', syncLocation);
    return () => {
      active = false;
      window.removeEventListener('popstate', syncLocation);
    };
  }, []);
  useEffect(() => {
    if (!locationReady) return;
    const nextPath = modal?.status === 'published' ? `/property/${encodeURIComponent(modal.publicId)}` : routeForView(view);
    if (window.location.pathname !== nextPath) window.history.pushState({ view, propertyId: modal?.publicId }, '', nextPath);
  }, [view, modal?.publicId, modal?.status, locationReady]);

  const t = (en:string,rw:string) => language==='en'?en:rw;
  const flash = (text:string) => { setNotice(text); window.setTimeout(()=>setNotice(current=>current===text?'':current),6500); };
  const shareListing = async (item: Listing) => {
    if (item.status !== 'published') {
      flash('This listing is not public yet. Administrator approval is required before it can be shared.');
      return;
    }
    const url = `${window.location.origin}/property/${encodeURIComponent(item.publicId)}`;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url);
      flash('Property link copied. Anyone opening it will load the listing from the API.');
    } catch {
      flash(`Copy this property link from your address bar: ${url}`);
    }
  };
  const listingParams = useCallback((page = 1) => {
    const params:Record<string,string> = {limit:'60',purpose,sort};
    if(page>1)params.page=String(page);
    if(district!=='All Rwanda')params.district=district;
    if(propertyType!=='All properties')params.type=propertyType;
    if(maxPrice.trim()&&Number(maxPrice)>0)params.maxPrice=String(Math.floor(Number(maxPrice)));
    if(search.trim())params.q=search.trim();
    return params;
  },[purpose,district,propertyType,maxPrice,search,sort]);
  const listingRequestSequence = useRef(0);
  const refreshListings = useCallback(async () => {
    const sequence = ++listingRequestSequence.current;
    try {
      const result = await api.listings(listingParams(1));
      if(sequence===listingRequestSequence.current){
        setItems(result.data || []);
        setListingPage(result.page || 1);
        setListingTotal(result.total || 0);
        setListingHasMore(Boolean(result.hasMore));
        setApiOnline(true);
      }
    } catch (e) {
      if(sequence===listingRequestSequence.current)setApiOnline(false);
      throw e;
    }
  },[listingParams]);
  const loadMoreListings = useCallback(async () => {
    if(!listingHasMore||loadingMore)return;
    const sequence=listingRequestSequence.current;
    const nextPage=listingPage+1;
    setLoadingMore(true);
    try {
      const result=await api.listings(listingParams(nextPage));
      if(sequence!==listingRequestSequence.current)return;
      setItems(previous=>{
        const seen=new Set(previous.map(item=>item.publicId));
        return [...previous,...(result.data||[]).filter(item=>!seen.has(item.publicId))];
      });
      setListingPage(result.page||nextPage);
      setListingTotal(result.total||0);
      setListingHasMore(Boolean(result.hasMore));
    } catch(error) {
      flash('Could not load the next page of listings: '+(error as Error).message);
    } finally {
      setLoadingMore(false);
    }
  },[listingHasMore,loadingMore,listingPage,listingParams]);
  const refreshWorkspace = useCallback(async (activeUser:User) => {
    setProfileForm({name:activeUser.name||'',phone:activeUser.phone||''});
    const safe = async <T,>(fn:()=>Promise<T>, fallback:T) => { try { return await fn(); } catch { return fallback; } };
    const [owned,favorites,leadData,rooms,dealData,agentData,notificationData] = await Promise.all([
      safe(()=>api.myListings(),{data:[] as Listing[]}),
      safe(()=>api.favorites(),{data:[] as {listingId:string;createdAt:string}[]}),
      safe(()=>api.myLeads(),{data:[] as Lead[]}),
      safe(()=>api.conversations(),{data:[] as Conversation[]}),
      safe(()=>api.deals(),{data:[] as Deal[]}),
      safe(()=>api.myAgentProfile(),{data:null as AgentApplication|null}),
      safe(()=>api.notifications(),{data:[] as AppNotification[],unreadCount:0}),
    ]);
    setMyItems(owned.data || []);
    setSavedIds((favorites.data || []).map(x=>x.listingId));
    setLeads(leadData.data || []);
    setConversations(rooms.data || []);
    setDeals(dealData.data || []);
    setAgentApplication(agentData.data);
    setNotifications(notificationData.data || []);
    setUnreadCount(notificationData.unreadCount || 0);
    if(agentData.data) setAgentForm({phone:agentData.data.phone||'',bio:agentData.data.bio||'',experienceYears:String(agentData.data.experienceYears??0),districts:agentData.data.districts||['Gasabo'],showPhone:agentData.data.showPhone===true});
    const detailResults = await Promise.all((favorites.data || []).map(x=>safe(()=>api.listing(x.listingId),null as any)));
    setSavedItems(detailResults.filter(Boolean).map((x:any)=>x.data).filter(Boolean));
    if(activeUser.role==='admin') {
      const [adminData,agentQueue]=await Promise.all([
        safe(()=>api.adminPending(),{data:[] as Listing[]}),
        safe(()=>api.adminPendingAgents(),{data:[] as AgentApplication[]}),
      ]);
      setPending(adminData.data || []);
      setPendingAgents(agentQueue.data || []);
    } else { setPending([]); setPendingAgents([]); }
  },[]);
  const refreshMessages = useCallback(async (id:string) => {
    if(!id) { setMessages([]); return; }
    try { const r=await api.messages(id); setMessages(r.data || []); } catch(e) { flash((e as Error).message); }
  },[]);

  useEffect(() => {
    let alive=true;
    api.health().then(()=>{if(alive)setApiOnline(true)}).catch(()=>{if(alive)setApiOnline(false)});
    api.districts().then(r=>{if(alive)setDistricts(r.data || [])}).catch(()=>{});
    setAgentDirectoryLoading(true);
    api.agents().then(r=>{if(alive)setAgentDirectory(r.data || [])}).catch(()=>{if(alive)setAgentDirectory([])}).finally(()=>{if(alive)setAgentDirectoryLoading(false)});
    if(localStorage.getItem('dealer.session.v1')) {
      api.me().then(async active=>{if(!alive)return;setUser(active); await refreshWorkspace(active)}).catch(()=>{if(alive){setSessionToken('');setUser(null)}});
    }
    return ()=>{alive=false};
  },[refreshWorkspace]);
  useEffect(()=>{const timer=window.setTimeout(()=>{refreshListings().catch(()=>{})},250);return()=>window.clearTimeout(timer)},[refreshListings]);
  const refreshNotifications = useCallback(async() => {
    try {
      const result=await api.notifications();
      setNotifications(result.data||[]);
      setUnreadCount(result.unreadCount||0);
    } catch {
      // The main workspace still works if the notification service is briefly unavailable.
    }
  },[]);
  useEffect(()=>{if(view==='messages'&&selectedConversation)refreshMessages(selectedConversation)},[view,selectedConversation,refreshMessages]);
  useEffect(()=>{
    if(view!=='messages'||!user)return;
    const timer=window.setInterval(()=>{
      void api.conversations().then(result=>setConversations(result.data||[])).catch(()=>{});
      if(selectedConversation)void refreshMessages(selectedConversation);
    },12000);
    return ()=>window.clearInterval(timer);
  },[view,user?.publicId,selectedConversation,refreshMessages]);
  useEffect(()=>{
    const previews=newListingPhotos.map(photo=>({clientId:photo.clientId,url:URL.createObjectURL(photo.file)}));
    setPhotoPreviews(previews);
    return ()=>previews.forEach(photo=>URL.revokeObjectURL(photo.url));
  },[newListingPhotos]);
  useEffect(()=>{if(!user)return;const timer=window.setInterval(()=>{void refreshNotifications()},45000);return()=>window.clearInterval(timer)},[user?.publicId,refreshNotifications]);

  const filtered = useMemo(()=>{
    let data = view==='saved' ? savedItems : view==='my-listings' ? myItems : items;
    if(view==='discover') data = data.filter(x=>x.purpose===purpose);
    if(propertyType!=='All properties'&&view==='discover') data=data.filter(x=>x.propertyType===propertyType);
    if(district!=='All Rwanda'&&view==='discover') data=data.filter(x=>x.location.district===district);
    if(maxPrice.trim()&&Number(maxPrice)>0&&view==='discover')data=data.filter(x=>x.price.amount<=Number(maxPrice));
    const q=search.trim().toLowerCase();
    if(q) data=data.filter(x=>[x.title,x.description,x.location.district,x.location.sector,x.propertyType].join(' ').toLowerCase().includes(q));
    if(sort==='price-low') data=[...data].sort((a,b)=>a.price.amount-b.price.amount);
    else if(sort==='price-high') data=[...data].sort((a,b)=>b.price.amount-a.price.amount);
    else if(sort==='oldest') data=[...data].sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||'')));
    return data;
  },[view,savedItems,myItems,items,purpose,propertyType,district,maxPrice,search,sort]);

  const compareItems = savedItems.filter(item=>compareIds.includes(item.publicId));
  const toggleCompare = (item:Listing) => setCompareIds(previous=>previous.includes(item.publicId)?previous.filter(id=>id!==item.publicId):previous.length>=3?(flash('Compare up to three saved properties at once.'),previous):[...previous,item.publicId]);

  const requireUser = (target?:View) => {
    if(!user) { setAuthMode('login');setAuthOpen(true); setReturnView(target || view); if(target) setView(target); return false; }
    return true;
  };
  const navTo = (target:View) => {
    setMobileNav(false);
    if(['dashboard','enquiries','new-listing','my-listings','saved','messages','deals','account','admin','agent-application','agent-review','notifications'].includes(target) && !user) { setReturnView(target); setAuthMode('login'); setAuthOpen(true); setView(target==='new-listing'?'discover':target); return; }
    if(target==='new-listing') {
      setEditingListingId(null);setExistingImages([]);setNewListingPhotos([]);
      setListingForm({title:'',description:'',propertyType:'house',purpose:'sale',district:'Gasabo',sector:'',price:''});
    }
    setView(target);
    if(target==='notifications'&&user)void refreshNotifications();
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
      setUser(active);setProfileForm({name:active.name||'',phone:active.phone||''});setAuthOpen(false);setAuthForm({name:'',email:'',phone:'',password:''});
      await Promise.all([refreshWorkspace(active),refreshListings()]);
      setView(active.role==='admin'?'admin':returnView);flash(t('Signed in securely.','Winjiye neza.'));
    });
  };
  const markNotificationRead = (item:AppNotification) => void withBusy(async()=>{
    if(!item.readAt) {
      await api.markNotificationRead(item.publicId);
      setNotifications(previous=>previous.map(n=>n.publicId===item.publicId?{...n,readAt:new Date().toISOString()}:n));
      setUnreadCount(value=>Math.max(0,value-1));
    }
    const allowed:View[]=['discover','agents','agent-application','agent-review','dashboard','enquiries','new-listing','my-listings','saved','messages','deals','trust','account','admin','notifications'];
    navTo(allowed.includes(item.destination as View)?item.destination as View:'notifications');
  });
  const markAllNotificationsRead = () => void withBusy(async()=>{
    if(unreadCount===0)return;
    await api.markAllNotificationsRead();
    const at=new Date().toISOString();
    setNotifications(previous=>previous.map(n=>({...n,readAt:n.readAt||at})));
    setUnreadCount(0);
    flash('All notifications marked as read.');
  });
  const signOut = () => { setSessionToken('');setUser(null);setEditingListingId(null);setExistingImages([]);setNewListingPhotos([]);setListingForm({title:'',description:'',propertyType:'house',purpose:'sale',district:'Gasabo',sector:'',price:''});setMyItems([]);setSavedIds([]);setSavedItems([]);setCompareIds([]);setLeads([]);setConversations([]);setMessages([]);setDeals([]);setAgentApplication(null);setPendingAgents([]);setPending([]);setView('discover');flash(t('You have signed out.','Wasohotse muri konti.')); };
  const saveListing = (item:Listing) => {
    if(!requireUser()) return;
    void withBusy(async()=>{
      if(savedIds.includes(item.publicId)){await api.removeFavorite(item.publicId);setSavedIds(s=>s.filter(id=>id!==item.publicId));setSavedItems(s=>s.filter(x=>x.publicId!==item.publicId));setCompareIds(s=>s.filter(id=>id!==item.publicId));flash(t('Removed from saved properties.','Byavanywe mu mitungo wabitswe.'))}
      else {await api.saveFavorite(item.publicId);setSavedIds(s=>[...s,item.publicId]);setSavedItems(s=>[item,...s]);flash(t('Property saved to your account.','Umutungo wabitswe muri konti.'))}
    });
  };
  const submitAgentApplication = (event:FormEvent) => {
    event.preventDefault();
    if(!requireUser('agent-application')) return;
    void withBusy(async()=>{
      const result=await api.applyForAgent({
        phone:agentForm.phone,bio:agentForm.bio,experienceYears:Number(agentForm.experienceYears),
        districts:agentForm.districts,showPhone:agentForm.showPhone,
      });
      setAgentApplication(result.data);
      await refreshWorkspace(user!);
      setView('agent-application');
      flash(result.message);
    });
  };
  const reviewAgent = (item:AgentApplication,decision:'approve'|'reject'|'request_changes') => void withBusy(async()=>{
    await api.adminReviewAgent(item.publicId,decision,reviewNotes[item.publicId]||'');
    const [queue,listingQueue,publicAgents]=await Promise.all([api.adminPendingAgents(),api.adminPending(),api.agents()]);
    setPendingAgents(queue.data||[]);setPending(listingQueue.data||[]);setAgentDirectory(publicAgents.data||[]);
    flash('Agent application decision recorded: '+decision+'.');
  });
  const beginEditListing = (item:Listing) => {
    if(!requireUser('new-listing'))return;
    setEditingListingId(item.publicId);
    setExistingImages(item.images||[]);
    setNewListingPhotos([]);
    setListingForm({
      title:item.title, description:item.description, propertyType:item.propertyType, purpose:item.purpose,
      district:item.location.district, sector:item.location.sector||'', price:String(item.price.amount),
    });
    setModal(null);
    setView('new-listing');
  };
  const selectListingPhotos = (files:FileList|null) => {
    if(!files?.length)return;
    const selected=Array.from(files);
    if((existingImages.length+newListingPhotos.length+selected.length)>6){flash('A listing can have up to six photos. Remove a photo before adding more.');return;}
    const invalid=selected.find(file=>!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size===0||file.size>8*1024*1024);
    if(invalid){flash('Choose JPEG, PNG or WebP photos, each smaller than 8 MiB.');return;}
    setNewListingPhotos(previous=>[
      ...previous,
      ...selected.map((file,index)=>({clientId:Date.now().toString()+'-'+index+'-'+Math.random().toString(36).slice(2),file,altText:listingForm.title.trim()||file.name.replace(/\.[^.]+$/,'')||'Property photo'})),
    ]);
  };
  const removeNewPhoto = (clientId:string) => setNewListingPhotos(previous=>previous.filter(photo=>photo.clientId!==clientId));
  const removeExistingPhoto = (photo:ListingImage) => {
    if(!editingListingId)return;
    if(!window.confirm('Remove this uploaded photo? The listing will return to review.'))return;
    void withBusy(async()=>{
      await api.deleteListingImage(editingListingId,photo.publicId);
      setExistingImages(previous=>previous.filter(image=>image.publicId!==photo.publicId));
      setMyItems(previous=>previous.map(item=>item.publicId===editingListingId?{...item,status:'pending_review',images:(item.images||[]).filter(image=>image.publicId!==photo.publicId)}:item));
      if(modal?.publicId===editingListingId)setModal(previous=>previous?{...previous,status:'pending_review',images:(previous.images||[]).filter(image=>image.publicId!==photo.publicId)}:previous);
      await Promise.all([refreshWorkspace(user!),refreshListings()]);
      flash('Photo removed. The listing is pending review again.');
    });
  };
  const submitListing = (event:FormEvent) => {
    event.preventDefault();if(!requireUser())return;
    void withBusy(async()=>{
      const payload:Partial<Listing>={
        title:listingForm.title,description:listingForm.description,propertyType:listingForm.propertyType as Listing['propertyType'],
        purpose:listingForm.purpose as Listing['purpose'],location:{district:listingForm.district,sector:listingForm.sector},
        price:{amount:Number(listingForm.price),currency:'RWF',period:listingForm.purpose==='rent'?'month':'once'},
      };
      const wasEditing=Boolean(editingListingId);
      const result=wasEditing?await api.updateListing(editingListingId!,payload):await api.createListing(payload);
      const listingId=result.id;
      let photoFailures=0;
      let photoSuccesses=0;
      for(const photo of newListingPhotos){
        try{await api.uploadListingImage(listingId,photo.file,photo.altText);photoSuccesses++}
        catch(error){photoFailures++;flash('Listing saved but one photo failed to upload: '+(error as Error).message)}
      }
      setListingForm({title:'',description:'',propertyType:'house',purpose:'sale',district:'Gasabo',sector:'',price:''});
      setEditingListingId(null);setExistingImages([]);setNewListingPhotos([]);
      await Promise.all([refreshWorkspace(user!),refreshListings()]);setView('my-listings');
      const base=wasEditing?'Changes saved and returned to review. Reference: '+listingId+'. Public visibility is paused until approval.':'Submitted for review. Reference: '+listingId+'. It will not be public until an administrator approves it.';
      flash(photoFailures?base+' Uploaded '+photoSuccesses+' new photo(s); '+photoFailures+' failed. Reopen the listing to retry.':base+(photoSuccesses?' '+photoSuccesses+' seller photo(s) uploaded.':''));
    });
  };
  const withdrawListing = (item:Listing) => {
    if(!user||!window.confirm('Withdraw “'+item.title+'”? It will be removed from public search.'))return;
    void withBusy(async()=>{
      await api.withdrawListing(item.publicId);
      await Promise.all([refreshWorkspace(user),refreshListings()]);
      if(modal?.publicId===item.publicId)setModal(null);
      flash('Listing withdrawn from publication.');
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
  const updateLeadStatus = (lead:Lead,status:'contacted'|'accepted'|'declined'|'completed'|'cancelled') => void withBusy(async()=>{
    await api.updateLeadStatus(lead.publicId,status);
    await refreshWorkspace(user!);
    flash('Enquiry status updated to '+prettyStage(status)+'. The other party has been notified.');
  });
  const openLeadConversation = (lead:Lead) => {
    if(!requireUser('messages'))return;
    void withBusy(async()=>{
      const isOwner=lead.ownerId===user!.publicId;
      const result=await api.openConversation(lead.listingId,isOwner?lead.requesterId:undefined);
      await refreshWorkspace(user!);
      setSelectedConversation(result.data.publicId);
      setView('messages');
    });
  };
  const acceptFee = (deal:Deal) => void withBusy(async()=>{await api.acceptFee(deal.publicId);await refreshWorkspace(user!);flash('Fee acceptance recorded. This is an in-platform acknowledgement, not a substitute for a signed contract.')});
  const updateStage = (deal:Deal,stage:string) => void withBusy(async()=>{const result=await api.updateDealStage(deal.publicId,stage,'Milestone updated in the deal workspace');await refreshWorkspace(user!);flash(result.completionPending?'Your completion confirmation is recorded. The other participant must confirm before the deal can be closed.':stage==='completed'?'Both participants confirmed completion. The deal record is now closed.':'Deal milestone updated to '+prettyStage(stage)+'.')});
  const runReview = (item:Listing,decision:'approve'|'reject'|'request_changes') => void withBusy(async()=>{await api.adminReview(item.publicId,decision,reviewNotes[item.publicId]||'');await refreshWorkspace(user!);await refreshListings();flash('Review decision recorded: '+decision+'.')});
  const runDocumentReview = (doc:EvidenceDocument,decision:'approve'|'reject'|'request_changes') => void withBusy(async()=>{const result=await api.adminReviewDocument(doc.publicId,decision,documentReviewNotes[doc.publicId]||'');setDocs(previous=>previous.map(item=>item.publicId===doc.publicId?result.data:item));flash(result.message)});
  const submitProfile = (event:FormEvent) => {
    event.preventDefault();if(!requireUser('account'))return;
    void withBusy(async()=>{
      const result=await api.updateProfile({name:profileForm.name,phone:profileForm.phone});
      setUser(result.user);setProfileForm({name:result.user.name||'',phone:result.user.phone||''});
      flash('Profile details saved.');
    });
  };
  const submitPasswordChange = (event:FormEvent) => {
    event.preventDefault();if(!requireUser('account'))return;
    if(passwordForm.newPassword!==passwordForm.confirmPassword){flash('The new password and confirmation do not match.');return;}
    if(new TextEncoder().encode(passwordForm.newPassword).length<12){flash('Choose a new password of at least 12 characters.');return;}
    void withBusy(async()=>{
      const result=await api.changePassword({currentPassword:passwordForm.currentPassword,newPassword:passwordForm.newPassword});
      setUser(result.user);setPasswordForm({currentPassword:'',newPassword:'',confirmPassword:''});
      flash('Password changed. This device has a new session; other sessions have been invalidated.');
    });
  };
  const doTrustCheck = (event:FormEvent) => {event.preventDefault();void withBusy(async()=>setHashResult(await api.verifyHash(hashInput.trim())))};
  const handleUpload = (listing:Listing,file?:File|null) => {if(!file)return;void withBusy(async()=>{const result=await api.uploadDocument(listing.publicId,file);setDocs(prev=>[result.data,...prev]);setModal(prev=>prev?.publicId===listing.publicId?{...prev,status:'pending_review',verification:{status:'unverified',checks:[]},reviewNote:''}:prev);await Promise.all([refreshWorkspace(user!),refreshListings()]);flash('Evidence stored privately. The listing has returned to human review. SHA-256: '+result.sha256)})};
  const loadDocs = (listing:Listing) => {if(!requireUser())return;void withBusy(async()=>setDocs((await api.documents(listing.publicId)).data||[]))};

  const navigation:{id:View;label:string;icon:any;group:string}[]=[
    {id:'discover',label:t('Discover property','Gushaka umutungo'),icon:Search,group:'Marketplace'},
    {id:'agents',label:t('Agent directory','Abahuza'),icon:Users,group:'Marketplace'},
    {id:'dashboard',label:t('Overview','Incamake'),icon:LayoutDashboard,group:'Workspace'},
    {id:'new-listing',label:t('Create listing','Shyiraho umutungo'),icon:FilePlus2,group:'Workspace'},
    {id:'agent-application',label:t('Become an agent','Ba umuhuza'),icon:BadgeCheck,group:'Workspace'},
    {id:'my-listings',label:t('My listings','Imitungo yanjye'),icon:Building2,group:'Workspace'},
    {id:'saved',label:t('Saved properties','Ibyabitswe'),icon:Heart,group:'Workspace'},
    {id:'notifications',label:t('Notifications','Ibimenyesha'),icon:Bell,group:'Workspace'},
    {id:'messages',label:t('Messages','Ubutumwa'),icon:MessageCircle,group:'Workspace'},
    {id:'enquiries',label:t('Enquiries & viewings','Ibibazo no gusura'),icon:ClipboardList,group:'Workspace'},
    {id:'deals',label:t('Deals & fees','Amasezerano'),icon:WalletCards,group:'Workspace'},
    {id:'trust',label:t('Evidence checker','Igenzura ry’inyandiko'),icon:ShieldCheck,group:'Tools'},
    ...(user?.role==='admin'?[{id:'admin' as View,label:t('Review queue','Igenzura'),icon:ClipboardList,group:'Administration'},{id:'agent-review' as View,label:t('Agent applications','Abahuza bashya'),icon:Users,group:'Administration'}]:[]),
    {id:'account',label:t('Account settings','Konti'),icon:Settings,group:'Account'},
  ];
  const heading:{[key in View]:{title:string;subtitle:string}}={
    discover:{title:t('Find a property with a clearer record.','Shaka umutungo ufite amakuru asobanutse.'),subtitle:t('Explore public listings, compare options and ask questions before making commitments.','Reba amatangazo rusange kandi ubaze mbere yo kwiyemeza.')},
    agents:{title:t('Meet reviewed property agents','Abahuza bemejwe'),subtitle:t('Explore agent profiles, service areas and experience. Public contact details appear only with the agent’s consent.','Reba imyirondoro y’abahuza, aho bakorera n’uburambe bwabo. Nimero zabo zigaragara gusa iyo babyemeye.')},
    'agent-application':{title:t('Become a property agent','Ba umuhuza w’imitungo'),subtitle:t('Submit a professional profile for human review. Approval is required before the profile becomes public.','Ohereza umwirondoro w’umwuga kugira ngo ugenzurwe n’abantu. Uzashyirwa ku mugaragaro ari uko wemejwe.')},
    'agent-review':{title:t('Agent application review','Igenzura ry’abahuza'),subtitle:t('Review applicant experience, service districts and contact consent before approving a public profile.','Genza uburambe bw’usaba, uturere akoreramo n’uruhushya rwo kugaragaza telefoni mbere yo kwemeza umwirondoro.')},
    notifications:{title:t('Notifications and updates','Ibimenyesha n’amakuru'),subtitle:t('Track listing reviews, new enquiries, conversations and deal milestones from your account.','Kurikirana igenzura ry’amatangazo, ibibazo bishya, ubutumwa n’intambwe z’amasezerano muri konti yawe.')},
    enquiries:{title:t('Enquiries, offers and viewings','Ibibazo, ibyifuzo no gusura'),subtitle:t('Process viewing requests, respond to prospective buyers and keep each enquiry status visible to both parties.','Subiza ibyifuzo byo gusura, ganira n’abaguzi bashobora kuza kandi ureke impande zombi zibone uko ikibazo gihagaze.')},
    dashboard:{title:t('Your property workspace','Ahantu hakurikirana imitungo yawe'),subtitle:t('Keep your listings, conversations, viewing requests and deal milestones in one place.','Bika amatangazo yawe, ibiganiro, ibyifuzo byo gusura n’intambwe z’amasezerano ahantu hamwe.')},
    'new-listing':{title:t('Create a property listing','Shyiraho itangazo ry’umutungo'),subtitle:t('Submissions stay private until the review team approves them.','Amatangazo akomeza kuba ibanga kugeza igihe itsinda rishinzwe igenzura riyemeje.')},
    'my-listings':{title:t('Your listings','Amatangazo yawe'),subtitle:t('See review status and continue preparing the evidence for every property.','Reba uko amatangazo agenzurwa kandi ukomeze gutegura ibimenyetso kuri buri mutungo.')},
    saved:{title:t('Saved properties','Imitungo wabitse'),subtitle:t('Your shortlist stays attached to your account across devices.','Imitungo wabitse iboneka muri konti yawe ku bikoresho bitandukanye.')},
    messages:{title:t('Private conversations','Ubutumwa bwihariye'),subtitle:t('Keep deal-related questions attached to the property they concern.','Bika ibibazo bijyanye n’amasezerano ku mutungo bireba.')},
    deals:{title:t('Deal room & commission terms','Amasezerano na komisiyo'),subtitle:t('Track milestones, record fee acceptance and keep the activity history readable.','Kurikirana intambwe z’amasezerano, wandike ukwemera komisiyo kandi ubike amateka y’ibikorwa asobanutse.')},
    trust:{title:t('Evidence hash checker','Igenzura ry’ibimenyetso'),subtitle:t('Check whether this platform recorded a particular content digest. It cannot validate legal ownership.','Reba niba uru rubuga rwarabitse ikimenyetso cy’inyandiko. Ibi ntibyemeza uburenganzira bwemewe n’amategeko ku mutungo.')},
    account:{title:t('Account settings','Imiterere ya konti'),subtitle:t('Manage session details and review your current access role.','Genzura ibyerekeye igihe winjiriye n’uruhushya ufite muri konti yawe.')},
    admin:{title:t('Listing review queue','Amatangazo agomba kugenzurwa'),subtitle:t('Review submitted listings and record a clear decision and note.','Genza amatangazo yoherejwe maze wandike icyemezo n’inyandiko ibisobanura.')},
  };
  const title=view==='new-listing'&&editingListingId?{title:'Update property listing',subtitle:'Changes return to human review before the property can appear publicly again.'}:heading[view];

  return <MotionConfig reducedMotion="user"><div className="app-shell">
    <header className="app-header">
      <button className="brand" onClick={()=>navTo('discover')} aria-label="Go to discover"><span className="brand-mark"><House size={22}/></span><span className="brand-name">DEALER<small>PROPERTY, WITH PROOF.</small></span></button>
      <div className="header-search"><Search size={17}/><input aria-label="Search properties" placeholder={t('Search by district, neighborhood or property','Shakisha ahantu cyangwa umutungo')} value={search} onChange={e=>{setSearch(e.target.value);setView('discover')}}/><kbd>⌕</kbd></div>
      <div className="header-actions"><button className="notification-trigger" onClick={()=>navTo('notifications')} aria-label={'Notifications, '+unreadCount+' unread'} title="Notifications"><Bell size={18}/>{unreadCount>0&&<span>{unreadCount>99?'99+':unreadCount}</span>}</button><button className="locale-button" onClick={()=>setLanguage(language==='en'?'rw':'en')}><Globe2 size={16}/><span>{language==='en'?'EN':'RW'}</span></button><TooltipProvider delayDuration={250}><Tooltip><TooltipTrigger asChild><span tabIndex={0} aria-label={apiOnline?'API is reachable':'API is offline'} className={'api-pill '+(apiOnline?'online':'offline')}><i/>{apiOnline?'API online':'API offline'}</span></TooltipTrigger><TooltipContent side="bottom">{apiOnline?'Live API health check is responding.':'API health check failed. Property data cannot be refreshed until the service returns.'}</TooltipContent></Tooltip></TooltipProvider>{user?<DropdownMenu><DropdownMenuTrigger asChild><button className="avatar-button" aria-label="Open account menu" title={user.email}>{user.name.slice(0,1).toUpperCase()}</button></DropdownMenuTrigger><DropdownMenuContent align="end" className="account-dropdown"><DropdownMenuItem onSelect={()=>navTo('account')}><UserCircle size={15}/>Account settings</DropdownMenuItem><DropdownMenuItem onSelect={()=>navTo('notifications')}><Bell size={15}/>Notifications{unreadCount>0?` (${unreadCount})`:``}</DropdownMenuItem><DropdownMenuItem onSelect={()=>navTo('deals')}><WalletCards size={15}/>Deal workspace</DropdownMenuItem><DropdownMenuSeparator/><DropdownMenuItem onSelect={signOut}><LogOut size={15}/>Sign out</DropdownMenuItem></DropdownMenuContent></DropdownMenu>:<Button size="sm" onClick={()=>{setAuthMode('login');setAuthOpen(true)}}><LogIn size={15}/>{t('Sign in','Injira')}</Button>}<button className="mobile-toggle" onClick={()=>setMobileNav(x=>!x)} aria-label="Toggle navigation"><Menu size={21}/></button></div>
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
        <AnimatePresence mode="wait" initial={false}><PageTransition key={view}>
        {view==='discover'&&<section className="view-content">
          <div className="hero-panel"><div className="hero-glow"/><div className="hero-text"><div className="hero-kicker"><Sparkles size={15}/> MORE CLARITY. FEWER SURPRISES.</div><h2>Find a place.<br/><em>Know what comes next.</em></h2><p>Houses, apartments and land, with a trail for questions, viewing requests and deal milestones.</p><div className="hero-stats"><span><b>{items.length}</b><small>Public listings</small></span><span><b>{districts.length||30}</b><small>District options</small></span><span><b>RWF</b><small>Local currency</small></span></div></div><div className="hero-illustration"><div className="illustration-house"><House size={82} strokeWidth={1}/><span/><span/><span/></div><div className="float-chip chip-proof"><ShieldCheck size={16}/>Evidence trail</div><div className="float-chip chip-deal"><CheckCircle2 size={16}/>Deal milestones</div></div></div>
          <div className="quick-actions"><button onClick={()=>navTo('new-listing')}><span className="quick-icon"><FilePlus2 size={19}/></span><span><b>Create a listing</b><small>Submit a house, room or land</small></span><ChevronRight size={17}/></button><button onClick={()=>navTo('saved')}><span className="quick-icon quick-lilac"><Heart size={19}/></span><span><b>Compare your shortlist</b><small>Keep properties in one place</small></span><ChevronRight size={17}/></button><button onClick={()=>navTo('deals')}><span className="quick-icon quick-gold"><WalletCards size={19}/></span><span><b>Track a deal</b><small>Fees, steps and decisions</small></span><ChevronRight size={17}/></button></div>
          <div className="toolbar"><Tabs value={purpose} onValueChange={value=>setPurpose(value as 'sale'|'rent')} className="purpose-switch"><TabsList className="purpose-tabs-list"><TabsTrigger value="sale">Buy</TabsTrigger><TabsTrigger value="rent">Rent</TabsTrigger></TabsList></Tabs><label className="filter-control"><MapPin size={15}/><select value={district} onChange={e=>setDistrict(e.target.value)}><option>All Rwanda</option>{districts.map(x=><option key={x}>{x}</option>)}</select><ChevronDown size={14}/></label><label className="filter-control"><Building2 size={15}/><select value={propertyType} onChange={e=>setPropertyType(e.target.value)}><option>All properties</option><option value="house">House</option><option value="apartment">Apartment</option><option value="land">Land</option><option value="commercial">Commercial</option><option value="room">Room</option></select><ChevronDown size={14}/></label><label className="price-filter"><span>Max price (RWF)</span><input type="number" inputMode="numeric" min="1" step="1" placeholder="Any budget" value={maxPrice} onChange={e=>setMaxPrice(e.target.value)} aria-label="Maximum price in Rwandan francs"/></label><label className="filter-control"><SlidersHorizontal size={15}/><select value={sort} onChange={e=>setSort(e.target.value)}><option value="newest">Newest first</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="oldest">Oldest first</option></select></label><button className="btn btn-outline btn-sm" onClick={()=>{setDistrict('All Rwanda');setPropertyType('All properties');setMaxPrice('');setSearch('');setSort('newest')}}><Filter size={14}/>Clear</button></div>
          <div className="section-title-row"><div><h2>Explore properties</h2><p>Only published listings from the API appear here. Results are filtered and sorted by the server.</p></div><span className="count-pill">{listingTotal?`Showing ${items.length} of ${listingTotal}`:`${filtered.length} results`}</span></div>
          {filtered.length?<div className="listing-grid">{filtered.map(item=><ListingCard key={item.publicId} item={item} saved={savedIds.includes(item.publicId)} onSave={()=>saveListing(item)} onOpen={()=>{setModal(item);setViewingForm({message:'I would like to arrange a viewing and discuss this property.',preferredAt:''});setDocs([])}}/>)}</div>:<EmptyState title={apiOnline?'No published properties match yet':'API is not reachable'} body={apiOnline?'There are no published listings for these filters. Create a listing or clear the filters to keep exploring.':'Start Docker Compose, then refresh. Illustrative fake listings are intentionally not presented as genuine homes for sale.'} icon={apiOnline?House:CircleAlert} action={()=>apiOnline?navTo('new-listing'):void withBusy(async()=>refreshListings())} button={apiOnline?'Create a listing':'Retry connection'}/>}
          {listingHasMore&&<div className="load-more-row"><Button variant="outline" size="lg" disabled={loadingMore} onClick={()=>void loadMoreListings()}>{loadingMore?<><RefreshCw className="animate-spin" size={16}/>Loading more properties…</>:<>Load more properties <ArrowDown size={16}/></>}</Button><span>Showing {items.length} of {listingTotal} published properties from the API.</span></div>}
        </section>}

        {view==='agents'&&<AgentDirectoryView
          agents={agentDirectory}
          loading={agentDirectoryLoading}
          search={search}
          busy={busy}
          onRefresh={()=>void withBusy(async()=>{setAgentDirectoryLoading(true);try{const r=await api.agents();setAgentDirectory(r.data||[])}finally{setAgentDirectoryLoading(false)}})}
          onBecomeAgent={()=>navTo('agent-application')}
          onClearSearch={()=>setSearch('')}
        />}

        {view==='agent-application'&&<AgentApplicationView
          application={agentApplication}
          form={agentForm}
          setForm={setAgentForm}
          districts={districts}
          busy={busy}
          onSubmit={submitAgentApplication}
          onViewDirectory={()=>navTo('agents')}
        />}

        {view==='enquiries'&&<EnquiriesView
          leads={leads}
          userId={user?.publicId}
          busy={busy}
          onOpenConversation={openLeadConversation}
          onUpdateStatus={updateLeadStatus}
          onRefresh={()=>void withBusy(async()=>refreshWorkspace(user!))}
          onExplore={()=>navTo('discover')}
        />}

        {view==='notifications'&&<NotificationsView
          notifications={notifications}
          unreadCount={unreadCount}
          busy={busy}
          onMarkRead={markNotificationRead}
          onMarkAllRead={markAllNotificationsRead}
          onExplore={()=>navTo('discover')}
        />}

        {view==='dashboard'&&<DashboardView
          firstName={user?.name.split(' ')[0]||'there'}
          listings={myItems}
          savedCount={savedIds.length}
          conversationCount={conversations.length}
          deals={deals}
          leads={leads}
          activityTableView={activityTableView}
          onToggleActivityTableView={()=>setActivityTableView(value=>!value)}
          onViewListings={()=>navTo('my-listings')}
          onOpenMessages={()=>navTo('messages')}
        />}

        {view==='new-listing'&&<ListingEditorView
          form={listingForm}
          setForm={setListingForm}
          districts={districts}
          editing={Boolean(editingListingId)}
          existingImages={existingImages}
          newPhotos={newListingPhotos}
          photoPreviews={photoPreviews}
          busy={busy}
          onSubmit={submitListing}
          onSelectPhotos={selectListingPhotos}
          onRemoveExisting={removeExistingPhoto}
          onRemoveNew={removeNewPhoto}
          onNewPhotoAltChange={(clientId,value)=>setNewListingPhotos(previous=>previous.map(photo=>photo.clientId===clientId?{...photo,altText:value}:photo))}
        />}

        {(view==='my-listings'||view==='saved')&&<section className="view-content"><div className="toolbar toolbar-light"><label className="wide-search"><Search size={16}/><input placeholder="Filter your properties" value={search} onChange={e=>setSearch(e.target.value)}/></label><label className="filter-control"><SlidersHorizontal size={15}/><select value={sort} onChange={e=>setSort(e.target.value)}><option value="newest">Newest first</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option></select></label><span className="count-pill">{filtered.length} properties</span></div>{view==='saved'&&<div className="compare-toolbar"><div><b>Compare your shortlist</b><p>Select up to three saved properties to compare price, location, type and listing status side by side.</p></div><div><span className="count-pill">{compareItems.length}/3 selected</span><button className="btn btn-outline btn-sm" disabled={!compareItems.length} onClick={()=>setCompareIds([])}>Clear comparison</button></div></div>}{view==='saved'&&compareItems.length>0&&<div className="compare-panel"><div className="compare-heading"><div><h2>Property comparison</h2><p>Compare the listing information provided on the platform. This is not a property valuation or legal verification.</p></div></div><div className="compare-table-wrap"><table className="compare-table"><thead><tr><th scope="col">Detail</th>{compareItems.map(item=><th scope="col" key={item.publicId}><span>{item.title}</span><button className="compare-remove" onClick={()=>toggleCompare(item)} aria-label={'Remove '+item.title+' from comparison'}>Remove</button></th>)}</tr></thead><tbody><tr><th scope="row">Price</th>{compareItems.map(item=><td key={item.publicId}><strong>{money(item.price.amount)}</strong>{item.purpose==='rent'&&<small>per month</small>}</td>)}</tr><tr><th scope="row">Location</th>{compareItems.map(item=><td key={item.publicId}>{item.location.sector?item.location.sector+', ':''}{item.location.district}, Rwanda</td>)}</tr><tr><th scope="row">Property type</th>{compareItems.map(item=><td key={item.publicId}>{item.propertyType}</td>)}</tr><tr><th scope="row">Purpose</th>{compareItems.map(item=><td key={item.publicId}>{item.purpose==='rent'?'For rent':'For sale'}</td>)}</tr><tr><th scope="row">Listing status</th>{compareItems.map(item=><td key={item.publicId}><StatusPill value={item.status||'unknown'}/></td>)}</tr><tr><th scope="row">Description</th>{compareItems.map(item=><td key={item.publicId}>{item.description}</td>)}</tr><tr><th scope="row">Next step</th>{compareItems.map(item=><td key={item.publicId}><button className="btn btn-primary btn-sm" onClick={()=>{setDocs([]);setModal(item)}}>View property</button></td>)}</tr></tbody></table></div></div>}{filtered.length?<div className="listing-grid">{filtered.map(item=><div className="listing-workspace-wrap" key={item.publicId}><ListingCard item={item} saved={savedIds.includes(item.publicId)} showSave={view==='saved'} onSave={()=>saveListing(item)} onOpen={()=>{setDocs([]);setModal(item)}}/>{view==='saved'&&<div className="owner-card-actions"><button className={'btn btn-sm '+(compareIds.includes(item.publicId)?'btn-primary':'btn-outline')} onClick={()=>toggleCompare(item)} aria-pressed={compareIds.includes(item.publicId)}>{compareIds.includes(item.publicId)?<Check size={14}/>:<SlidersHorizontal size={14}/>} {compareIds.includes(item.publicId)?'Selected to compare':'Compare property'}</button></div>}{view==='my-listings'&&<ListingLifecycleNotice listing={item} busy={busy} onEdit={beginEditListing} onWithdraw={withdrawListing}/>}</div>)}</div>:<EmptyState icon={view==='saved'?Heart:Building2} title={view==='saved'?'No saved properties yet':'No listings to show'} body={view==='saved'?'Save properties from Discover to keep a shortlist synced to your account.':'Submit a property to see its review status and evidence trail here.'} action={()=>navTo(view==='saved'?'discover':'new-listing')} button={view==='saved'?'Explore properties':'Create a listing'}/>}</section>}

        {view==='messages'&&<MessagingView
          conversations={conversations}
          selectedConversationId={selectedConversation}
          messages={messages}
          userId={user?.publicId}
          busy={busy}
          draft={messageDraft}
          setDraft={setMessageDraft}
          onSelectConversation={setSelectedConversation}
          onRefreshConversations={()=>void withBusy(async()=>refreshWorkspace(user!))}
          onReloadMessages={()=>{if(selectedConversation)void refreshMessages(selectedConversation)}}
          onSendMessage={sendMessage}
        />}

        {view==='deals'&&<DealWorkspaceView
          deals={deals}
          userId={user?.publicId}
          busy={busy}
          onAcceptFee={acceptFee}
          onUpdateStage={updateStage}
          onFindProperty={()=>navTo('discover')}
        />}

        {view==='trust'&&<section className="view-content trust-view"><div className="trust-hero-card"><div className="trust-big-icon"><ShieldCheck size={30}/></div><div><h2>Traceable evidence, honest limits.</h2><p>Files are kept in private storage and access is checked by the API. A SHA-256 digest can show whether the same byte sequence was recorded. It does not say who owns a property or whether a document is genuine.</p></div></div><form className="panel hash-form" onSubmit={doTrustCheck}><div className="panel-heading"><div><h3>Check a recorded hash</h3><p>Paste the exact SHA-256 digest returned by an upload or listing submission.</p></div><LockKeyhole size={19}/></div><label className="field-label">SHA-256 digest<input required minLength={32} maxLength={128} value={hashInput} onChange={e=>setHashInput(e.target.value.trim())} placeholder="Paste the hash string here"/></label><button className="btn btn-primary" disabled={busy||!hashInput.trim()} type="submit"><Search size={16}/>Check digest</button>{hashResult&&<div className={'hash-result '+(hashResult.exists?'hash-found':'hash-missing')}><span>{hashResult.exists?<CheckCircle2 size={20}/>:<CircleAlert size={20}/>}</span><div><b>{hashResult.exists?'Digest found in audit records':'No matching audit record found'}</b><p>{hashResult.meaning}</p></div></div>}</form><div className="two-column"><div className="panel"><div className="panel-heading"><div><h3>Document access</h3><p>Evidence downloads are served through authenticated endpoints.</p></div><FileCheck2 size={20}/></div><p className="muted-copy">Only a listing owner, uploader or participant in a deal for that property can request the evidence file. Uploads are limited to PDF, JPEG, PNG and WebP, up to 8 MiB each.</p></div><div className="panel"><div className="panel-heading"><div><h3>Official land verification</h3><p>Platform records do not replace government records.</p></div></div><p className="muted-copy">Confirm the parcel UPI, title holder and any restrictions through the National Land Authority and the official transfer process.</p><a className="btn btn-outline" href="https://support.irembo.gov.rw/en/support/solutions/articles/47001210595-how-to-apply-for-title-transfer-voluntary-sale-" target="_blank" rel="noreferrer">Open IremboGov guidance <ArrowUpRight size={14}/></a></div></div></section>}

        {view==='account'&&<section className="view-content account-view">
          <div className="account-column">
            <div className="panel account-card"><div className="account-banner"><span className="account-avatar">{user?.name.slice(0,1).toUpperCase()}</span><div><h2>{user?.name}</h2><p>{user?.email}</p></div><StatusPill value={user?.role||'member'}/></div><div className="account-fields"><div><small>Account name</small><b>{user?.name}</b></div><div><small>Sign-in email</small><b>{user?.email}</b></div><div><small>Phone contact</small><b>{user?.phone||'Not supplied'}</b></div><div><small>Access role</small><b>{user?.role||'member'}</b></div><div><small>Session</small><b>Bearer token · 8-hour expiry</b></div><div><small>API connection</small><b className={apiOnline?'text-success':'text-warning'}>{apiOnline?'Connected':'Offline'}</b></div></div><div className="account-actions"><button className="btn btn-outline" onClick={()=>void withBusy(async()=>{const refreshed=await api.me();setUser(refreshed);setProfileForm({name:refreshed.name||'',phone:refreshed.phone||''});flash('Account refreshed from the API.')})}><RefreshCw size={15}/>Refresh account</button><button className="btn btn-danger" onClick={signOut}><LogOut size={15}/>Sign out</button></div></div>
            <form className="panel account-edit-card" onSubmit={submitProfile}><div className="panel-heading"><div><h3>Edit profile</h3><p>These details are private account data, not your public property listing.</p></div><UserCircle size={20}/></div><div className="account-form-fields"><Field label="Display name"><Input required minLength={2} maxLength={100} value={profileForm.name} onChange={e=>setProfileForm({...profileForm,name:e.target.value})}/></Field><Field label="Phone (optional)"><Input maxLength={40} value={profileForm.phone} onChange={e=>setProfileForm({...profileForm,phone:e.target.value})} placeholder="+250…"/></Field></div><button className="btn btn-primary" type="submit" disabled={busy}><CheckCircle2 size={15}/>Save profile</button></form>
          </div>
          <div className="account-column">
            <form className="panel password-change-card" onSubmit={submitPasswordChange}><div className="panel-heading"><div><h3>Change password</h3><p>Changing your password invalidates older signed-in sessions.</p></div><LockKeyhole size={20}/></div><div className="account-form-fields"><Field label="Current password"><Input required type="password" autoComplete="current-password" value={passwordForm.currentPassword} onChange={e=>setPasswordForm({...passwordForm,currentPassword:e.target.value})}/></Field><Field label="New password"><Input required type="password" autoComplete="new-password" minLength={12} value={passwordForm.newPassword} onChange={e=>setPasswordForm({...passwordForm,newPassword:e.target.value})} placeholder="At least 12 characters"/></Field><Field label="Confirm new password"><Input required type="password" autoComplete="new-password" minLength={12} value={passwordForm.confirmPassword} onChange={e=>setPasswordForm({...passwordForm,confirmPassword:e.target.value})}/></Field></div><div className="review-explainer"><ShieldCheck size={17}/><div><b>Session protection</b><p>The API stores password hashes, never plaintext passwords. A password change revokes existing tokens by increasing the account token version.</p></div></div><button className="btn btn-primary" type="submit" disabled={busy}><LockKeyhole size={15}/>Change password</button></form>
            <div className="panel account-help"><LockKeyhole size={21}/><h3>Account security</h3><p>Use a unique password, sign out on shared computers and avoid sharing sensitive ID information in public listing descriptions or ordinary chat messages. Email changes and password recovery are not enabled until a verified email delivery service is configured.</p></div>
          </div>
        </section>}

        {view==='admin'&&<>
          <ListingReviewQueue
            userRole={user?.role}
            pending={pending}
            busy={busy}
            notes={reviewNotes}
            onNoteChange={(id,value)=>setReviewNotes(previous=>({...previous,[id]:value}))}
            onReview={runReview}
            onOpenEvidence={item=>{setDocs([]);setModal(item)}}
            onRefresh={()=>void withBusy(async()=>{const r=await api.adminPending();setPending(r.data||[])})}
          />
          {user?.role==='admin'&&<AdminAuditView />}
        </>}
        {view==='agent-review'&&<AgentReviewQueue
          userRole={user?.role}
          pending={pendingAgents}
          busy={busy}
          notes={reviewNotes}
          onNoteChange={(id,value)=>setReviewNotes(previous=>({...previous,[id]:value}))}
          onReview={reviewAgent}
          onRefresh={()=>void withBusy(async()=>{const r=await api.adminPendingAgents();setPendingAgents(r.data||[])})}
        />}
        </PageTransition></AnimatePresence>
    </main>
    </div>

    <nav className="mobile-bottom-nav" aria-label="Quick navigation"><button className={view==='discover'?'active':''} onClick={()=>navTo('discover')}><Search size={18}/><span>Discover</span></button><button className={view==='saved'?'active':''} onClick={()=>navTo('saved')}><Heart size={18}/><span>Saved</span></button><button className={view==='messages'?'active':''} onClick={()=>navTo('messages')}><MessageCircle size={18}/><span>Messages</span></button><button className={view==='dashboard'?'active':''} onClick={()=>navTo('dashboard')}><LayoutDashboard size={18}/><span>Desk</span></button></nav>

    {modal&&<Dialog open={Boolean(modal)} onOpenChange={open=>{if(!open)setModal(null)}}><DialogContent className="property-dialog-content !block !max-w-4xl !max-h-[92vh] !overflow-y-auto !p-0 !gap-0 !border-0 !bg-transparent !shadow-none"><DialogTitle className="sr-only">{modal.title}</DialogTitle><DialogDescription className="sr-only">Property details, evidence, viewing and commission actions.</DialogDescription><section className="property-modal"><PropertyImage item={modal} variant="modal"/><div className="modal-body"><div className="listing-type">{modal.propertyType} · {modal.location.district}</div><h2>{modal.title}</h2><div className="modal-price">{money(modal.price.amount)}{modal.purpose==='rent'&&<small> / month</small>}</div><p className="modal-description">{modal.description}</p>{user&&modal.ownerId===user.publicId&&modal.reviewNote&&<div className="review-explainer"><FileCheck2 size={17}/><div><b>Review team note</b><p>{modal.reviewNote}</p></div></div>}<div className="modal-location"><MapPin size={15}/>{modal.location.sector?modal.location.sector+', ':''}{modal.location.district}, Rwanda</div><div className="modal-trust"><ShieldCheck size={18}/><div><b>{modal.status==='published'?'Moderation approved':'Review not confirmed'}</b><small>Request evidence and independently confirm title, parcel details and ownership. This listing is not a legal guarantee.</small></div></div><div className="modal-actions">{(!user||user.publicId!==modal.ownerId)&&<button className="btn btn-primary" onClick={()=>startConversation(modal)}><MessageCircle size={16}/>Message owner</button>}<button className="btn btn-outline" onClick={()=>saveListing(modal)}><Heart size={16}/>{savedIds.includes(modal.publicId)?'Saved':'Save'}</button><button className="btn btn-outline" onClick={()=>void shareListing(modal)}><Copy size={16}/>Copy property link</button>{user&&user.publicId===modal.ownerId&&<span className="owner-label"><CheckCircle2 size={14}/>Your listing</span>}</div>{(!user||user.publicId!==modal.ownerId)?<div className="modal-section"><h3>Request a viewing</h3><form onSubmit={openViewing}><label className="field-label">Preferred date and time<input type="datetime-local" value={viewingForm.preferredAt} onChange={e=>setViewingForm({...viewingForm,preferredAt:e.target.value})}/></label><label className="field-label">Message<textarea rows={3} required minLength={5} maxLength={1000} value={viewingForm.message} onChange={e=>setViewingForm({...viewingForm,message:e.target.value})}/></label><button className="btn btn-outline btn-block" type="submit" disabled={busy}><CalendarClock size={16}/>Request a viewing</button></form></div>:<div className="modal-section owner-listing-note"><h3>Your listing workspace</h3><p className="muted-copy">Use the private evidence section below to add documents. Manage property photos in the listing editor; photo changes return the listing to review.</p><StatusPill value={modal.status||'unknown'}/><button className="btn btn-outline btn-block owner-manage-listing" onClick={()=>beginEditListing(modal)}><FileText size={15}/>Manage listing and photos</button></div>}{user&&user.publicId!==modal.ownerId&&<div className="modal-section"><h3>Commission agreement proposal</h3><p className="muted-copy">Creates a deal workspace; the other party must separately acknowledge terms.</p><label className="field-label">Commission percentage<input type="number" min="0" max="15" step=".25" value={dealForm.commissionPercent} onChange={e=>setDealForm({...dealForm,commissionPercent:e.target.value})}/></label><label className="field-label">Terms<textarea rows={3} value={dealForm.commissionTerms} onChange={e=>setDealForm({...dealForm,commissionTerms:e.target.value})}/></label><button className="btn btn-outline btn-block" onClick={()=>startDeal(modal)} disabled={busy}>Propose deal <ArrowRight size={15}/></button></div>}{user&&modal.ownerId===user.publicId&&<div className="modal-section"><h3>Private property evidence</h3><p className="muted-copy">PDF, JPEG, PNG or WebP, up to 8 MiB. Uploads are private, enter administrator review, and require authorization to download.</p><label className="btn btn-outline upload-label"><Upload size={15}/>Upload evidence<input type="file" accept=".pdf,image/jpeg,image/png,image/webp" onChange={e=>handleUpload(modal,e.target.files?.[0])}/></label><button className="text-button" onClick={()=>loadDocs(modal)}>View stored documents <ArrowRight size={14}/></button>{docs.filter(doc=>doc.listingId===modal.publicId).map(doc=><div className="document-row" key={doc.publicId}><FileText size={16}/><span><b>{doc.fileName}</b><small>{Math.ceil(doc.sizeBytes/1024)} KB · {evidenceStatusLabel(doc.reviewStatus)}</small></span><button className="icon-button" onClick={()=>void api.downloadDocument(doc.publicId,doc.fileName).catch(e=>flash((e as Error).message))} aria-label="Download evidence"><Download size={15}/></button></div>)}</div>}{user?.role==='admin'&&<div className="modal-section"><h3>Submitted evidence</h3><p className="muted-copy">Open the metadata for evidence uploaded by the property owner. This does not verify the legal validity of any document.</p><button className="btn btn-outline btn-block" onClick={()=>loadDocs(modal)} disabled={busy}><RefreshCw size={15}/>Load evidence documents</button>{docs.filter(doc=>doc.listingId===modal.publicId).map(doc=><div className="document-row evidence-review-row" key={doc.publicId}><FileText size={16}/><span><b>{doc.fileName}</b><small>{Math.ceil(doc.sizeBytes/1024)} KB · {evidenceStatusLabel(doc.reviewStatus)} · restricted access</small><textarea className="standalone-textarea" rows={2} value={documentReviewNotes[doc.publicId]||''} onChange={e=>setDocumentReviewNotes(previous=>({...previous,[doc.publicId]:e.target.value}))} placeholder="Evidence review note (optional)"/><span className="review-actions"><button className="btn btn-primary btn-sm" disabled={busy} onClick={()=>runDocumentReview(doc,'approve')}>Mark verified</button><button className="btn btn-outline btn-sm" disabled={busy} onClick={()=>runDocumentReview(doc,'request_changes')}>Request changes</button><button className="btn btn-danger btn-sm" disabled={busy} onClick={()=>runDocumentReview(doc,'reject')}>Reject evidence</button></span></span><button className="icon-button" onClick={()=>void api.downloadDocument(doc.publicId,doc.fileName).catch(e=>flash((e as Error).message))} aria-label="Download review evidence"><Download size={15}/></button></div>)}</div>}{user?.role==='admin'&&<div className="modal-section"><h3>Review control</h3><textarea className="standalone-textarea" rows={2} value={reviewNotes[modal.publicId]||''} onChange={e=>setReviewNotes({...reviewNotes,[modal.publicId]:e.target.value})} placeholder="Review note"/><div className="review-actions"><button className="btn btn-primary" onClick={()=>runReview(modal,'approve')}>Approve</button><button className="btn btn-outline" onClick={()=>runReview(modal,'request_changes')}>Request changes</button><button className="btn btn-danger" onClick={()=>runReview(modal,'reject')}>Reject</button></div></div>}</div></section></DialogContent></Dialog>}

    <Dialog open={authOpen} onOpenChange={setAuthOpen}><DialogContent className="auth-dialog-content !border-0 !bg-transparent !p-0 !shadow-none"><section className="auth-card"><div className="auth-brand"><span className="brand-mark"><House size={20}/></span><div><b>DEALER</b><small>PROPERTY, WITH PROOF.</small></div></div><div className="eyebrow">YOUR PROPERTY DESK</div><DialogTitle className="auth-dialog-title">{authMode==='login'?'Welcome back.':'Create your account.'}</DialogTitle><DialogDescription className="auth-dialog-description">{authMode==='login'?'Sign in to manage saved homes, private conversations and deal milestones.':'Create an account to list property and keep your activity connected.'}</DialogDescription><form onSubmit={handleAuth} className="auth-form">{authMode==='register'&&<Field label="Full name"><input required minLength={2} maxLength={100} value={authForm.name} onChange={e=>setAuthForm({...authForm,name:e.target.value})} placeholder="Your name"/></Field>}<Field label="Email address"><input type="email" required autoComplete="email" value={authForm.email} onChange={e=>setAuthForm({...authForm,email:e.target.value})} placeholder="you@example.com"/></Field>{authMode==='register'&&<Field label="Phone (optional)"><input value={authForm.phone} onChange={e=>setAuthForm({...authForm,phone:e.target.value})} placeholder="+250…"/></Field>}<Field label="Password"><input type="password" required minLength={authMode==='register'?10:1} autoComplete={authMode==='login'?'current-password':'new-password'} value={authForm.password} onChange={e=>setAuthForm({...authForm,password:e.target.value})} placeholder={authMode==='register'?'At least 10 characters':'Your password'}/></Field><button className="btn btn-primary btn-block" type="submit" disabled={busy}>{busy?'Please wait…':authMode==='login'?'Sign in':'Create account'}<ArrowRight size={16}/></button></form><p className="auth-switch">{authMode==='login'?'New to Dealer?':'Already registered?'} <button onClick={()=>setAuthMode(authMode==='login'?'register':'login')}>{authMode==='login'?'Create an account':'Sign in instead'}</button></p><div className="auth-safety"><LockKeyhole size={14}/>Password is hashed on the API. Sessions expire after eight hours.</div></section></DialogContent></Dialog>
    <ErrorNote text={notice} onClose={()=>setNotice('')}/>
  </div></MotionConfig>;
}

