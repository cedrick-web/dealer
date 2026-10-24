import { ArrowUpRight, Bell, CalendarClock, Check, MessageCircle, ShieldCheck, WalletCards } from 'lucide-react';
import type { AppNotification } from '@/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { EmptyState } from '@/components/app/common';
import { dateLabel, prettyStage } from '@/lib/property-format';

function NotificationIcon({type}:{type:string}) {
  if(type==='message'||type==='conversation')return <MessageCircle size={18}/>;
  if(type==='listing_review'||type==='agent_review')return <ShieldCheck size={18}/>;
  if(type==='lead'||type==='lead_status')return <CalendarClock size={18}/>;
  if(type==='deal'||type==='deal_stage'||type==='fee_acceptance'||type==='deal_completion')return <WalletCards size={18}/>;
  return <Bell size={18}/>;
}

export function NotificationsView({
  notifications, unreadCount, busy, onMarkRead, onMarkAllRead, onExplore,
}:{
  notifications:AppNotification[];
  unreadCount:number;
  busy:boolean;
  onMarkRead:(item:AppNotification)=>void;
  onMarkAllRead:()=>void;
  onExplore:()=>void;
}) {
  return (
    <section className="view-content notifications-view">
      <Card className="notifications-toolbar">
        <div><span className="count-pill">{unreadCount} unread</span><span className="notifications-caption">Notifications stay attached to your account, not this device.</span></div>
        <Button variant="outline" size="sm" disabled={busy||unreadCount===0} onClick={onMarkAllRead}><Check size={14}/>Mark all read</Button>
      </Card>
      <Separator className="my-3"/>
      {notifications.length ? (
        <div className="notification-list">
          {notifications.map(item=><button className={'notification-card '+(!item.readAt?'unread':'')} key={item.publicId} onClick={()=>onMarkRead(item)}>
            <span className={'notification-icon '+item.type.replaceAll('_','-')}><NotificationIcon type={item.type}/></span>
            <span className="notification-copy">
              <span className="notification-top"><b>{item.title}</b><small>{dateLabel(item.createdAt)}</small></span>
              <p>{item.body}</p>
              <small className="notification-destination">{prettyStage(item.destination)} <ArrowUpRight size={12}/></small>
            </span>
            {!item.readAt&&<i className="unread-dot" aria-label="Unread"/>}
          </button>)}
        </div>
      ) : (
        <EmptyState icon={Bell} title="You're up to date" body="New viewing requests, messages, listing decisions and commission milestones will appear here." action={onExplore} button="Explore properties"/>
      )}
    </section>
  );
}
