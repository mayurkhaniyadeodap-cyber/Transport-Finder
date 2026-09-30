import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CompactList, PincodeSummary } from "../components/CityList";
import {
  AlertIcon, CheckCircleIcon, ChevronDownIcon, EmptyIcon, EyeIcon, EyeOffIcon, InfoIcon, PencilIcon, PlusIcon, RotateCcwIcon,
  SearchIcon, TrashIcon, TruckIcon, XIcon,
} from "../components/Icons";
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
  all: "All Transporters", active: "Active transporters", inactive: "Not Active transporters", hidden: "Hidden transporters",
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
  const allTransportersRef = useRef<HTMLElement | null>(null);
  const [deletedOpen, setDeletedOpen] = useState(false);

  const [overrides, setOverrides] = useState<Override[] | null>(null);
  const [overridesError, setOverridesError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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

  const run = async (action: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await action();
      refresh();
      return true;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not save.");
      return false;
    }
  };

  const toggleHidden = (t: ManagedTransporter) => run(() => updateTransporter(t.transport_name, { hidden: !t.hidden }));

  const remove = (t: ManagedTransporter) => {
    const ok = window.confirm(
      `Delete "${t.transport_name}"?\n\nIt will be removed from Search and from this list. ` +
        "The real data source is not changed, and you can restore it from Deleted transporters.",
    );
    if (ok) run(() => deleteTransporter(t.transport_name));
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
        await savePhoto(v.name, v.photo);
      }));
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
    }));
  };

  const saveOverride = async (fields: OverrideFields) => {
    if (editing?.kind !== "override") return;
    setSaving(true);
    finish(await run(() => updateOverride(editing.override.id, fields)));
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
          : { name: "", service_cities: [], pincodes: [], mobile: "", status: "Active", hidden: false, photo_url: null }}
        saving={saving}
        serverError={actionError}
        onSave={saveTransporter}
        onCancel={closeEditor}
      />
    );
  };

  const tiles: { label: string; value: number | undefined; icon: typeof TruckIcon; tone: string; filter: StatusFilter }[] = [
    { label: "Transporters", value: list?.total, icon: TruckIcon, tone: "tone-blue", filter: "all" },
    { label: "Active", value: list ? counts.active : undefined, icon: CheckCircleIcon, tone: "tone-green", filter: "active" },
    { label: "Not Active", value: list ? counts.inactive : undefined, icon: AlertIcon, tone: "tone-red", filter: "inactive" },
    { label: "Hidden", value: list ? counts.hidden : undefined, icon: EyeOffIcon, tone: "tone-slate", filter: "hidden" },
  ];

  const applyFilter = (f: StatusFilter) => {
    setStatusFilter(f);
    setPage(1);
    allTransportersRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="manage page-stack">
      <div className="page-header">
        <div>
          <h2>Manage Transporters</h2>
          <p>Edit what Transport Finder shows. Changes are saved locally — the RDS data is never changed.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setEditing({ kind: "new" })}>
          <PlusIcon size={16} /> Add Transporter
        </button>
      </div>

      <div className="summary-tiles" role="group" aria-label="Filter transporters by status">
        {tiles.map(({ label, value, icon: Icon, tone, filter }) => (
          <button
            key={label}
            type="button"
            className={`card tile tile-btn ${statusFilter === filter ? "active" : ""}`}
            aria-pressed={statusFilter === filter}
            onClick={() => applyFilter(filter)}
          >
            <span className={`tile-icon ${tone}`}>
              <Icon size={20} />
            </span>
            <div>
              <p className="tile-value">{value ?? "…"}</p>
              <p className="tile-label">{label}</p>
            </div>
          </button>
        ))}
      </div>

      {actionError && !editing && (
        <div className="alert alert-error" role="alert">
          <AlertIcon size={16} />
          <span>{actionError}</span>
        </div>
      )}

      <section className="card" ref={allTransportersRef}>
        <div className="card-head">
          <div>
            <h3>{FILTER_LABEL[statusFilter]}</h3>
            <p>
              {statusFilter === "all"
                ? "Every transporter, including Not Active and hidden ones."
                : `Filtered from the summary cards above.`}
            </p>
          </div>
        </div>
        <div className="card-toolbar">
          <label className="input-wrap manage-name-search">
            <span className="input-icon">
              <SearchIcon size={16} />
            </span>
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Search transporter name"
              aria-label="Search transporter name"
            />
            {query && (
              <button type="button" className="input-action" aria-label="Clear search" onClick={() => { setQuery(""); setPage(1); }}>
                <XIcon size={14} />
              </button>
            )}
          </label>
          {statusFilter !== "all" && (
            <span className="filter-pill">
              {FILTER_LABEL[statusFilter]}
              <button type="button" aria-label="Clear filter" onClick={() => applyFilter("all")}>
                <XIcon size={12} />
              </button>
            </span>
          )}
        </div>

        {listError && (
          <div className="alert alert-error card-alert" role="alert">
            <AlertIcon size={16} />
            <span>{listError}</span>
          </div>
        )}
        {!list && !listError && <p className="card-note">Loading transporters…</p>}

        {list && filtered.length === 0 && (
          <div className="state-card state-card-flat" role="status">
            <span className="state-icon">
              <EmptyIcon size={30} />
            </span>
            <h3>No transporters found</h3>
            <p>
              {query
                ? `No transporter name matches "${query}"${statusFilter !== "all" ? ` among ${FILTER_LABEL[statusFilter].toLowerCase()}` : ""}.`
                : statusFilter !== "all"
                  ? `There are no ${FILTER_LABEL[statusFilter].toLowerCase()} right now.`
                  : "No transporters in the data yet."}
            </p>
          </div>
        )}

        {pageRows.length > 0 && (
          <>
            <p className="result-bar">
              {filtered.length} transporter{filtered.length === 1 ? "" : "s"}
              {query ? ` matching "${query}"` : ""}
            </p>
            <div className="table-scroll" tabIndex={0} role="region" aria-label="All transporters table">
              <table className="sheet manage-table">
                <thead>
                  <tr>
                    <th scope="col">Transporter Name</th>
                    <th scope="col">Service Cities</th>
                    <th scope="col">Pincode</th>
                    <th scope="col">Mobile</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="cell-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((t) => (
                    <tr key={t.transport_name} className={t.hidden ? "row-muted" : undefined}>
                      <td>
                        <span className="transport-cell">
                          <Avatar name={t.transport_name} size="sm" photoUrl={t.photo_url} />
                          <span className="transport-stack">
                            <span className="transport-line">
                              <span className="transport-name">{t.transport_name}</span>
                              {t.hidden && <OverrideBadge kind="Hidden" />}
                              {t.added_locally && <OverrideBadge kind="Added" />}
                              {t.edited && <OverrideBadge kind="Edited" />}
                            </span>
                            <span className="transport-type">{deriveTransportType(t.transport_name)}</span>
                          </span>
                        </span>
                      </td>
                      <td className="city wrap-cell">
                        <CompactList items={t.service_cities} />
                      </td>
                      <td className="wrap-cell pin-list">
                        <PincodeSummary pins={t.pincodes} />
                      </td>
                      <td className={t.mobile ? "mobile" : "na"}>{t.mobile || NA}</td>
                      <td>
                        <StatusBadge status={t.status} />
                      </td>
                      <td className="cell-actions">
                        <div className="icon-actions" aria-label={`Actions for ${t.transport_name}`}>
                          <button type="button" className="icon-btn icon-btn-ghost" aria-label="Edit" title="Edit"
                                  onClick={() => setEditing({ kind: "transporter", t })}>
                            <PencilIcon size={16} />
                          </button>
                          <button type="button" className="icon-btn icon-btn-ghost" aria-label={t.hidden ? "Unhide" : "Hide"}
                                  title={t.hidden ? "Show in search" : "Hide from search"} onClick={() => toggleHidden(t)}>
                            {t.hidden ? <EyeIcon size={16} /> : <EyeOffIcon size={16} />}
                          </button>
                          <button type="button" className="icon-btn icon-btn-ghost icon-btn-danger" aria-label="Delete" title="Delete"
                                  onClick={() => remove(t)}>
                            <TrashIcon size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card-foot">
              <Pagination page={current} totalPages={totalPages} total={filtered.length} pageSize={PAGE_SIZE} onPage={setPage} />
            </div>
          </>
        )}
      </section>

      {list && list.deleted.length > 0 && (
        <section className="card">
          <button
            type="button"
            className={`card-head card-head-toggle ${deletedOpen ? "" : "collapsed"}`}
            aria-expanded={deletedOpen}
            aria-controls="deleted-transporters-list"
            onClick={() => setDeletedOpen((v) => !v)}
          >
            <div>
              <h3>
                Deleted transporters <span className="count-pill">{list.deleted.length}</span>
              </h3>
              <p>Removed from Search and the list above. Restore to bring one back.</p>
            </div>
            <span className={`chevron ${deletedOpen ? "open" : ""}`} aria-hidden="true">
              <ChevronDownIcon size={18} />
            </span>
          </button>
          {deletedOpen && (
            <ul className="deleted-list" id="deleted-transporters-list">
              {list.deleted.map((name) => (
                <li key={name}>
                  <span className="transport-cell">
                    <Avatar name={name} size="sm" />
                    <span className="transport-name">{name}</span>
                  </span>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => run(() => restoreTransporter(name))}>
                    <RotateCcwIcon size={14} /> Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <div>
            <h3>
              Current local overrides <span className="count-pill">{overrides ? overrides.length : "…"}</span>
            </h3>
            <p>Row-level edits, hides and added transporters.</p>
          </div>
        </div>
        <div className="alert alert-info card-alert">
          <InfoIcon size={16} />
          <span>These are applied on top of the RDS data, which is never changed. Deleting an edit brings back the original values.</span>
        </div>
        {overridesError && (
          <div className="alert alert-error card-alert" role="alert">
            <AlertIcon size={16} />
            <span>{overridesError}</span>
          </div>
        )}
        {overrides && overrides.length === 0 && <p className="card-note">No local overrides yet.</p>}
        {overrides && overrides.length > 0 && (
          <div className="table-scroll">
            <table className="sheet">
              <thead>
                <tr>
                  <th scope="col">Transporter</th>
                  <th scope="col">Change</th>
                  <th scope="col">City</th>
                  <th scope="col">Pincode</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="cell-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {overrides.map((o) => (
                  <tr key={o.id}>
                    <td className="transport-name">{o.override_transport_name || o.source_transport_name}</td>
                    <td>
                      <span className="change-cell">
                        <OverrideBadge kind={overrideKind(o)} />
                        <span className="muted small">{changeText(o)}</span>
                      </span>
                    </td>
                    <td className={o.override_city || o.source_city ? "city" : "na"}>{o.override_city || o.source_city || NA}</td>
                    <td className={o.override_pincode || o.source_pincode ? "pin" : "na"}>{o.override_pincode || o.source_pincode || NA}</td>
                    <td>{o.override_status ? <StatusBadge status={o.override_status} /> : <span className="muted small">Original value</span>}</td>
                    <td className="cell-actions">
                      <div className="icon-actions">
                        <button type="button" className="icon-btn icon-btn-ghost" aria-label="Edit" title="Edit"
                                onClick={() => setEditing({ kind: "override", override: o })}>
                          <PencilIcon size={16} />
                        </button>
                        <button type="button" className="icon-btn icon-btn-ghost icon-btn-danger" aria-label="Delete"
                                title={o.is_new ? "Delete" : "Remove this override (back to the original data)"}
                                onClick={() => run(() => deleteOverride(o.id))}>
                          {o.is_new ? <TrashIcon size={16} /> : <RotateCcwIcon size={16} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && (
        <Modal label={editing.kind === "new" ? "Add Transporter" : "Edit transporter"} onClose={closeEditor}>
          {editor()}
        </Modal>
      )}
    </div>
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
