'use client';
// Persona embedded SDK (v5) loaded via the CDN script. Resumes the inquiry created
// by start-verification using { inquiryId, sessionToken }. The verdict is NOT decided
// here: the persona-webhook is the source of truth; onComplete only signals the client
// to move to the status screen.
import { useEffect, useRef } from 'react';
import Script from 'next/script';

interface PersonaClient { open: () => void; }
interface PersonaClientOptions {
  inquiryId: string;
  sessionToken?: string;
  onReady?: () => void;
  onComplete?: (args: { inquiryId: string; status: string }) => void;
  onCancel?: () => void;
  onError?: (error: unknown) => void;
}
interface PersonaClientCtor { new (opts: PersonaClientOptions): PersonaClient; }
declare global {
  interface Window { Persona?: { Client: PersonaClientCtor } }
}

export function PersonaEmbed({
  inquiryId, sessionToken, onComplete, onCancel, onError,
}: {
  inquiryId: string;
  sessionToken?: string;
  onComplete?: () => void;
  onCancel?: () => void;
  onError?: (e: unknown) => void;
}) {
  const launched = useRef(false);

  function launch() {
    if (launched.current || !window.Persona?.Client) return;
    launched.current = true;
    const client = new window.Persona.Client({
      inquiryId,
      sessionToken,
      onReady: () => client.open(),
      onComplete: () => onComplete?.(),
      onCancel: () => onCancel?.(),
      onError: (e) => onError?.(e),
    });
  }

  // If the script is already present (returning to the step), launch on mount.
  useEffect(() => {
    if (window.Persona?.Client) launch();
    // launch is stable for this mount; deps intentionally empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Script
        src="https://cdn.withpersona.com/dist/persona-v5.1.2.js"
        strategy="afterInteractive"
        onLoad={launch}
      />
      <div aria-live="polite" className="rounded-2xl border border-shell-ink/15 bg-white/60 px-4 py-6 text-center font-body text-sm text-shell-ink/70">
        opening secure verification…
      </div>
    </>
  );
}
