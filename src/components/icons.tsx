import type { ReactNode } from 'react';

const Icon = ({ children }: { children: ReactNode }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

export const icons = {
  select: (
    <Icon>
      <path d="M5 3l14 8-6 2-2 6z" />
    </Icon>
  ),
  hand: (
    <Icon>
      <path d="M8 13V5.5a1.5 1.5 0 013 0V12M11 11.5v-7a1.5 1.5 0 013 0V12M14 11.5V6.5a1.5 1.5 0 013 0V15c0 3.5-2.5 6-6 6s-5-1.5-6.5-4l-2-3.5a1.5 1.5 0 012.5-1.6L8 14" />
    </Icon>
  ),
  rectangle: (
    <Icon>
      <rect x="3" y="6" width="18" height="12" />
    </Icon>
  ),
  rounded: (
    <Icon>
      <rect x="3" y="6" width="18" height="12" rx="4" />
    </Icon>
  ),
  ellipse: (
    <Icon>
      <ellipse cx="12" cy="12" rx="9" ry="7" />
    </Icon>
  ),
  diamond: (
    <Icon>
      <path d="M12 3l9 9-9 9-9-9z" />
    </Icon>
  ),
  arrow: (
    <Icon>
      <path d="M4 20L20 4M20 4h-8M20 4v8" />
    </Icon>
  ),
  text: (
    <Icon>
      <path d="M5 6V4h14v2M12 4v16M9 20h6" />
    </Icon>
  ),
  undo: (
    <Icon>
      <path d="M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3" />
    </Icon>
  ),
  redo: (
    <Icon>
      <path d="M15 14l5-5-5-5M20 9H9a5 5 0 000 10h3" />
    </Icon>
  ),
  play: (
    <Icon>
      <path d="M7 4l13 8-13 8z" fill="currentColor" />
    </Icon>
  ),
  pause: (
    <Icon>
      <path d="M7 4h3v16H7zM14 4h3v16h-3z" fill="currentColor" />
    </Icon>
  ),
  restart: (
    <Icon>
      <path d="M4 12a8 8 0 108-8 8 8 0 00-6 2.7M4 4v4h4" />
    </Icon>
  ),
  trash: (
    <Icon>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </Icon>
  ),
  copy: (
    <Icon>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3" />
    </Icon>
  ),
  help: (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 015 .5c0 2-2.5 2-2.5 4M12 17h.01" />
    </Icon>
  ),
};
