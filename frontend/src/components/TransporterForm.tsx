import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { MAX_PHOTO_BYTES, OverrideStatus, PHOTO_TYPES } from "../services/overridesApi";
import { deriveTransportType } from "../searchDefaults";
import { AlertIcon, TrashIcon } from "./Icons";
import { ModalHead } from "./Modal";
import { Avatar, TransporterPhoto } from "./ui";

export interface TransporterFormValues {
  name: string;
  service_cities: string[];
  pincodes: string[];
  mobile: string;
  status: OverrideStatus;
  hidden: boolean;
  photo_url?: string | null; // the current image (initial values only)
  photo_source?: "admin" | "official" | null; // where that image comes from
  photo?: File | null; // on save: a new photo to upload, null to remove it, undefined = unchanged
  shipment_charge?: string; // approx. charge per box in rupees, "" = not set
}

/** Same rule as the server: rupees with up to 2 decimals ("45", "75.50"); a leading ₹ or commas are fine. */
export function cleanCharge(text: string): string | null {
  const t = text.replace(/[₹,\s]/g, "");
  return t === "" || /^\d+(\.\d{1,2})?$/.test(t) ? t : null;
}

interface Props {
  mode: "add" | "edit";
  initial: TransporterFormValues;
  saving?: boolean;
  serverError?: string | null;
  onSave: (values: TransporterFormValues) => void;
  onCancel: () => void;
}

/** Comma- or line-separated text -> trimmed, de-duplicated list (cities case-insensitively). */
export function parseList(text: string, caseInsensitive = true): string[] {
  const seen = new Map<string, string>();
  for (const raw of text.split(/[,\n]/)) {
    const v = raw.trim().replace(/\s+/g, " ");
    const k = caseInsensitive ? v.toLowerCase() : v;
    if (v && !seen.has(k)) seen.set(k, v);
  }
  return [...seen.values()];
}

/** Manage Transporters' Add and Edit form: every transporter-level field. */
export default function TransporterForm({ mode, initial, saving, serverError, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial.name);
  const [cities, setCities] = useState(initial.service_cities.join(", "));
  const [pincodes, setPincodes] = useState(initial.pincodes.join(", "));
  const [mobile, setMobile] = useState(initial.mobile);
  const [status, setStatus] = useState<OverrideStatus>(initial.status);
  const [hidden, setHidden] = useState(initial.hidden);
  const [charge, setCharge] = useState(initial.shipment_charge ?? "");
  const [error, setError] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Local preview of a newly chosen photo (not uploaded until Save).
  useEffect(() => {
    if (!photoFile || typeof URL.createObjectURL !== "function") return setPreviewUrl(null);
    const url = URL.createObjectURL(photoFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  // An official logo isn't an upload: it can be replaced by one, not removed (it shows again if the upload is removed).
  const official = initial.photo_source === "official" ? initial.photo_url ?? null : null;
  const uploaded = initial.photo_source === "official" ? null : initial.photo_url ?? null;
  const currentPhoto = photoRemoved ? official : uploaded ?? official;
  const hasPhoto = Boolean(photoFile || currentPhoto);
  const canRemove = Boolean(photoFile || (uploaded && !photoRemoved));

  const pickPhoto = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // choosing the same file again still fires a change
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) return setError("The image must be a JPEG, PNG or WebP file.");
    if (file.size > MAX_PHOTO_BYTES) return setError("The image must be 2 MB or smaller.");
    setError(null);
    setPhotoFile(file);
    setPhotoRemoved(false);
  };

  const removePhoto = () => {
    setPhotoFile(null);
    setPhotoRemoved(Boolean(uploaded));
  };

  const cityList = parseList(cities);
  const pinList = parseList(pincodes, false);
  const isAdd = mode === "add";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("Transporter Name is required.");
    const bad = pinList.filter((p) => !/^\d{6}$/.test(p));
    if (bad.length) return setError(`Pincodes must be 6 digits: ${bad.join(", ")}`);
    const cleanedCharge = cleanCharge(charge);
    if (cleanedCharge === null) return setError("Approx. Shipment Charge / 1 Box must be an amount in rupees with up to 2 decimals, e.g. 45 or 75.50.");
    setError(null);
    onSave({
      name: name.trim().replace(/\s+/g, " "), service_cities: cityList, pincodes: pinList, mobile: mobile.trim(), status, hidden,
      photo: photoFile ?? (photoRemoved ? null : undefined),
      shipment_charge: cleanedCharge,
    });
  };

  const shownError = error || serverError;

  return (
    <form onSubmit={submit} noValidate>
      <ModalHead
        title={isAdd ? "Add transporter" : "Edit transporter"}
        sub={isAdd
          ? "Added and shown locally. Not backed by a real order."
          : "Changes apply to every row of this transporter and show in Search right away."}
        onClose={onCancel}
      />

      {!isAdd && (
        <div className="source-summary">
          <span aria-hidden="true">{/* the image field below is the accessible one */}
            <Avatar name={initial.name} size="sm" photoUrl={initial.photo_url} />
          </span>
          <div>
            <b className="source-summary-name">{initial.name}</b>
            <span>
              {initial.service_cities.length} service {initial.service_cities.length === 1 ? "city" : "cities"} ·{" "}
              {initial.pincodes.length} pincode{initial.pincodes.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
      )}

      <div className="formgrid">
        <div className="field">
          <label htmlFor="tf-name">Transporter name <span className="req">*</span></label>
          <input id="tf-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. TCI Express" autoFocus />
        </div>
        <div className="field">
          <span className="label">Transport type · from the name</span>
          <input value={name.trim() ? deriveTransportType(name) : "—"} disabled aria-label="Transport type (from the name)" />
        </div>
        <div className="field">
          <label htmlFor="tf-cities">Service cities (comma separated) <span className="count">{cityList.length}</span></label>
          <textarea id="tf-cities" rows={3} value={cities} onChange={(e) => setCities(e.target.value)} placeholder="e.g. Mumbai, Pune, Thane" />
        </div>
        <div className="field">
          <label htmlFor="tf-pins">Pincodes (comma separated) <span className="count">{pinList.length}</span></label>
          <textarea id="tf-pins" className="mono" rows={3} value={pincodes} onChange={(e) => setPincodes(e.target.value)}
                    placeholder="e.g. 400001, 411001" inputMode="numeric" />
        </div>
        <div className="field">
          <label htmlFor="tf-mobile">Mobile number</label>
          <input id="tf-mobile" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="10-digit mobile" inputMode="tel" />
        </div>
        <div className="field">
          <label htmlFor="shipment-charge">Approx. Shipment Charge / 1 Box (₹)</label>
          <span className="prefix-wrap">
            <span aria-hidden="true">₹</span>
            <input id="shipment-charge" value={charge} onChange={(e) => setCharge(e.target.value)} placeholder="e.g. 75.50"
                   inputMode="decimal" aria-describedby="shipment-charge-hint" />
          </span>
          <span className="hint" id="shipment-charge-hint">Entered by the Admin. Leave empty if not known.</span>
        </div>
        <div className="field">
          <label htmlFor="tf-status">Status</label>
          <select id="tf-status" value={status} onChange={(e) => setStatus(e.target.value as OverrideStatus)}>
            <option value="Active">Active</option>
            <option value="Not Active">Not Active</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="tf-visibility">Visibility</label>
          <select id="tf-visibility" value={hidden ? "hidden" : "visible"} onChange={(e) => setHidden(e.target.value === "hidden")}>
            <option value="visible">Visible</option>
            <option value="hidden">Hidden</option>
          </select>
        </div>
        <div className="field full">
          <span className="label">Logo / photo upload</span>
          <div className="photo-field">
            {previewUrl ? (
              <img className="logo lg" src={previewUrl} alt="New image preview" />
            ) : (
              <TransporterPhoto name={name || "Transporter"} photoUrl={photoFile ? null : currentPhoto} className="lg" />
            )}
            <div className="photo-field-actions">
              <div>
                <label className="btn secondary sm upload-btn">
                  <input type="file" accept={PHOTO_TYPES.join(",")} onChange={pickPhoto} aria-label={hasPhoto ? "Replace image" : "Upload image"} />
                  {hasPhoto ? "Replace image" : "Upload image"}
                </label>
                {canRemove && (
                  <button type="button" className="btn danger sm" onClick={removePhoto}>
                    <TrashIcon size={14} /> Remove image
                  </button>
                )}
              </div>
              <p className="hint">
                {photoFile
                  ? `Selected: ${photoFile.name} — saved when you click ${isAdd ? "Add transporter" : "Save transporter"}.`
                  : photoRemoved
                    ? official
                      ? "Your upload will be removed when you save; the official company logo will show again."
                      : "The image will be removed when you save."
                    : currentPhoto === official && official
                      ? "Showing the official company logo. Upload the company's own image to replace it if it's wrong."
                      : "Use the company's official logo or photo — JPEG, PNG or WebP, up to 2 MB."}
              </p>
            </div>
          </div>
        </div>
      </div>

      {shownError && (
        <div className="alert error" role="alert">
          <AlertIcon size={16} />
          <span>{shownError}</span>
        </div>
      )}

      <div className="actions">
        <button type="button" className="ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn" disabled={saving}>
          {saving ? "Saving…" : isAdd ? "Add transporter" : "Save transporter"}
        </button>
      </div>
    </form>
  );
}
