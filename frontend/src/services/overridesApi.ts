// Transporter Management: local manual overrides only. Never touches the RDS/CSV/Excel data —
// see backend/app/services/overrides_store.py. Priority: RDS real data -> local override -> combined result.

import { withBase } from "./base";
import { loadSession } from "../session";

export type OverrideStatus = "Active" | "Not Active";

/** The signed-in session's token: every Manage/overrides request is checked for Admin on the server. */
function authHeader(): Record<string, string> {
  const token = loadSession()?.token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface Override {
  id: number;
  is_new: boolean;
  source_city: string | null;
  source_transport_name: string | null;
  source_pincode: string | null;
  override_transport_name: string | null;
  override_city: string | null;
  override_pincode: string | null;
  override_mobile: string | null;
  override_status: OverrideStatus | null;
  hidden: boolean;
  created_at: string;
  updated_at: string;
}

export interface OverrideFields {
  transport_name?: string | null;
  city?: string | null;
  pincode?: string | null;
  mobile?: string | null;
  status?: OverrideStatus | null;
  hidden?: boolean | null;
}

async function call(url: string, options?: RequestInit): Promise<any> {
  const res = await fetch(withBase(url), {
    ...options,
    headers: { "Content-Type": "application/json", ...authHeader() },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail ? String(detail.detail) : `Server error (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

export const listOverrides = (): Promise<Override[]> => call("/api/overrides");

/** Edit an existing (source-backed) row, identified by exactly what it currently shows. */
export const upsertExistingRowOverride = (
  source: { source_city: string | null; source_transport_name: string; source_pincode: string | null },
  fields: OverrideFields,
): Promise<Override> =>
  call("/api/overrides", { method: "POST", body: JSON.stringify({ ...source, ...fields }) });

export const createNewTransporter = (fields: OverrideFields & { transport_name: string }): Promise<Override> =>
  call("/api/overrides/new-transporter", { method: "POST", body: JSON.stringify(fields) });

export const updateOverride = (id: number, fields: OverrideFields): Promise<Override> =>
  call(`/api/overrides/${id}`, { method: "PATCH", body: JSON.stringify(fields) });

export const deleteOverride = (id: number): Promise<void> => call(`/api/overrides/${id}`, { method: "DELETE" });

// --- Manage Transporters (Admin): one row per transporter, actions apply to all of its rows ---

export interface ManagedTransporter {
  transport_name: string;
  service_cities: string[];
  pincodes: string[];
  mobile: string | null;
  status: OverrideStatus;
  hidden: boolean;
  added_locally: boolean;
  edited: boolean;
  photo_url?: string | null; // Admin-uploaded photo, else a verified official logo
  photo_source?: "admin" | "official" | null;
  shipment_charge?: string | null; // Admin-entered approx. charge per box in rupees
}

export interface ManageList {
  results: ManagedTransporter[];
  total: number;
  deleted: string[];
}

export interface TransporterSettings {
  name?: string; // new displayed name
  service_cities?: string[]; // replaces the whole list
  pincodes?: string[]; // replaces the whole list
  status?: OverrideStatus;
  mobile?: string;
  hidden?: boolean;
  shipment_charge?: string; // rupees per box, e.g. "75.50"; "" clears it
}

export interface NewTransporter {
  transport_name: string;
  service_cities: string[];
  pincodes: string[];
  mobile?: string;
  status: OverrideStatus;
}

export const listManagedTransporters = (): Promise<ManageList> => call("/api/manage/transporters");

export const addTransporter = (t: NewTransporter): Promise<unknown> =>
  call("/api/manage/transporters", { method: "POST", body: JSON.stringify(t) });

export const updateTransporter = (transport_name: string, fields: TransporterSettings): Promise<unknown> =>
  call("/api/manage/transporters", { method: "PATCH", body: JSON.stringify({ transport_name, ...fields }) });

export const deleteTransporter = (transport_name: string): Promise<unknown> =>
  call(`/api/manage/transporters?${new URLSearchParams({ transport_name })}`, { method: "DELETE" });

export const restoreTransporter = (transport_name: string): Promise<unknown> =>
  call("/api/manage/transporters/restore", { method: "POST", body: JSON.stringify({ transport_name }) });

// --- Transporter profile photo (Admin): stored in the local SQLite file only, never RDS ---

export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/** Sends the image file itself as the request body (the server checks its real bytes). */
export async function uploadTransporterPhoto(transport_name: string, file: File): Promise<{ photo_url: string }> {
  const res = await fetch(withBase(`/api/manage/transporters/photo?${new URLSearchParams({ transport_name })}`), {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream", ...authHeader() },
    body: file,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail ? String(detail.detail) : `Could not upload the photo (${res.status})`);
  }
  return res.json();
}

export const removeTransporterPhoto = (transport_name: string): Promise<unknown> =>
  call(`/api/manage/transporters/photo?${new URLSearchParams({ transport_name })}`, { method: "DELETE" });
