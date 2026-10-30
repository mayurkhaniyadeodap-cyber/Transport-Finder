import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { deriveTransportType } from "../searchDefaults";
import type { TransportResult } from "../services/api";
import { ChipList, CompactList, formatCharge, PINCODE_PREVIEW, PincodeSummary, splitPincodes } from "./CityList";
import { ArrowLeftIcon, CheckIcon, CopyIcon, InfoIcon, PhoneIcon, SearchIcon, XIcon, ZoomIcon } from "./Icons";
import { PhotoSource, photoSourceText, StatusBadge, TransporterPhoto } from "./ui";

const NA = "Not Available";

interface Props {
  row: TransportResult | null;
  onBack: () => void;
}

/** Transporter profile page (both roles, read-only). Only fields the API actually returns are
 * shown -- nothing invented, since this is real operational data. */
export default function TransporterProfile({ row, onBack }: Props) {
  const [copied, setCopied] = useState<"info" | "number" | null>(null);
  const [tab, setTab] = useState<"overview" | "coverage">("overview");
  const [preview, setPreview] = useState(false);
  const imageButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setCopied(null);
    setTab("overview");
    setPreview(false);
  }, [row]);

  const closePreview = () => {
    setPreview(false);
    imageButton.current?.focus();
  };

  const head = (
    <div className="pagehead">
      <div>
        <div className="eyebrow">Directory / Profile</div>
        <h1 className="h1">Transporter profile</h1>
        <p className="sub">Contact, shipment cost and full delivery coverage.</p>
      </div>
      <button type="button" className="btn secondary" onClick={onBack}>
        <ArrowLeftIcon size={16} /> Back to search
      </button>
    </div>
  );

  if (!row) {
    return (
      <section>
        {head}
        <div className="panel empty">
          <span className="empty-icon"><SearchIcon size={24} /></span>
          <h3>No transporter selected</h3>
          <p>Search for a pincode, city, state or transporter, then choose <b>View profile</b> on a result.</p>
          <button type="button" className="btn" onClick={onBack}>Find transport</button>
        </div>
      </section>
    );
  }

  const type = deriveTransportType(row.transport_name);
  const cities = row.service_cities ?? [];
  const pins = splitPincodes(row.pincode);
  const charge = formatCharge(row.shipment_charge);
  const phone = row.contact_number?.split(",")[0].trim();

  const copy = async (text: string, what: "info" | "number") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      // clipboard access can be blocked (permissions, insecure context); fail quietly
    }
  };

  const info = [
    `Transporter: ${row.transport_name}`,
    `Service Cities: ${cities.join(", ") || NA}`,
    `Pincode: ${row.pincode || NA}`,
    `Mobile: ${row.contact_number || NA}`,
    `Approx. Shipment Charge / 1 Box: ${charge ?? NA}`,
    `Status: ${row.status || NA}`,
    `Transport Type: ${type}`,
  ].join("\n");

  return (
    <section aria-labelledby="profile-title">
      {head}
      <div className="panel">
        <div className="profilehero">
          <button type="button" ref={imageButton} className="photo-btn" onClick={() => setPreview(true)}
                  aria-label={`View ${row.transport_name} logo/image`} title="View logo/image">
            <TransporterPhoto name={row.transport_name} photoUrl={row.photo_url} className="lg profile-photo" />
            <span className="zoom" aria-hidden="true"><ZoomIcon size={12} /></span>
          </button>
          <div>
            <h2 id="profile-title">{row.transport_name}</h2>
            <div className="rmeta">
              {type} · {cities.length} service {cities.length === 1 ? "city" : "cities"} · {pins.length} pincode{pins.length === 1 ? "" : "s"}
            </div>
            {row.photo_url && <p className="photo-source">{photoSourceText(row.photo_source)}</p>}
          </div>
          <StatusBadge status={row.status} />
        </div>

        <div className="profile-actions">
          {phone && (
            <a className="btn" href={`tel:${phone}`}>
              <PhoneIcon size={16} /> Call
            </a>
          )}
          {row.contact_number && (
            <button type="button" className="btn secondary" onClick={() => copy(row.contact_number as string, "number")}>
              {copied === "number" ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
              {copied === "number" ? "Copied" : "Copy number"}
            </button>
          )}
          <button type="button" className="btn secondary" onClick={() => copy(info, "info")}>
            {copied === "info" ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
            {copied === "info" ? "Copied" : "Copy information"}
          </button>
        </div>

        <div className="tabs" role="tablist" aria-label="Details">
          <button type="button" role="tab" aria-selected={tab === "overview"} className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>
            Overview
          </button>
          <button type="button" role="tab" aria-selected={tab === "coverage"} className={tab === "coverage" ? "active" : ""} onClick={() => setTab("coverage")}>
            Coverage
          </button>
        </div>

        {tab === "overview" ? (
          <>
            <div className="profilegrid">
              <div className="profileitem">
                <small>Mobile</small>
                <b className={row.contact_number ? "phone" : "na"}>{row.contact_number || NA}</b>
              </div>
              <div className="profileitem">
                <small>Approx. Shipment Charge / 1 Box (₹)</small>
                <b>{charge ?? <span className="na">{NA}</span>}</b>
              </div>
              <div className="profileitem">
                <small>Service Cities</small>
                <div>
                  <CompactList items={cities} />
                  {cities.length > 3 && (
                    <button type="button" className="linkbtn" onClick={() => setTab("coverage")}>See all {cities.length}</button>
                  )}
                </div>
              </div>
              <div className="profileitem">
                <small>Pincode</small>
                <div>
                  <PincodeSummary pins={pins} />
                  {pins.length > PINCODE_PREVIEW && (
                    <button type="button" className="linkbtn" onClick={() => setTab("coverage")}>See all {pins.length}</button>
                  )}
                </div>
              </div>
              <div className="profileitem">
                <small>Status</small>
                <b>{row.status || NA}</b>
              </div>
              <div className="profileitem">
                <small>Transport Type · guessed from the name</small>
                <b>{type}</b>
              </div>
              <div className="profileitem full">
                <small>Data source</small>
                <b>Order history (all recorded orders)</b>
              </div>
            </div>
            <div className="alert info">
              <InfoIcon size={16} />
              <span>A result means this transporter has carried an order to this area before. It isn't a promise that they serve it today.</span>
            </div>
          </>
        ) : (
          <div className="coverage">
            <h3>Service Cities{cities.length > 0 ? ` (${cities.length})` : ""}</h3>
            <ChipList items={cities} label="Service cities" />
            <h3>Pincodes{pins.length > 0 ? ` (${pins.length})` : ""}</h3>
            <ChipList items={pins} label="Pincodes" />
          </div>
        )}
      </div>

      {preview && createPortal(
        <ImagePreview name={row.transport_name} photoUrl={row.photo_url} source={row.photo_source} onClose={closePreview} />,
        document.body,
      )}
    </section>
  );
}

/** Larger view of the transporter's image (view-only, both roles): the same image the profile shows --
 * Admin upload, else official logo, else the short name. Closes on ×, a click outside, or Escape. */
function ImagePreview({ name, photoUrl, source, onClose }: {
  name: string; photoUrl?: string | null; source?: PhotoSource; onClose: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const [zoomed, setZoomed] = useState(false); // fit to the dialog, or 2x with scrolling
  useEffect(() => closeButton.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const caption = photoUrl ? photoSourceText(source) : "";
  return (
    <div className="overlay lightbox-overlay" onClick={onClose}>
      <div className="lightbox" role="dialog" aria-modal="true" aria-label={`${name} logo/image`} onClick={(e) => e.stopPropagation()}>
        <button type="button" ref={closeButton} className="close" onClick={onClose} aria-label="Close image preview">
          <XIcon size={16} />
        </button>
        <div className={`lightbox-frame ${zoomed ? "zoomed" : ""}`} onClick={() => photoUrl && setZoomed((z) => !z)}
             title={photoUrl ? (zoomed ? "Click to fit" : "Click to zoom in") : undefined}>
          <TransporterPhoto name={name} photoUrl={photoUrl} className="lightbox-image" />
        </div>
        <b>{name}</b>
        {caption && <p className="photo-source">{caption}</p>}
        {photoUrl && <p className="hint">{zoomed ? "Scroll to look around · click the image to fit it again" : "Click the image to zoom in"}</p>}
      </div>
    </div>
  );
}
