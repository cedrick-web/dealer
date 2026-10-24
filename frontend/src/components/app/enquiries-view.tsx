import { CalendarClock, ClipboardList, MapPin, MessageCircle, RefreshCw } from 'lucide-react';
import type { Lead } from '@/api';
import { Button } from '@/components/ui/button';
import { EmptyState, StatusPill } from '@/components/app/common';
import { dateLabel, prettyStage } from '@/lib/property-format';

export type LeadStatusChange = 'contacted'|'accepted'|'declined'|'completed'|'cancelled';

export function EnquiriesView({
  leads, userId, busy, onOpenConversation, onUpdateStatus, onRefresh, onExplore,
}:{
  leads:Lead[];
  userId?:string;
  busy:boolean;
  onOpenConversation:(lead:Lead)=>void;
  onUpdateStatus:(lead:Lead,status:LeadStatusChange)=>void;
  onRefresh:()=>void;
  onExplore:()=>void;
}) {
  return (
    <section className="view-content enquiries-view">
      <div className="enquiry-toolbar">
        <div><span className="count-pill">{leads.length} total</span><span className="notifications-caption">Every status update is logged and notifies the other participant.</span></div>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={busy}><RefreshCw size={14}/>Refresh</Button>
      </div>
      {leads.length ? (
        <div className="enquiry-list">
          {leads.map(lead=>{
            const isOwner=lead.ownerId===userId;
            const isRequester=lead.requesterId===userId;
            const ownerNext:LeadStatusChange[]=lead.status==='open'?['contacted','accepted','declined']:lead.status==='contacted'?['accepted','declined']:lead.status==='accepted'?['completed']:[];
            const requesterCanCancel=isRequester&&['open','contacted','accepted'].includes(lead.status);
            return <article className="panel enquiry-card" key={lead.publicId}>
              <div className="enquiry-card-head"><span className="enquiry-kind"><CalendarClock size={16}/>{prettyStage(lead.type)}</span><StatusPill value={lead.status}/></div>
              <h3>{lead.listingTitle}</h3>
              <div className="enquiry-metadata"><span><MapPin size={13}/>{isOwner?'Your property':'Property enquiry'}</span><span>{dateLabel(lead.createdAt)}</span>{lead.preferredAt&&<span><CalendarClock size={13}/>{new Date(lead.preferredAt).toLocaleString()}</span>}</div>
              <p className="enquiry-message">{lead.message||'No message provided.'}</p>
              <div className="enquiry-actions">
                <button className="btn btn-outline btn-sm" onClick={()=>onOpenConversation(lead)} disabled={busy}><MessageCircle size={14}/>Open conversation</button>
                {isOwner&&ownerNext.map(next=><button key={next} className={next==='declined'?'btn btn-danger btn-sm':'btn btn-primary btn-sm'} disabled={busy} onClick={()=>onUpdateStatus(lead,next)}>{next==='contacted'?'Mark contacted':next==='accepted'?'Accept request':next==='declined'?'Decline':'Mark completed'}</button>)}
                {requesterCanCancel&&<button className="btn btn-danger btn-sm" disabled={busy} onClick={()=>onUpdateStatus(lead,'cancelled')}>Cancel request</button>}
              </div>
              {isRequester&&lead.status==='declined'&&<p className="enquiry-status-note">The property owner declined this enquiry. The conversation remains available for clarification.</p>}
              {isOwner&&!ownerNext.length&&<p className="enquiry-status-note">This enquiry is closed for status changes. You can still use the conversation to refer back to the discussion.</p>}
            </article>;
          })}
        </div>
      ) : (
        <EmptyState icon={ClipboardList} title="No enquiries yet" body="Viewing requests, questions and offers from published property listings will appear here, with separate controls for owners and requesters." action={onExplore} button="Explore properties"/>
      )}
    </section>
  );
}
