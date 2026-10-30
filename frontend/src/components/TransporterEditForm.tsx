import { FormEvent, useState } from "react";
import type { OverrideFields, OverrideStatus } from "../services/overridesApi";
import { AlertIcon } from "./Icons";
import { ModalHead } from "./Modal";

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
    <form onSubmit={submit}>
      <ModalHead title={title} sub="Leave a field blank to keep the real value from the data source." onClose={onCancel} />
      <div className="formgrid">
        <div className="field">
          <label htmlFor="ov-name">Transport Name</label>
          <input id="ov-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. TCI Express" />
        </div>
        <div className="field">
          <label htmlFor="ov-city">City</label>
          <input id="ov-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Rajkot" />
        </div>
        <div className="field">
          <label htmlFor="ov-pin">Pincode</label>
          <input id="ov-pin" className="mono" value={pincode} onChange={(e) => setPincode(e.target.value)}
                 inputMode="numeric" maxLength={6} placeholder="e.g. 360003" />
        </div>
        <div className="field">
          <label htmlFor="ov-mobile">Mobile</label>
          <input id="ov-mobile" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="e.g. 9876543210" />
        </div>
        <div className="field">
          <label htmlFor="ov-status">Status</label>
          <select id="ov-status" value={status} onChange={(e) => setStatus(e.target.value as OverrideStatus | "")}>
            <option value="">Keep as-is</option>
            <option value="Active">Active</option>
            <option value="Not Active">Not Active</option>
          </select>
        </div>
      </div>

      {serverError && (
        <div className="alert error" role="alert">
          <AlertIcon size={16} />
          <span>{serverError}</span>
        </div>
      )}

      <div className="actions">
        <button type="button" className="ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </form>
  );
}
