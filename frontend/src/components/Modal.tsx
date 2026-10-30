import { ReactNode, useEffect } from "react";
import { XIcon } from "./Icons";

interface Props {
  label: string;
  onClose: () => void;
  children: ReactNode;
}

/** Centered dialog (a bottom sheet on phones). Escape or a click on the backdrop closes it. */
export default function Modal({ label, onClose, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

/** The design's modal header: title, optional line under it, and the ✕ button. */
export function ModalHead({ title, sub, onClose }: { title: string; sub?: string; onClose: () => void }) {
  return (
    <div className="modalhead">
      <div>
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
      <button type="button" className="close" aria-label="Close" onClick={onClose}>
        <XIcon size={16} />
      </button>
    </div>
  );
}
