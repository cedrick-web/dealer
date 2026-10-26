import { AlertCircle, CheckCircle2, Clock3, FilePenLine, RotateCcw, ShieldCheck, XCircle } from 'lucide-react';
import type { Listing } from '@/api';

const stateCopy: Record<string, { title: string; description: string; icon: typeof Clock3 }> = {
  pending_review: { title: 'Awaiting moderation', description: 'This listing is private until an administrator reviews the current version.', icon: Clock3 },
  changes_requested: { title: 'Changes requested', description: 'Read the reviewer note, update the listing, and resubmit it for another review.', icon: RotateCcw },
  rejected: { title: 'Not approved', description: 'The listing is not public. Review the decision note before making a revised submission.', icon: AlertCircle },
  published: { title: 'Published', description: 'This listing is currently visible to the public. Editing it will pause visibility until the revised version is reviewed.', icon: CheckCircle2 },
  withdrawn: { title: 'Withdrawn', description: 'This listing is no longer available in public search. Create a new listing if you need to advertise it again.', icon: XCircle },
};

export function ListingLifecycleNotice({
  listing, onEdit, onWithdraw, busy = false,
}: {
  listing: Listing;
  onEdit: (listing: Listing) => void;
  onWithdraw: (listing: Listing) => void;
  busy?: boolean;
}) {
  const status = listing.status || 'unknown';
  const state = stateCopy[status] || { title: status.replaceAll('_', ' '), description: 'Check the current listing status before taking further action.', icon: ShieldCheck };
  const Icon = state.icon;
  const canEdit = ['pending_review', 'changes_requested', 'rejected', 'published'].includes(status);
  const canWithdraw = ['pending_review', 'changes_requested', 'rejected', 'published'].includes(status);

  return (
    <div className="listing-lifecycle" aria-label={state.title}>
      <div className="listing-lifecycle-state">
        <Icon size={17} aria-hidden="true" />
        <div><strong>{state.title}</strong><p>{state.description}</p></div>
      </div>
      {listing.reviewNote?.trim() && <div className="listing-review-feedback"><b>Reviewer feedback</b><p>{listing.reviewNote}</p></div>}
      <div className="owner-card-actions">
        {canEdit && <button className="btn btn-outline btn-sm" type="button" disabled={busy} onClick={() => onEdit(listing)}><FilePenLine size={14}/>{status === 'rejected' || status === 'changes_requested' ? 'Correct & resubmit' : 'Edit & resubmit'}</button>}
        {canWithdraw && <button className="btn btn-danger btn-sm" type="button" disabled={busy} onClick={() => onWithdraw(listing)}><XCircle size={14}/>Withdraw</button>}
      </div>
    </div>
  );
}
