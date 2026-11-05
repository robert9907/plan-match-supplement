// Plan Match runs inside an <iframe> on generationhealth.me. When a
// call / text / email link fires from inside that frame, mobile browsers
// (Chrome on iOS especially) treat it as the embedded site trying to
// launch an app and show a scary "This site is repeatedly trying to open
// another application" prompt. Sending those links to the top-level page
// makes them behave like a normal tap-to-call link on the parent site.

const APP_SCHEMES = /^(tel|sms|mailto|facetime|facetime-audio):/i;

export function isFramed(): boolean {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
}

/** Open a tel:/sms:/mailto: URL from the top-level page when framed. */
export function openAppLink(url: string): void {
  if (isFramed()) {
    window.open(url, '_top');
  } else {
    window.location.href = url;
  }
}

export function installTopLevelAppLinks(): void {
  if (typeof document === 'undefined' || !isFramed()) return;
  document.addEventListener(
    'click',
    (e) => {
      const el = (e.target as Element | null)?.closest?.('a[href]');
      if (!(el instanceof HTMLAnchorElement)) return;
      if (!APP_SCHEMES.test(el.getAttribute('href') ?? '')) return;
      el.target = '_top';
    },
    true,
  );
}
