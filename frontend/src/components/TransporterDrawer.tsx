import { ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { deriveTransportType } from "../searchDefaults";
import type { TransportResult } from "../services/api";
import { CityChips, CompactList, formatCharge, PINCODE_PREVIEW, PincodeSummary, splitPincodes } from "./CityList";
import {
  CheckCircleIcon, CheckIcon, CityIcon, CopyIcon, HashIcon, InfoIcon, PhoneIcon, TagIcon, TruckIcon, XIcon, ZoomIcon,
} from "./Icons";
import { PhotoSource, photoSourceText, StatusBadge, TransporterPhoto, TypeChip } from "./ui";

const NA = "Not Available";

interface Props {
  row: TransportResult | null;
  onClose: () => void;
}

function Fact({ icon, label, hint, children }: { icon: ReactNode; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="fact">
      <span className="fact-icon">{icon}</span>
      <div className="fact-body">
        <p className="fact-label">
          {label}
          {hint && <span className="fact-hint"> · {hint}</span>}
        </p>
        <div className="fact-value">{children}</div>
      </div>
    </div>
  );
}

/** Transporter profile (both roles, read-only). Only fields the API actually returns are shown here -- no invented website/service-area/
 * feature-checklist content, since this is real operational data, not a demo. */
export default function TransporterDrawer({ row, onClose }: Props) {
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

  useEffect(() => {
    if (!row) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (preview) closePreview(); // Escape closes the image preview first, then the profile
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [row, onClose, preview]);

  if (!row) return null;

  const type = deriveTransportType(row.transport_name);
  const cities = row.service_cities ?? [];
  const pins = splitPincodes(row.pincode);
  const charge = formatCharge(row.shipment_charge);

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
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer profile" role="dialog" aria-modal="true" aria-labelledby="drawer-title" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-bar">
          <p>Transporter profile</p>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close details">
            <XIcon size={18} />
          </button>
        </div>

        <div className="drawer-scroll">
          <div className="profile-cover" aria-hidden="true" />
          <div className="drawer-hero profile-hero">
            <button type="button" ref={imageButton} className="profile-photo-btn" onClick={() => setPreview(true)}
                    aria-label={`View ${row.transport_name} logo/image`} title="View logo/image">
              <TransporterPhoto name={row.transport_name} photoUrl={row.photo_url} className="profile-photo" />
              <span className="profile-photo-zoom" aria-hidden="true"><ZoomIcon size={14} /></span>
            </button>
            <div className="profile-identity">
              <h2 id="drawer-title">{row.transport_name}</h2>
              <div className="chip-row">
                <StatusBadge status={row.status} />
                <TypeChip name={row.transport_name} />
              </div>
              {row.photo_url && <p className="photo-source">{photoSourceText(row.photo_source)}</p>}
            </div>
            {row.contact_number && (
              <div className="drawer-quick">
                <a className="btn btn-primary" href={`tel:${row.contact_number.split(",")[0].trim()}`}>
                  <PhoneIcon size={16} /> Call
                </a>
                <button type="button" className="btn btn-outline" onClick={() => copy(row.contact_number as string, "number")}>
                  {copied === "number" ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
                  {copied === "number" ? "Copied" : "Copy number"}
                </button>
              </div>
            )}
          </div>

          <div className="drawer-tabs">
            <div className="segmented segmented-full" role="tablist" aria-label="Details">
              <button type="button" role="tab" aria-selected={tab === "overview"} className={`segmented-btn ${tab === "overview" ? "active" : ""}`} onClick={() => setTab("overview")}>
                Overview
              </button>
              <button type="button" role="tab" aria-selected={tab === "coverage"} className={`segmented-btn ${tab === "coverage" ? "active" : ""}`} onClick={() => setTab("coverage")}>
                Coverage
              </button>
            </div>
          </div>

          {tab === "overview" ? (
            <div className="drawer-body">
              <div className="facts">
                <Fact icon={<PhoneIcon size={16} />} label="Mobile">{row.contact_number || NA}</Fact>
                <Fact icon={<CityIcon size={16} />} label="Service Cities">
                  <CompactList items={cities} />
                  {cities.length > 3 && (
                    <button type="button" className="link-btn" onClick={() => setTab("coverage")}>
                      See all {cities.length}
                    </button>
                  )}
                </Fact>
                <Fact icon={<HashIcon size={16} />} label="Pincode">
                  <PincodeSummary pins={pins} />
                  {pins.length > PINCODE_PREVIEW && (
                    <button type="button" className="link-btn" onClick={() => setTab("coverage")}>
                      See all {pins.length}
                    </button>
                  )}
                </Fact>
                <Fact icon={<TruckIcon size={16} />} label="Approx. Shipment Charge / 1 Box (₹)">
                  {charge ?? <span className="na">{NA}</span>}
                </Fact>
                <Fact icon={<CheckCircleIcon size={16} />} label="Status">{row.status || NA}</Fact>
                <Fact icon={<TagIcon size={16} />} label="Transport Type" hint="guessed from the name">{type}</Fact>
              </div>
              <div className="alert alert-info">
                <InfoIcon size={18} />
                <p>A result means this transporter has carried an order to this area before. It isn't a promise that they serve it today.</p>
              </div>
            </div>
          ) : (
            <div className="drawer-body">
              <section className="drawer-section">
                <h3>Service Cities{cities.length > 0 ? ` (${cities.length})` : ""}</h3>
                <CityChips cities={cities} />
              </section>
              <section className="drawer-section">
                <h3>Pincodes{pins.length > 0 ? ` (${pins.length})` : ""}</h3>
                {pins.length ? (
                  <ul className="pin-chips" aria-label="Pincodes">
                    {pins.map((p) => (
                      <li key={p} className="pin-chip">{p}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="na">{NA}</p>
                )}
              </section>
            </div>
          )}
        </div>

        <div className="drawer-foot">
          <button type="button" className="btn btn-primary btn-block" onClick={() => copy(info, "info")}>
            {copied === "info" ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
            {copied === "info" ? "Copied" : "Copy information"}
          </button>
        </div>
      </aside>
      {preview && createPortal(
        <ImagePreview name={row.transport_name} photoUrl={row.photo_url} source={row.photo_source} onClose={closePreview} />,
        document.body,
      )}
    </div>
  );
}

/** Larger view of the transporter's image (view-only, both roles): the same image the profile shows --
 * Admin upload, else official logo, else the short name. Closes on ×, a click outside, or Escape. */
function ImagePreview({ name, photoUrl, source, onClose }: {
  name: string; photoUrl?: string | null; source?: PhotoSource; onClose: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => closeButton.current?.focus(), []);
  const caption = photoUrl ? photoSourceText(source) : "";
  return (
    <div className="lightbox-overlay" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="lightbox" role="dialog" aria-modal="true" aria-label={`${name} logo/image`} onClick={(e) => e.stopPropagation()}>
        <button type="button" ref={closeButton} className="icon-btn lightbox-close" onClick={onClose} aria-label="Close image preview">
          <XIcon size={18} />
        </button>
        <div className="lightbox-frame">
          <TransporterPhoto name={name} photoUrl={photoUrl} className="lightbox-image" />
        </div>
        <p className="lightbox-name">{name}</p>
        {caption && <p className="lightbox-caption">{caption}</p>}
      </div>
    </div>
  );
}
