'use client';

// Sidebar actions on the itinerary detail page: Share, Download PDF,
// Add to Calendar, Open route in Maps. Lazy-loads react-pdf only when the
// user actually clicks Download so we don't pay the bundle cost upfront.

import { useState } from 'react';
import { Share2, Download, Calendar, MapPin, Check } from 'lucide-react';
import { downloadIcs } from '@/lib/calendar';
import type { Itinerary, Stop } from '@/lib/itinerary-types';

export function ItineraryActions({ itinerary }: { itinerary: Itinerary }) {
  const [copied, setCopied] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);

  const shareUrl =
    typeof window !== 'undefined' && itinerary.id
      ? `${window.location.origin}/plan/i/${itinerary.id}`
      : '';

  async function onShare() {
    if (!shareUrl) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({
          title: itinerary.title,
          text: `${itinerary.title} — a date plan from After5`,
          url: shareUrl,
        });
      } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      // user dismissed, no-op
    }
  }

  async function onDownloadPdf() {
    setPdfLoading(true);
    try {
      const [{ pdf }, { PlanPDFDocument }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('./PlanPDFDocument'),
      ]);
      const blob = await pdf(<PlanPDFDocument itinerary={itinerary} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeTitle = itinerary.title
        .replace(/[^a-z0-9]+/gi, '-')
        .toLowerCase()
        .slice(0, 40);
      a.download = `after5-${safeTitle}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setPdfLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onShare}
        className="flex w-full items-center justify-center gap-2 rounded-pill border border-border bg-background px-5 py-3 text-sm font-medium text-text transition-colors hover:border-text/40"
      >
        {copied ? (
          <>
            <Check className="h-4 w-4" strokeWidth={2} />
            Link copied
          </>
        ) : (
          <>
            <Share2 className="h-4 w-4" strokeWidth={2} />
            Share this plan
          </>
        )}
      </button>

      <button
        type="button"
        onClick={onDownloadPdf}
        disabled={pdfLoading}
        className="flex w-full items-center justify-center gap-2 rounded-pill border border-border bg-background px-5 py-3 text-sm font-medium text-text transition-colors hover:border-text/40 disabled:opacity-60"
      >
        <Download className="h-4 w-4" strokeWidth={2} />
        {pdfLoading ? 'Building PDF…' : 'Download PDF'}
      </button>

      <button
        type="button"
        onClick={() => downloadIcs(itinerary)}
        className="flex w-full items-center justify-center gap-2 rounded-pill border border-border bg-background px-5 py-3 text-sm font-medium text-text transition-colors hover:border-text/40"
      >
        <Calendar className="h-4 w-4" strokeWidth={2} />
        Add to calendar
      </button>

      <a
        href={mapsRouteUrl(itinerary.stops)}
        target="_blank"
        rel="noopener noreferrer"
        className="flex w-full items-center justify-center gap-2 rounded-pill bg-primary px-5 py-3 text-sm font-medium text-background transition-opacity hover:opacity-85"
      >
        <MapPin className="h-4 w-4" strokeWidth={2} />
        Open route in Maps
      </a>
    </div>
  );
}

function mapsRouteUrl(stops: Stop[]): string {
  const encoded = stops.map((s) =>
    encodeURIComponent(`${s.place_name}, Kelowna BC`),
  );
  if (encoded.length === 0) return 'https://maps.google.com';
  if (encoded.length === 1)
    return `https://www.google.com/maps/search/?api=1&query=${encoded[0]}`;
  const origin = encoded[0];
  const destination = encoded[encoded.length - 1];
  const waypoints = encoded.slice(1, -1).join('|');
  const wp = waypoints ? `&waypoints=${waypoints}` : '';
  return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${wp}`;
}
