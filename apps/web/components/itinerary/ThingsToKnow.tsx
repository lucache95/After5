// "Things to know" panel — derived from the itinerary's stops + totals.
// Airbnb-style strip of 3-4 practical notes (reservations, getting around,
// timing, weather backup) so the user knows what to expect before saving.

import { CalendarCheck, Car, Clock, Cloud, Wallet } from 'lucide-react';
import type { Itinerary } from '@/lib/itinerary-types';

interface KnowNote {
  icon: typeof CalendarCheck;
  title: string;
  body: string;
}

const OUTDOOR_TYPES = new Set([
  'hike',
  'viewpoint',
  'sunset_spot',
  'beach',
  'park',
  'garden',
  'walk',
]);

function deriveNotes(itinerary: Itinerary): KnowNote[] {
  const notes: KnowNote[] = [];

  // 1. Reservations — call out which stops require a booking.
  const reservationStops = itinerary.stops.filter((s) => s.reservation_required);
  if (reservationStops.length > 0) {
    const names = reservationStops.map((s) => s.place_name).join(', ');
    notes.push({
      icon: CalendarCheck,
      title:
        reservationStops.length === 1 ? 'Book ahead' : `Book ${reservationStops.length} stops`,
      body: `${names} ${reservationStops.length === 1 ? 'fills up — reserve before you head out' : 'all need reservations — lock them in earlier in the week'}.`,
    });
  }

  // 2. Outdoor stop → weather backup
  const outdoor = itinerary.stops.find(
    (s) => s.place_type && OUTDOOR_TYPES.has(s.place_type),
  );
  if (outdoor) {
    notes.push({
      icon: Cloud,
      title: 'Check the sky',
      body: `${outdoor.place_name} is outdoors. If it's raining or smoky, swap it for a quick coffee stop or skip ahead to the next place.`,
    });
  }

  // 3. Driving — Kelowna is car-first; flag if stops span neighborhoods.
  const neighborhoods = new Set(itinerary.stops.map((s) => s.neighborhood).filter(Boolean));
  if (neighborhoods.size > 1) {
    notes.push({
      icon: Car,
      title: 'Plan the drive',
      body: `You'll cross ${neighborhoods.size} neighbourhoods. Driver picks the playlist; the other person picks the after-stop snack.`,
    });
  }

  // 4. Cost expectation
  if (itinerary.total_cost_pp >= 80) {
    notes.push({
      icon: Wallet,
      title: 'Bring a card',
      body: `Mid-range estimate is $${Math.round(itinerary.total_cost_pp)} per person — most stops here are tap-to-pay. Cash isn't required anywhere on this route.`,
    });
  }

  // 5. Late-night fallback if total > 4hr
  if (itinerary.total_duration_min >= 240) {
    notes.push({
      icon: Clock,
      title: 'Pace it',
      body: `This is a ${Math.round(itinerary.total_duration_min / 60)}-hour night. If you're flagging, drop the last stop — the route still lands.`,
    });
  }

  return notes.slice(0, 4);
}

export function ThingsToKnow({ itinerary }: { itinerary: Itinerary }) {
  const notes = deriveNotes(itinerary);
  if (notes.length === 0) return null;

  return (
    <section id="know" className="scroll-mt-24">
      <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-muted">
        Things to know
      </p>
      <h2 className="font-display text-2xl font-bold tracking-[-0.01em] text-text md:text-3xl">
        Before you <em className="font-display font-semibold not-italic text-accent" style={{ fontStyle: 'italic' }}>head out.</em>
      </h2>
      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
        {notes.map((n) => (
          <div
            key={n.title}
            className="flex items-start gap-4 rounded-card border border-border bg-background p-5"
          >
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-text">
              <n.icon className="h-4 w-4" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <p className="font-display text-base font-semibold leading-snug text-text">
                {n.title}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-secondary">{n.body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
