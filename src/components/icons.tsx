// Lightweight inline SVG icons (stroke-based, currentColor). No icon dependency.
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;

function base(props: P) {
  return {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...props,
  };
}

export const PlusIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const UploadIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
  </svg>
);

export const FileIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M14 3v4a1 1 0 0 0 1 1h4" />
    <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" />
  </svg>
);

export const UsersIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

export const ArrowLeftIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </svg>
);

export const TrashIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
  </svg>
);

export const CheckIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const EyeIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const SendIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m22 2-7 20-4-9-9-4Z" />
    <path d="M22 2 11 13" />
  </svg>
);

export const ChevronDownIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const SettingsIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </svg>
);

export const GripIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="9" cy="6" r="1" />
    <circle cx="9" cy="12" r="1" />
    <circle cx="9" cy="18" r="1" />
    <circle cx="15" cy="6" r="1" />
    <circle cx="15" cy="12" r="1" />
    <circle cx="15" cy="18" r="1" />
  </svg>
);

export const SignatureIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 17c2 0 3-6 4-6s1 4 2 4 2-7 3-7 1 5 2 5 2-2 3-2" />
    <path d="M3 21h18" />
  </svg>
);

export const DownloadIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
  </svg>
);

export const LinkIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

export const XIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export const SparkleIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3l1.6 4.8L18 9.4l-4.4 1.6L12 16l-1.6-4.9L6 9.4l4.4-1.6L12 3Z" />
    <path d="M19 14l.7 2.1L22 17l-2.3.9L19 20l-.7-2.1L16 17l2.3-.9L19 14Z" />
  </svg>
);
