import { FormEvent, useState } from "react";
import type { OverrideFields, OverrideStatus } from "../services/overridesApi";
import { AlertIcon, CheckCircleIcon, PencilIcon, XIcon } from "./Icons";

interface EditInitial {
  transport_name?: string | null;
  city?: string | null;
  pincode?: string | null;
  mobile?: string | null;
  status?: string | null; // any status text is accepted here; only "Active"/"Not Active" is submitted
}

interface Props {
  title: string;
  initial: EditInitial;
  saving?: boolean;
  serverError?: string | null;
  onSave: (fields: OverrideFields) => void;
  onCancel: () => void;
}

/** Edit form for one row-level local override (Current local overrides). Only non-empty fields
 * are sent, so leaving a field blank means "keep whatever the real source shows" (per the RDS ->
 * override -> combined-result rule). */
export default function TransporterEditForm({ title, initial, saving, serverError, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial.transport_name ?? "");
  const [city, setCity] = useState(initial.city ?? "");
  const [pincode, setPincode] = useState(initial.pincode ?? "");
  const [mobile, setMobile] = useState(initial.mobile ?? "");
  const [status, setStatus] = useState<OverrideStatus | "">(
    initial.status === "Active" || initial.status === "Not Active" ? initial.status : "",
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave({
      transport_name: name.trim() || undefined,
      city: city.trim() || undefined,
      pincode: pincode.trim() || undefined,
      mobile: mobile.trim() || undefined,
      status: (status as OverrideStatus) || undefined,
    });
  };

  return (
    <form className="modal-form" onSubmit={submit}>
      <header className="modal-head">
        <span className="modal-head-icon tone-blue">
          <PencilIcon size={20} />
        </span>
        <div className="modal-head-text">
          <h3>{title}</h3>
          <p>Leave a field blank to keep the real value from the data source.</p>
        </div>
        <button type="button" className="icon-btn icon-btn-ghost" aria-label="Close" onClick={onCancel}>
          <XIcon size={18} />
        </button>
      </header>

      <div className="modal-body">
        <fieldset className="form-section">
          <legend>Row</legend>
          <div className="form-grid">
            <label className="field">
              <span className="field-label">Transport Name</span>
              <input className="edit-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. TCI Express" />
            </label>
            <label className="field">
              <span className="field-label">City</span>
              <input className="edit-input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Rajkot" />
            </label>
            <label className="field">
              <span className="field-label">Pincode</span>
              <input className="edit-input mono" value={pincode} onChange={(e) => setPincode(e.target.value)}
                     inputMode="numeric" maxLength={6} placeholder="e.g. 360003" />
            </label>
            <label className="field">
              <span className="field-label">Mobile</span>
              <input className="edit-input" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="e.g. 9876543210" />
            </label>
            <label className="field">
              <span className="field-label">Status</span>
              <select className="edit-input" value={status} onChange={(e) => setStatus(e.target.value as OverrideStatus | "")}>
                <option value="">Keep as-is</option>
                <option value="Active">Active</option>
                <option value="Not Active">Not Active</option>
              </select>
            </label>
          </div>
        </fieldset>

        {serverError && (
          <div className="alert alert-error" role="alert">
            <AlertIcon size={16} />
            <span>{serverError}</span>
          </div>
        )}
      </div>

      <footer className="modal-foot">
        <button type="button" className="btn btn-outline" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          <CheckCircleIcon size={16} />
          {saving ? "Saving…" : "Save"}
        </button>
      </footer>
    </form>
  );
}
