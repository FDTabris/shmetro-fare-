import { createMetroNetwork, shortestPath } from "./metro-pathfinding.js";
import {
  calculateFare,
  calculateFareWithMonthlyDiscount,
  commuterPasses,
  fareSchemes,
  getOptimalMonthlyPassCost,
  getUniquePassRecommendation,
} from "./fare-policy.js";
import { filterStationSuggestions } from "./station-suggestions.js";

const dataResponse = await fetch("./data/shanghai-metro.json");
if (!dataResponse.ok) {
  throw new Error("无法加载 data/shanghai-metro.json");
}
const metroData = await dataResponse.json();

const startInput = document.getElementById("startInput");
const endInput = document.getElementById("endInput");
const searchBtn = document.getElementById("searchBtn");
const result = document.getElementById("result");
const chartPanel = document.getElementById("chartPanel");
const passOptimizationToggle = document.getElementById("passOptimizationToggle");
const chartSvg = d3.select("#fareChart");
const stationSuggestionsByInput = new Map([
  [startInput, document.getElementById("startSuggestions")],
  [endInput, document.getElementById("endSuggestions")],
]);

let passOptimizationEnabled = false;
let lastDistanceKm = 0;

function buildSuggestionList(input, listElement, suggestions) {
  listElement.innerHTML = "";

  if (!suggestions.length) {
    listElement.classList.add("hidden");
    return;
  }

  for (const suggestion of suggestions) {
    const item = document.createElement("li");
    item.className = "suggestion-item";
    item.textContent = suggestion;
    item.tabIndex = 0;
    item.setAttribute("role", "option");
    item.addEventListener("mousedown", (event) => {
      event.preventDefault();
      input.value = suggestion;
      hideSuggestions(input);
    });
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        input.value = suggestion;
        hideSuggestions(input);
      }
    });
    listElement.appendChild(item);
  }

  listElement.classList.remove("hidden");
}

function hideSuggestions(input) {
  const listElement = stationSuggestionsByInput.get(input);
  if (!listElement) {
    return;
  }

  listElement.classList.add("hidden");
}

function updateSuggestions(input) {
  const listElement = stationSuggestionsByInput.get(input);
  if (!listElement) {
    return;
  }

  const query = input.value.trim();
  const suggestions = filterStationSuggestions(metroData.stations, query);
  buildSuggestionList(input, listElement, suggestions);

  if (!query) {
    listElement.classList.add("hidden");
  }
}

for (const input of [startInput, endInput]) {
  input.addEventListener("input", () => {
    updateSuggestions(input);
  });

  input.addEventListener("focus", () => {
    updateSuggestions(input);
  });

  input.addEventListener("blur", () => {
    window.setTimeout(() => hideSuggestions(input), 120);
  });

  input.addEventListener("keydown", (event) => {
    const listElement = stationSuggestionsByInput.get(input);
    if (!listElement || listElement.classList.contains("hidden")) {
      return;
    }

    const items = [...listElement.querySelectorAll(".suggestion-item")];
    let activeIndex = items.findIndex((item) => item.classList.contains("active"));

    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = activeIndex < items.length - 1 ? activeIndex + 1 : 0;
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = activeIndex > 0 ? activeIndex - 1 : items.length - 1;
    } else if (event.key === "Escape") {
      event.preventDefault();
      hideSuggestions(input);
      return;
    } else if (event.key === "Enter") {
      const activeItem = items[activeIndex];
      if (activeItem) {
        event.preventDefault();
        input.value = activeItem.textContent;
        hideSuggestions(input);
      }
      return;
    } else {
      return;
    }

    items.forEach((item, index) => {
      item.classList.toggle("active", index === activeIndex);
    });
  });
}

const lineColorById = new Map(metroData.lines.map((line) => [line.id, line.color]));
const lineNameById = new Map(metroData.lines.map((line) => [line.id, line.name]));
const missingDistanceMarker = metroData.distanceMetadata?.missingDistanceMarker;
const metroNetwork = createMetroNetwork(metroData.stations, metroData.edges);

passOptimizationToggle.addEventListener("click", () => {
  passOptimizationEnabled = !passOptimizationEnabled;
  refreshPassToggleButton();
  renderFareChart(lastDistanceKm);
});

searchBtn.addEventListener("click", () => {
  const from = startInput.value.trim();
  const to = endInput.value.trim();

  if (!metroData.stations.includes(from) || !metroData.stations.includes(to)) {
    result.textContent = "请输入有效的站名（从下拉建议中选择）。";
    chartPanel.classList.remove("active");
    chartSvg.selectAll("*").remove();
    return;
  }

  chartPanel.classList.add("active");
  lastDistanceKm = 0;

  if (from === to) {
    const fareSummary = buildFareSummary(0);
    result.innerHTML = `<strong>起终点相同：</strong>${from}，${fareSummary}`;
    renderFareChart(0);
    return;
  }

  const pathResult = shortestPath(metroNetwork, from, to);
  if (!pathResult) {
    result.textContent = "未找到可达路径。";
    chartPanel.classList.remove("active");
    chartSvg.selectAll("*").remove();
    return;
  }

  lastDistanceKm = Number(pathResult.distanceKm);
  const fareSummary = buildFareSummary(pathResult.distanceKm);
  const lineInfo = summarizeLines(pathResult.segments);
  const missingDistanceSegments = pathResult.segments.filter(
    (segment) => segment.distanceMarker === missingDistanceMarker,
  );
  const missingDistanceText =
    missingDistanceSegments.length === 0
      ? ""
      : `<br><strong>缺失区间里程：</strong>${missingDistanceMarker}（${missingDistanceSegments
          .map((segment) => `${segment.from} → ${segment.to}`)
          .join("；")} 已按线路数据估算）`;

  result.innerHTML = [
    `<strong>经过线路：</strong>${lineInfo}`,
    `<br><strong>估算里程：</strong>${pathResult.distanceKm.toFixed(2)} km`,
    `<br><strong>票价对比：</strong>${fareSummary}`,
    missingDistanceText,
  ].join("");

  renderFareChart(pathResult.distanceKm);
});

result.innerHTML = `已加载 ${metroData.stations.length} 个站点，选择起终点后点击“查询票价及路径”。`;
chartPanel.classList.remove("active");
chartSvg.selectAll("*").remove();
refreshPassToggleButton();

function buildFareSummary(distanceKm) {
  return Object.entries(fareSchemes)
    .map(([key, scheme]) => `${scheme.name}：¥${calculateFare(distanceKm, key)}`)
    .join("；");
}

function refreshPassToggleButton() {
  passOptimizationToggle.setAttribute("aria-pressed", String(passOptimizationEnabled));
  passOptimizationToggle.textContent = passOptimizationEnabled ? "关闭次卡省钱" : "使用次卡省钱";
}

function getDisplaySchemeName(schemeKey, schemeName) {
  if (!passOptimizationEnabled || schemeKey === "current") {
    return schemeName;
  }

  return `${schemeName}（次卡省钱）`;
}

function renderFareChart(distanceKm) {
  chartSvg.selectAll("*").remove();

  if (distanceKm === null || Number.isNaN(Number(distanceKm)) || Number(distanceKm) < 0) {
    chartPanel.classList.remove("active");
    return;
  }

  const containerWidth = Math.max(320, chartSvg.node() ? chartSvg.node().clientWidth || 720 : 720);
  const width = Math.min(720, containerWidth);
  const height = Math.max(420, Math.min(960, width * 1.28));
  const margin = {
    top: 40,
    right: 30,
    bottom: 80,
    left: Math.max(70, width * 0.12),
  };
  const rideCounts = d3.range(1, 91);

  chartSvg.attr("viewBox", `0 0 ${width} ${height}`);
  chartSvg.attr("preserveAspectRatio", "xMidYMid meet");
  const schemeEntries = Object.entries(fareSchemes).map(([key, scheme]) => ({
    key,
    name: getDisplaySchemeName(key, scheme.name),
    color: {
      current: "#0969da",
      scheme1: "#cf222e",
      scheme2: "#2da44e",
    }[key] ?? "#57606a",
    data: rideCounts.map((rides) => ({
      rides,
      total:
        passOptimizationEnabled && key !== "current"
          ? getOptimalMonthlyPassCost(Number(distanceKm), key, rides)
          : getCumulativeSingleTicketSpend(Number(distanceKm), key, rides),
    })),
  }));

  const mergedEntries = new Map();
  for (const entry of schemeEntries) {
    const signature = entry.data.map((point) => point.total.toFixed(2)).join("|");
    const existing = mergedEntries.get(signature);

    if (existing) {
      existing.names.push(entry.name);
    } else {
      mergedEntries.set(signature, {
        names: [entry.name],
        color: entry.color,
        data: entry.data,
      });
    }
  }

  const visibleEntries = Array.from(mergedEntries.values()).map((entry) => ({
    name: entry.names.length > 1 ? entry.names.join("/") : entry.names[0],
    color: entry.color,
    data: entry.data,
  }));

  const maxTotal = d3.max(visibleEntries.flatMap((entry) => entry.data.map((d) => d.total))) ?? 0;

  const x = d3.scaleLinear().domain([1, 90]).range([margin.left, width - margin.right]);
  const y = d3
    .scaleLinear()
    .domain([0, maxTotal > 0 ? maxTotal * 1.08 : 1])
    .nice()
    .range([height - margin.bottom, margin.top]);

  const gridLines = y.ticks(5);
  chartSvg
    .append("g")
    .selectAll("line")
    .data(gridLines)
    .join("line")
    .attr("x1", margin.left)
    .attr("x2", width - margin.right)
    .attr("y1", (d) => y(d))
    .attr("y2", (d) => y(d))
    .attr("stroke", "#d8dee4")
    .attr("stroke-width", 1);

  const passReferenceLines = commuterPasses.map((pass) => ({
    rides: pass.rides,
    price: pass.price,
    label: `${pass.rides}次卡：¥${pass.price}`,
  }));

  chartSvg
    .append("g")
    .selectAll("line")
    .data(passReferenceLines)
    .join("line")
    .attr("x1", margin.left)
    .attr("x2", width - margin.right)
    .attr("y1", (d) => y(d.price))
    .attr("y2", (d) => y(d.price))
    .attr("stroke", "#6e7781")
    .attr("stroke-width", 1.2)
    .attr("stroke-dasharray", "6 5")
    .attr("opacity", 0.9);

  chartSvg
    .append("g")
    .selectAll("text")
    .data(passReferenceLines)
    .join("text")
    .attr("x", width - margin.right - 6)
    .attr("y", (d) => y(d.price) - 6)
    .attr("text-anchor", "end")
    .attr("fill", "#57606a")
    .attr("font-size", Math.max(9, 11 * (width / 720)))
    .text((d) => d.label);

  chartSvg
    .append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(9).tickFormat((d) => `${d}`));

  chartSvg
    .append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat((d) => `¥${d}`));

  chartSvg
    .append("g")
    .selectAll("text")
    .data(["坐车次数", "累计支出"])
    .join("text")
    .attr("x", (d, i) => (i === 0 ? width / 2 : margin.left - 12))
    .attr("y", (d, i) => (i === 0 ? height - 6 : margin.top + 18))
    .attr("text-anchor", (d, i) => (i === 0 ? "middle" : "end"))
    .attr("fill", "#57606a")
    .attr("font-size", Math.max(10, 12 * (width / 720)))
    .text((d) => d);

  const lineGroup = chartSvg.append("g");
  lineGroup
    .selectAll("path")
    .data(visibleEntries)
    .join("path")
    .attr("fill", "none")
    .attr("stroke", (d) => d.color)
    .attr("stroke-width", 2)
    .attr("d", (d) => d3.line().x((point) => x(point.rides)).y((point) => y(point.total))(d.data));

  const tooltip = d3
    .select("body")
    .append("div")
    .style("position", "fixed")
    .style("pointer-events", "none")
    .style("padding", "6px 8px")
    .style("border-radius", "6px")
    .style("background", "rgba(31, 35, 40, 0.9)")
    .style("color", "#fff")
    .style("font-size", "12px")
    .style("line-height", "1.4")
    .style("opacity", 0)
    .style("z-index", 1000);

  const points = lineGroup
    .selectAll("circle")
    .data(
      visibleEntries.flatMap((entry) =>
        entry.data.map((point) => ({ ...point, schemeName: entry.name, color: entry.color })),
      ),
    )
    .join("circle")
    .attr("cx", (d) => x(d.rides))
    .attr("cy", (d) => y(d.total))
    .attr("r", 2.8)
    .attr("fill", (d) => d.color)
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 1)
    .attr("opacity", 0.95)
    .on("pointermove", (event, d) => {
      tooltip
        .style("opacity", 1)
        .style("left", `${event.clientX + 12}px`)
        .style("top", `${event.clientY + 12}px`)
        .html(`${d.schemeName}<br>次数：${d.rides}<br>累计支出：¥${d.total.toFixed(2)}`);
    })
    .on("pointerleave", () => {
      tooltip.style("opacity", 0);
    });

  const legend = chartSvg.append("g").attr("transform", `translate(${margin.left}, 12)`);
  const legendStep = Math.max(90, 140 * (width / 720));
  visibleEntries.forEach((entry, index) => {
    const xPos = index * legendStep;
    legend
      .append("line")
      .attr("x1", xPos)
      .attr("x2", xPos + 18)
      .attr("y1", 0)
      .attr("y2", 0)
      .attr("stroke", entry.color)
      .attr("stroke-width", 2);

    legend
      .append("text")
      .attr("x", xPos + 24)
      .attr("y", 4)
      .attr("fill", "#24292f")
      .attr("font-size", Math.max(10, 12 * (width / 720)))
      .text(entry.name);
  });
}

function getCumulativeSingleTicketSpend(distanceKm, schemeKey, rideCount) {
  const oneWayFare = calculateFare(distanceKm, schemeKey);
  const discountThreshold = schemeKey === "current" ? 70 : 100;
  let total = 0;

  for (let i = 0; i < rideCount; i += 1) {
    const fare = total >= discountThreshold ? Number((oneWayFare * 0.9).toFixed(2)) : oneWayFare;
    total += fare;
  }

  return Number(total.toFixed(2));
}

function summarizeLines(segments) {
  if (segments.length === 0) {
    return "-";
  }

  const groups = [];
  let current = { lineId: segments[0].lineId, from: segments[0].from, to: segments[0].to };
  for (let i = 1; i < segments.length; i += 1) {
    const segment = segments[i];
    if (segment.lineId === current.lineId) {
      current.to = segment.to;
    } else {
      groups.push(current);
      current = { lineId: segment.lineId, from: segment.from, to: segment.to };
    }
  }
  groups.push(current);

  return groups
    .map((group) => {
      const color = lineColorById.get(group.lineId) ?? "#888";
      const lineName = lineNameById.get(group.lineId) ?? `Line ${group.lineId}`;
      return `<span style="color:${color}">${lineName}: ${group.from} → ${group.to}</span>`;
    })
    .join("；");
}

