/**
 * Clean SVG placeholder for angles that haven't been generated yet.
 * Matches the brand palette and looks professional.
 */
export function placeholderSvg(label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
    <rect width="800" height="800" fill="#faf8f5"/>
    <rect x="250" y="250" width="300" height="300" rx="16" fill="#f5ede3"/>
    <g transform="translate(400 380)" fill="none" stroke="#b8915c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <rect x="-40" y="-40" width="80" height="80" rx="8"/>
      <circle cx="0" cy="0" r="16"/>
      <circle cx="24" cy="-24" r="4" fill="#e8a838" stroke="none"/>
      <line x1="-70" y1="-70" x2="-40" y2="-40"/>
      <line x1="70" y1="-70" x2="40" y2="-40"/>
      <line x1="-70" y1="70" x2="-40" y2="40"/>
      <line x1="70" y1="70" x2="40" y2="40"/>
    </g>
    <text x="400" y="640" text-anchor="middle" font-family="Marcellus, serif" font-size="22" fill="#1a1a1a" letter-spacing="3">${label.toUpperCase()}</text>
    <text x="400" y="670" text-anchor="middle" font-family="Jost, sans-serif" font-size="13" fill="#b8915c" letter-spacing="2">PROFESSIONAL PHOTO BEING GENERATED</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export type Angle = "front" | "side" | "top" | "closeup";
