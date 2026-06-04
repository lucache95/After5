// Shared PRIVACY-INVARIANT network helper for the reveal-ladder specs.
// Lives in _helpers/ (not a *.spec.ts) so multiple reveal specs can import it —
// Playwright forbids one test file importing another test file.
//
// Invariant: every storage signed-photo request on a pre-lock surface MUST target a
// *_blurred.jpg object — the clear photo path is NEVER signed pre-lock. Capturing the
// signed object path(s) reduces "no clear photo signed" to "every signed path ends in
// _blurred.jpg" (the clear sibling is <uid>/<id>.jpg).
import { expect, type Page, type Request } from '@playwright/test';

const SIGN_RE = /\/storage\/v1\/object\/sign(\/|\b)/;

/** Records signed object paths seen on `page`. Call before navigating. */
export function captureSignedPaths(page: Page): { paths: string[] } {
  const store = { paths: [] as string[] };
  page.on('request', (req: Request) => {
    const url = req.url();
    if (!SIGN_RE.test(url)) return;
    // Single-object sign: path is in the URL after /sign/. Batch sign (/sign-many or
    // createSignedUrls): the paths are in the POST body. Capture both shapes.
    const m = url.match(/\/storage\/v1\/object\/sign\/(.+?)(?:\?|$)/);
    if (m) store.paths.push(decodeURIComponent(m[1]));
    if (req.method() === 'POST') {
      try {
        const body = req.postDataJSON() as { paths?: string[]; path?: string } | null;
        if (body?.paths) store.paths.push(...body.paths);
        if (body?.path) store.paths.push(body.path);
      } catch {
        /* non-JSON body — ignore */
      }
    }
  });
  return store;
}

/** The load-bearing assertion: every signed photo path on a pre-lock surface is blurred. */
export function assertNoClearPhotoSigned(store: { paths: string[] }): void {
  const photoPaths = store.paths.filter((p) => /\.jpe?g$/i.test(p));
  for (const p of photoPaths) {
    expect(p, `pre-lock surface signed a non-blurred photo path: ${p}`).toMatch(/_blurred\.jpe?g$/i);
  }
}
