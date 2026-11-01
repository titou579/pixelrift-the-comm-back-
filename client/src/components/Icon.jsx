// Jeu d'icônes SVG (traits arrondis, couleur = couleur du texte). Remplace les emojis.
const circle = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

const ICONS = {
  coin: [circle(12, 12, 9), 'M9.5 16V8l5 8V8'],
  xp: ['M13 2L4 14h7l-1 8 9-12h-7z'],
  kills: [circle(12, 12, 7), 'M12 2v5M12 17v5M2 12h5M17 12h5'],
  skull: ['M12 3a8 8 0 0 0-8 8c0 2.6 1.3 4.5 3 5.7V20h10v-3.3c1.7-1.2 3-3.1 3-5.7a8 8 0 0 0-8-8z', 'M9 12h.01M15 12h.01M10.5 17v3M13.5 17v3'],
  trophy: ['M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z', 'M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3'],
  user: ['M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  users: ['M17 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1', 'M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M21 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8'],
  shop: ['M5 8h14l-1 12H6z', 'M9 8a3 3 0 0 1 6 0'],
  ticket: ['M3 9a2 2 0 0 0 0 6v3h18v-3a2 2 0 0 1 0-6V6H3z', 'M14 6v2M14 11v2M14 16v2'],
  quest: ['M9 3h6v3H9z', 'M7 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1', 'M8 12h8M8 16h5'],
  gear: [circle(12, 12, 3), 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
  shield: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', 'M9 12l2 2 4-4'],
  lock: ['M6 11h12v9H6z', 'M8 11V8a4 4 0 0 1 8 0v3'],
  check: ['M5 12l5 5 9-10'],
  close: ['M6 6l12 12M18 6L6 18'],
  crown: ['M3 8l4 4 5-7 5 7 4-4-2 11H5z'],
  shirt: ['M8 3L3 7l3 3 2-1v12h8V9l2 1 3-3-5-4a4 4 0 0 1-8 0z'],
  tracer: ['M3 21L21 3', 'M14 3h7v7', 'M5 14l-2 2M9 18l-2 2'],
  upload: ['M12 16V4M7 9l5-5 5 5', 'M4 20h16'],
  plus: ['M12 5v14M5 12h14'],
  minus: ['M5 12h14'],
  trash: ['M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13', 'M10 11v6M14 11v6'],
  key: [circle(8, 15, 4), 'M11 12l9-9M16 7l3 3M14 9l2 2'],
  logout: ['M9 21H5V3h4', 'M16 17l5-5-5-5M21 12H9'],
  back: ['M19 12H5M12 5l-7 7 7 7'],
  edit: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
  gift: ['M20 12v9H4v-9M2 7h20v5H2zM12 22V7', 'M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z', 'M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z'],
  mic: ['M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z', 'M19 10v1a7 7 0 0 1-14 0v-1M12 18v4'],
  chart: ['M4 20V10M10 20V4M16 20v-7M22 20H2'],
  star: ['M12 2l3 7 7 .6-5.3 4.7L18.2 22 12 18.3 5.8 22l1.5-7.7L2 9.6 9 9z'],
  clock: [circle(12, 12, 9), 'M12 7v5l3 2'],
  megaphone: ['M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1z', 'M16 8a5 5 0 0 1 0 8'],
  play: ['M7 4l13 8-13 8z'],
  gun: ['M3 10h13l2-2h3v4h-4l-1 2h-3l-1 4H8l1-4H3z'],
  flag: ['M5 21V4', 'M5 4h12l-2 4 2 4H5'],
  eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z', circle(12, 12, 3)],
  refresh: ['M21 12a9 9 0 1 1-3-6.7L21 8', 'M21 3v5h-5'],
  info: [circle(12, 12, 9), 'M12 11v5M12 8h.01'],
  medal: [circle(12, 15, 6), 'M8.5 3h7l-2 6h-3z'],
};

export default function Icon({ name, size = 18, className = '', title }) {
  const paths = ICONS[name] || ICONS.info;
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      {paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}
