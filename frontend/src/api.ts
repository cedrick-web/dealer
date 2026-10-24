const API = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || 'http://localhost:8080';
const TOKEN_KEY = 'dealer.session.v1';

export type User = { publicId: string; name: string; email: string; phone?: string; role: 'member' | 'agent' | 'admin'; status?: string };
export type Listing = {
  publicId: string; ownerId?: string; title: string; description: string; propertyType: 'house'|'apartment'|'land'|'commercial'|'room';
  purpose: 'sale'|'rent'; location: { district: string; sector?: string }; price: { amount: number; currency?: string; period?: string };
  status?: string; reviewNote?: string; reviewedBy?: string; verification?: { status: string; checks?: unknown[] }; createdAt?: string;
};
export type Lead = { publicId: string; listingId: string; listingTitle: string; ownerId: string; requesterId: string; type: string; message?: string; preferredAt?: string; status: string; createdAt: string };
export type Conversation = { publicId: string; listingId: string; listingTitle: string; participants: string[]; ownerId: string; lastMessage?: string; updatedAt: string };
export type Message = { publicId: string; conversationId: string; senderId: string; text: string; createdAt: string };
export type Deal = {
  publicId: string; listingId: string; listingTitle: string; participants: string[]; commissionPercent: number; commissionTerms: string;
  feeAcceptedBy: string[]; stage: string; history: { stage: string; actorId: string; at: string; note?: string }[]; updatedAt: string;
};
export type EvidenceDocument = { publicId: string; listingId: string; fileName: string; contentType: string; sizeBytes: number; createdAt: string; reviewStatus: string };
export type ApiResult<T> = { data: T; [key: string]: unknown };
export type Agent = { publicId:string; name:string; bio:string; districts:string[]; experienceYears:number; contactPhone?:string|null; updatedAt:string };
export type AgentApplication = { publicId:string; userId:string; name:string; phone:string; showPhone:boolean; bio:string; districts:string[]; experienceYears:number; status:string; reviewNote?:string; createdAt:string; updatedAt:string };
export type AppNotification = { publicId:string; type:string; title:string; body:string; destination:string; subjectId?:string|null; readAt?:string|null; createdAt:string };


let sessionToken = localStorage.getItem(TOKEN_KEY) || '';
export function setSessionToken(token: string) { sessionToken = token; if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY); }
export function getSessionToken() { return sessionToken; }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (sessionToken) headers.set('Authorization', 'Bearer ' + sessionToken);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  let response: Response;
  try { response = await fetch(API + path, { ...init, headers }); }
  catch { throw new Error('Cannot reach the API. Start Docker services and check VITE_API_URL.'); }
  const type = response.headers.get('content-type') || '';
  const payload: any = type.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(typeof payload === 'object' && payload?.error ? payload.error : 'Request failed (' + response.status + ').');
  return payload as T;
}
const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
export const api = {
  health: () => request<{status:string;service:string;database:string}>('/health'),
  districts: () => request<ApiResult<string[]>>('/api/v1/districts'),
  agents: () => request<ApiResult<Agent[]>>('/api/v1/agents'),
  myAgentProfile: () => request<{data:AgentApplication|null}>('/api/v1/me/agent-profile'),
  applyForAgent: (input:{phone:string;bio:string;experienceYears:number;districts:string[];showPhone:boolean}) => request<{data:AgentApplication;message:string}>('/api/v1/agents/apply', json(input)),
  adminPendingAgents: () => request<ApiResult<AgentApplication[]>>('/api/v1/admin/agents/pending'),
  adminReviewAgent: (id:string,decision:'approve'|'reject'|'request_changes',note:string) => request('/api/v1/admin/agents/' + encodeURIComponent(id) + '/review', {method:'PATCH',body:JSON.stringify({decision,note})}),
  listings: (params: Record<string,string> = {}) => {
    const query = new URLSearchParams(Object.entries(params).filter(([,v]) => Boolean(v)));
    const suffix = query.toString();
    return request<ApiResult<Listing[]> & {page:number;limit:number;total:number;hasMore:boolean}>('/api/v1/listings' + (suffix ? '?' + suffix : ''));
  },
  listing: (id:string) => request<ApiResult<Listing>>('/api/v1/listings/' + encodeURIComponent(id)),
  register: async (input:{name:string;email:string;password:string;phone?:string}) => {
    const data = await request<{token:string;user:User}>('/api/v1/auth/register', json(input));
    setSessionToken(data.token); return data.user;
  },
  login: async (input:{email:string;password:string}) => {
    const data = await request<{token:string;user:User}>('/api/v1/auth/login', json(input));
    setSessionToken(data.token); return data.user;
  },
  me: () => request<{user:User}>('/api/v1/auth/me').then(x => x.user),
  notifications: () => request<ApiResult<AppNotification[]> & {unreadCount:number}>('/api/v1/me/notifications?limit=100'),
  markNotificationRead: (id:string) => request('/api/v1/notifications/' + encodeURIComponent(id) + '/read', {method:'PATCH',body:JSON.stringify({})}),
  markAllNotificationsRead: () => request('/api/v1/me/notifications/read-all', json({})),
  myListings: () => request<ApiResult<Listing[]>>('/api/v1/me/listings'),
  createListing: (input:Partial<Listing>) => request<{id:string;status:string;message:string;evidenceHash:string}>('/api/v1/listings', json(input)),
  updateListing: (id:string,input:Partial<Listing>) => request<{id:string;status:string;message:string;evidenceHash:string}>('/api/v1/me/listings/' + encodeURIComponent(id), {method:'PATCH',body:JSON.stringify(input)}),
  withdrawListing: (id:string) => request<{id:string;status:string}>('/api/v1/me/listings/' + encodeURIComponent(id) + '/withdraw', json({})),
  favorites: () => request<ApiResult<{listingId:string;createdAt:string}[]>>('/api/v1/me/favorites'),
  saveFavorite: (id:string) => request('/api/v1/favorites/' + encodeURIComponent(id), {method:'PUT'}),
  removeFavorite: (id:string) => request('/api/v1/favorites/' + encodeURIComponent(id), {method:'DELETE'}),
  createLead: (input:{listingId:string;type:'viewing'|'question'|'offer';message:string;preferredAt?:string}) => request<ApiResult<Lead>>('/api/v1/leads', json(input)),
  myLeads: () => request<ApiResult<Lead[]>>('/api/v1/me/leads'),
  conversations: () => request<ApiResult<Conversation[]>>('/api/v1/me/conversations'),
  openConversation: (listingId:string) => request<ApiResult<Conversation>>('/api/v1/conversations', json({listingId})),
  messages: (id:string) => request<ApiResult<Message[]>>('/api/v1/conversations/' + encodeURIComponent(id) + '/messages'),
  sendMessage: (id:string,text:string) => request<ApiResult<Message>>('/api/v1/conversations/' + encodeURIComponent(id) + '/messages', json({text})),
  deals: () => request<ApiResult<Deal[]>>('/api/v1/me/deals'),
  createDeal: (input:{listingId:string;commissionPercent:number;commissionTerms:string}) => request<ApiResult<Deal>>('/api/v1/deals', json(input)),
  updateDealStage: (id:string,stage:string,note:string) => request('/api/v1/deals/' + encodeURIComponent(id) + '/stage', {method:'PATCH',body:JSON.stringify({stage,note})}),
  acceptFee: (id:string) => request('/api/v1/deals/' + encodeURIComponent(id) + '/accept-fee', json({})),
  documents: (listingId:string) => request<ApiResult<EvidenceDocument[]>>('/api/v1/listings/' + encodeURIComponent(listingId) + '/documents'),
  uploadDocument: async (listingId:string,file:File) => {
    if (file.size > 8 * 1024 * 1024) throw new Error('Maximum file size is 8 MiB.');
    const base64 = await new Promise<string>((resolve,reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(new Error('Could not read this file.'));
      reader.readAsDataURL(file);
    });
    return request<{data:EvidenceDocument;sha256:string;note:string}>('/api/v1/listings/' + encodeURIComponent(listingId) + '/documents', json({fileName:file.name,contentType:file.type,base64}));
  },
  downloadDocument: async (id:string,fileName:string) => {
    const headers = new Headers(); if (sessionToken) headers.set('Authorization','Bearer ' + sessionToken);
    const response = await fetch(API + '/api/v1/documents/' + encodeURIComponent(id) + '/download', {headers});
    if (!response.ok) { let msg = 'Document download failed.'; try { msg = (await response.json()).error || msg; } catch {} throw new Error(msg); }
    const blob = await response.blob(), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  },
  verifyHash: (hash:string) => request<{exists:boolean;meaning:string}>('/api/v1/trust/verify/' + encodeURIComponent(hash)),
  adminPending: () => request<ApiResult<Listing[]>>('/api/v1/admin/listings/pending'),
  adminReview: (id:string,decision:'approve'|'reject'|'request_changes',note:string) => request('/api/v1/admin/listings/' + encodeURIComponent(id) + '/review', {method:'PATCH',body:JSON.stringify({decision,note})}),
};
