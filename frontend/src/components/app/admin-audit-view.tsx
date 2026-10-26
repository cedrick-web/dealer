import { useCallback, useEffect, useState } from 'react';
import { Activity, AlertCircle, CheckCircle2, Clock3, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { api, type AuditEvent } from '@/api';

const dateTime = (value?: string) => {
  if (!value) return 'Time not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const shortId = (value?: string) => value ? (value.length > 20 ? value.slice(0, 10) + '…' + value.slice(-7) : value) : '—';

export function AdminAuditView() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [eventType, setEventType] = useState('');
  const [draftType, setDraftType] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadedAt, setLoadedAt] = useState('');

  const load = useCallback(async (type = eventType) => {
    setLoading(true);
    setError('');
    try {
      const result = await api.adminAudit({ limit: 100, ...(type.trim() ? { type: type.trim() } : {}) });
      setEvents(Array.isArray(result.data) ? result.data : []);
      setLoadedAt(new Date().toISOString());
    } catch (cause) {
      setError((cause as Error).message || 'Could not load audit events.');
    } finally {
      setLoading(false);
    }
  }, [eventType]);

  useEffect(() => { void load(''); }, [load]);

  const submitFilter = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = draftType.trim();
    setEventType(next);
    void load(next);
  };

  return (
    <section className="view-content admin-audit-view" aria-labelledby="admin-audit-title">
      <div className="panel">
        <div className="panel-heading">
          <div>
            <div className="eyebrow"><ShieldCheck size={14} /> ADMIN OPERATIONS</div>
            <h2 id="admin-audit-title">Audit trail</h2>
            <p>Review recorded moderation decisions and evidence events. Audit entries are trace records, not proof of legal ownership or document authenticity.</p>
          </div>
          <button className="btn btn-outline btn-sm" type="button" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        <form className="toolbar toolbar-light" onSubmit={submitFilter}>
          <label className="wide-search">
            <Search size={16} />
            <input aria-label="Filter by exact event type" value={draftType} onChange={event => setDraftType(event.target.value)} placeholder="Filter by exact event type, e.g. document.reviewed" />
          </label>
          <button className="btn btn-primary btn-sm" type="submit" disabled={loading}>Apply filter</button>
          <button className="btn btn-outline btn-sm" type="button" disabled={loading && !eventType} onClick={() => { setDraftType(''); setEventType(''); void load(''); }}>Clear</button>
        </form>

        <div className="section-title-row">
          <div><h3>Recent events</h3><p>{loadedAt ? 'Last refreshed ' + dateTime(loadedAt) : 'Latest server-side audit records'}</p></div>
          <span className="count-pill">{events.length} {events.length === 1 ? 'event' : 'events'} · max 100</span>
        </div>

        {error && <div className="review-explainer" role="alert"><AlertCircle size={18} /><div><b>Audit feed unavailable</b><p>{error}</p><p>Confirm your admin session and API connection. Access is enforced by the server.</p></div></div>}
        {loading && <div className="empty-state"><RefreshCw size={22} className="animate-spin" /><h3>Loading audit events</h3><p>Fetching the latest records from the protected API.</p></div>}
        {!loading && !error && events.length === 0 && <div className="empty-state"><Activity size={22} /><h3>No matching audit events</h3><p>{eventType ? 'No events match this exact type filter.' : 'No audit events have been recorded yet.'}</p></div>}

        {!loading && !error && events.length > 0 && <div className="compare-table-wrap">
          <table className="compare-table admin-audit-table">
            <thead><tr><th scope="col">Event</th><th scope="col">Decision</th><th scope="col">Subject</th><th scope="col">Actor</th><th scope="col">Evidence digest</th><th scope="col">Recorded at</th></tr></thead>
            <tbody>{events.map((item, index) => <tr key={item.eventId || [item.type, item.subjectId, item.createdAt, index].join(':')}>
              <td><strong>{item.type}</strong>{item.note && <small className="audit-note">{item.note}</small>}</td>
              <td>{item.decision ? <span className="status-pill">{item.decision.replaceAll('_', ' ')}</span> : '—'}</td>
              <td><code title={item.subjectId || ''}>{shortId(item.subjectId)}</code></td>
              <td><code title={item.actorId || ''}>{shortId(item.actorId)}</code></td>
              <td>{item.evidenceHash ? <code title={item.evidenceHash}>{item.evidenceHash.slice(0, 12)}…</code> : '—'}</td>
              <td><span className="audit-time"><Clock3 size={13} />{dateTime(item.createdAt)}</span></td>
            </tr>)}</tbody>
          </table>
        </div>}

        <div className="review-explainer audit-integrity-note"><CheckCircle2 size={17} /><div><b>Privacy and integrity limits</b><p>This view displays only event metadata returned by the API. It does not expose stored file contents or storage paths. A SHA-256 digest can help compare file bytes, but cannot establish whether a document is genuine.</p></div></div>
      </div>
    </section>
  );
}
