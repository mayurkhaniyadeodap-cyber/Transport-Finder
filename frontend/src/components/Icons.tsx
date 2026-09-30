import type { ReactNode } from "react";

// Small inline SVG icon set (decorative: hidden from screen readers).
function Svg({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const TruckIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M2 6.5A1.5 1.5 0 0 1 3.5 5h9A1.5 1.5 0 0 1 14 6.5V16H2z" />
    <path d="M14 9h3.6a1.5 1.5 0 0 1 1.2.6L21.4 13a1.5 1.5 0 0 1 .3.9V16H14z" />
    <circle cx="6.5" cy="17.5" r="2" />
    <circle cx="17.5" cy="17.5" r="2" />
  </Svg>
);

export const PincodeIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.3" />
  </Svg>
);

export const CityIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M4 21V7l7-3v17" />
    <path d="M11 21V10l9 3v8" />
    <path d="M3 21h18M7.5 10h.01M7.5 14h.01M15.5 15.5h.01M15.5 18h.01" />
  </Svg>
);

export const StateIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M9 4 3 6.5v13L9 17l6 3 6-2.5v-13L15 7z" />
    <path d="M9 4v13M15 7v13" />
  </Svg>
);

export const SearchIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-3.8-3.8" />
  </Svg>
);

export const ClearIcon = () => (
  <Svg>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const AlertIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5M12 16h.01" />
  </Svg>
);

export const EmptyIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M3 13h5l1.5 3h5L16 13h5" />
    <path d="M5.5 5h13L21 13v6H3v-6z" />
  </Svg>
);

export const BellIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M6 9a6 6 0 1 1 12 0c0 3.6 1 5.2 1.6 6.1a1 1 0 0 1-.8 1.6H5.2a1 1 0 0 1-.8-1.6C5 14.2 6 12.6 6 9z" />
    <path d="M10 19a2 2 0 0 0 4 0" />
  </Svg>
);

export const SettingsIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Svg>
);

export const SunIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
);

export const MoonIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a6.6 6.6 0 0 0 11 11z" />
  </Svg>
);

export const MonitorIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </Svg>
);

export const ZoomIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2M11 8.5v5M8.5 11h5" />
  </Svg>
);

export const UserIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="12" cy="8" r="3.6" />
    <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
  </Svg>
);

export const ChevronDownIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

export const GridIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
  </Svg>
);

export const TableIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
    <path d="M3.5 9.5h17M9.5 9.5v10" />
  </Svg>
);

export const ArrowLeftIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Svg>
);

export const PhoneIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M5 4.5h3.2l1.3 4-1.9 1.4a11 11 0 0 0 5.5 5.5l1.4-1.9 4 1.3V18a1.5 1.5 0 0 1-1.6 1.5A15.5 15.5 0 0 1 3.5 6.1 1.5 1.5 0 0 1 5 4.5z" />
  </Svg>
);

export const XIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const CopyIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="1.8" />
    <path d="M15.5 8.5V5.8A1.8 1.8 0 0 0 13.7 4H5.8A1.8 1.8 0 0 0 4 5.8v7.9a1.8 1.8 0 0 0 1.8 1.8h2.7" />
  </Svg>
);

export const CheckIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M5 12.5 9.5 17 19 7" />
  </Svg>
);

export const TruckBadgeIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M2 6.5A1.5 1.5 0 0 1 3.5 5h7A1.5 1.5 0 0 1 12 6.5V15H2z" />
    <path d="M12 9h3.2a1.5 1.5 0 0 1 1.2.6L18.4 12a1.5 1.5 0 0 1 .3.9V15H12z" />
    <circle cx="6" cy="16.2" r="1.7" />
    <circle cx="15.3" cy="16.2" r="1.7" />
  </Svg>
);

export const CheckCircleIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.2 12.3 2.6 2.6 5-5.2" />
  </Svg>
);

export const TypesIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.5" />
    <circle cx="16.8" cy="6.8" r="3.3" />
    <path d="M4 20.5c0-2.8 2.2-5 5-5s5 2.2 5 5M14.5 15.7c.6-.3 1.3-.5 2-.5 2.8 0 5 2.2 5 5" />
  </Svg>
);

export const LocationPinIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.3" />
  </Svg>
);

export const ShieldIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M12 3.5 5 6v5.5c0 4.6 3 7.9 7 9.5 4-1.6 7-4.9 7-9.5V6z" />
    <path d="m9.2 12.3 2 2 3.6-4" />
  </Svg>
);

export const LockIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
  </Svg>
);

export const EyeIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="2.8" />
  </Svg>
);

export const EyeOffIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M3 3l18 18" />
    <path d="M10.6 5.7A10.4 10.4 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a15 15 0 0 1-3.4 4.1M6.6 6.6C4 8.3 2.5 12 2.5 12s3.5 6.5 9.5 6.5a9.9 9.9 0 0 0 3.9-.8" />
    <path d="M9.9 10a2.8 2.8 0 0 0 4 4" />
  </Svg>
);

export const LoginArrowIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M10 7l5 5-5 5" />
    <path d="M4 12h11" />
  </Svg>
);

export const SlidersIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M4 6h16M4 12h16M4 18h16" />
    <circle cx="9" cy="6" r="1.8" fill="currentColor" stroke="none" />
    <circle cx="16" cy="12" r="1.8" fill="currentColor" stroke="none" />
    <circle cx="10" cy="18" r="1.8" fill="currentColor" stroke="none" />
  </Svg>
);

export const GlobeIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.6 3.8 5.8 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.8-3.8-9S9.5 5.6 12 3z" />
  </Svg>
);

export const MenuIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Svg>
);

export const PencilIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M4 20l1-4.3L15.6 5.1a1.5 1.5 0 0 1 2.1 0l1.2 1.2a1.5 1.5 0 0 1 0 2.1L8.3 19 4 20z" />
    <path d="M14 6.8l3.2 3.2" />
  </Svg>
);

export const TrashIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M5 7h14M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12" />
  </Svg>
);

export const PlusIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const HashIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16" />
  </Svg>
);

export const InfoIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Svg>
);

export const RefreshIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M20 11a8 8 0 0 0-14.3-4.3L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.3 4.3l1.7-1.8M20 20v-4.5h-4.5" />
  </Svg>
);

export const ZapIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
  </Svg>
);

export const LayersIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="m12 3 9 5-9 5-9-5z" />
    <path d="m3 13 9 5 9-5" />
  </Svg>
);

export const ChevronLeftIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="m15 18-6-6 6-6" />
  </Svg>
);

export const ChevronRightIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="m9 18 6-6-6-6" />
  </Svg>
);

export const LogOutIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
  </Svg>
);

export const TagIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z" />
    <path d="M7.5 7.5h.01" />
  </Svg>
);

export const RotateCcwIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </Svg>
);

export const ArrowRightIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);

export const UsersIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.6-3.5 3.3-5.5 6.5-5.5s5.9 2 6.5 5.5M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.2 2.5 3.5 5.2" />
  </Svg>
);
