import type { FormEventHandler, Dispatch, SetStateAction } from 'react';
import { ArrowRight, BadgeCheck, CalendarClock, CheckCircle2, FileCheck2, LockKeyhole, MessageCircle, RefreshCw, ShieldCheck, Sparkles, UserCircle, Users, X } from 'lucide-react';
import { Agent, AgentApplication } from '@/api';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState, Field, StatusPill } from '@/components/app/common';
import { Reveal } from '@/components/app/reveal';
import { dateLabel } from '@/lib/property-format';

export type AgentApplicationForm = {
  phone: string;
  bio: string;
  experienceYears: string;
  districts: string[];
  showPhone: boolean;
};

type AgentDecision = 'approve' | 'reject' | 'request_changes';

export function AgentDirectoryView({
  agents, loading, search, busy, onRefresh, onBecomeAgent, onClearSearch,
}: {
  agents: Agent[];
  loading: boolean;
  search: string;
  busy: boolean;
  onRefresh: () => void;
  onBecomeAgent: () => void;
  onClearSearch: () => void;
}) {
  const visible = agents.filter(agent => !search || [agent.name, agent.bio, ...agent.districts].join(' ').toLowerCase().includes(search.toLowerCase()));
  return (
    <section className="view-content">
      <div className="agent-directory-banner">
        <div className="agent-directory-icon"><Users size={25}/></div>
        <div><b>Professional property support, with disclosed experience.</b><p>Only profiles approved by the platform team appear in this directory. A profile review is not a government licence or a guarantee of performance.</p></div>
        <div className="agent-banner-actions">
          <button className="btn btn-outline" onClick={onRefresh} disabled={busy}><RefreshCw size={15}/>Refresh</button>
          <button className="btn btn-primary" onClick={onBecomeAgent}>Become an agent <ArrowRight size={15}/></button>
        </div>
      </div>
      {loading ? (
        <div className="agent-directory-grid" aria-label="Loading approved agent profiles">
          {[0,1,2].map(index => <Card className="panel agent-profile-card agent-profile-skeleton" key={index}>
            <div className="agent-card-top"><Skeleton className="h-11 w-11 rounded-xl"/><Skeleton className="h-5 w-16 rounded-full"/></div>
            <Skeleton className="mt-4 h-4 w-2/3"/><Skeleton className="mt-3 h-3 w-1/2"/>
            <Skeleton className="mt-5 h-3 w-full"/><Skeleton className="mt-2 h-3 w-5/6"/><Skeleton className="mt-2 h-3 w-4/5"/>
            <div className="mt-5 flex gap-2"><Skeleton className="h-6 w-16 rounded"/><Skeleton className="h-6 w-20 rounded"/></div>
            <Skeleton className="mt-5 h-8 w-full rounded"/>
          </Card>)}
        </div>
      ) : visible.length ? (
        <div className="agent-directory-grid">
          {visible.map(agent => <Reveal className="agent-profile-reveal" key={agent.publicId}>
            <article className="panel agent-profile-card">
              <div className="agent-card-top"><span className="agent-avatar"><UserCircle size={27}/></span><StatusPill value="approved"/></div>
              <h3>{agent.name}</h3>
              <div className="agent-experience"><BadgeCheck size={14}/>{agent.experienceYears} years of experience stated</div>
              <p>{agent.bio}</p>
              <div className="agent-districts">{agent.districts.map(d => <span key={d}>{d}</span>)}</div>
              <div className="agent-card-footer">{agent.contactPhone ? <a className="btn btn-outline" href={'tel:'+agent.contactPhone}><MessageCircle size={15}/>Contact agent</a> : <span className="muted-copy">Agent has not shared a public phone number.</span>}<small>Updated {dateLabel(agent.updatedAt)}</small></div>
            </article>
          </Reveal>)}
        </div>
      ) : (
        <EmptyState icon={Users} title="No approved agents match" body={agents.length ? 'Change the search terms to find a professional in another area.' : 'The approved directory is empty while the first agent profiles await review.'} action={() => { onClearSearch(); onBecomeAgent(); }} button="Apply to join the directory"/>
      )}
    </section>
  );
}

export function AgentApplicationView({
  application, form, setForm, districts, busy, onSubmit, onViewDirectory,
}: {
  application: AgentApplication | null;
  form: AgentApplicationForm;
  setForm: Dispatch<SetStateAction<AgentApplicationForm>>;
  districts: string[];
  busy: boolean;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onViewDirectory: () => void;
}) {
  return (
    <section className="view-content form-layout">
      <form className="panel editor-panel" onSubmit={onSubmit}>
        <div className="panel-heading"><div><h3>Professional agent profile</h3><p>Give prospective clients accurate information about your experience and service area.</p></div><span className="step-count">AGENT / 01</span></div>
        {application && <div className="application-status"><div><b>Latest application status</b><small>Submitted {dateLabel(application.createdAt)}</small></div><StatusPill value={application.status}/></div>}
        {application?.reviewNote && <div className="review-explainer"><FileCheck2 size={17}/><div><b>Reviewer feedback</b><p>{application.reviewNote}</p></div></div>}
        {application?.status === 'approved' ? (
          <EmptyState icon={BadgeCheck} title="Your agent profile is approved" body="Your public profile is visible in the agent directory. Contact support if you need to change the public details." action={onViewDirectory} button="View agent directory"/>
        ) : application?.status === 'pending_review' ? (
          <EmptyState icon={CalendarClock} title="Your application is awaiting review" body="The public directory will show your profile only after the review team approves it." action={onViewDirectory} button="Preview agent directory"/>
        ) : (
          <>
            <div className="form-grid">
              <Field label="Phone number for review"><Input required minLength={7} maxLength={40} value={form.phone} onChange={e => setForm(previous => ({...previous, phone:e.target.value}))} placeholder="+250…"/></Field>
              <Field label="Years of experience"><Input required type="number" min="0" max="60" step="1" value={form.experienceYears} onChange={e => setForm(previous => ({...previous, experienceYears:e.target.value}))}/></Field>
              <Field label="Professional biography" wide><Textarea required minLength={50} maxLength={1200} rows={5} value={form.bio} onChange={e => setForm(previous => ({...previous, bio:e.target.value}))} placeholder="Describe your property experience, professional approach, local knowledge and how you help buyers or sellers make informed decisions."/><small className="field-help">{form.bio.length}/1200 characters. Do not claim a licence, verification or qualification you do not hold.</small></Field>
              <div className="field field-wide"><span>Service districts</span><div className="district-picker">{districts.map(d => <label key={d} className="district-option"><input type="checkbox" checked={form.districts.includes(d)} onChange={e => setForm(previous => ({...previous, districts:e.target.checked ? Array.from(new Set([...previous.districts,d])) : previous.districts.filter(x => x !== d)}))}/><span>{d}</span></label>)}</div><small className="field-help">Select between 1 and 8 districts where you can realistically serve clients. Selected: {form.districts.length}/8</small></div>
              <label className="public-phone-option"><input type="checkbox" checked={form.showPhone} onChange={e => setForm(previous => ({...previous, showPhone:e.target.checked}))}/><span><b>Show my phone in the public directory</b><small>By opting in, you consent to displaying this number on your approved public profile. Otherwise, it stays private to the application review.</small></span></label>
            </div>
            <div className="review-explainer"><LockKeyhole size={18}/><div><b>Review is not a government licence</b><p>Submitting this form does not grant agent credentials. Platform staff will review it before the profile appears. Provide only information you are comfortable sharing with the review team.</p></div></div>
            <div className="form-footer"><span>By submitting, you confirm the profile is accurate and that you have permission to share the phone number.</span><button className="btn btn-primary" disabled={busy || form.districts.length < 1 || form.districts.length > 8} type="submit">{busy?'Submitting…':'Submit agent application'}<ArrowRight size={16}/></button></div>
          </>
        )}
      </form>
      <aside className="panel side-checklist"><div className="checklist-icon"><ShieldCheck size={22}/></div><h3>What reviewers look for</h3><p>Quality and honesty matter more than marketing claims.</p>{['A clear, specific professional biography','Realistic service areas and contact details','Accurate experience claims','Consent before publishing a phone number','Willingness to record fee terms and deal milestones'].map((x,i)=><div className="checklist-item" key={x}><span>{i+1}</span>{x}</div>)}<div className="tip-box"><Sparkles size={16}/><span>Only approved profiles appear in the public directory. Approval does not establish legal qualifications or guarantee a transaction.</span></div></aside>
    </section>
  );
}

export function AgentReviewQueue({
  userRole, pending, busy, notes, onNoteChange, onReview, onRefresh,
}: {
  userRole?: string;
  pending: AgentApplication[];
  busy: boolean;
  notes: Record<string,string>;
  onNoteChange: (id:string,value:string) => void;
  onReview: (item:AgentApplication,decision:AgentDecision) => void;
  onRefresh: () => void;
}) {
  return (
    <section className="view-content">
      {userRole !== 'admin' ? (
        <EmptyState icon={LockKeyhole} title="Administrator access required" body="Agent applications contain private contact information and can only be reviewed by an administrator."/>
      ) : pending.length ? (
        <div className="admin-list">
          {pending.map(app => <article className="panel agent-review-card" key={app.publicId}>
            <div className="agent-review-head"><span className="agent-avatar"><UserCircle size={27}/></span><div><span className="deal-label">AGENT APPLICATION / {app.publicId.slice(0,8).toUpperCase()}</span><h3>{app.name}</h3><small>{app.experienceYears} years experience stated · Submitted {dateLabel(app.createdAt)}</small></div><StatusPill value={app.status}/></div>
            <div className="agent-review-details"><div><small>Private phone for review</small><b>{app.phone}</b><span>{app.showPhone ? 'Applicant consents to public display if approved.' : 'Keep phone private if approved.'}</span></div><div><small>Selected service districts</small><div className="agent-districts">{app.districts.map(d => <span key={d}>{d}</span>)}</div></div></div>
            <p className="agent-review-bio">{app.bio}</p>
            <label className="field-label">Decision note<textarea rows={2} value={notes[app.publicId]||''} onChange={e=>onNoteChange(app.publicId,e.target.value)} placeholder="Explain what was reviewed or what needs correction."/></label>
            <div className="review-actions"><button className="btn btn-primary" disabled={busy} onClick={()=>onReview(app,'approve')}><CheckCircle2 size={15}/>Approve profile</button><button className="btn btn-outline" disabled={busy} onClick={()=>onReview(app,'request_changes')}>Request changes</button><button className="btn btn-danger" disabled={busy} onClick={()=>onReview(app,'reject')}>Reject</button></div>
            <p className="review-caution"><ShieldCheck size={14}/>Approval publishes the profile on this platform. It does not certify a government licence or guarantee professional performance.</p>
          </article>)}
        </div>
      ) : (
        <EmptyState icon={Users} title="No agent applications pending" body="New professional profile applications will appear here after users submit them." action={onRefresh} button="Refresh applications"/>
      )}
    </section>
  );
}
