import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { callApi, errorText } from "../lib/supabase";
import { CATEGORY_NAMES, type Product } from "../lib/types";
import { fmt } from "../lib/merge";
import { imageToDataUrl } from "../lib/util";

interface Props { onClose: () => void; onProduct: (p: Product) => void }

export function Scanner({ onClose, onProduct }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const photo = useRef<HTMLInputElement>(null);
  const controls = useRef<IScannerControls | null>(null);
  const busy = useRef(false);
  const [status, setStatus] = useState<{ text: string; err?: boolean }>({ text: "Hold stregkoden inden for rammen." });
  const [result, setResult] = useState<Product | null>(null);
  const [camOk, setCamOk] = useState(true);

  async function lookup(body: { barcode?: string; image?: string }) {
    busy.current = true;
    setStatus({ text: body.barcode ? `Slår ${body.barcode} op…` : "Kigger på billedet…" });
    try {
      const p = await callApi<Product & { reason?: string }>("/api/product", body);
      if (p.found) { setResult(p); setStatus({ text: "" }); controls.current?.stop(); }
      else if (p.reason === "unknown_barcode") setStatus({ text: "Stregkoden findes ikke i varedatabasen. Tag et billede af forsiden i stedet.", err: true });
      else setStatus({ text: "Varen kunne ikke genkendes. Tag billedet tættere på, med navnet synligt.", err: true });
    } catch (e) { setStatus({ text: errorText(e), err: true }); }
    finally { setTimeout(() => { busy.current = false; }, 1500); }
  }

  useEffect(() => {
    let cancelled = false;
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]);
    const reader = new BrowserMultiFormatReader(hints);
    let last = "";
    reader.decodeFromConstraints({ video: { facingMode: "environment" } }, video.current!, (res) => {
      if (!res || busy.current) return;
      const code = res.getText();
      if (code === last) return;
      last = code;
      navigator.vibrate?.(40);
      lookup({ barcode: code });
    }).then((c) => { if (cancelled) c.stop(); else controls.current = c; })
      .catch(() => { setCamOk(false); setStatus({ text: "Kameraet kunne ikke startes. Tillad kamera for appen, eller tag et billede i stedet.", err: true }); });
    return () => { cancelled = true; controls.current?.stop(); };
  }, []);

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try { await lookup({ image: await imageToDataUrl(f) }); } catch (err) { setStatus({ text: errorText(err), err: true }); }
  }

  return (
    <div className="sheet" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel scanner">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>Scan vare</h2>
          <button className="link" onClick={onClose}>Luk</button>
        </div>
        {!result && camOk && <div className="frame"><video ref={video} playsInline muted /></div>}
        {!camOk && <video ref={video} hidden />}
        {result ? (
          <div className="card">
            <h3>{result.name}</h3>
            <p className="muted small" style={{ margin: 0 }}>
              {result.qty ? `${fmt(result.qty)} ${result.unit} · ` : ""}{CATEGORY_NAMES[result.category]}
            </p>
            <div className="row end">
              <button className="btn ghost" onClick={() => { setResult(null); onClose(); }}>Fortryd</button>
              <button className="btn" onClick={() => onProduct(result)}>Sæt på listen</button>
            </div>
          </div>
        ) : (
          <>
            {status.text && <p className={"status" + (status.err ? " err" : "")}>{status.text}</p>}
            <button className="btn ghost" onClick={() => photo.current?.click()}>Tag billede af emballagen i stedet</button>
          </>
        )}
        <input ref={photo} type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />
      </div>
    </div>
  );
}
