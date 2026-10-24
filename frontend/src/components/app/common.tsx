import type { ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, Bell, CalendarClock, CircleAlert, MessageCircle, Search, ShieldCheck, WalletCards, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { prettyStage } from '@/lib/property-format';

export function ErrorNote({text,onClose}:{text:string;onClose:()=>void}) {
  if(!text) return null;
  return <div className="toast" role="status"><CircleAlert size={18}/><span>{text}</span><button onClick={onClose} aria-label="Dismiss"><X size={17}/></button></div>;
}
export function EmptyState({icon:Icon=Search,title,body,action,button}:{icon?:LucideIcon;title:string;body:string;action?:()=>void;button?:string}) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={24}/></span><h3>{title}</h3><p>{body}</p>{action&&button&&<button className="btn btn-primary" onClick={action}>{button}<ArrowRight size={16}/></button>}</div>;
}

export function Field({label,children,wide=false}:{label:string;children:ReactNode;wide?:boolean}) {
  return <Label className={'field '+(wide?'field-wide':'')}><span>{label}</span>{children}</Label>;
}
export function Metric({icon:Icon,label,value,detail}:{icon:LucideIcon;label:string;value:number|string;detail:string}) {
  return <div className="metric-card"><span className="metric-icon"><Icon size={18}/></span><div><small>{label}</small><strong>{value}</strong><span>{detail}</span></div><ArrowUpRight className="metric-arrow" size={15}/></div>;
}
export function NotificationIcon({type}:{type:string}) {
  if(type==='message'||type==='conversation')return <MessageCircle size={18}/>;
  if(type==='listing_review'||type==='agent_review')return <ShieldCheck size={18}/>;
  if(type==='lead'||type==='lead_status')return <CalendarClock size={18}/>;
  if(type==='deal'||type==='deal_stage'||type==='fee_acceptance')return <WalletCards size={18}/>;
  return <Bell size={18}/>;
}
export function StatusPill({value}:{value:string}) {
  const type=['published','completed','active','approve','approved','reviewed','accepted','contacted'].includes(value)?'good':['pending_review','proposed','open','viewing','offer','due_diligence','agreement','changes_requested'].includes(value)?'waiting':['rejected','cancelled','declined','withdrawn'].includes(value)?'bad':'neutral';
  const variant = type==='good'?'success':type==='waiting'?'warning':type==='bad'?'destructive':'neutral';
  return <Badge variant={variant} className={'status-pill '+type}><i/>{prettyStage(value)}</Badge>;
}
