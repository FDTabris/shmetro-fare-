import { createMetroNetwork, shortestPath } from "./metro-pathfinding.js";
import {
  calculateFare,
  calculateFareWithMonthlyDiscount,
  fareSchemes,
  getUniquePassRecommendation,
} from "./fare-policy.js";

const dataResponse = await fetch("./data/shanghai-metro.json");
if (!dataResponse.ok) {
  throw new Error("无法加载 data/shanghai-metro.json");
}
const metroData = await dataResponse.json();

const startInput = document.getElementById("startInput");
const endInput = document.getElementById("endInput");
const searchBtn = document.getElementById("searchBtn");
const result = document.getElementById("result");
const stationList = document.getElementById("stationList");
const chartPanel = document.getElementById("chartPanel");
const chartSvg = d3.select("#fareChart");
const svg = d3.select("#mapSvg");

for (const station of metroData.stations) {
  const option = document.createElement("option");
  option.value = station;
  stationList.appendChild(option);
}

const lineColorById = new Map(metroData.lines.map((line) => [line.id, line.color]));
const lineNameById = new Map(metroData.lines.map((line) => [line.id, line.name]));
const missingDistanceMarker = metroData.distanceMetadata?.missingDistanceMarker;
const metroNetwork = createMetroNetwork(metroData.stations, metroData.edges);
const graph = buildGraph(svg, metroData);

searchBtn.addEventListener("click", () => {
  const from = startInput.value.trim();
  const to = endInput.value.trim();

  if (!metroData.stations.includes(from) || !metroData.stations.includes(to)) {
    result.textContent = "请输入有效的站名（从下拉建议中选择）。";
    chartPanel.classList.remove("active");
    chartSvg.selectAll("*").remove();
    graph.highlight([], []);
    return;
  }

  chartPanel.classList.add("active");

  if (from === to) {
    const fareSummary = buildFareSummary(0);
    result.innerHTML = `<strong>起终点相同：</strong>${from}，${fareSummary}`;
    renderFareChart(0);
    graph.highlight([from], []);
    return;
  }

  const pathResult = shortestPath(metroNetwork, from, to);
  if (!pathResult) {
    result.textContent = "未找到可达路径。";
    chartPanel.classList.remove("active");
    chartSvg.selectAll("*").remove();
    graph.highlight([], []);
    return;
  }

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
  graph.highlight(pathResult.stations, pathResult.segments);
});

result.innerHTML = `已加载 ${metroData.stations.length} 个站点，选择起终点后点击“查询票价及路径”。`;
chartPanel.classList.remove("active");
chartSvg.selectAll("*").remove();

function buildFareSummary(distanceKm) {
  return Object.entries(fareSchemes)
    .map(([key, scheme]) => `${scheme.name}：¥${calculateFare(distanceKm, key)}`)
    .join("；");
}

function renderFareChart(distanceKm) {
  chartSvg.selectAll("*").remove();

  if (distanceKm === null || Number.isNaN(Number(distanceKm)) || Number(distanceKm) < 0) {
    chartPanel.classList.remove("active");
    return;
  }

  const width = 720;
  const height = 960;
  const margin = { top: 40, right: 30, bottom: 80, left: 90 };
  const rideCounts = d3.range(1, 91);
  const schemeEntries = Object.entries(fareSchemes).map(([key, scheme]) => ({
    key,
    name: scheme.name,
    color: {
      current: "#0969da",
      scheme1: "#cf222e",
      scheme2: "#2da44e",
    }[key] ?? "#57606a",
    data: rideCounts.map((rides) => ({
      rides,
      total: getCumulativeSingleTicketSpend(Number(distanceKm), key, rides),
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
    name: entry.names.length > 1 ? entry.names.join(" + ") : entry.names[0],
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
    .attr("font-size", 12)
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
    .attr("r", 3.5)
    .attr("fill", (d) => d.color)
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 1.2)
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
  visibleEntries.forEach((entry, index) => {
    const xPos = index * 140;
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
      .attr("font-size", 12)
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

function buildGraph(svgRoot, metro) {
  const width = 1200;
  const height = 800;

  svgRoot.attr("viewBox", `0 0 ${width} ${height}`);
  const zoomGroup = svgRoot.append("g");

  svgRoot.call(
    d3.zoom().scaleExtent([0.3, 6]).on("zoom", (event) => {
      zoomGroup.attr("transform", event.transform);
    }),
  );

  const nodes = metro.stations.map((station) => ({ id: station }));
  const links = metro.edges.map((edge) => ({
    source: edge.from,
    target: edge.to,
    lineId: edge.lineId,
  }));

  const simulation = d3
    .forceSimulation(nodes)
    .force("link", d3.forceLink(links).id((d) => d.id).distance(18).strength(1))
    .force("charge", d3.forceManyBody().strength(-35))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collision", d3.forceCollide(5));

  const edge = zoomGroup
    .append("g")
    .attr("class", "edges")
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("class", "edge");

  const station = zoomGroup
    .append("g")
    .attr("class", "stations")
    .selectAll("circle")
    .data(nodes)
    .join("circle")
    .attr("class", "station")
    .attr("r", 2.6);

  const label = zoomGroup
    .append("g")
    .attr("class", "labels")
    .selectAll("text")
    .data(nodes)
    .join("text")
    .attr("class", "station-label")
    .attr("dx", 4)
    .attr("dy", 3)
    .text((d) => d.id)
    .style("display", "none");

  simulation.on("tick", () => {
    edge
      .attr("x1", (d) => d.source.x)
      .attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x)
      .attr("y2", (d) => d.target.y);

    station.attr("cx", (d) => d.x).attr("cy", (d) => d.y);
    label.attr("x", (d) => d.x).attr("y", (d) => d.y);
  });

  return {
    highlight(pathStations, pathSegments) {
      const nodeSet = new Set(pathStations);
      const edgeKeySet = new Set(
        pathSegments.map((seg) => edgeKey(seg.from, seg.to, seg.lineId)),
      );

      station.classed("active", (d) => nodeSet.has(d.id));
      label
        .classed("active", (d) => nodeSet.has(d.id))
        .style("display", (d) => (nodeSet.has(d.id) ? "block" : "none"));

      edge.classed("active", (d) =>
        edgeKeySet.has(edgeKey(d.source.id, d.target.id, d.lineId)),
      );
    },
  };
}

function edgeKey(a, b, lineId) {
  return `${[a, b].sort().join("::")}::${lineId}`;
}
