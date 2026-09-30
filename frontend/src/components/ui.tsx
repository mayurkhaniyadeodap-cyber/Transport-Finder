import { useState } from "react";
import { initials } from "../brandBadge";
import { withBase } from "../services/base";
import { deriveTransportType } from "../searchDefaults";
import { ChevronLeftIcon, ChevronRightIcon } from "./Icons";

const typeClass = (type: string) => `type-${type.toLowerCase()}`;

/** The transporter's image, shown as-is: an Admin-uploaded photo or a verified official logo.
 * If it fails to load, falls back to the short-name tile. */
function useImage(photoUrl?: string | null) {
  const [failed, setFailed] = useState<string | null>(null);
  const url = photoUrl && photoUrl !== failed ? withBase(photoUrl) : null;
  return { url, onError: () => setFailed(photoUrl ?? null) };
}

/** Short-name tile used wherever a transporter has no image: its initials, e.g. "GTS". */
export function ShortName({ name, className = "" }: { name: string; className?: string }) {
  const short = initials(name);
  return (
    <span className={`short-name ${className}`} role="img" aria-label={`${name} (${short})`} title={name}>
      <span aria-hidden="true">{short}</span>
    </span>
  );
}

export function Avatar({ name, size = "md", photoUrl }: { name: string; size?: "sm" | "md" | "lg"; photoUrl?: string | null }) {
  const { url, onError } = useImage(photoUrl);
  if (url) {
    return <img className={`avatar avatar-${size} avatar-photo`} src={url} alt={`${name} image`} loading="lazy" onError={onError} />;
  }
  return <ShortName name={name} className={`avatar avatar-${size}`} />;
}

/** A transporter's image (Admin photo or official logo), or its short-name tile. */
export function TransporterPhoto({ name, photoUrl, className = "" }: { name: string; photoUrl?: string | null; className?: string }) {
  const { url, onError } = useImage(photoUrl);
  return url ? (
    <img className={`transporter-photo ${className}`} src={url} alt={`${name} image`} onError={onError} />
  ) : (
    <ShortName name={name} className={`transporter-photo short-name-lg ${className}`} />
  );
}

export type PhotoSource = "admin" | "official" | null | undefined;

export function photoSourceText(source: PhotoSource): string {
  if (source === "official") return "Official company logo";
  if (source === "admin") return "Image uploaded by Admin";
  return "";
}

export function TypeChip({ name }: { name: string }) {
  const type = deriveTransportType(name);
  return <span className={`type-chip ${typeClass(type)}`}>{type}</span>;
}

export function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return <span className="na">Not Available</span>;
  return <span className={`badge ${status === "Active" ? "badge-active" : "badge-inactive"}`}>{status}</span>;
}

export type OverrideKind = "Edited" | "Hidden" | "Added";

export function OverrideBadge({ kind }: { kind: OverrideKind }) {
  return <span className={`override-badge override-${kind.toLowerCase()}`}>{kind}</span>;
}

function pageList(page: number, pages: number): (number | string)[] {
  const nums = [...new Set([1, pages, page - 1, page, page + 1])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out: (number | string)[] = [];
  nums.forEach((n, i) => {
    if (i > 0 && n - nums[i - 1] > 1) out.push(`gap-${n}`);
    out.push(n);
  });
  return out;
}

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
}

export function Pagination({ page, totalPages, total, pageSize, onPage }: PaginationProps) {
  if (!total) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="pagination">
      <p className="pagination-range">
        Showing <strong>{from}</strong>–<strong>{to}</strong> of <strong>{total}</strong> results
      </p>
      {totalPages > 1 && (
        <nav className="pagination-controls" aria-label="Pagination">
          <button type="button" className="page-btn" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            <ChevronLeftIcon size={16} />
          </button>
          {pageList(page, totalPages).map((n) =>
            typeof n === "string" ? (
              <span key={n} className="page-gap">…</span>
            ) : (
              <button
                key={n}
                type="button"
                className={`page-btn ${n === page ? "active" : ""}`}
                aria-current={n === page ? "page" : undefined}
                onClick={() => onPage(n)}
              >
                {n}
              </button>
            ),
          )}
          <button type="button" className="page-btn" aria-label="Next page" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
            <ChevronRightIcon size={16} />
          </button>
        </nav>
      )}
    </div>
  );
}

/** Decorative city/road/truck illustration (login panel, search hero). */
export function TruckArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 170" className={className} aria-hidden="true" focusable="false">
      <g fill="#16357a">
        <rect x="8" y="62" width="26" height="80" rx="2" />
        <rect x="38" y="36" width="22" height="106" rx="2" />
        <rect x="64" y="78" width="30" height="64" rx="2" />
        <rect x="98" y="22" width="18" height="120" rx="2" />
        <rect x="120" y="56" width="28" height="86" rx="2" />
        <rect x="236" y="30" width="20" height="112" rx="2" />
        <rect x="260" y="64" width="26" height="78" rx="2" />
        <rect x="290" y="48" width="24" height="94" rx="2" />
      </g>
      <rect x="0" y="142" width="320" height="28" fill="#132a5e" />
      {[10, 60, 110, 160, 210, 260].map((x) => (
        <rect key={x} x={x} y="155" width="28" height="3" rx="1.5" fill="#2a4a8f" />
      ))}
      <rect x="62" y="68" width="152" height="62" rx="4" fill="#ffffff" stroke="#cbd5e1" />
      <rect x="62" y="116" width="152" height="6" fill="#2563eb" />
      <rect x="76" y="80" width="60" height="8" rx="4" fill="#dbeafe" />
      <rect x="76" y="94" width="40" height="6" rx="3" fill="#e2e8f0" />
      <path d="M218 86 h38 l24 24 v22 h-62 z" fill="#1d4ed8" />
      <path d="M226 93 h26 l15 15 h-41 z" fill="#bfdbfe" />
      <rect x="274" y="120" width="8" height="6" rx="1" fill="#fbbf24" />
      {[92, 124, 186, 250].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="132" r="10" fill="#0f172a" />
          <circle cx={cx} cy="132" r="4" fill="#94a3b8" />
        </g>
      ))}
    </svg>
  );
}
