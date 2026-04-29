// useCameraStream — reusable live camera hook.
//
// Requests the rear-facing camera via getUserMedia, attaches the stream to
// a <video> element, and exposes a capture() that returns a data URL of
// the current frame. Cleans up on unmount or when `active` flips to false.
//
// Used by all three consumer scan screens (meds / providers / MBI card)
// so they share the same permission fallback and teardown.

import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraStatus = 'idle' | 'requesting' | 'ready' | 'denied' | 'unsupported' | 'error';

export interface UseCameraStream {
  videoRef: React.RefObject<HTMLVideoElement>;
  status: CameraStatus;
  error: string | null;
  /** Capture the current video frame as a JPEG data URL. Returns null if
   *  the stream isn't ready yet. */
  capture: () => string | null;
  /** Force-stop the stream — e.g. after the user confirms a capture and
   *  we've moved on to the next screen. */
  stop: () => void;
}

export function useCameraStream(active: boolean): UseCameraStream {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    if (!active) {
      stop();
      setStatus('idle');
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatus('unsupported');
      setError('Camera is not supported on this device.');
      return;
    }

    let cancelled = false;
    setStatus('requesting');
    setError(null);

    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          // playsInline is required for iOS Safari to render inline.
          v.setAttribute('playsinline', 'true');
          v.muted = true;
          v.play().catch(() => {
            /* autoplay can be blocked until a user gesture; the shutter
               button counts as one, so a later play() will succeed */
          });
        }
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const name = err instanceof Error ? err.name : '';
        if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
          setStatus('denied');
          setError('Camera access was denied.');
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          setStatus('unsupported');
          setError('No camera found on this device.');
        } else {
          setStatus('error');
          setError(err instanceof Error ? err.message : 'Camera unavailable.');
        }
      });

    return () => {
      cancelled = true;
      stop();
    };
  }, [active, stop]);

  const capture = useCallback((): string | null => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || !v.videoHeight) return null;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    try {
      return canvas.toDataURL('image/jpeg', 0.82);
    } catch {
      return null;
    }
  }, []);

  return { videoRef, status, error, capture, stop };
}
