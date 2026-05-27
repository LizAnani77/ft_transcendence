// frontend/src/core/NeonFrameRenderer.ts

export interface NeonFrameOptions {
  speed?: number;
  trailLengthRatio?: number;
  persistence?: number;
  padding?: number;
}

/* Effet de cadre néon partagé entre le rendu remote et le moteur local */
export class NeonFrameRenderer {
  private neonCanvas: HTMLCanvasElement | null = null;
  private neonCtx: CanvasRenderingContext2D | null = null;
  private targetCanvas: HTMLCanvasElement | null = null;
  private targetCtx: CanvasRenderingContext2D | null = null;

  private neonTrailSpeed: number;
  private neonTrailLengthRatio: number;
  private neonTrailPersistence: number;
  private neonFramePadding: number;

  constructor(options: NeonFrameOptions = {}) {
    this.neonTrailSpeed = options.speed ?? 0.35;
    this.neonTrailLengthRatio = options.trailLengthRatio ?? 0.7;
    this.neonTrailPersistence = options.persistence ?? 0.97;
    this.neonFramePadding = options.padding ?? 0;
  }

  public attach(canvas: HTMLCanvasElement, ctx?: CanvasRenderingContext2D | null): void {
    this.targetCanvas = canvas;
    this.targetCtx = ctx ?? canvas.getContext('2d');
    if (!this.neonCanvas) {
      this.neonCanvas = document.createElement('canvas');
      this.neonCtx = this.neonCanvas.getContext('2d', { alpha: true });
    }
    this.syncOffscreenSize();
  }

  public detach(): void {
    this.targetCanvas = null;
    this.targetCtx = null;
    this.neonCanvas = null;
    this.neonCtx = null;
  }

  public render(timestamp?: number): void {
    if (!this.targetCtx || !this.targetCanvas || !this.ensureOffscreenReady()) return;
    const neonCtx = this.neonCtx!;
    const neonCanvas = this.neonCanvas!;

    const time = typeof timestamp === 'number'
      ? timestamp
      : (typeof performance !== 'undefined' ? performance.now() : Date.now());

    const inset = this.neonFramePadding;
    const innerWidth = Math.max(0, this.targetCanvas.width - inset * 2);
    const innerHeight = Math.max(0, this.targetCanvas.height - inset * 2);
    if (innerWidth <= 0 || innerHeight <= 0) return;

    const perimeter = 2 * (innerWidth + innerHeight);
    if (perimeter <= 0) return;

    const segmentLength = Math.max(150, perimeter * this.neonTrailLengthRatio);
    const head = ((time * this.neonTrailSpeed) % perimeter + perimeter) % perimeter;

    neonCtx.save();
    neonCtx.lineCap = 'round';
    neonCtx.lineJoin = 'round';
    neonCtx.miterLimit = 2;

    neonCtx.globalCompositeOperation = 'destination-out';
    neonCtx.fillStyle = `rgba(0, 0, 0, ${1 - this.neonTrailPersistence})`;
    neonCtx.fillRect(0, 0, neonCanvas.width, neonCanvas.height);

    neonCtx.globalCompositeOperation = 'lighter';
    this.strokeNeonSegment(head, segmentLength, innerWidth, innerHeight, inset, 'medium', neonCtx);
    this.strokeNeonSegment(head, segmentLength, innerWidth, innerHeight, inset, 'core', neonCtx);

    neonCtx.restore();

    this.targetCtx.drawImage(neonCanvas, 0, 0);
  }

  private ensureOffscreenReady(): boolean {
    if (!this.neonCanvas) {
      this.neonCanvas = document.createElement('canvas');
      this.neonCtx = this.neonCanvas.getContext('2d', { alpha: true });
    }
    if (!this.neonCanvas) return false;
    if (!this.neonCtx) this.neonCtx = this.neonCanvas.getContext('2d', { alpha: true });
    this.syncOffscreenSize();
    return !!this.neonCtx;
  }

  private syncOffscreenSize(): void {
    if (!this.neonCanvas || !this.targetCanvas) return;
    if (this.neonCanvas.width !== this.targetCanvas.width) {
      this.neonCanvas.width = this.targetCanvas.width;
    }
    if (this.neonCanvas.height !== this.targetCanvas.height) {
      this.neonCanvas.height = this.targetCanvas.height;
    }
  }

  private strokeNeonSegment(
    start: number,
    length: number,
    width: number,
    height: number,
    inset: number,
    mode: 'glow' | 'medium' | 'core',
    targetCtx: CanvasRenderingContext2D
  ): void {
    const segments = [width, height, width, height];
    const perimeter = 2 * (width + height);
    if (perimeter <= 0) return;

    let cursor = start % perimeter;
    if (cursor < 0) cursor += perimeter;
    let remaining = Math.min(length, perimeter);
    let travelled = 0;
    let edgeIndex = 0;
    let edgeOffset = cursor;

    while (edgeOffset >= segments[edgeIndex]) {
      edgeOffset -= segments[edgeIndex];
      edgeIndex = (edgeIndex + 1) % 4;
    }

    let lineWidth: number, shadowBlur: number, shadowColor: string;

    switch (mode) {
      case 'glow':
        lineWidth = 1.75;
        shadowBlur = 3.75;
        shadowColor = 'rgba(14, 37, 74, 0.25)';
        break;
      case 'medium':
        lineWidth = 0.75;
        shadowBlur = 1.75;
        shadowColor = 'rgba(7, 28, 52, 0.45)';
        break;
      default:
        lineWidth = 0.25;
        shadowBlur = 0.75;
        shadowColor = 'rgba(3, 21, 32, 0.7)';
        break;
    }

    targetCtx.lineWidth = lineWidth;
    targetCtx.shadowColor = shadowColor;
    targetCtx.shadowBlur = shadowBlur;
    targetCtx.globalAlpha = mode === 'core' ? 0.8 : mode === 'medium' ? 0.55 : 0.35;

    while (remaining > 0.01) {
      const available = segments[edgeIndex] - edgeOffset;
      const drawLen = Math.min(available, remaining);
      if (drawLen <= 0) break;

      const startPoint = this.getPerimeterPoint(edgeIndex, edgeOffset, inset, width, height);
      const endPoint = this.getPerimeterPoint(edgeIndex, edgeOffset + drawLen, inset, width, height);

      const startRatio = travelled / length;
      const endRatio = (travelled + drawLen) / length;
      const alphaStart = this.neonAlphaImproved(startRatio, mode);
      const alphaEnd = this.neonAlphaImproved(endRatio, mode);

      const gradient = targetCtx.createLinearGradient(startPoint.x, startPoint.y, endPoint.x, endPoint.y);

      if (mode === 'core') {
        const startAlpha = alphaStart * 0.55;
        const endAlpha = alphaEnd * 0.55;
        gradient.addColorStop(0, `rgba(0, 35, 55, ${startAlpha})`);
        gradient.addColorStop(0.4, `rgba(0, 32, 50, ${startAlpha * 0.85 + endAlpha * 0.15})`);
        gradient.addColorStop(0.7, `rgba(0, 28, 46, ${startAlpha * 0.5 + endAlpha * 0.5})`);
        gradient.addColorStop(1, `rgba(0, 40, 65, ${endAlpha})`);
      } else {
        const alphaScale = 0.6;
        const tonedStart = alphaStart * alphaScale;
        const tonedEnd = alphaEnd * alphaScale;
        const midAlpha = tonedStart * 0.6 + tonedEnd * 0.4;
        const toneA = mode === 'medium' ? 55 : 45;
        const toneB = mode === 'medium' ? 48 : 40;
        const toneC = mode === 'medium' ? 60 : 50;
        gradient.addColorStop(0, `rgba(0, ${toneA}, 95, ${tonedStart})`);
        gradient.addColorStop(0.5, `rgba(0, ${toneB}, 85, ${midAlpha})`);
        gradient.addColorStop(1, `rgba(0, ${toneC}, 100, ${tonedEnd})`);
      }

      targetCtx.strokeStyle = gradient;
      targetCtx.beginPath();
      targetCtx.moveTo(startPoint.x, startPoint.y);
      targetCtx.lineTo(endPoint.x, endPoint.y);
      targetCtx.stroke();

      remaining -= drawLen;
      travelled += drawLen;
      edgeOffset += drawLen;

      if (edgeOffset >= segments[edgeIndex] - 0.001) {
        edgeOffset = 0;
        edgeIndex = (edgeIndex + 1) % 4;
      }
    }
  }

  private getPerimeterPoint(edgeIndex: number, distance: number, inset: number, width: number, height: number): { x: number; y: number } {
    const left = inset;
    const top = inset;
    const right = inset + width;
    const bottom = inset + height;

    switch (edgeIndex) {
      case 0: return { x: left + distance, y: top };
      case 1: return { x: right, y: top + distance };
      case 2: return { x: right - distance, y: bottom };
      default: return { x: left, y: bottom - distance };
    }
  }

  private neonAlphaImproved(ratio: number, mode: 'glow' | 'medium' | 'core'): number {
    const clamped = Math.max(0, Math.min(1, ratio));
    const tailPower = mode === 'core' ? 0.9 : mode === 'medium' ? 0.75 : 0.6;
    const tail = Math.pow(1 - clamped, tailPower);
    const headStart = 0.6;
    let headBoost = 0;

    if (clamped > headStart) {
      const headProgress = (clamped - headStart) / (1 - headStart);
      const easeIn = Math.pow(headProgress, 0.4);
      headBoost = 0.3 + 0.7 * easeIn;
    }

    const baseAlpha = tail * (mode === 'core' ? 0.4 : mode === 'medium' ? 0.5 : 0.6);
    const finalAlpha = Math.min(1, baseAlpha + headBoost);
    const shimmer = 1 + Math.sin(ratio * Math.PI * 2) * 0.05;

    return finalAlpha * shimmer;
  }
}
