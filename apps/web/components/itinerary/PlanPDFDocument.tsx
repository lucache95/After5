'use client';

// react-pdf document for After5 itineraries. Lazy-loaded by ItineraryActions
// so the ~600kb library only ships when the user clicks Download PDF.

import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { imageForStop } from '@/lib/place-image';
import { to12h } from '@/lib/format';
import type { Itinerary } from '@/lib/itinerary-types';

// Using react-pdf's built-in Helvetica (Helvetica-Bold). Tried Google-hosted
// custom fonts via Font.register() but gstatic.com blocks the fetch in some
// browser contexts and the whole PDF generation silently errored. Built-in
// fonts always work. Custom typography can come back via bundled font files.

const palette = {
  bg: '#FAFAF7',
  surface: '#F4F2EC',
  border: '#E5E3DD',
  muted: '#8B8884',
  secondary: '#6B6864',
  text: '#1A1A1A',
  accent: '#C2552B',
  accentSoft: '#F4E5DC',
  white: '#FFFFFF',
};

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: palette.text,
    backgroundColor: palette.bg,
    paddingTop: 36,
    paddingBottom: 36,
    paddingHorizontal: 36,
  },

  brandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    marginBottom: 22,
  },
  brand: { fontFamily: 'Helvetica-Bold', fontSize: 16, color: palette.text },
  brandRight: { fontSize: 9, color: palette.muted, letterSpacing: 1.2, textTransform: 'uppercase' },

  hero: {
    width: '100%',
    height: 220,
    objectFit: 'cover',
    borderRadius: 6,
    marginBottom: 18,
  },

  template: { fontSize: 9, color: palette.muted, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 },
  title: { fontFamily: 'Helvetica-Bold', fontSize: 26, lineHeight: 1.1, marginBottom: 10 },
  hook: { fontSize: 12, color: palette.secondary, lineHeight: 1.4, marginBottom: 18 },

  statsRow: {
    flexDirection: 'row',
    gap: 22,
    paddingTop: 14,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    marginBottom: 22,
  },
  statLabel: { fontSize: 8, color: palette.muted, letterSpacing: 1.5, textTransform: 'uppercase' },
  statValue: { fontFamily: 'Helvetica-Bold', fontSize: 18, marginTop: 3 },

  why: { fontSize: 11, lineHeight: 1.55, color: palette.secondary, marginBottom: 22 },

  sectionTitle: {
    fontSize: 8,
    color: palette.muted,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 12,
  },

  stop: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 16,
    padding: 12,
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 6,
  },
  stopImg: { width: 110, height: 90, objectFit: 'cover', borderRadius: 4 },
  stopBody: { flex: 1, gap: 4 },
  stopHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  stopTime: { fontSize: 9, color: palette.muted, letterSpacing: 0.6 },
  stopName: { fontFamily: 'Helvetica-Bold', fontSize: 14, color: palette.text },
  stopMeta: { fontSize: 9, color: palette.muted, marginTop: 2 },
  stopWhat: { fontSize: 10, color: palette.secondary, lineHeight: 1.45, marginTop: 6 },
  stopInsight: {
    fontSize: 9,
    color: palette.text,
    lineHeight: 1.45,
    backgroundColor: palette.accentSoft,
    padding: 8,
    borderRadius: 3,
    marginTop: 6,
  },

  driveRow: {
    fontSize: 9,
    color: palette.muted,
    textAlign: 'center',
    marginVertical: 4,
    letterSpacing: 0.4,
  },

  footer: {
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 9,
    color: palette.muted,
  },
});

function absUrl(path: string): string {
  if (typeof window === 'undefined') return path;
  if (path.startsWith('http')) return path;
  return `${window.location.origin}${path}`;
}

export function PlanPDFDocument({ itinerary }: { itinerary: Itinerary }) {
  const cover = itinerary.stops[0]
    ? imageForStop({
        photo_url: itinerary.stops[0].photo_url,
        place_type: itinerary.stops[0].place_type,
      })
    : '/places/place-walk.jpg';

  const totalHr = Math.round((itinerary.total_duration_min / 60) * 10) / 10;

  return (
    <Document title={itinerary.title} author="After5">
      <Page size="LETTER" style={styles.page}>
        {/* Brand bar */}
        <View style={styles.brandRow}>
          <Text style={styles.brand}>After5</Text>
          <Text style={styles.brandRight}>Kelowna · Date Plan</Text>
        </View>

        {/* Hero image */}
        <Image src={absUrl(cover)} style={styles.hero} />

        {/* Title block */}
        <Text style={styles.template}>{itinerary.template_name}</Text>
        <Text style={styles.title}>{itinerary.title}</Text>
        {itinerary.hook && <Text style={styles.hook}>{itinerary.hook}</Text>}

        {/* Stats */}
        <View style={styles.statsRow}>
          <View>
            <Text style={styles.statLabel}>Total</Text>
            <Text style={styles.statValue}>${Math.round(itinerary.total_cost_pp)} / pp</Text>
          </View>
          <View>
            <Text style={styles.statLabel}>Duration</Text>
            <Text style={styles.statValue}>{totalHr} hr</Text>
          </View>
          <View>
            <Text style={styles.statLabel}>Stops</Text>
            <Text style={styles.statValue}>{itinerary.stops.length}</Text>
          </View>
        </View>

        {itinerary.why_it_works && <Text style={styles.why}>{itinerary.why_it_works}</Text>}

        {/* Stops */}
        <Text style={styles.sectionTitle}>Timeline · Pacific Time</Text>
        {itinerary.stops.map((s, i) => {
          const img = imageForStop({ photo_url: s.photo_url, place_type: s.place_type });
          return (
            <View key={s.place_id} wrap={false}>
              <View style={styles.stop}>
                <Image src={absUrl(img)} style={styles.stopImg} />
                <View style={styles.stopBody}>
                  <View style={styles.stopHeader}>
                    <Text style={styles.stopName}>
                      {i + 1}. {s.place_name}
                    </Text>
                    <Text style={styles.stopTime}>{to12h(s.start_time)}</Text>
                  </View>
                  <Text style={styles.stopMeta}>
                    {[
                      s.neighborhood,
                      s.place_type?.replace(/_/g, ' '),
                      `${s.duration_min} min`,
                      s.estimated_cost_pp > 0 ? `$${Math.round(s.estimated_cost_pp)} pp` : 'Free',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  {s.what_to_do && <Text style={styles.stopWhat}>{s.what_to_do}</Text>}
                  {s.local_insight && (
                    <Text style={styles.stopInsight}>Local tip — {s.local_insight}</Text>
                  )}
                </View>
              </View>
              {i < itinerary.stops.length - 1 &&
                s.drive_to_next_min !== undefined &&
                s.drive_to_next_min > 0 && (
                  <Text style={styles.driveRow}>↓ {s.drive_to_next_min} min to next</Text>
                )}
            </View>
          );
        })}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text>After5 · Kelowna</Text>
          <Text>{itinerary.id ? `after5.app/plan/i/${itinerary.id}` : 'after5.app'}</Text>
        </View>
      </Page>
    </Document>
  );
}
