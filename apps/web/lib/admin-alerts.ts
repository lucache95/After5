// apps/web/lib/admin-alerts.ts

// Converts an admin_alerts.kind value into a human-readable label.
// Rule: replace underscores with spaces, sentence-case the result.
// Exported as a pure function so it's unit-testable without Supabase.
export function formatAlertKind(kind: string): string {
  if (!kind) return '';
  const spaced = kind.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
