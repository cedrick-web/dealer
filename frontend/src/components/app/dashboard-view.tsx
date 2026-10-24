import { ArrowRight, ArrowUpRight, Building2, CalendarClock, Heart, LayoutDashboard, MessageCircle, ShieldCheck, SlidersHorizontal, WalletCards } from 'lucide-react';
import type { Deal, Lead, Listing } from '@/api';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Metric, StatusPill } from '@/components/app/common';
import { PropertyImage } from '@/components/app/property-cards';
import { dateLabel, money } from '@/lib/property-format';

export function DashboardView({
  firstName, listings, savedCount, conversationCount, deals, leads,
  activityTableView, onToggleActivityTableView, onViewListings, onOpenMessages,
}:{
  firstName:string;
  listings:Listing[];
  savedCount:number;
  conversationCount:number;
  deals:Deal[];
  leads:Lead[];
  activityTableView:boolean;
  onToggleActivityTableView:()=>void;
  onViewListings:()=>void;
  onOpenMessages:()=>void;
}) {
  return (
    <section className="view-content">
      <div className="welcome-strip"><div><span className="welcome-label">YOUR WORKSPACE</span><h2>Good day, {firstName}.</h2><p>Here is what is happening across your property activity.</p></div><div className="welcome-symbol"><LayoutDashboard size={28}/></div></div>
      <div className="metric-grid">
        <Metric icon={Building2} label="Your listings" value={listings.length} detail="All review statuses"/>
        <Metric icon={Heart} label="Saved properties" value={savedCount} detail="Your shortlist"/>
        <Metric icon={MessageCircle} label="Conversations" value={conversationCount} detail="Private property chats"/>
        <Metric icon={WalletCards} label="Deal workspaces" value={deals.length} detail="Commission terms recorded"/>
      </div>
      <div className="two-column">
        <div className="panel">
          <div className="panel-heading"><div><h3>Recent listings</h3><p>Latest submissions from your account</p></div><button className="text-button" onClick={onViewListings}>View all <ArrowRight size={14}/></button></div>
          {listings.length ? listings.slice(0,4).map(item=><div className="compact-row" key={item.publicId}><PropertyImage item={item} variant="mini"/><div className="compact-main"><b>{item.title}</b><small>{item.location.district} · {money(item.price.amount)}</small></div><StatusPill value={item.status||'pending_review'}/></div>) : <p className="inline-empty">You haven't submitted a listing yet.</p>}
        </div>
        <div className="panel">
          <div className="panel-heading"><div><h3>Recent activity</h3><p>Enquiries and deal changes to follow up</p></div><button className="text-button" onClick={onToggleActivityTableView} aria-pressed={activityTableView}>{activityTableView?'Compact list':'Table view'} <SlidersHorizontal size={14}/></button></div>
          {activityTableView&&leads.length>0 ? (
            <Table className="dashboard-activity-table"><TableHeader><TableRow><TableHead>Request</TableHead><TableHead>Property</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead></TableRow></TableHeader><TableBody>
              {leads.slice(0,4).map(lead=><TableRow key={lead.publicId}><TableCell><span className="activity-table-kind"><CalendarClock size={14}/>{lead.type==='viewing'?'Viewing':lead.type==='offer'?'Offer':'Question'}</span></TableCell><TableCell><span className="activity-table-property" title={lead.listingTitle}>{lead.listingTitle}</span></TableCell><TableCell><StatusPill value={lead.status}/></TableCell><TableCell><span className="activity-table-date">{dateLabel(lead.createdAt)}</span></TableCell></TableRow>)}
            </TableBody></Table>
          ) : leads.slice(0,4).map(lead=><div className="activity-row" key={lead.publicId}><span className="activity-icon"><CalendarClock size={16}/></span><span><b>{lead.type==='viewing'?'Viewing request':lead.type==='offer'?'Offer received':'Property question'}</b><small>{lead.listingTitle} · {dateLabel(lead.createdAt)}</small></span><StatusPill value={lead.status}/></div>)}
          {!leads.length&&!deals.length&&<p className="inline-empty">Activity will appear when you receive enquiries or create a deal workspace.</p>}
          <button className="btn btn-outline btn-block" onClick={onOpenMessages}>Open conversations <MessageCircle size={15}/></button>
        </div>
      </div>
      <div className="notice-banner"><ShieldCheck size={20}/><div><b>Independent verification still matters.</b><p>Use official land administration channels for parcel identity, ownership and transfer requirements. Platform records do not replace a title, notary or regulator.</p></div><a href="https://support.irembo.gov.rw/en/support/solutions/articles/47001210595-how-to-apply-for-title-transfer-voluntary-sale-" target="_blank" rel="noreferrer">Official guidance <ArrowUpRight size={14}/></a></div>
    </section>
  );
}
