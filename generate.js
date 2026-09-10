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
const MARGIN_BOTTOM = 16;
const ROWS = 7;
const LAP_SECONDS = 22;

const PALETTES = {
  dark: {
    bg: "#0d1117",
    grid: "#161b22",
    levels: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"],
    text: "#c9d1d9",
    accent: "#39d353",
    track: "#30363d",
  },
  light: {
    bg: "#ffffff",
    grid: "#ebedf0",
    levels: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
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

function mockContributions() {
  // Deterministic pseudo-random grid for local preview/testing without a token.
  const weeks = [];
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let w = 0; w < 53; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const r = rand();
      const count = r > 0.55 ? Math.floor(r * 12) : 0;
      days.push({ contributionCount: count, weekday: d });
    }
    weeks.push({ contributionDays: days });
  }
  return weeks;
}

function levelFor(count) {
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
function buildTrackPath(cols) {
  const points = [];
  for (let col = 0; col < cols; col++) {
    const goingDown = col % 2 === 0;
    const rowOrder = goingDown
      ? [0, 1, 2, 3, 4, 5, 6]
      : [6, 5, 4, 3, 2, 1, 0];
    for (const row of rowOrder) {
      points.push([cellX(col) + CELL / 2, cellY(row) + CELL / 2]);
    }
  }
  return points;
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
  const width = MARGIN_LEFT + cols * STEP + MARGIN_RIGHT;
  const height = MARGIN_TOP + ROWS * STEP + MARGIN_BOTTOM;

  const trackPoints = buildTrackPath(cols);
  const trackD = pointsToPathD(trackPoints);

  const cellRects = cells
    .map(
      (c) =>
        `<rect x="${cellX(c.col).toFixed(1)}" y="${cellY(c.row).toFixed(
          1
        )}" width="${CELL}" height="${CELL}" rx="2" fill="${
          palette.levels[c.level]
        }"/>`
    )
    .join("\n      ");

  // Two trailing "dust" particles that follow the same path with a small
  // time delay, for a comet-tail effect behind the car.
  const particles = [0.985, 0.965]
    .map(
      (frac, i) => `
      <circle r="${3 - i}" fill="${palette.accent}" opacity="${0.35 - i * 0.1}">
        <animateMotion dur="${LAP_SECONDS}s" begin="-${(
          (1 - frac) *
          LAP_SECONDS
        ).toFixed(2)}s" repeatCount="indefinite" rotate="auto" path="${trackD}"/>
      </circle>`
    )
    .join("");

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

  <!-- contribution grid -->
  ${cellRects}

  <!-- dust trail -->
  ${particles}

  <!-- the car -->
  ${carSprite("#E10600")}
  <animateMotion xlink:href="#f1car" dur="${LAP_SECONDS}s" repeatCount="indefinite" rotate="auto" path="${trackD}"/>

</svg>`;
}

// Note: <animateMotion> must be a child of the element it animates in
// standard SVG, not linked via xlink:href on a sibling. Fix applied below
// by nesting it inside the #f1car group instead.
function buildSVGFixed(grid, palette) {
  const raw = buildSVG(grid, palette);
  const trackPoints = buildTrackPath(grid.cols);
  const trackD = pointsToPathD(trackPoints);
  return raw
    .replace(
      /<animateMotion xlink:href="#f1car"[^>]*\/>\s*/,
      ""
    )
    .replace(
      "</g>",
      `<animateMotion dur="${LAP_SECONDS}s" repeatCount="indefinite" rotate="auto" path="${trackD}"/>\n    </g>`
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
