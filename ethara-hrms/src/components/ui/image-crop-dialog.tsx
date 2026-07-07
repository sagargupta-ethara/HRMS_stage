"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type SyntheticEvent } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const VIEW = 288; // square crop viewport (px)
const OUT = 512; // exported square image size (px)

type Offset = { x: number; y: number };

/**
 * Lets a user reposition and zoom an uploaded image so their face is framed inside
 * the circular avatar, then exports a square JPEG (the preview math is replicated
 * 1:1 on the export canvas, so what you see is what you get). Dependency-free.
 */
export function ImageCropDialog({
  open,
  file,
  title = "Position your photo",
  onCancel,
  onCropped,
}: {
  open: boolean;
  file: File | null;
  title?: string;
  onCancel: () => void;
  onCropped: (file: File) => void;
}) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [minScale, setMinScale] = useState(1);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!file) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setImgSrc(null);
      setNat(null);
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }
    const url = URL.createObjectURL(file);
    setImgSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const clamp = useCallback(
    (o: Offset, s: number): Offset => {
      if (!nat) return o;
      const dw = nat.w * s;
      const dh = nat.h * s;
      return {
        x: Math.min(0, Math.max(VIEW - dw, o.x)),
        y: Math.min(0, Math.max(VIEW - dh, o.y)),
      };
    },
    [nat],
  );

  const onImgLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    const w = e.currentTarget.naturalWidth;
    const h = e.currentTarget.naturalHeight;
    if (!w || !h) return;
    const cover = Math.max(VIEW / w, VIEW / h);
    setNat({ w, h });
    setMinScale(cover);
    setScale(cover);
    setOffset({ x: (VIEW - w * cover) / 2, y: (VIEW - h * cover) / 2 });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const nx = dragRef.current.ox + (e.clientX - dragRef.current.x);
    const ny = dragRef.current.oy + (e.clientY - dragRef.current.y);
    setOffset(clamp({ x: nx, y: ny }, scale));
  };
  const onPointerUp = () => {
    dragRef.current = null;
    setDragging(false);
  };

  const onZoom = (next: number) => {
    if (!nat) return;
    const center = VIEW / 2;
    // Keep the point under the centre fixed while zooming.
    const ix = (center - offset.x) / scale;
    const iy = (center - offset.y) / scale;
    setScale(next);
    setOffset(clamp({ x: center - ix * next, y: center - iy * next }, next));
  };

  const handleSave = () => {
    if (!nat || !imgRef.current) return;
    const ratio = OUT / VIEW;
    const canvas = document.createElement("canvas");
    canvas.width = OUT;
    canvas.height = OUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, OUT, OUT);
    ctx.drawImage(
      imgRef.current,
      offset.x * ratio,
      offset.y * ratio,
      nat.w * scale * ratio,
      nat.h * scale * ratio,
    );
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const base = (file?.name || "photo").replace(/\.[^.]+$/, "");
        onCropped(new File([blob], `${base}.jpg`, { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.92,
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Drag to reposition and use the slider to zoom. The circle shows how it will appear as your avatar.
        </p>
        <div className="flex flex-col items-center gap-4">
          <div
            className="relative shrink-0 touch-none select-none overflow-hidden rounded-lg bg-black/50"
            style={{ width: VIEW, height: VIEW, cursor: dragging ? "grabbing" : "grab" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            {imgSrc && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                ref={imgRef}
                src={imgSrc}
                alt="Crop preview"
                onLoad={onImgLoad}
                draggable={false}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: nat ? nat.w * scale : undefined,
                  height: nat ? nat.h * scale : undefined,
                  maxWidth: "none",
                  transform: `translate(${offset.x}px, ${offset.y}px)`,
                }}
              />
            )}
            {/* Circular mask: darkens everything outside the avatar circle. */}
            <div
              className="pointer-events-none absolute inset-0 rounded-full"
              style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)" }}
            />
          </div>
          <input
            type="range"
            min={minScale}
            max={minScale * 3}
            step={0.01}
            value={scale}
            onChange={(e) => onZoom(Number(e.target.value))}
            disabled={!nat}
            aria-label="Zoom"
            className="w-full accent-primary"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!nat}>
            Save photo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
