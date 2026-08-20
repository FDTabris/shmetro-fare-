import { createMetroNetwork, shortestPath } from "./metro-pathfinding.js";

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
    graph.highlight([], []);
    return;
  }

  if (from === to) {
    result.textContent = `起终点相同：${from}，票价为 ¥3。`;
    graph.highlight([from], []);
    return;
  }

  const pathResult = shortestPath(metroNetwork, from, to);
  if (!pathResult) {
    result.textContent = "未找到可达路径。";
    graph.highlight([], []);
    return;
  }

  const fare = calculateFare(pathResult.distanceKm);
  const routeText = pathResult.stations.join(" → ");
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
    `<strong>最短路径：</strong>${routeText}`,
    `<br><strong>站数：</strong>${pathResult.stations.length} 站（含起终点）`,
    `<br><strong>估算里程：</strong>${pathResult.distanceKm.toFixed(2)} km`,
    `<br><strong>估算票价：</strong>¥${fare}`,
    `<br><strong>经过线路：</strong>${lineInfo}`,
    missingDistanceText,
  ].join("");

  graph.highlight(pathResult.stations, pathResult.segments);
});

result.innerHTML = `已加载 ${metroData.stations.length} 个站点，选择起终点后点击“查询最短路径”。`;

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

function calculateFare(distanceKm) {
  if (distanceKm <= 6) return 3;
  if (distanceKm <= 16) return 4;
  if (distanceKm <= 26) return 5;
  if (distanceKm <= 36) return 6;
  if (distanceKm <= 46) return 7;
  if (distanceKm <= 56) return 8;
  return 8 + Math.ceil((distanceKm - 56) / 20);
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
