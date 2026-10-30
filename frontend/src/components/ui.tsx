import { useState } from "react";
import { initials } from "../brandBadge";
import { withBase } from "../services/base";
import { deriveTransportType } from "../searchDefaults";
import { ChevronLeftIcon, ChevronRightIcon } from "./Icons";

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
    <span className={`logo short-name ${className}`} role="img" aria-label={`${name} (${short})`} title={name}>
      <span aria-hidden="true">{short}</span>
    </span>
  );
}

const SIZE_CLASS = { sm: "sm", md: "", lg: "lg" } as const;

/** The design's square logo tile: the transporter's image, or its initials. */
export function Avatar({ name, size = "md", photoUrl }: { name: string; size?: "sm" | "md" | "lg"; photoUrl?: string | null }) {
  const { url, onError } = useImage(photoUrl);
  const cls = `logo avatar-photo ${SIZE_CLASS[size]}`;
  if (url) return <img className={cls} src={url} alt={`${name} image`} loading="lazy" onError={onError} />;
  return <ShortName name={name} className={SIZE_CLASS[size]} />;
}

/** A transporter's image (Admin photo or official logo), or its short-name tile. */
export function TransporterPhoto({ name, photoUrl, className = "" }: { name: string; photoUrl?: string | null; className?: string }) {
  const { url, onError } = useImage(photoUrl);
  return url ? (
    <img className={`logo transporter-photo ${className}`} src={url} alt={`${name} image`} onError={onError} />
  ) : (
    <ShortName name={name} className={className} />
  );
}

export type PhotoSource = "admin" | "official" | null | undefined;

export function photoSourceText(source: PhotoSource): string {
  if (source === "official") return "Official company logo";
  if (source === "admin") return "Image uploaded by Admin";
  return "";
}

export function TypeChip({ name }: { name: string }) {
  return <span className="chip">{deriveTransportType(name)}</span>;
}

export function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return <span className="na">Not Available</span>;
  return <span className={status === "Active" ? "status" : "status off"}>{status}</span>;
}

export type OverrideKind = "Edited" | "Hidden" | "Added";

const OVERRIDE_TONE: Record<OverrideKind, string> = { Edited: "", Hidden: "muted", Added: "good" };

export function OverrideBadge({ kind }: { kind: OverrideKind }) {
  return <span className={`tag ${OVERRIDE_TONE[kind]}`}>{kind}</span>;
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
      <span>
        Showing <b>{from}–{to}</b> of {total} results
      </span>
      {totalPages > 1 && (
        <nav className="pages" aria-label="Pagination">
          <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            <ChevronLeftIcon size={14} />
          </button>
          {pageList(page, totalPages).map((n) =>
            typeof n === "string" ? (
              <span key={n} className="gap">…</span>
            ) : (
              <button key={n} type="button" className={n === page ? "active" : ""} aria-current={n === page ? "page" : undefined}
                      onClick={() => onPage(n)}>
                {n}
              </button>
            ),
          )}
          <button type="button" aria-label="Next page" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
            <ChevronRightIcon size={14} />
          </button>
        </nav>
      )}
    </div>
  );
}

/** Two-letter initials for a person's ID, e.g. "Admin_deodap@123" -> "AD". */
export function personInitials(id: string | null | undefined): string {
  const words = (id || "").replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0];
  const second = words[1];
  return (second ? first[0] + second[0] : first.slice(0, 2)).toUpperCase();
}
