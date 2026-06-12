// apps/web/lib/after5/notif-map.ts
// Pure (NO 'use client') per-type rendering map for the in-app notification
// surfaces (G, spec §4). Imported by both server components (badge seed) and
// client components (center, toast). Labels are lowercase stop-slop copy.
// hrefFor reads the jsonb payload defensively and NEVER returns '' (a bad href
// would break <Link>); it falls back to a safe in-app surface.
import {
  Heart, Clock, X, Undo2, ArrowUp, Sparkles, HeartHandshake, MessageCircle,
  CalendarCheck, Star, CalendarX, RefreshCw, ShieldCheck, ShieldAlert,
  User, Gavel, BadgeCheck, BadgeAlert, Scale, Flame, Eye, type LucideIcon,
} from 'lucide-react';
import type { Database } from '@after5/types';

export type NotificationType = Database['public']['Enums']['notification_type'];
export type NotifCategory = 'offers' | 'matches' | 'messages' | 'reminders' | 'account' | 'system';

type Payload = Record<string, unknown> | null | undefined;

function str(payload: Payload, key: string): string | null {
  if (payload && typeof payload === 'object' && key in payload) {
    const v = (payload as Record<string, unknown>)[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

export interface NotifMeta {
  label: string;
  Icon: LucideIcon;
  category: NotifCategory;
  hrefFor: (payload: Payload) => string;
}

const offerHref = (p: Payload) => { const o = str(p, 'offer_id'); return o ? `/offers/${o}` : '/feed'; };
const lockHref = (p: Payload) => { const l = str(p, 'lock_id'); return l ? `/matches/${l}` : '/matches'; };
// A host's interested-candidate list for one night (group key = date_instance_id).
const interestedHref = (p: Payload) => { const id = str(p, 'date_instance_id'); return id ? `/dates/${id}/interested` : '/my-nights'; };
// The night detail surface (used by cancel/material-change candidate notifications).
const instanceHref = (p: Payload) => { const id = str(p, 'date_instance_id'); return id ? `/dates/${id}` : '/feed'; };
const feed = () => '/feed';
const account = () => '/account';

export const NOTIF_META: Record<NotificationType, NotifMeta> = {
  offer_received:        { label: 'a date wants you in',          Icon: Heart,          category: 'offers',   hrefFor: offerHref },
  offer_expiring:        { label: "an offer's about to lapse",    Icon: Clock,          category: 'offers',   hrefFor: offerHref },
  offer_passed:          { label: 'they passed this time',        Icon: X,              category: 'system',   hrefFor: feed },
  offer_expired:         { label: 'an offer ran out',             Icon: Clock,          category: 'system',   hrefFor: feed },
  offer_withdrawn:       { label: 'a host pulled an offer',       Icon: Undo2,          category: 'offers',   hrefFor: feed },
  standby_promoted:      { label: "you're up next",               Icon: ArrowUp,        category: 'offers',   hrefFor: offerHref },
  new_match:             { label: "it's a match",                 Icon: Sparkles,       category: 'matches',  hrefFor: lockHref },
  reciprocal_detected:   { label: 'you both said yes',            Icon: HeartHandshake, category: 'system',   hrefFor: (p) => { const id = str(p, 'pair_id'); return id ? `/reciprocal/${id}` : '/matches'; } },
  new_message:           { label: 'new message',                  Icon: MessageCircle,  category: 'messages', hrefFor: () => '/matches' },
  date_reconfirm:        { label: "confirm you're still on",      Icon: CalendarCheck,  category: 'reminders',hrefFor: lockHref },
  rating_request:        { label: 'how was the date?',            Icon: Star,           category: 'reminders',hrefFor: lockHref },
  lock_cancelled_frozen: { label: 'a date was cancelled',         Icon: CalendarX,      category: 'system',   hrefFor: lockHref },
  lock_cancelled_rolled: { label: 'a date rolled to standby',     Icon: RefreshCw,      category: 'system',   hrefFor: lockHref },
  safety_checkin:        { label: 'checking you got home ok',     Icon: ShieldCheck,    category: 'system',   hrefFor: lockHref },
  safety_alert:          { label: 'safety alert',                 Icon: ShieldAlert,    category: 'system',   hrefFor: account },
  account:               { label: 'account update',               Icon: User,           category: 'account',  hrefFor: account },
  moderation_action:     { label: 'a moderation update',          Icon: Gavel,          category: 'account',  hrefFor: account },
  verification_passed:   { label: "you're verified",              Icon: BadgeCheck,     category: 'account',  hrefFor: account },
  verification_failed:   { label: 'verification needs another look', Icon: BadgeAlert,  category: 'account',  hrefFor: account },
  appeal_resolved:       { label: 'your appeal was reviewed',     Icon: Scale,          category: 'account',  hrefFor: account },
  interest_received:     { label: "someone's into your night",    Icon: Flame,          category: 'matches',  hrefFor: interestedHref },
  identity_revealed:     { label: 'you can see them now',         Icon: Eye,            category: 'matches',  hrefFor: lockHref },
  night_cancelled:       { label: 'a night you liked was cancelled', Icon: CalendarX,   category: 'reminders',hrefFor: instanceHref },
  night_changed:         { label: 'a night you liked changed',    Icon: RefreshCw,      category: 'reminders',hrefFor: instanceHref },
  // Pushy host-side timer (founder 2026-06-12): people are queued on your
  // night and you haven't picked — deep-links straight to the interested list.
  host_pick_nudge:       { label: 'people are waiting on your night', Icon: Clock,       category: 'reminders',hrefFor: interestedHref },
};

export const NOTIFICATION_TYPES = Object.keys(NOTIF_META) as NotificationType[];

// Unified-inbox grouped types (#84, spec §2). These two notification_type values
// are now enum-backed (shipped in 20260603120000_gated_inbox_notification_types.sql,
// surfaced once types regenerated) and have full meta in the enum-exhaustive
// NOTIF_META above. They remain named here because the inbox groups on them:
//   interest_received → grouped "someone's into your night" row; group key is
//     payload.date_instance_id; deep-links the host to that night's interested list.
//   identity_revealed → single "you can see them now" row; deep-links the lock.
export const GATED_INBOX_TYPES = ['interest_received', 'identity_revealed'] as const;

// Resolve render meta for any type string. Now that the inbox types are enum-backed
// they live in NOTIF_META; a quiet account row is the fallback so an unknown value
// (e.g. a future type whose meta hasn't landed) never crashes the inbox.
const ACCOUNT_FALLBACK: NotifMeta = { label: 'account update', Icon: User, category: 'account', hrefFor: account };

export function metaFor(type: string): NotifMeta {
  if (type in NOTIF_META) return NOTIF_META[type as NotificationType];
  return ACCOUNT_FALLBACK;
}

export function hrefForNotification(type: NotificationType, payload: Payload): string {
  return NOTIF_META[type].hrefFor(payload);
}
