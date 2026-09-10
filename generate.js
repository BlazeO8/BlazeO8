// generate.js
// Builds an animated "F1 car races across your contribution graph" SVG.
// Usage: node generate.js <github_username> <output_path> [theme]
//   theme = "dark" | "light"   (default: dark)
//
// Requires env var GH_TOKEN (a PAT with read:user scope) to pull real
// contribution data from the GitHub GraphQL API. If GH_TOKEN is not set,
// falls back to deterministic mock data so the script can still be
// previewed/tested without a token.

const [, , usernameArg, outPathArg, themeArg] = process.argv;
const username = usernameArg || process.env.GH_USERNAME || "octocat";
const outPath = outPathArg || "dist/f1-track-dark.svg";
const theme = themeArg || "dark";

const CELL = 10;
const GAP = 3;
const STEP = CELL + GAP;
const MARGIN_LEFT = 24;
const MARGIN_TOP = 46;
const MARGIN_RIGHT = 24;
const MARGIN_BOTTOM = 30; // room for the lap-progress bar
const ROWS = 7;
const LAP_SECONDS = 22;
const BAR_HEIGHT = 7;
const BAR_GAP = 14; // gap between grid bottom and progress bar

const PALETTES = {
  dark: {
    bg: "#0d1117",
    grid: "#161b22",
    levels: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"],
    halo: "#060708",
    text: "#c9d1d9",
    accent: "#39d353",
    track: "#30363d",
  },
  light: {
    bg: "#ffffff",
    grid: "#ebedf0",
    levels: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
    halo: "#d8dbdf",
    text: "#24292f",
    accent: "#216e39",
    track: "#d0d7de",
  },
};

async function fetchContributions(login) {
  const token = process.env.GH_TOKEN;
  if (!token) {
    return mockContributions();
  }
  const query = `
    query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            weeks {
              contributionDays {
                contributionCount
                date
                weekday
              }
            }
          }
        }
      }
    }`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "f1-contribution-track",
    },
    body: JSON.stringify({ query, variables: { login } }),
  });
  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error(`GitHub GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data.user.contributionsCollection.contributionCalendar.weeks;
}

// Bold 5x7 dot-matrix bitmap font — classic proportions, wide enough to
// read clearly at 7 characters across a 53-column grid.
const FONT = {
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
};
const LETTER_WIDTH = 5;

function mockContributions() {
  // Deterministic "BLAZEO8" pixel-art pattern in the mock/preview data, so
  // the placeholder (before a real GH_TOKEN is wired up) looks intentional
  // instead of random noise. Straight, upright letters — no slant.
  const word = "BLAZEO8".split("");
  const letterGap = 2;
  const totalLetterCols =
    word.length * LETTER_WIDTH + (word.length - 1) * letterGap;

  const totalWeeks = 53;
  const startCol = Math.floor((totalWeeks - totalLetterCols) / 2);

  // Build a lookup of every lit ("on") cell: col -> row -> true
  const lit = new Map();
  let col = startCol;
  for (const ch of word) {
    const rows = FONT[ch];
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < LETTER_WIDTH; c++) {
        if (rows[r][c] === "1") {
          lit.set(`${col + c}-${r}`, true);
        }
      }
    }
    col += LETTER_WIDTH + letterGap;
  }

  // A one-cell "halo" ring around the letters — every cell touching a lit
  // cell (including diagonally) that isn't itself lit gets flagged, so it
  // can be rendered darker than the rest of the grid. This is what makes
  // the letters pop against the busy background instead of any slanting.
  const halo = new Map();
  for (const key of lit.keys()) {
    const [c, r] = key.split("-").map(Number);
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (dc === 0 && dr === 0) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nc >= totalWeeks || nr < 0 || nr > 6) continue;
        const nkey = `${nc}-${nr}`;
        if (!lit.has(nkey)) halo.set(nkey, true);
      }
    }
  }

  const weeks = [];
  for (let w = 0; w < totalWeeks; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const key = `${w}-${d}`;
      // Sentinel -1 marks a halo cell; handled specially in levelFor/render.
      const count = lit.has(key) ? 8 : halo.has(key) ? -1 : 0;
      days.push({ contributionCount: count, weekday: d });
    }
    weeks.push({ contributionDays: days });
  }
  return weeks;
}

function levelFor(count) {
  if (count === -1) return "halo";
  if (count <= 0) return 0;
  if (count < 3) return 1;
  if (count < 6) return 2;
  if (count < 10) return 3;
  return 4;
}

function buildGrid(weeks) {
  const cols = weeks.length;
  const cells = [];
  weeks.forEach((week, col) => {
    week.contributionDays.forEach((day) => {
      const row = day.weekday;
      cells.push({
        col,
        row,
        level: levelFor(day.contributionCount),
      });
    });
  });
  return { cols, cells };
}

function cellX(col) {
  return MARGIN_LEFT + col * STEP;
}
function cellY(row) {
  return MARGIN_TOP + row * STEP;
}

// Boustrophedon path through the grid: down column 0, up column 1, down column 2, ...
// Returns both the raw [x,y] points (for the motion path) and an index
// lookup keyed by "col-row" so each cell can find its position along the
// route (used to time the "consumed as the car passes" fade effect).
function buildTrackPath(cols) {
  const points = [];
  const indexByCell = new Map();
  for (let col = 0; col < cols; col++) {
    const goingDown = col % 2 === 0;
    const rowOrder = goingDown
      ? [0, 1, 2, 3, 4, 5, 6]
      : [6, 5, 4, 3, 2, 1, 0];
    for (const row of rowOrder) {
      indexByCell.set(`${col}-${row}`, points.length);
      points.push([cellX(col) + CELL / 2, cellY(row) + CELL / 2]);
    }
  }
  return { points, indexByCell };
}

// Clamp + dedupe keyTimes so SMIL never receives a non-increasing sequence.
function safeKeyTimes(times) {
  const out = [];
  let prev = -1;
  for (let t of times) {
    t = Math.min(1, Math.max(0, t));
    if (t <= prev) t = Math.min(1, prev + 0.0005);
    out.push(t);
    prev = t;
  }
  // Force the last keyTime to exactly 1 (SMIL requirement).
  out[out.length - 1] = 1;
  return out;
}

// By default <animateMotion> moves at constant *physical speed* along the
// path (SMIL "paced" mode). Our path has uneven segment lengths (short
// vertical steps within a column vs. long diagonal jumps between columns),
// so a paced car drifts out of sync with the per-cell "consumed" flashes
// and the progress bar, which both fire on constant *time* intervals per
// point index. Fix: force calcMode="linear" with keyTimes spaced evenly by
// index and keyPoints spaced by actual arc-length fraction. That tells the
// animation "at index-fraction T, be at arc-length-fraction K", which pins
// the car to the same point-by-point schedule the tiles and bar already use.
function buildMotionTiming(points) {
  const n = points.length;
  const dist = [0];
  let total = 0;
  for (let i = 1; i < n; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    total += Math.hypot(x1 - x0, y1 - y0);
    dist.push(total);
  }
  const keyTimes = points
    .map((_, i) => (n > 1 ? i / (n - 1) : 0).toFixed(4))
    .join(";");
  const keyPoints = dist
    .map((d) => (total > 0 ? d / total : 0).toFixed(4))
    .join(";");
  return { keyTimes, keyPoints };
}

function pointsToPathD(points) {
  return points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
}

function carSprite(fill = "#E10600") {
  // Simple top-down F1 car silhouette, nose pointing along +x so that
  // rotate="auto" on animateMotion aligns it with the direction of travel.
  return `
    <g id="f1car">
      <ellipse cx="0" cy="0" rx="17" ry="8" fill="${fill}" opacity="0.35" filter="url(#carGlow)"/>
      <!-- rear wing -->
      <rect x="11" y="-9" width="3" height="18" rx="1" fill="#1a1a1a"/>
      <rect x="12.5" y="-9" width="1.5" height="18" fill="#1a1a1a"/>
      <!-- body -->
      <rect x="-14" y="-5.5" width="24" height="11" rx="4" fill="${fill}"/>
      <!-- cockpit / halo -->
      <ellipse cx="-1" cy="0" rx="3.2" ry="2.6" fill="#0d1117"/>
      <!-- front wing -->
      <rect x="-18" y="-8" width="4" height="16" rx="1" fill="#1a1a1a"/>
      <!-- nose -->
      <path d="M -14 -2.5 L -20 0 L -14 2.5 Z" fill="${fill}"/>
      <!-- wheels -->
      <rect x="-9" y="-9" width="5" height="4" rx="1.5" fill="#111"/>
      <rect x="-9" y="5" width="5" height="4" rx="1.5" fill="#111"/>
      <rect x="6" y="-9" width="5" height="4" rx="1.5" fill="#111"/>
      <rect x="6" y="5" width="5" height="4" rx="1.5" fill="#111"/>
    </g>`;
}

function buildSVG({ cols, cells }, palette) {
  const gridWidth = cols * STEP - GAP;
  const width = MARGIN_LEFT + cols * STEP + MARGIN_RIGHT;
  const height = MARGIN_TOP + ROWS * STEP + BAR_GAP + BAR_HEIGHT + MARGIN_BOTTOM;

  const { points: trackPoints, indexByCell } = buildTrackPath(cols);
  const trackD = pointsToPathD(trackPoints);
  const totalPoints = trackPoints.length;
  const motionTiming = buildMotionTiming(trackPoints);

  // Each cell fades down ("consumed") right as the car passes it, then
  // gradually recharges back to full brightness before the next lap.
  const cellRects = cells
    .map((c) => {
      const idx = indexByCell.get(`${c.col}-${c.row}`) ?? 0;
      const frac = totalPoints > 1 ? idx / (totalPoints - 1) : 0;
      const keyTimes = safeKeyTimes([0, frac, frac + 0.015, 1]).join(";");
      const fill = c.level === "halo" ? palette.halo : palette.levels[c.level];
      return `<rect x="${cellX(c.col).toFixed(1)}" y="${cellY(c.row).toFixed(
        1
      )}" width="${CELL}" height="${CELL}" rx="2" fill="${fill}">
        <animate attributeName="opacity" keyTimes="${keyTimes}" values="1;1;0.18;1" dur="${LAP_SECONDS}s" repeatCount="indefinite"/>
      </rect>`;
    })
    .join("\n      ");

  // Two trailing "dust" particles that follow the same index-paced timing
  // as the car (see buildMotionTiming), just started a hair earlier so
  // they trail behind it instead of chasing at a different pace.
  const particles = [0.985, 0.965]
    .map(
      (frac, i) => `
      <circle r="${3 - i}" fill="${palette.accent}" opacity="${0.35 - i * 0.1}">
        <animateMotion dur="${LAP_SECONDS}s" begin="-${(
          (1 - frac) *
          LAP_SECONDS
        ).toFixed(2)}s" repeatCount="indefinite" rotate="auto" calcMode="linear" keyTimes="${motionTiming.keyTimes}" keyPoints="${motionTiming.keyPoints}" path="${trackD}"/>
      </circle>`
    )
    .join("");

  const barY = MARGIN_TOP + ROWS * STEP + BAR_GAP;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <filter id="carGlow" x="-100%" y="-100%" width="300%" height="300%">
      <feGaussianBlur stdDeviation="3.2" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="blur"/>
      </feMerge>
    </filter>
  </defs>

  <rect x="0" y="0" width="${width}" height="${height}" rx="10" fill="${palette.bg}"/>

  <text x="${MARGIN_LEFT}" y="22" font-family="'Courier New', monospace" font-size="13" font-weight="700" fill="${palette.accent}" letter-spacing="1.5">CONTRIBUTION CIRCUIT</text>
  <text x="${width - MARGIN_RIGHT}" y="22" text-anchor="end" font-family="'Courier New', monospace" font-size="10" fill="${palette.text}" opacity="0.6">LAP ${LAP_SECONDS}s</text>

  <!-- faint racing line under the grid -->
  <path d="${trackD}" fill="none" stroke="${palette.track}" stroke-width="1" stroke-dasharray="1 3" opacity="0.5"/>

  <!-- contribution grid (each cell dims as the car consumes it, then recharges) -->
  ${cellRects}

  <!-- dust trail -->
  ${particles}

  <!-- the car -->
  ${carSprite("#E10600")}

  <!-- lap progress bar -->
  <rect x="${MARGIN_LEFT}" y="${barY}" width="${gridWidth}" height="${BAR_HEIGHT}" rx="${BAR_HEIGHT / 2}" fill="${palette.track}"/>
  <rect x="${MARGIN_LEFT}" y="${barY}" height="${BAR_HEIGHT}" rx="${BAR_HEIGHT / 2}" fill="${palette.accent}" width="0">
    <animate attributeName="width" values="0;${gridWidth};0" keyTimes="0;0.999;1" dur="${LAP_SECONDS}s" repeatCount="indefinite"/>
  </rect>

</svg>`;
}

function buildSVGFixed(grid, palette) {
  const raw = buildSVG(grid, palette);
  const { points: trackPoints } = buildTrackPath(grid.cols);
  const trackD = pointsToPathD(trackPoints);
  const { keyTimes, keyPoints } = buildMotionTiming(trackPoints);
  return raw.replace(
    "</g>",
    `<animateMotion dur="${LAP_SECONDS}s" repeatCount="indefinite" rotate="auto" calcMode="linear" keyTimes="${keyTimes}" keyPoints="${keyPoints}" path="${trackD}"/>\n    </g>`
  );
}

async function main() {
  const weeks = await fetchContributions(username);
  const grid = buildGrid(weeks);
  const palette = PALETTES[theme] || PALETTES.dark;
  const svg = buildSVGFixed(grid, palette);

  const fs = await import("node:fs");
  const path = await import("node:path");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, svg, "utf8");
  console.log(`Wrote ${outPath} (${grid.cols} weeks, ${grid.cells.length} cells)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
