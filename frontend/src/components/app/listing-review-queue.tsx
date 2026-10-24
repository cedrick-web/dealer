import { CheckCircle2, ClipboardList, FileCheck2, LockKeyhole } from 'lucide-react';
import type { Listing } from '@/api';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/app/common';
import { PropertyImage } from '@/components/app/property-cards';
import { money } from '@/lib/property-format';

export type ListingReviewDecision = 'approve'|'request_changes'|'reject';

export function ListingReviewQueue({
  userRole, pending, busy, notes, onNoteChange, onReview, onOpenEvidence, onRefresh,
}:{
  userRole?:string;
  pending:Listing[];
  busy:boolean;
  notes:Record<string,string>;
  onNoteChange:(id:string,value:string)=>void;
  onReview:(listing:Listing,decision:ListingReviewDecision)=>void;
  onOpenEvidence:(listing:Listing)=>void;
  onRefresh:()=>void;
}) {
  return (
    <section className="view-content">
      {userRole!=='admin' ? (
        <EmptyState icon={LockKeyhole} title="Administrator access required" body="This queue is only available to an authenticated admin account."/>
      ) : pending.length ? (
        <div className="admin-list">
          {pending.map(item=><article className="panel review-card" key={item.publicId}>
            <PropertyImage item={item} variant="mini"/>
            <div className="review-body">
              <div className="listing-type">{item.propertyType} · {item.purpose}</div>
              <h3>{item.title}</h3>
              <p>{item.location.district}{item.location.sector?', '+item.location.sector:''} · {money(item.price.amount)}</p>
              <p className="review-description">{item.description}</p>
              <label className="field-label">Decision note<Textarea rows={2} value={notes[item.publicId]||''} onChange={e=>onNoteChange(item.publicId,e.target.value)} placeholder="Record what was checked, what is missing or what needs correction."/></label>
              <div className="review-actions">
                <button className="btn btn-outline" onClick={()=>onOpenEvidence(item)}><FileCheck2 size={15}/>Review evidence</button>
                <button className="btn btn-primary" onClick={()=>onReview(item,'approve')} disabled={busy}><CheckCircle2 size={15}/>Approve</button>
                <button className="btn btn-outline" onClick={()=>onReview(item,'request_changes')} disabled={busy}>Request changes</button>
                <button className="btn btn-danger" onClick={()=>onReview(item,'reject')} disabled={busy}>Reject</button>
              </div>
            </div>
          </article>)}
        </div>
      ) : (
        <EmptyState icon={ClipboardList} title="Review queue is clear" body="New submissions appear here when users send properties for review." action={onRefresh} button="Refresh queue"/>
      )}
    </section>
  );
}
