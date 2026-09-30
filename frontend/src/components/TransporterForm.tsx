import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { MAX_PHOTO_BYTES, OverrideStatus, PHOTO_TYPES } from "../services/overridesApi";
import { AlertIcon, CheckCircleIcon, PencilIcon, PlusIcon, TrashIcon, XIcon } from "./Icons";
import { Avatar, TransporterPhoto, TypeChip } from "./ui";

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
  shipment_charge?: string; // Edit only: approx. charge per box in rupees, "" = not set
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

/** Manage Transporters' Edit and Add form: every transporter-level field. */
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
      ...(isAdd ? {} : { shipment_charge: cleanedCharge }),
    });
  };

  const shownError = error || serverError;

  return (
    <form className="modal-form transporter-form" onSubmit={submit} noValidate>
      <header className="modal-head">
        <span className={`modal-head-icon ${isAdd ? "tone-violet" : "tone-blue"}`}>
          {isAdd ? <PlusIcon size={20} /> : <PencilIcon size={20} />}
        </span>
        <div className="modal-head-text">
          <h3>{isAdd ? "Add Transporter" : "Edit transporter"}</h3>
          <p>
            {isAdd
              ? "Added and shown locally. Not backed by a real order."
              : "Changes apply to every row of this transporter and show in Search right away."}
          </p>
        </div>
        <button type="button" className="icon-btn icon-btn-ghost" aria-label="Close" onClick={onCancel}>
          <XIcon size={18} />
        </button>
      </header>

      <div className="modal-body">
        {!isAdd && (
          <div className="source-summary">
            <span aria-hidden="true">{/* the image field below is the accessible one */}
              <Avatar name={initial.name} size="sm" photoUrl={initial.photo_url} />
            </span>
            <div>
              <p className="source-summary-name">{initial.name}</p>
              <p className="source-summary-meta">
                {initial.service_cities.length} service {initial.service_cities.length === 1 ? "city" : "cities"} ·{" "}
                {initial.pincodes.length} pincode{initial.pincodes.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>
        )}

        <fieldset className="form-section">
          <legend>Transporter image</legend>
          <div className="photo-field">
            {previewUrl ? (
              <img className="transporter-photo photo-field-preview" src={previewUrl} alt="New image preview" />
            ) : (
              <TransporterPhoto name={name || "Transporter"} photoUrl={photoFile ? null : currentPhoto} className="photo-field-preview" />
            )}
            <div className="photo-field-actions">
              <label className="btn btn-outline btn-sm photo-upload">
                <input type="file" accept={PHOTO_TYPES.join(",")} className="sr-only" onChange={pickPhoto} />
                {hasPhoto ? "Replace image" : "Upload image"}
              </label>
              {canRemove && (
                <button type="button" className="btn btn-sm photo-remove" onClick={removePhoto}>
                  <TrashIcon size={14} /> Remove image
                </button>
              )}
              <p className="hint">
                {photoFile
                  ? `Selected: ${photoFile.name} — saved when you click ${isAdd ? "Add Transporter" : "Save"}.`
                  : photoRemoved
                    ? official
                      ? "Your upload will be removed when you save; the official company logo will show again."
                      : "The image will be removed when you save."
                    : currentPhoto === official && official
                      ? "Showing the official company logo. Upload the company's own image to replace it if it's wrong."
                      : "Use the company's official logo or photo — JPEG, PNG or WebP, up to 2 MB. Shown on search results and the profile."}
              </p>
            </div>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend>Transporter</legend>
          <div className="form-grid">
            <label className="field">
              <span className="field-label">
                Transporter Name <span className="req">*</span>
              </span>
              <input className="edit-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Abhisek Travels" autoFocus />
            </label>
            <div className="field">
              <span className="field-label">Transport type · from the name</span>
              <div className="readonly-box">{name.trim() ? <TypeChip name={name} /> : <span className="na">—</span>}</div>
            </div>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend>Coverage</legend>
          <div className="form-stack">
            <label className="field">
              <span className="field-label">
                Service Cities <span className="field-count">{cityList.length}</span>
              </span>
              <textarea className="edit-input" rows={3} value={cities} onChange={(e) => setCities(e.target.value)}
                        placeholder="e.g. Mumbai, Pune, Thane" />
            </label>
            <label className="field">
              <span className="field-label">
                Pincode(s) <span className="field-count">{pinList.length}</span>
              </span>
              <textarea className="edit-input mono" rows={3} value={pincodes} onChange={(e) => setPincodes(e.target.value)}
                        placeholder="e.g. 400001, 411001" inputMode="numeric" />
            </label>
            <p className="hint">Separate with commas or new lines. Search matches exactly these cities and pincodes.</p>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend>Contact &amp; status</legend>
          <div className="form-grid">
            <label className="field">
              <span className="field-label">Mobile Number</span>
              <input className="edit-input" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="e.g. 9876543210"
                     inputMode="tel" />
            </label>
            <label className="field">
              <span className="field-label">Status</span>
              <select className="edit-input" value={status} onChange={(e) => setStatus(e.target.value as OverrideStatus)}>
                <option value="Active">Active</option>
                <option value="Not Active">Not Active</option>
              </select>
            </label>
            {!isAdd && (
              <div className="field">
                <label className="field-label" htmlFor="shipment-charge">Approx. Shipment Charge / 1 Box (₹)</label>
                <span className="input-prefix-wrap">
                  <span className="input-prefix" aria-hidden="true">₹</span>
                  <input id="shipment-charge" className="edit-input" value={charge} onChange={(e) => setCharge(e.target.value)}
                         placeholder="e.g. 75.50" inputMode="decimal" aria-describedby="shipment-charge-hint" />
                </span>
                <span className="hint" id="shipment-charge-hint">Entered by the Admin. Leave empty if not known.</span>
              </div>
            )}
          </div>
        </fieldset>

        {!isAdd && (
          <label className="switch-row">
            <span className="switch-text">
              <span className="switch-title">Hide from search</span>
              <span className="switch-sub">It stays here in Manage Transporters so you can show it again.</span>
            </span>
            <input type="checkbox" role="switch" className="switch-input" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
            <span className="switch" aria-hidden="true" />
          </label>
        )}

        {shownError && (
          <div className="alert alert-error" role="alert">
            <AlertIcon size={16} />
            <span>{shownError}</span>
          </div>
        )}
      </div>

      <footer className="modal-foot">
        <button type="button" className="btn btn-outline" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          <CheckCircleIcon size={16} />
          {saving ? "Saving…" : isAdd ? "Add Transporter" : "Save"}
        </button>
      </footer>
    </form>
  );
}
