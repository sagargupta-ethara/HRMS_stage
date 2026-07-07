"use client";

import { useEffect, useRef, useCallback } from "react";

interface NeuralBackgroundProps {
  nodeCount?: number;
  className?: string;
  intensity?: "low" | "medium" | "high";
  interactive?: boolean;
}

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  opacity: number;
  pulsePhase: number;
  pulseSpeed: number;
}

const PALETTE = {
  neon: "237,0,237",
  accent: "144,141,206",
  soft: "197,203,232",
};

export function NeuralBackground({
  nodeCount = 55,
  className = "",
  intensity = "medium",
  interactive = true,
}: NeuralBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<Node[]>([]);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const rafRef = useRef<number>(0);
  const timeRef = useRef(0);

  const connectionDistance = intensity === "low" ? 80 : intensity === "high" ? 150 : 120;
  const speed = intensity === "low" ? 0.12 : intensity === "high" ? 0.30 : 0.18;

  const initNodes = useCallback((w: number, h: number) => {
    nodesRef.current = Array.from({ length: nodeCount }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * speed,
      vy: (Math.random() - 0.5) * speed,
      radius: Math.random() * 1.4 + 0.8,
      opacity: Math.random() * 0.30 + 0.12,
      pulsePhase: Math.random() * Math.PI * 2,
      pulseSpeed: Math.random() * 0.010 + 0.005,
    }));
  }, [nodeCount, speed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;

    const resize = () => {
      const parent = canvas.parentElement;
      w = parent ? parent.offsetWidth : window.innerWidth;
      h = parent ? parent.offsetHeight : window.innerHeight;
      canvas.width = w;
      canvas.height = h;
      initNodes(w, h);
    };

    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    const onMouse = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const onLeave = () => { mouseRef.current = { x: -9999, y: -9999 }; };

    if (interactive) {
      canvas.addEventListener("mousemove", onMouse);
      canvas.addEventListener("mouseleave", onLeave);
    }

    const draw = () => {
      timeRef.current += 1;
      ctx.clearRect(0, 0, w, h);

      const nodes = nodesRef.current;
      const mouse = mouseRef.current;

      for (const node of nodes) {
        node.x += node.vx;
        node.y += node.vy;
        if (node.x < -20) node.x = w + 20;
        if (node.x > w + 20) node.x = -20;
        if (node.y < -20) node.y = h + 20;
        if (node.y > h + 20) node.y = -20;

        if (interactive) {
          const dx = mouse.x - node.x;
          const dy = mouse.y - node.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            const force = (120 - dist) / 120 * 0.012;
            node.vx -= dx * force;
            node.vy -= dy * force;
          }
        }

        const maxSpeed = speed * 2.5;
        const spd = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
        if (spd > maxSpeed) {
          node.vx = (node.vx / spd) * maxSpeed;
          node.vy = (node.vy / spd) * maxSpeed;
        }

        node.vx *= 0.998;
        node.vy *= 0.998;

        if (Math.abs(node.vx) < speed * 0.1) node.vx += (Math.random() - 0.5) * speed * 0.08;
        if (Math.abs(node.vy) < speed * 0.1) node.vy += (Math.random() - 0.5) * speed * 0.08;
      }

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < connectionDistance) {
            const alpha = (1 - dist / connectionDistance) * 0.12;
            const isNear = dist < connectionDistance * 0.40;
            const color = isNear ? PALETTE.neon : PALETTE.accent;

            const gradient = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
            gradient.addColorStop(0, `rgba(${color},${alpha * (isNear ? 1.3 : 1)})`);
            gradient.addColorStop(0.5, `rgba(${PALETTE.accent},${alpha * 0.6})`);
            gradient.addColorStop(1, `rgba(${color},${alpha * (isNear ? 1.3 : 1)})`);

            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = gradient;
            ctx.lineWidth = isNear ? 0.5 : 0.25;
            ctx.stroke();
          }
        }
      }

      for (const node of nodes) {
        node.pulsePhase += node.pulseSpeed;
        const pulse = Math.sin(node.pulsePhase) * 0.25 + 0.75;
        const finalOpacity = node.opacity * pulse;

        const dx = mouse.x - node.x;
        const dy = mouse.y - node.y;
        const mouseDist = Math.sqrt(dx * dx + dy * dy);
        const mouseGlow = mouseDist < 80 ? (1 - mouseDist / 80) * 0.25 : 0;
        const isNeonNode = node.radius > 1.6;
        const color = isNeonNode ? PALETTE.neon : PALETTE.accent;

        const glowRadius = node.radius * 2.2;
        const grd = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, glowRadius);
        grd.addColorStop(0, `rgba(${color},${(finalOpacity + mouseGlow) * 0.7})`);
        grd.addColorStop(0.6, `rgba(${color},${(finalOpacity + mouseGlow) * 0.2})`);
        grd.addColorStop(1, `rgba(${color},0)`);

        ctx.beginPath();
        ctx.arc(node.x, node.y, glowRadius, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${color},${Math.min(finalOpacity * 1.4 + mouseGlow, 0.75)})`;
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      if (interactive) {
        canvas.removeEventListener("mousemove", onMouse);
        canvas.removeEventListener("mouseleave", onLeave);
      }
    };
  }, [initNodes, connectionDistance, speed, interactive]);

  return (
    <canvas
      ref={canvasRef}
      className={`pointer-events-none absolute inset-0 ${className}`}
      style={{ opacity: 0.45 }}
    />
  );
}
