import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CompactList, PincodeSummary } from "../components/CityList";
import { AlertIcon, ChevronDownIcon, EmptyIcon, InfoIcon, PlusIcon, RotateCcwIcon, SearchIcon, XIcon } from "../components/Icons";
import Modal from "../components/Modal";
import { Avatar, OverrideBadge, OverrideKind, Pagination, StatusBadge } from "../components/ui";
import { deriveTransportType } from "../searchDefaults";
import TransporterEditForm from "../components/TransporterEditForm";
import TransporterForm, { TransporterFormValues } from "../components/TransporterForm";
import {
  addTransporter, deleteOverride, deleteTransporter, listManagedTransporters, listOverrides,
  ManagedTransporter, ManageList, Override, OverrideFields, removeTransporterPhoto, restoreTransporter,
  TransporterSettings, updateOverride, updateTransporter, uploadTransporterPhoto,
} from "../services/overridesApi";

const PAGE_SIZE = 25;
const NA = "Not Available";

type Editing =
  | { kind: "transporter"; t: ManagedTransporter }
  | { kind: "override"; override: Override }
  | { kind: "new" };

type StatusFilter = "all" | "active" | "inactive" | "hidden";
const FILTER_LABEL: Record<StatusFilter, string> = {
  all: "Transporter directory", active: "Active transporters", inactive: "Not Active transporters", hidden: "Hidden transporters",
};

/** Case/spacing/punctuation-insensitive, like the backend's own name matching. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const sameList = (a: string[], b: string[]) => {
  const k = (xs: string[]) => JSON.stringify(xs.map((x) => x.toLowerCase()).sort());
  return k(a) === k(b);
};

export default function ManageTransporters() {
  const [list, setList] = useState<ManageList | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const directoryRef = useRef<HTMLElement | null>(null);

  const [overrides, setOverrides] = useState<Override[] | null>(null);
  const [overridesError, setOverridesError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [deletedOpen, setDeletedOpen] = useState(false); // Recently deleted starts collapsed

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const refresh = useCallback(() => {
    listManagedTransporters()
      .then((l) => {
        setList(l);
        setListError(null);
      })
      .catch((e) => setListError(e instanceof Error ? e.message : "Could not load transporters."));
    listOverrides()
      .then(setOverrides)
      .catch((e) => setOverridesError(e instanceof Error ? e.message : "Could not load overrides."));
  }, []);

  useEffect(refresh, [refresh]);

  // A save error belongs to the panel it happened in; don't carry it into the next one.
  useEffect(() => setActionError(null), [editing]);

  const byStatus = useMemo(() => {
    const all = list?.results ?? [];
    switch (statusFilter) {
      case "active":
        return all.filter((t) => t.status === "Active");
      case "inactive":
        return all.filter((t) => t.status !== "Active");
      case "hidden":
        return all.filter((t) => t.hidden);
      default:
        return all;
    }
  }, [list, statusFilter]);

  const filtered = useMemo(() => {
    const q = norm(query);
    return q ? byStatus.filter((t) => norm(t.transport_name).includes(q)) : byStatus;
  }, [byStatus, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const pageRows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const counts = useMemo(() => {
    const all = list?.results ?? [];
    return {
      active: all.filter((t) => t.status === "Active").length,
      inactive: all.filter((t) => t.status !== "Active").length,
      hidden: all.filter((t) => t.hidden).length,
    };
  }, [list]);

  const run = async (action: () => Promise<unknown>, done?: string) => {
    setActionError(null);
    try {
      await action();
      refresh();
      if (done) setToast(done);
      return true;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not save.");
      return false;
    }
  };

  const toggleHidden = (t: ManagedTransporter) =>
    run(() => updateTransporter(t.transport_name, { hidden: !t.hidden }), t.hidden ? "Transporter unhidden" : "Transporter hidden");

  const remove = (t: ManagedTransporter) => {
    const ok = window.confirm(
      `Delete "${t.transport_name}"?\n\nIt will be removed from Search and from this list. ` +
        "The real data source is not changed, and you can restore it from Recently deleted.",
    );
    if (ok) run(() => deleteTransporter(t.transport_name), "Moved to Recently deleted");
  };

  const finish = (done: boolean) => {
    setSaving(false);
    if (done) setEditing(null);
  };

  // A photo change is sent after the transporter itself is saved, under its (possibly new) name.
  const savePhoto = async (name: string, photo: File | null | undefined) => {
    if (photo instanceof File) await uploadTransporterPhoto(name, photo);
    else if (photo === null) await removeTransporterPhoto(name);
  };

  const saveTransporter = async (v: TransporterFormValues) => {
    if (!editing || editing.kind === "override") return;
    setSaving(true);
    if (editing.kind === "new") {
      return finish(await run(async () => {
        await addTransporter({
          transport_name: v.name, service_cities: v.service_cities, pincodes: v.pincodes,
          mobile: v.mobile || undefined, status: v.status,
        });
        // Adding takes the core fields; a charge or "Hidden" set in the same form is saved right after.
        const extra: TransporterSettings = {};
        if (v.shipment_charge) extra.shipment_charge = v.shipment_charge;
        if (v.hidden) extra.hidden = true;
        if (Object.keys(extra).length) await updateTransporter(v.name, extra);
        await savePhoto(v.name, v.photo);
      }, "Transporter added"));
    }
    const t = editing.t;
    // Only what actually changed, so e.g. an untouched Mobile or pincode list isn't pinned as an override.
    const changes: TransporterSettings = {};
    if (v.name !== t.transport_name) changes.name = v.name;
    if (!sameList(v.service_cities, t.service_cities)) changes.service_cities = v.service_cities;
    if (!sameList(v.pincodes, t.pincodes)) changes.pincodes = v.pincodes;
    if (v.mobile !== (t.mobile ?? "")) changes.mobile = v.mobile;
    if (v.status !== t.status) changes.status = v.status;
    if (v.hidden !== t.hidden) changes.hidden = v.hidden;
    if ((v.shipment_charge ?? "") !== (t.shipment_charge ?? "")) changes.shipment_charge = v.shipment_charge ?? "";
    if (Object.keys(changes).length === 0 && v.photo === undefined) return finish(true);
    finish(await run(async () => {
      if (Object.keys(changes).length) await updateTransporter(t.transport_name, changes);
      await savePhoto(v.name, v.photo);
    }, "Transporter saved"));
  };

  const saveOverride = async (fields: OverrideFields) => {
    if (editing?.kind !== "override") return;
    setSaving(true);
    finish(await run(() => updateOverride(editing.override.id, fields), "Override saved"));
  };

  const closeEditor = useCallback(() => setEditing(null), []);

  const editor = () => {
    if (!editing) return null;
    if (editing.kind === "override") {
      const o = editing.override;
      return (
        <TransporterEditForm
          key={o.id}
          title={`Edit override: ${o.override_transport_name ?? o.source_transport_name}`}
          initial={{ transport_name: o.override_transport_name, city: o.override_city, pincode: o.override_pincode,
                     mobile: o.override_mobile, status: o.override_status }}
          saving={saving}
          serverError={actionError}
          onSave={saveOverride}
          onCancel={closeEditor}
        />
      );
    }
    const t = editing.kind === "transporter" ? editing.t : null;
    return (
      <TransporterForm
        key={t?.transport_name ?? "new"}
        mode={t ? "edit" : "add"}
        initial={t
          ? { name: t.transport_name, service_cities: t.service_cities, pincodes: t.pincodes, mobile: t.mobile ?? "",
              status: t.status, hidden: t.hidden, photo_url: t.photo_url ?? null, photo_source: t.photo_source ?? null,
              shipment_charge: t.shipment_charge ?? "" }
          : { name: "", service_cities: [], pincodes: [], mobile: "", status: "Active", hidden: false, photo_url: null, shipment_charge: "" }}
        saving={saving}
        serverError={actionError}
        onSave={saveTransporter}
        onCancel={closeEditor}
      />
    );
  };

  const tiles: { label: string; value: number | undefined; filter: StatusFilter; hint: string }[] = [
    { label: "Transporters", value: list?.total, filter: "all", hint: "In the directory" },
    { label: "Active", value: list ? counts.active : undefined, filter: "active", hint: "Shown in Search" },
    { label: "Not Active", value: list ? counts.inactive : undefined, filter: "inactive", hint: "Left out of Search" },
    { label: "Hidden", value: list ? counts.hidden : undefined, filter: "hidden", hint: "Hidden by an Admin" },
  ];

  const applyFilter = (f: StatusFilter) => {
    setStatusFilter(f);
    setPage(1);
    directoryRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  return (
    <section>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Admin workspace</div>
          <h1 className="h1">Manage transporters</h1>
          <p className="sub">Maintain your transporter directory and visibility. Changes are saved locally — the RDS data is never changed.</p>
        </div>
        <button type="button" className="btn" onClick={() => setEditing({ kind: "new" })}>
          <PlusIcon size={16} /> Add transporter
        </button>
      </div>

      <div className="grid4" role="group" aria-label="Filter transporters by status">
        {tiles.map(({ label, value, filter, hint }) => (
          <button key={label} type="button" className={`stat ${statusFilter === filter ? "active" : ""}`}
                  aria-pressed={statusFilter === filter} onClick={() => applyFilter(filter)}>
            <div className="label">{label}</div>
            <div className="num">{value ?? "…"}</div>
            <div className="hint">{hint}</div>
          </button>
        ))}
      </div>

      {actionError && !editing && (
        <div className="alert error" role="alert">
          <AlertIcon size={16} />
          <span>{actionError}</span>
        </div>
      )}

      <section className="panel section" ref={directoryRef} aria-labelledby="directory-title">
        <div className="resulthead">
          <div>
            <h3 id="directory-title">{FILTER_LABEL[statusFilter]}</h3>
            <p>
              {statusFilter === "all"
                ? "Every transporter, including Not Active and hidden ones. Search, edit or update visibility."
                : "Filtered from the summary cards above."}
            </p>
          </div>
          <div className="filterwrap">
            {statusFilter !== "all" && (
              <span className="filterpill">
                {FILTER_LABEL[statusFilter]}
                <button type="button" aria-label="Clear filter" onClick={() => applyFilter("all")}>
                  <XIcon size={12} />
                </button>
              </span>
            )}
            <span className="inputbox">
              <span className="glass"><SearchIcon size={14} /></span>
              <input
                className="filterinput"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Search name…"
                aria-label="Search transporter name"
              />
              {query && (
                <button type="button" className="clearbtn" aria-label="Clear search" onClick={() => { setQuery(""); setPage(1); }}>
                  <XIcon size={12} />
                </button>
              )}
            </span>
          </div>
        </div>

        {listError && (
          <div className="alert error" role="alert">
            <AlertIcon size={16} />
            <span>{listError}</span>
          </div>
        )}
        {!list && !listError && <p className="loading-line"><span className="spinner" aria-hidden="true" /> Loading transporters…</p>}

        {list && filtered.length === 0 && (
          <div className="empty" role="status">
            <span className="empty-icon"><EmptyIcon size={24} /></span>
            <h3>No transporters found</h3>
            <p>
              {query
                ? `No transporter name matches "${query}"${statusFilter !== "all" ? ` among ${FILTER_LABEL[statusFilter].toLowerCase()}` : ""}.`
                : statusFilter !== "all"
                  ? `There are no ${FILTER_LABEL[statusFilter].toLowerCase()} right now.`
                  : "No transporters in the data yet. Try another name or add a transporter."}
            </p>
          </div>
        )}

        {pageRows.length > 0 && (
          <>
            <p className="hint" style={{ marginBottom: 10 }}>
              {filtered.length} transporter{filtered.length === 1 ? "" : "s"}
              {query ? ` matching "${query}"` : ""}
            </p>
            <div className="tablewrap flat" tabIndex={0} role="region" aria-label="All transporters table">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Transporter</th>
                    <th scope="col">Mobile</th>
                    <th scope="col">Service Cities</th>
                    <th scope="col">Pincodes</th>
                    <th scope="col">Status</th>
                    <th scope="col">Visibility</th>
                    <th scope="col" className="actions-cell">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((t) => (
                    <tr key={t.transport_name} className={t.hidden ? "muted-row" : undefined}>
                      <td>
                        <span className="namecell">
                          <Avatar name={t.transport_name} size="sm" photoUrl={t.photo_url} />
                          <span>
                            <b className="transport-name">{t.transport_name}</b>
                            <span className="badges">
                              <span className="chip muted">{deriveTransportType(t.transport_name)}</span>
                              {t.added_locally && <OverrideBadge kind="Added" />}
                              {t.edited && <OverrideBadge kind="Edited" />}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className={t.mobile ? "phone nowrap" : "na nowrap"}>{t.mobile || NA}</td>
                      <td><CompactList items={t.service_cities} /></td>
                      <td><PincodeSummary pins={t.pincodes} /></td>
                      <td><StatusBadge status={t.status} /></td>
                      <td>{t.hidden ? <OverrideBadge kind="Hidden" /> : <span className="tag good">Visible</span>}</td>
                      <td className="actions-cell">
                        <span aria-label={`Actions for ${t.transport_name}`} role="group">
                          <button type="button" className="linkbtn" onClick={() => setEditing({ kind: "transporter", t })}>Edit</button>
                          <button type="button" className="linkbtn" title={t.hidden ? "Show in search" : "Hide from search"}
                                  onClick={() => toggleHidden(t)}>
                            {t.hidden ? "Unhide" : "Hide"}
                          </button>
                          <button type="button" className="linkbtn danger" onClick={() => remove(t)}>Delete</button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={current} totalPages={totalPages} total={filtered.length} pageSize={PAGE_SIZE} onPage={setPage} />
          </>
        )}
      </section>

      <section className="panel section" aria-labelledby="deleted-title">
        <div className="resulthead">
          <div>
            <h3 id="deleted-title">
              Recently deleted {list && list.deleted.length > 0 && <span className="count">{list.deleted.length}</span>}
            </h3>
            <p>{!list || list.deleted.length === 0 ? "No deleted transporters." : "Removed from Search and the directory above. Restore to bring one back."}</p>
          </div>
          {list && list.deleted.length > 0 && (
            <button type="button" className="btn secondary sm" aria-expanded={deletedOpen} aria-controls="deleted-list"
                    onClick={() => setDeletedOpen((v) => !v)}>
              {deletedOpen ? "Hide" : `Show ${list.deleted.length}`}
              <span className={`chev ${deletedOpen ? "up" : ""}`}><ChevronDownIcon size={14} /></span>
            </button>
          )}
        </div>
        {list && list.deleted.length > 0 && deletedOpen && (
          <>
            <div className="tablewrap flat" id="deleted-list">
              <table className="data" style={{ minWidth: 0 }}>
                <tbody>
                  {list.deleted.map((name) => (
                    <tr key={name}>
                      <td>
                        <span className="namecell">
                          <Avatar name={name} size="sm" />
                          <b>{name}</b>
                        </span>
                      </td>
                      <td className="actions-cell">
                        <button type="button" className="linkbtn" onClick={() => run(() => restoreTransporter(name), "Transporter restored")}>
                          <RotateCcwIcon size={12} /> Restore
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="panel section" aria-labelledby="overrides-title">
        <h3 id="overrides-title">
          Current local overrides <span className="count">{overrides ? overrides.length : "…"}</span>
        </h3>
        <p className="sub">Row-level edits, hides and added transporters.</p>
        <div className="alert info">
          <InfoIcon size={16} />
          <span>These are applied on top of the RDS data, which is never changed. Deleting an edit brings back the original values.</span>
        </div>
        {overridesError && (
          <div className="alert error" role="alert">
            <AlertIcon size={16} />
            <span>{overridesError}</span>
          </div>
        )}
        {overrides && overrides.length === 0 && <p className="sub">No local overrides yet.</p>}
        {overrides && overrides.length > 0 && (
          <div className="tablewrap flat">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Transporter</th>
                  <th scope="col">Change</th>
                  <th scope="col">City</th>
                  <th scope="col">Pincode</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="actions-cell">Actions</th>
                </tr>
              </thead>
              <tbody>
                {overrides.map((o) => (
                  <tr key={o.id}>
                    <td><b>{o.override_transport_name || o.source_transport_name}</b></td>
                    <td>
                      <OverrideBadge kind={overrideKind(o)} /> <span className="muted">{changeText(o)}</span>
                    </td>
                    <td className={o.override_city || o.source_city ? "" : "na"}>{o.override_city || o.source_city || NA}</td>
                    <td className={o.override_pincode || o.source_pincode ? "nowrap" : "na"}>{o.override_pincode || o.source_pincode || NA}</td>
                    <td>{o.override_status ? <StatusBadge status={o.override_status} /> : <span className="muted">Original value</span>}</td>
                    <td className="actions-cell">
                      <button type="button" className="linkbtn" onClick={() => setEditing({ kind: "override", override: o })}>Edit</button>
                      <button type="button" className="linkbtn danger" aria-label="Delete"
                              title={o.is_new ? "Delete" : "Remove this override (back to the original data)"}
                              onClick={() => run(() => deleteOverride(o.id), o.is_new ? "Override deleted" : "Override removed")}>
                        {o.is_new ? "Delete" : "Revert"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && (
        <Modal label={editing.kind === "new" ? "Add transporter" : "Edit transporter"} onClose={closeEditor}>
          {editor()}
        </Modal>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </section>
  );
}

function overrideKind(o: Override): OverrideKind {
  if (o.is_new) return "Added";
  return o.hidden ? "Hidden" : "Edited";
}

function changeText(o: Override): string {
  if (o.is_new) return "No real order behind it";
  const parts: string[] = [];
  if (o.override_transport_name && o.override_transport_name !== o.source_transport_name) {
    parts.push(`Renamed from ${o.source_transport_name}`);
  }
  if (o.override_city) parts.push(`City → ${o.override_city}`);
  if (o.override_pincode) parts.push(`Pincode → ${o.override_pincode}`);
  if (o.override_mobile) parts.push(`Mobile → ${o.override_mobile}`);
  if (o.override_status) parts.push(`Status → ${o.override_status}`);
  if (o.hidden) parts.push("Hidden from search");
  return parts.join(" · ") || "No changes";
}
