import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const EN_RAW_BASE = "https://en.wikipedia.org/w/index.php";
const ZH_RAW_BASE = "https://zh.wikipedia.org/w/index.php";
const TEMPLATE_TITLE = "Template:Shanghai_Metro";
const MODULE_TITLE = "Module:Adjacent_stations/Shanghai_Metro";

const LINES = [
  { id: "1", name: "Line 1", page: "Line_1_(Shanghai_Metro)" },
  { id: "2", name: "Line 2", page: "Line_2_(Shanghai_Metro)" },
  { id: "3", name: "Line 3", page: "Line_3_(Shanghai_Metro)" },
  { id: "4", name: "Line 4", page: "Line_4_(Shanghai_Metro)", circular: true },
  { id: "5", name: "Line 5", page: "Line_5_(Shanghai_Metro)", branched: true },
  { id: "6", name: "Line 6", page: "Line_6_(Shanghai_Metro)" },
  { id: "7", name: "Line 7", page: "Line_7_(Shanghai_Metro)" },
  { id: "8", name: "Line 8", page: "Line_8_(Shanghai_Metro)" },
  { id: "9", name: "Line 9", page: "Line_9_(Shanghai_Metro)" },
  { id: "10", name: "Line 10", page: "Line_10_(Shanghai_Metro)", branched: true },
  { id: "11", name: "Line 11", page: "Line_11_(Shanghai_Metro)", branched: true },
  { id: "12", name: "Line 12", page: "Line_12_(Shanghai_Metro)" },
  { id: "13", name: "Line 13", page: "Line_13_(Shanghai_Metro)" },
  { id: "14", name: "Line 14", page: "Line_14_(Shanghai_Metro)" },
  { id: "15", name: "Line 15", page: "Line_15_(Shanghai_Metro)" },
  { id: "16", name: "Line 16", page: "Line_16_(Shanghai_Metro)" },
  { id: "17", name: "Line 17", page: "Line_17_(Shanghai_Metro)" },
  { id: "18", name: "Line 18", page: "Line_18_(Shanghai_Metro)" },
  { id: "Pujiang", name: "Pujiang line", page: "Pujiang_Line" },
];

const STATION_ALIASES = new Map([
  ["Pudian Road6", "Pudian Road (Line 6)"],
  ["Pudian Road4", "Xiangcheng Road"],
  ["Panxiang Road · Shanghai National Accounting Institute", "Panxiang Road"],
  ["Zhangjiang High Technology Park", "Zhangjiang Hi-Tech Park"],
  ["Shanghai Songjiang Railway Station", "Shanghai Songjiang"],
  ["Xia'nan Road", "Xianan Road"],
  ["Dingbian Road formerly Cao'an Highway", "Dingbian Road"],
]);

const farePolicy = {
  note: "Shanghai Metro fare rule by distance (CNY): <=6km ¥3; <=16km ¥4; <=26km ¥5; <=36km ¥6; <=46km ¥7; <=56km ¥8; then +¥1 per extra 20km.",
  source: "https://en.wikipedia.org/wiki/Shanghai_Metro",
};

const REQUEST_HEADERS = {
  "user-agent": "ShanghaiMetroRoute/1.0 (route data builder)",
};

const ACTIVE_ROUTE_MARKERS = /[●◒◑◔◕◐◓◉↓]/u;
const MISSING_DISTANCE_MARKER = "WIKIPEDIA_DISTANCE_MISSING";
const REVERSED_CHINESE_ROUTE_LINES = new Set(["3"]);

function getChineseLineTitle(line) {
  return line.id === "Pujiang" ? "上海轨道交通浦江线" : `上海轨道交通${line.id}号线`;
}

function getChineseLineName(line) {
  return line.id === "Pujiang" ? "上海轨道交通浦江线" : `上海轨道交通${line.id}号线`;
}

export { getChineseLineName };

const buildRawUrl = (baseUrl, title) =>
  `${baseUrl}?title=${encodeURIComponent(title)}&action=raw`;

async function fetchRaw(baseUrl, title) {
  const response = await fetch(buildRawUrl(baseUrl, title), { headers: REQUEST_HEADERS });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${title}: ${response.status}`);
  }
  return response.text();
}

function cleanInlineMarkup(value) {
  return value
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\{\{(?:Efn-lr|efn-lr)\|[\s\S]*?\}\}/g, " ")
    .replace(/\{\{small\|([^}]*)\}\}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStationName(name) {
  const clean = cleanInlineMarkup(name);
  return STATION_ALIASES.get(clean) ?? clean;
}

function parseStationsFromText(text) {
  const stations = [];
  const regex =
    /^\*\s*(?:''\s*)?\{\{#invoke:adjacent stations\|station link\|SHM\|([^}|]+)\}\}(?:\s*'')?/gm;

  for (const match of text.matchAll(regex)) {
    if (!match[0].includes("''")) {
      stations.push(normalizeStationName(match[1]));
    }
  }

  return stations;
}

function extractListSection(templateRaw, listKey, nextGroupKey) {
  const start = templateRaw.indexOf(`|${listKey} =`);
  if (start < 0) {
    throw new Error(`List key not found: ${listKey}`);
  }

  const end = templateRaw.indexOf(`|${nextGroupKey} =`, start);
  if (end < 0) {
    throw new Error(`Next group key not found: ${nextGroupKey}`);
  }

  return templateRaw.slice(start, end);
}

function parseBranches(templateRaw) {
  const branchesByLine = new Map();

  for (const line of LINES) {
    if (line.id === "Pujiang") {
      const section = extractListSection(templateRaw, "list24", "group25");
      branchesByLine.set(line.id, [parseStationsFromText(section)]);
      continue;
    }

    if (!line.branched) {
      const section = extractListSection(
        templateRaw,
        `list${line.id}`,
        `group${Number(line.id) + 1}`,
      );
      branchesByLine.set(line.id, [parseStationsFromText(section)]);
      continue;
    }

    if (line.id === "5") {
      const section = extractListSection(templateRaw, "list5", "group6");
      const mainMatch = section.match(/\|list1\s*=\n([\s\S]*?)\n\s*\|group2\s*=/);
      const branchMatch = section.match(/\|list2\s*=\n([\s\S]*?)\n\s*\}\}/);
      if (!mainMatch || !branchMatch) {
        throw new Error("Failed to parse line 5 branches from template.");
      }
      branchesByLine.set(line.id, [
        parseStationsFromText(mainMatch[1]),
        parseStationsFromText(branchMatch[1]),
      ]);
      continue;
    }

    const section = extractListSection(
      templateRaw,
      `list${line.id}`,
      `group${Number(line.id) + 1}`,
    );
    const mainMatch = section.match(
      new RegExp(`\\|${line.id}_list1\\s*=\\n([\\s\\S]*?)\\n\\s*\\|${line.id}_group2\\s*=`),
    );
    const branchMatch = section.match(
      new RegExp(`\\|${line.id}_list2\\s*=\\n([\\s\\S]*)$`),
    );
    if (!mainMatch || !branchMatch) {
      throw new Error(`Failed to parse line ${line.id} branches from template.`);
    }
    branchesByLine.set(line.id, [
      parseStationsFromText(mainMatch[1]),
      parseStationsFromText(branchMatch[1]),
    ]);
  }

  return branchesByLine;
}

function parseColor(moduleRaw, lineId) {
  const pattern = new RegExp(
    String.raw`\["${lineId}"\]\s*=\s*\{[\s\S]*?\["color"\]\s*=\s*"([0-9a-fA-F]{6})"`,
  );
  const match = moduleRaw.match(pattern);
  return match ? `#${match[1].toLowerCase()}` : "#888888";
}

function parseLineLengthKm(raw) {
  const line =
    raw.match(/^\|\s*linelength\s*=\s*(.+)$/m)?.[1] ??
    raw.match(/^\|\s*线路长度\s*=\s*(.+)$/m)?.[1] ??
    raw.match(/^\|\s*line_length\s*=\s*(.+)$/m)?.[1] ??
    raw.match(/^\|\s*route_length\s*=\s*(.+)$/m)?.[1] ??
    "";
  const number = line.match(/(\d+(?:\.\d+)?)/)?.[1];
  return number ? Number(number) : null;
}

function getAllStations(linesWithBranches) {
  const stationSet = new Set();
  for (const line of linesWithBranches) {
    for (const branch of line.branches) {
      for (const station of branch) {
        stationSet.add(station);
      }
    }
  }
  return Array.from(stationSet).sort((a, b) => a.localeCompare(b));
}

function findSection(raw, headings) {
  for (const heading of headings) {
    const match = raw.match(
      new RegExp(`===\\s*${heading}\\s*===[\\s\\S]*?(?=\\n===[^=]|$)`, "i"),
    );
    if (match) {
      return match[0];
    }
  }
  return null;
}

function extractFirstTable(sectionRaw) {
  const start = sectionRaw.indexOf("{|");
  if (start < 0) {
    return null;
  }

  let templateDepth = 0;
  let linkDepth = 0;
  let tableDepth = 0;

  for (let i = start; i < sectionRaw.length - 1; i += 1) {
    const token = sectionRaw.slice(i, i + 2);

    if (token === "{{") {
      templateDepth += 1;
      i += 1;
      continue;
    }
    if (token === "}}") {
      templateDepth = Math.max(0, templateDepth - 1);
      i += 1;
      continue;
    }
    if (token === "[[") {
      linkDepth += 1;
      i += 1;
      continue;
    }
    if (token === "]]") {
      linkDepth = Math.max(0, linkDepth - 1);
      i += 1;
      continue;
    }
    if (token === "{|" && templateDepth === 0 && linkDepth === 0) {
      tableDepth += 1;
      i += 1;
      continue;
    }
    if (token === "|}" && templateDepth === 0 && linkDepth === 0) {
      tableDepth -= 1;
      i += 1;
      if (tableDepth === 0) {
        return sectionRaw.slice(start, i + 1);
      }
    }
  }

  return null;
}

function splitTopLevelCells(line) {
  const cells = [];
  let buffer = "";
  let templateDepth = 0;
  let linkDepth = 0;
  let tableDepth = 0;

  for (let i = 0; i < line.length; i += 1) {
    const token = line.slice(i, i + 2);

    if (token === "{{") {
      templateDepth += 1;
      buffer += token;
      i += 1;
      continue;
    }
    if (token === "}}") {
      templateDepth = Math.max(0, templateDepth - 1);
      buffer += token;
      i += 1;
      continue;
    }
    if (token === "[[") {
      linkDepth += 1;
      buffer += token;
      i += 1;
      continue;
    }
    if (token === "]]") {
      linkDepth = Math.max(0, linkDepth - 1);
      buffer += token;
      i += 1;
      continue;
    }
    if (token === "{|" && templateDepth === 0 && linkDepth === 0) {
      tableDepth += 1;
      buffer += token;
      i += 1;
      continue;
    }
    if (token === "|}" && templateDepth === 0 && linkDepth === 0) {
      tableDepth = Math.max(0, tableDepth - 1);
      buffer += token;
      i += 1;
      continue;
    }
    if (
      token === "||" &&
      templateDepth === 0 &&
      linkDepth === 0 &&
      tableDepth === 0
    ) {
      cells.push(buffer);
      buffer = "";
      i += 1;
      continue;
    }

    buffer += line[i];
  }

  cells.push(buffer);
  return cells;
}

function stripCellFormatting(cell) {
  let value = cell.trim();

  while (true) {
    let templateDepth = 0;
    let linkDepth = 0;
    let tableDepth = 0;
    let splitIndex = -1;

    for (let i = 0; i < value.length; i += 1) {
      const token = value.slice(i, i + 2);

      if (token === "{{") {
        templateDepth += 1;
        i += 1;
        continue;
      }
      if (token === "}}") {
        templateDepth = Math.max(0, templateDepth - 1);
        i += 1;
        continue;
      }
      if (token === "[[") {
        linkDepth += 1;
        i += 1;
        continue;
      }
      if (token === "]]") {
        linkDepth = Math.max(0, linkDepth - 1);
        i += 1;
        continue;
      }
      if (token === "{|" && templateDepth === 0 && linkDepth === 0) {
        tableDepth += 1;
        i += 1;
        continue;
      }
      if (token === "|}" && templateDepth === 0 && linkDepth === 0) {
        tableDepth = Math.max(0, tableDepth - 1);
        i += 1;
        continue;
      }
      if (
        value[i] === "|" &&
        templateDepth === 0 &&
        linkDepth === 0 &&
        tableDepth === 0
      ) {
        splitIndex = i;
        break;
      }
    }

    if (splitIndex < 0) {
      return value.trim();
    }

    value = value.slice(splitIndex + 1).trim();
  }
}

function parseRowCells(rowChunk) {
  const cells = [];

  for (const rawLine of rowChunk.split("\n")) {
    const line = rawLine.trim();
    if (!line || line === "|-" || !line.startsWith("|")) {
      continue;
    }

    for (const cell of splitTopLevelCells(line.slice(1))) {
      cells.push(stripCellFormatting(cell));
    }
  }

  return cells;
}

function extractStationName(cell) {
  if (/loop line/i.test(cell)) {
    return null;
  }

  const stationTemplate = cell.match(
    /\{\{(?:stl|ltl)\|(?:SHM|上海地铁)\|([^}|]+)(?:\|[^}]*)?\}\}/i,
  );
  if (stationTemplate) {
    return normalizeStationName(stationTemplate[1]);
  }

  const adjacentStationInvoke = cell.match(
    /\{\{#invoke:adjacent stations\|station link\|SHM\|([^}|]+)/i,
  );
  if (adjacentStationInvoke) {
    return normalizeStationName(adjacentStationInvoke[1]);
  }

  const linkedStation =
    cell.match(/^\[\[[^\]|]+\|([^\]]+)\]\](.*)$/) ??
    cell.match(/^\[\[([^\]]+)\]\](.*)$/);
  if (linkedStation) {
    const candidate = cleanInlineMarkup(
      `${linkedStation[1]}${linkedStation[2] ?? ""}`.replace(
        /\s+station$/i,
        "",
      ),
    );
    const looksLikeStationName =
      /^[A-Za-z]/.test(candidate) || /[\u4e00-\u9fff]/.test(candidate);
    if (
      candidate &&
      looksLikeStationName &&
      !candidate.endsWith(":") &&
      !/^As of\b/i.test(candidate)
    ) {
      return normalizeStationName(candidate);
    }
  }

  const plain = cleanInlineMarkup(cell.replace(/\{\{[^}]+\}\}/g, " "));
  const looksLikePlainStationName =
    plain &&
    (/[\u4e00-\u9fff]/.test(plain) || /^[A-Za-z]/.test(plain)) &&
    !/^L\d+\//.test(plain) &&
    !plain.endsWith(":") &&
    !/^As of\b/i.test(plain) &&
    !/^(Routes|M|B|P|C|E|AM|Mainline|Branch|Branchline|Clockwise|Counter-clockwise)$/i.test(
      plain,
    );
  if (looksLikePlainStationName) {
    return normalizeStationName(plain);
  }

  return null;
}

export { extractStationName };

function isStationCode(cell) {
  return (
    /^[A-Z]{0,3}\d{1,2}\/\d/.test(cell) ||
    /^[A-Z]{1,3}\/?\d+(?:-\d+)?$/.test(cell)
  );
}

function parseNumericCellValue(cell) {
  const match = cleanInlineMarkup(cell).match(/^-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parseNumericCellValues(cell) {
  return Array.from(cleanInlineMarkup(cell).matchAll(/-?\d+(?:\.\d+)?/g), (match) =>
    Number(match[0]),
  );
}

function parseStationRowsFromServiceTable(tableRaw) {
  const rows = [];

  for (const chunk of tableRaw.split("\n|-")) {
    const cells = parseRowCells(chunk);
    if (cells.length === 0) {
      continue;
    }

    const stationIndex = cells.findIndex((cell) => extractStationName(cell));
    if (stationIndex < 0) {
      continue;
    }

    const routeCount =
      stationIndex > 0 && isStationCode(cells[stationIndex - 1])
        ? stationIndex - 1
        : stationIndex;

    const activeRouteIndexes = [];
    for (let i = 0; i < routeCount; i += 1) {
      if (ACTIVE_ROUTE_MARKERS.test(cells[i])) {
        activeRouteIndexes.push(i);
      }
    }

    const intervalCell = cells
      .slice(stationIndex + 1)
      .map((cell) => parseNumericCellValue(cell))
      .find((value) => value != null);

    rows.push({
      station: extractStationName(cells[stationIndex]),
      activeRouteIndexes,
      intervalKm: intervalCell,
    });
  }

  return rows;
}

function parseLoopClosureDistanceKm(tableRaw) {
  const chunks = tableRaw.split("\n|-").reverse();

  for (const chunk of chunks) {
    if (!/loop line/i.test(chunk)) {
      continue;
    }

    const numericCell = parseRowCells(chunk)
      .map((cell) => parseNumericCellValue(cell))
      .find((value) => value != null);
    if (numericCell != null) {
      return numericCell;
    }
  }

  return null;
}

function resolveSegmentDistanceKm(sequence, index) {
  const backwardDistanceKm = sequence[index].intervalKm;
  if (backwardDistanceKm != null && backwardDistanceKm > 0) {
    return backwardDistanceKm;
  }

  if (index === 1) {
    const forwardDistanceKm = sequence[index - 1].intervalKm;
    if (forwardDistanceKm != null && forwardDistanceKm > 0) {
      return forwardDistanceKm;
    }
  }

  return null;
}

function estimateMissingDistanceKm({ knownDistances, missingCount, lineLengthKm, edgeCount }) {
  const knownTotalKm = knownDistances.reduce((sum, distanceKm) => sum + distanceKm, 0);
  const remainingKm =
    lineLengthKm != null ? Number((lineLengthKm - knownTotalKm).toFixed(6)) : null;

  if (remainingKm != null && remainingKm > 0 && missingCount > 0) {
    return remainingKm / missingCount;
  }

  if (knownDistances.length > 0) {
    return knownTotalKm / knownDistances.length;
  }

  if (lineLengthKm != null && edgeCount > 0) {
    return lineLengthKm / edgeCount;
  }

  return 1.2;
}

function extractChineseStationRows(raw) {
  const section = findSection(raw, ["车站列表"]);
  if (!section) {
    return [];
  }

  const tableRaw = extractFirstTable(section);
  if (!tableRaw) {
    return [];
  }

  const groups = [];
  let currentGroup = null;

  for (const chunk of tableRaw.split("\n|-")) {
    const cells = parseRowCells(chunk);
    if (cells.length === 0) {
      continue;
    }

    const stationIndex = cells.findIndex((cell) => /\{\{stl\|上海地铁\|[^}|]+/i.test(cell));
    if (stationIndex < 0) {
      continue;
    }

    const groupLabel = cells
      .slice(0, stationIndex)
      .map((cell) => cleanInlineMarkup(cell))
      .find((cell) => cell && !PURE_METADATA_CELL.test(cell));

    if (chunk.includes("border-top:3px") || groupLabel || !currentGroup) {
      currentGroup = { label: groupLabel ?? null, rows: [] };
      groups.push(currentGroup);
    }

    const stationName = extractStationName(cells[stationIndex]);
    if (!stationName) {
      continue;
    }

    currentGroup.rows.push({
      station: stationName,
      mileageValues: parseNumericCellValues(cells[stationIndex + 1] ?? ""),
      intervalValues: parseNumericCellValues(cells[stationIndex + 2] ?? ""),
    });
  }

  return groups;
}

const PURE_METADATA_CELL =
  /^(?:[-—–]|●|↓|▼|不运行|—|高架|地下|地面|\d+(?:\.\d+)?(?:\s*\(\d+(?:\.\d+)?\))?)$/;

function mileageItem(row, mileageIndex = 0) {
  return { row, mileageIndex };
}

function getMileageValueMeters(item) {
  return item.row.mileageValues[item.mileageIndex] ?? null;
}

function flattenGroupRows(groups, predicate = () => true) {
  return groups.filter(predicate).flatMap((group) => group.rows);
}

function buildChineseMileageSequences(line, groups) {
  if (groups.length === 0) {
    return { sequences: [] };
  }

  if (line.id === "4") {
    const rows = flattenGroupRows(groups);
    return {
      sequences: [[mileageItem(rows[0], 1), ...rows.slice(1).toReversed().map((row) => mileageItem(row))]],
      circularClosureMeters: rows[0].mileageValues[0] ?? null,
    };
  }

  if (line.id === "5") {
    const trunk = groups.find(
      (group) => group.label?.includes("主线") && !group.label?.includes("南延伸"),
    );
    const south = groups.find((group) => group.label?.includes("主线南延伸"));
    const branch = groups.find((group) => group.label?.includes("支线"));
    return {
      sequences: [
        [...(trunk?.rows ?? []), ...(south?.rows ?? [])].map((row) => mileageItem(row)),
        [trunk?.rows.at(-1), ...(branch?.rows ?? [])]
          .filter(Boolean)
          .map((row) => mileageItem(row)),
      ],
    };
  }

  if (line.id === "10") {
    const branchRows = groups.find((group) => group.label?.includes("支线"))?.rows ?? [];
    const mainRows = flattenGroupRows(groups, (group) => !group.label?.includes("支线"));
    const mergeRow = mainRows.find((row) => row.mileageValues.length > 1);
    return {
      sequences: [
        mainRows.map((row) => mileageItem(row)),
        [mileageItem(mergeRow, 1), ...branchRows.toReversed().map((row) => mileageItem(row))]
          .filter((item) => item.row),
      ],
    };
  }

  if (line.id === "11") {
    const flowerRows = groups.find((group) => group.label?.includes("花桥"))?.rows ?? [];
    const branchRows = groups.find((group) => group.label?.includes("支线"))?.rows ?? [];
    const mainRows = flattenGroupRows(
      groups,
      (group) => !group.label?.includes("花桥") && !group.label?.includes("支线"),
    );
    const mergeRow = mainRows.find((row) => row.mileageValues.length > 1);
    return {
      sequences: [
        mainRows.map((row) => mileageItem(row)),
        [
          ...flowerRows.map((row) => mileageItem(row)),
          ...branchRows.map((row) => mileageItem(row)),
          mileageItem(mergeRow, 1),
        ].filter((item) => item.row),
      ],
    };
  }

  if (line.id === "2") {
    return {
      sequences: [flattenGroupRows(groups).slice(0, 31).map((row) => mileageItem(row))],
    };
  }

  if (line.id === "12") {
    return {
      sequences: [flattenGroupRows(groups).slice(-32).map((row) => mileageItem(row))],
    };
  }

  if (line.id === "13") {
    return {
      sequences: [flattenGroupRows(groups).slice(5, 36).map((row) => mileageItem(row))],
    };
  }

  if (line.id === "14") {
    const rows = flattenGroupRows(groups);
    return {
      sequences: [[...rows.slice(0, 23), ...rows.slice(24)].map((row) => mileageItem(row))],
    };
  }

  if (line.id === "15") {
    return {
      sequences: [flattenGroupRows(groups).slice(5).toReversed().map((row) => mileageItem(row))],
    };
  }

  if (line.id === "17") {
    return {
      sequences: [flattenGroupRows(groups).slice(2).map((row) => mileageItem(row))],
    };
  }

  if (line.id === "18") {
    const rows = flattenGroupRows(groups).filter((_, index) => index !== 28);
    return {
      sequences: [rows.toReversed().map((row) => mileageItem(row))],
    };
  }

  let rows = flattenGroupRows(groups).map((row) => mileageItem(row));
  if (REVERSED_CHINESE_ROUTE_LINES.has(line.id)) {
    rows = rows.toReversed();
  }
  return { sequences: [rows] };
}

function parseEdgeDistancesFromChineseLinePage(raw, line, branches) {
  const groups = extractChineseStationRows(raw);
  const { sequences, circularClosureMeters } = buildChineseMileageSequences(line, groups);
  const edgeDistances = new Map();

  if (sequences.length !== branches.length) {
    throw new Error(
      `Chinese route sequence count mismatch for ${line.name}: expected ${branches.length}, got ${sequences.length}.`,
    );
  }

  for (let branchIndex = 0; branchIndex < branches.length; branchIndex += 1) {
    const branchStations = branches[branchIndex];
    const sequence = sequences[branchIndex];
    if (sequence.length !== branchStations.length) {
      throw new Error(
        `Chinese station row count mismatch for ${line.name} branch ${branchIndex + 1}: expected ${branchStations.length}, got ${sequence.length}.`,
      );
    }

    for (let i = 1; i < sequence.length; i += 1) {
      const previousMileage = getMileageValueMeters(sequence[i - 1]);
      const currentMileage = getMileageValueMeters(sequence[i]);
      if (previousMileage == null || currentMileage == null) {
        continue;
      }
      edgeDistances.set(
        [branchStations[i - 1], branchStations[i]].sort().join("::"),
        Number((Math.abs(currentMileage - previousMileage) / 1000).toFixed(3)),
      );
    }
  }

  if (line.circular && branches[0] && circularClosureMeters != null) {
    const sequence = sequences[0];
    const lastMileage = getMileageValueMeters(sequence.at(-1));
    if (lastMileage != null) {
      edgeDistances.set(
        [branches[0].at(-1), branches[0][0]].sort().join("::"),
        Number((Math.abs(lastMileage - circularClosureMeters) / 1000).toFixed(3)),
      );
    }
  }

  return edgeDistances;
}

function buildChineseBranchStations(raw, line, fallbackBranches) {
  const groups = extractChineseStationRows(raw);
  const { sequences } = buildChineseMileageSequences(line, groups);

  if (sequences.length === 0) {
    return fallbackBranches;
  }

  return sequences.map((sequence) =>
    sequence.map((item) => item.row.station).filter(Boolean),
  );
}

function remapEdgeDistancesToChineseNames(line, englishBranches, chineseBranches, edgeDistances) {
  const remapped = new Map();

  for (let branchIndex = 0; branchIndex < englishBranches.length; branchIndex += 1) {
    const englishBranch = englishBranches[branchIndex] ?? [];
    const chineseBranch = chineseBranches[branchIndex] ?? [];

    if (englishBranch.length !== chineseBranch.length) {
      continue;
    }

    for (let i = 1; i < englishBranch.length; i += 1) {
      const distanceKm = edgeDistances.get(
        [englishBranch[i - 1], englishBranch[i]].sort().join("::"),
      );
      if (distanceKm == null) {
        continue;
      }
      remapped.set(
        [chineseBranch[i - 1], chineseBranch[i]].sort().join("::"),
        distanceKm,
      );
    }

    if (line.circular && englishBranch.length > 1 && chineseBranch.length > 1) {
      const distanceKm = edgeDistances.get(
        [englishBranch.at(-1), englishBranch[0]].sort().join("::"),
      );
      if (distanceKm != null) {
        remapped.set(
          [chineseBranch.at(-1), chineseBranch[0]].sort().join("::"),
          distanceKm,
        );
      }
    }
  }

  return remapped;
}

function buildEdges(linesWithBranches, edgeDistancesByLineId) {
  const edges = [];
  const missingSegments = [];

  for (const line of linesWithBranches) {
    const uniqueBranchEdges = [];
    const branchSeen = new Set();

    for (const branchStations of line.branches) {
      for (let i = 0; i < branchStations.length - 1; i += 1) {
        const pairKey = [branchStations[i], branchStations[i + 1]]
          .sort()
          .join("::");
        if (!branchSeen.has(pairKey)) {
          branchSeen.add(pairKey);
          uniqueBranchEdges.push([branchStations[i], branchStations[i + 1]]);
        }
      }

      if (line.circular && branchStations.length > 2) {
        const pairKey = [branchStations.at(-1), branchStations[0]]
          .sort()
          .join("::");
        if (!branchSeen.has(pairKey)) {
          branchSeen.add(pairKey);
          uniqueBranchEdges.push([branchStations.at(-1), branchStations[0]]);
        }
      }
    }

    const lineDistances = edgeDistancesByLineId.get(line.id) ?? new Map();
    const knownDistances = [];
    const missingEdgePairs = [];

    for (const [from, to] of uniqueBranchEdges) {
      const distanceKm = lineDistances.get([from, to].sort().join("::"));
      if (distanceKm == null) {
        missingEdgePairs.push([from, to]);
      } else {
        knownDistances.push(distanceKm);
      }
    }

    const estimatedMissingDistanceKm = estimateMissingDistanceKm({
      knownDistances,
      missingCount: missingEdgePairs.length,
      lineLengthKm: line.lengthKm,
      edgeCount: uniqueBranchEdges.length,
    });

    for (const [from, to] of uniqueBranchEdges) {
      const parsedDistanceKm = lineDistances.get(
        [from, to].sort().join("::"),
      );
      const isMissingWikipediaDistance = parsedDistanceKm == null;
      const distanceKm = isMissingWikipediaDistance
        ? estimatedMissingDistanceKm
        : parsedDistanceKm;

      if (isMissingWikipediaDistance) {
        missingSegments.push({
          lineId: line.id,
          lineName: line.name,
          from,
          to,
          distanceKm: Number(distanceKm.toFixed(3)),
          distanceMarker: MISSING_DISTANCE_MARKER,
          estimateStrategy:
            knownDistances.length > 0
              ? line.lengthKm != null &&
                line.lengthKm - knownDistances.reduce((sum, value) => sum + value, 0) > 0
                ? "remaining-line-length"
                : "average-known-segments"
              : line.lengthKm != null
                ? "average-line-length"
                : "default-fallback",
        });
      }

      edges.push({
        from,
        to,
        lineId: line.id,
        distanceKm: Number(distanceKm.toFixed(3)),
        distanceSource: isMissingWikipediaDistance ? "estimated" : "wikipedia",
        distanceMarker: isMissingWikipediaDistance
          ? MISSING_DISTANCE_MARKER
          : null,
      });
    }
  }

  return { edges, missingSegments };
}

async function main() {
  const linePagesRaw = await Promise.all(
    LINES.map((line) => fetchRaw(ZH_RAW_BASE, getChineseLineTitle(line))),
  );

  const linePagesByLineId = new Map(
    LINES.map((line, index) => [line.id, linePagesRaw[index]]),
  );

  const chineseBranchesByLine = new Map(
    LINES.map((line) => [
      line.id,
      buildChineseBranchStations(
        linePagesByLineId.get(line.id),
        line,
        [],
      ),
    ]),
  );

  const lengthsByLineId = new Map(
    LINES.map((line) => [line.id, parseLineLengthKm(linePagesByLineId.get(line.id))]),
  );

  const edgeDistancesByLineId = new Map(
    LINES.map((line) => [
      line.id,
      parseEdgeDistancesFromChineseLinePage(
        linePagesByLineId.get(line.id),
        line,
        chineseBranchesByLine.get(line.id) ?? [],
      ),
    ]),
  );

  let moduleRaw = "";
  try {
    moduleRaw = await fetchRaw(EN_RAW_BASE, MODULE_TITLE);
  } catch {
    moduleRaw = "";
  }

  const lines = LINES.map((line) => ({
    id: line.id,
    name: getChineseLineName(line),
    page: line.page,
    color: parseColor(moduleRaw, line.id),
    circular: Boolean(line.circular),
    lengthKm: lengthsByLineId.get(line.id),
    branches: chineseBranchesByLine.get(line.id) ?? [],
  }));

  const stations = getAllStations(lines);
  const { edges, missingSegments } = buildEdges(lines, edgeDistancesByLineId);

  const data = {
    source: {
      template: buildRawUrl(EN_RAW_BASE, TEMPLATE_TITLE),
      module: buildRawUrl(EN_RAW_BASE, MODULE_TITLE),
      linePages: Object.fromEntries(
        LINES.map((line) => [line.id, buildRawUrl(ZH_RAW_BASE, getChineseLineTitle(line))]),
      ),
      fetchedAt: new Date().toISOString(),
    },
    distanceMetadata: {
      missingDistanceMarker: MISSING_DISTANCE_MARKER,
      missingSegmentCount: missingSegments.length,
      missingSegments,
    },
    farePolicy,
    lines,
    stations,
    edges,
  };

  await mkdir("data", { recursive: true });
  await writeFile("data/shanghai-metro.json", JSON.stringify(data, null, 2));
  console.log(
    `Generated data/shanghai-metro.json with ${data.stations.length} stations and ${data.edges.length} edges.`,
  );
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
