import { Check, CheckCircle2, LockKeyhole, ShieldCheck, WalletCards } from 'lucide-react';
import type { Deal } from '@/api';
import { EmptyState, StatusPill } from '@/components/app/common';
import { dateLabel, prettyStage } from '@/lib/property-format';

const stages = ['proposed','viewing','offer','due_diligence','agreement','completed','cancelled'] as const;
const transitions:Record<string,string[]> = {
  proposed:['viewing','cancelled'],
  viewing:['offer','cancelled'],
  offer:['due_diligence','agreement','cancelled'],
  due_diligence:['agreement','cancelled'],
  agreement:['completed','cancelled'],
  completed:[],
  cancelled:[],
};
const nextStages = (stage:string) => transitions[stage] || [];

export function DealWorkspaceView({
  deals, userId, busy, onAcceptFee, onUpdateStage, onFindProperty,
}:{
  deals:Deal[];
  userId?:string;
  busy:boolean;
  onAcceptFee:(deal:Deal)=>void;
  onUpdateStage:(deal:Deal,stage:string)=>void;
  onFindProperty:()=>void;
}) {
  return (
    <section className="view-content">
      <div className="deal-intro"><span><WalletCards size={21}/></span><div><b>Deal workspaces keep the story together.</b><p>Create a record, write the fee terms plainly, get each party's acknowledgement and update milestones as the deal progresses. Don't hold client funds in this app.</p></div></div>
      {deals.length ? (
        <div className="deal-list">
          {deals.map(deal=>{
            const acceptedByMe=deal.feeAcceptedBy?.includes(userId||'')||false;
            const completionByMe=deal.completionConfirmedBy?.includes(userId||'')||false;
            return <article className="panel deal-card" key={deal.publicId}>
              <div className="deal-top"><div><span className="deal-label">DEAL WORKSPACE / {deal.publicId.slice(0,8).toUpperCase()}</span><h3>{deal.listingTitle}</h3><p>Opened {dateLabel(deal.updatedAt)}</p></div><StatusPill value={deal.stage}/></div>
              <div className="deal-facts">
                <div><small>Agreed commission proposal</small><b>{deal.commissionPercent}%</b></div>
                <div><small>Fee acknowledgements</small><b>{deal.feeAcceptedBy?.length||0} / {deal.participants?.length||2} parties</b></div>
                <div><small>Milestones logged</small><b>{deal.history?.length||0}</b></div>
              </div>
              <div className="deal-progress">{stages.slice(0,6).map((stage,i)=><div className={'deal-step '+(deal.stage!=='cancelled'&&stages.indexOf(deal.stage as typeof stages[number])>=i?'done':'')} key={stage}><i>{stages.indexOf(deal.stage as typeof stages[number])>i?<Check size={12}/>:i+1}</i><span>{prettyStage(stage)}</span></div>)}</div>
              <div className="commission-terms"><b>Commission terms</b><p>{deal.commissionTerms}</p><div className="accept-row"><span>{acceptedByMe?'You acknowledged these terms':'Your acknowledgement is not yet recorded.'}</span><button className="btn btn-outline btn-sm" disabled={acceptedByMe||busy||['completed','cancelled'].includes(deal.stage)} onClick={()=>onAcceptFee(deal)}>{acceptedByMe?'Accepted':'Acknowledge terms'}<CheckCircle2 size={14}/></button></div></div>
              {deal.stage==='agreement'&&<div className="completion-confirmation"><ShieldCheck size={18}/><div><b>{completionByMe?'Your completion confirmation is saved':deal.completionConfirmedBy?.length?'The other participant has confirmed completion':'Both participants must confirm completion'}</b><p>{completionByMe?'Waiting for the other participant. This deal remains open until they confirm.':deal.completionConfirmedBy?.length?'Confirm the completion milestone to close this record.':'Marking a deal complete now requires two separate account confirmations.'}</p></div></div>}
              <div className="stage-control"><label>Update milestone<select value={deal.stage} onChange={e=>onUpdateStage(deal,e.target.value)} disabled={nextStages(deal.stage).length===0}><option value={deal.stage}>{prettyStage(deal.stage)} (current)</option>{nextStages(deal.stage).filter(stage=>stage!=='completed'||!completionByMe).map(stage=><option key={stage} value={stage}>{stage==='completed'?'Confirm completion':prettyStage(stage)}</option>)}</select></label><span>Changes are timestamped in the API history.</span></div>
              {deal.history?.length>0&&<details className="history-details"><summary>View activity history</summary>{deal.history.map((h,i)=><div key={i} className="history-item"><i/><span><b>{prettyStage(h.stage)}</b><small>{dateLabel(h.at)} · {h.note||'Milestone updated'}</small></span></div>)}</details>}
            </article>;
          })}
        </div>
      ) : (
        <EmptyState icon={WalletCards} title="No deals yet" body="Open a published property, choose “Propose deal”, and record the commission terms discussed by the parties." action={onFindProperty} button="Find a property"/>
      )}
      <div className="compliance-note"><LockKeyhole size={17}/><span>Fee acceptance is an application record. It does not replace legal advice, a signed contract, regulated payment handling or official land-transfer steps.</span></div>
    </section>
  );
}
