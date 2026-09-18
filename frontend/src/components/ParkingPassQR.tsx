import { useEffect, useState } from "react";
import { toDataURL } from "qrcode";

interface ParkingPassQRProps {
  value: string;
  label: string;
}

export function ParkingPassQR({ value, label }: ParkingPassQRProps) {
  const [dataUrl, setDataUrl] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setDataUrl(undefined);
    let qrPromise: Promise<string>;
    try {
      qrPromise = toDataURL(value, { errorCorrectionLevel: "M", margin: 1, width: 176 });
    } catch {
      if (!cancelled) setFailed(true);
      return;
    }
    void qrPromise.then(
      (url) => {
        if (!cancelled) setDataUrl(url);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [value]);

  if (failed) {
    return (
      <p className="notice error" role="alert">
        Unable to render the parking pass QR code.
      </p>
    );
  }

  if (!dataUrl) {
    return (
      <p className="notice" aria-live="polite">
        Rendering parking pass QR code...
      </p>
    );
  }

  return <img className="parking-pass-qr" src={dataUrl} alt={label} width={176} height={176} />;
}
