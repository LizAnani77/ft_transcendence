// frontend/src/types/qrcode.d.ts

declare module 'qrcode' {
  interface QRCanvasOpts {
    width?: number;
    margin?: number;
    color?: { dark?: string; light?: string };
  }

  const QRCode: {
    toCanvas(
      canvas: HTMLCanvasElement,
      text: string,
      opts?: QRCanvasOpts
    ): Promise<void>;

    toDataURL(
      text: string,
      opts?: QRCanvasOpts
    ): Promise<string>;
  };

  export = QRCode;
}
