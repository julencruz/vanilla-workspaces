const APPEARANCE_DEFAULT = { icon: "●", color: "#0060df" };
const MAX_ICON_GRAPHEMES = 2;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function splitGraphemes(text) {
  return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map(part => part.segment);
}

function clampIcon(value) {
  return splitGraphemes(String(value ?? "").trim()).slice(0, MAX_ICON_GRAPHEMES).join("");
}

function normalizeHex(value) {
  const text = String(value ?? "").trim().replace(/^#?/, "#");
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text);
  const full = short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : text;
  return HEX_COLOR.test(full) ? full.toLowerCase() : null;
}

function hexToHsv(hex) {
  const [red, green, blue] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  const max = Math.max(red, green, blue);
  const delta = max - Math.min(red, green, blue);
  let hue = 0;
  if (delta) {
    if (max === red) hue = ((green - blue) / delta) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue = (hue * 60 + 360) % 360;
  }
  return { h: hue, s: max ? delta / max : 0, v: max };
}

function hsvToHex({ h, s, v }) {
  const chroma = v * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const match = v - chroma;
  const [red, green, blue] = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]][
    Math.min(5, Math.floor(h / 60) % 6)
  ];
  return `#${[red, green, blue].map(channel => Math.round((channel + match) * 255).toString(16).padStart(2, "0")).join("")}`;
}

function readableOn(hex) {
  const [red, green, blue] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = channel => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue) > 0.5 ? "#1b1b1b" : "#ffffff";
}
