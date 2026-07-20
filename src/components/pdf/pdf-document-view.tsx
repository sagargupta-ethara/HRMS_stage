'use client';

// Shared PDF renderer built on pdfjs-dist. SSR-safe: pdfjs is dynamically
// imported inside an effect so it never executes on the server. Renders every
// page stacked vertically; each page exposes its rendered size via a
// render-prop overlay so callers can absolutely-position field boxes / values
// using percentage geometry.
//
// Used by BOTH the template builder (draggable field overlays) and the document
// views (read-only filled-value overlays).

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';

export interface PageRenderContext {
  pageNumber: number;
  /** rendered CSS size of the page, in pixels */
  width: number;
  height: number;
}

interface PdfDocumentViewProps {
  url: string;
  className?: string;
  pageClassName?: string;
  /** clamp the rendered page width (px) */
  maxWidth?: number;
  onNumPages?: (n: number) => void;
  onReady?: () => void;
  onError?: (message: string) => void;
  /** overlay rendered on top of each page (fields, values, drop target) */
  renderPageOverlay?: (ctx: PageRenderContext) => ReactNode;
}

// Loaded lazily; typed loosely to avoid pulling pdfjs types into the server build.
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<unknown>; destroy: () => void };

export function PdfDocumentView({
  url,
  className,
  pageClassName,
  maxWidth = 880,
  onNumPages,
  onReady,
  onError,
  renderPageOverlay,
}: PdfDocumentViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [containerWidth, setContainerWidth] = useState(maxWidth);

  // Measure available width.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = Math.min(el.clientWidth - 2, maxWidth);
      if (w > 0) setContainerWidth(w);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxWidth]);

  // Load the document.
  useEffect(() => {
    let cancelled = false;
    let loadedDoc: PdfDoc | null = null;
    setStatus('loading');

    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        // Worker is copied into /public by scripts/copy-pdf-worker.mjs.
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        const task = pdfjs.getDocument({ url });
        const pdf = (await task.promise) as unknown as PdfDoc;
        if (cancelled) {
          pdf.destroy();
          return;
        }
        loadedDoc = pdf;
        setDoc(pdf);
        setNumPages(pdf.numPages);
        setStatus('ready');
        onNumPages?.(pdf.numPages);
        onReady?.();
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load PDF';
        setErrorMsg(message);
        setStatus('error');
        onError?.(message);
      }
    })();

    return () => {
      cancelled = true;
      loadedDoc?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return (
    <div ref={containerRef} className={cn('flex w-full flex-col items-center gap-6', className)}>
      {status === 'loading' && (
        <div className="flex h-72 w-full items-center justify-center text-sm text-ink-dim">
          <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Rendering PDF…
        </div>
      )}
      {status === 'error' && (
        <div className="flex h-72 w-full items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/10 px-6 text-center text-sm text-rose-300">
          Could not render PDF: {errorMsg}
        </div>
      )}
      {status === 'ready' &&
        doc &&
        Array.from({ length: numPages }, (_, i) => (
          <PdfPage
            key={i + 1}
            doc={doc}
            pageNumber={i + 1}
            targetWidth={containerWidth}
            className={pageClassName}
            renderPageOverlay={renderPageOverlay}
          />
        ))}
    </div>
  );
}

function PdfPage({
  doc,
  pageNumber,
  targetWidth,
  className,
  renderPageOverlay,
}: {
  doc: PdfDoc;
  pageNumber: number;
  targetWidth: number;
  className?: string;
  renderPageOverlay?: (ctx: PageRenderContext) => ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel: () => void } | null = null;

    (async () => {
      const page = (await doc.getPage(pageNumber)) as {
        getViewport: (o: { scale: number }) => { width: number; height: number };
        render: (o: unknown) => { promise: Promise<void>; cancel: () => void };
      };
      if (cancelled) return;

      const base = page.getViewport({ scale: 1 });
      const scale = targetWidth / base.width;
      const viewport = page.getViewport({ scale });
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const task = page.render({ canvasContext: ctx, viewport });
      renderTask = task;
      try {
        await task.promise;
        if (!cancelled) setSize({ width: viewport.width, height: viewport.height });
      } catch {
        /* render cancelled — ignore */
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [doc, pageNumber, targetWidth]);

  return (
    <div
      data-page={pageNumber}
      className={cn(
        'relative bg-paper shadow-xl shadow-black/40 ring-1 ring-black/10',
        className,
      )}
      style={size ? { width: size.width, height: size.height } : { width: targetWidth }}
    >
      <canvas ref={canvasRef} className="block" />
      {size && renderPageOverlay && (
        <div className="absolute inset-0">
          {renderPageOverlay({ pageNumber, width: size.width, height: size.height })}
        </div>
      )}
    </div>
  );
}
