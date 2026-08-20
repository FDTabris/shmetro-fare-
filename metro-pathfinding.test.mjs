import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createMetroNetwork, shortestPath } from "./metro-pathfinding.js";

const metroData = JSON.parse(
  await readFile(new URL("./data/shanghai-metro.json", import.meta.url), "utf8"),
);

function buildSubset(lineIds) {
  const lineIdSet = new Set(lineIds);
  const lines = metroData.lines.filter((line) => lineIdSet.has(line.id));
  const edges = metroData.edges.filter((edge) => lineIdSet.has(edge.lineId));
  const stations = Array.from(
    new Set(
      lines.flatMap((line) => line.branches.flatMap((branch) => branch)),
    ),
  );

  return {
    stations,
    edges,
    network: createMetroNetwork(stations, edges),
  };
}

function linePath(line, from, to) {
  const branch = line.branches.find(
    (candidate) => candidate.includes(from) && candidate.includes(to),
  );
  assert.ok(branch, `No branch contains both ${from} and ${to} for ${line.name}`);

  const fromIndex = branch.indexOf(from);
  const toIndex = branch.indexOf(to);
  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex);
  const stations = branch.slice(start, end + 1);
  return fromIndex <= toIndex ? stations : stations.toReversed();
}

function assertPathStations(network, from, to, expectedStations) {
  const result = shortestPath(network, from, to);
  assert.ok(result, `Expected route from ${from} to ${to}`);
  assert.deepEqual(result.stations, expectedStations);
  return result;
}

function createSeededPicker(seed) {
  let current = seed >>> 0;
  return (max) => {
    current = (current * 1664525 + 1013904223) >>> 0;
    return current % max;
  };
}

test("single Line 1 data returns the exact single-line route", () => {
  const subset = buildSubset(["1"]);
  const line1 = subset.network;
  const expectedStations = linePath(
    metroData.lines.find((line) => line.id === "1"),
    "Xinzhuang",
    "Fujin Road",
  );

  const result = assertPathStations(line1, "Xinzhuang", "Fujin Road", expectedStations);
  assert.equal(result.segments.length, expectedStations.length - 1);
  assert.ok(result.segments.every((segment) => segment.lineId === "1"));
});

test("Line 1 + Line 2 preserve in-line routes and interchange at People's Square", () => {
  const subset = buildSubset(["1", "2"]);
  const line1Expected = linePath(
    metroData.lines.find((line) => line.id === "1"),
    "Xinzhuang",
    "Fujin Road",
  );
  const line2Expected = linePath(
    metroData.lines.find((line) => line.id === "2"),
    "Panxiang Road",
    "Pudong Airport Terminal 1&2",
  );

  assertPathStations(subset.network, "Xinzhuang", "Fujin Road", line1Expected);
  assertPathStations(
    subset.network,
    "Panxiang Road",
    "Pudong Airport Terminal 1&2",
    line2Expected,
  );

  const transferResult = shortestPath(subset.network, "Xinzhuang", "Lujiazui");
  assert.ok(transferResult);
  assert.ok(transferResult.stations.includes("People's Square"));
  assert.equal(
    transferResult.stations.filter((station) => station === "People's Square").length,
    1,
  );

  const lineSwitchIndex = transferResult.segments.findIndex(
    (segment) => segment.from === "People's Square" || segment.to === "People's Square",
  );
  assert.ok(lineSwitchIndex >= 0);
  assert.ok(transferResult.segments.some((segment) => segment.lineId === "1"));
  assert.ok(transferResult.segments.some((segment) => segment.lineId === "2"));

  const beforeTransfer = transferResult.segments
    .slice(0, lineSwitchIndex + 1)
    .every((segment) => segment.lineId === "1");
  const afterTransfer = transferResult.segments
    .slice(lineSwitchIndex + 1)
    .every((segment) => segment.lineId === "2");
  assert.ok(beforeTransfer, "Expected Line 1 before People's Square");
  assert.ok(afterTransfer, "Expected Line 2 after People's Square");
});

test("full network keeps sampled stations mutually reachable", () => {
  const network = createMetroNetwork(metroData.stations, metroData.edges);
  const pick = createSeededPicker(20260820);
  const selectedStations = [];
  const seen = new Set();

  while (selectedStations.length < 12) {
    const station = metroData.stations[pick(metroData.stations.length)];
    if (seen.has(station)) {
      continue;
    }
    seen.add(station);
    selectedStations.push(station);
  }

  for (let i = 0; i < selectedStations.length; i += 1) {
    for (let j = i + 1; j < selectedStations.length; j += 1) {
      const from = selectedStations[i];
      const to = selectedStations[j];
      const result = shortestPath(network, from, to);
      assert.ok(result, `Expected route between ${from} and ${to}`);
      assert.equal(result.stations[0], from);
      assert.equal(result.stations.at(-1), to);
      assert.ok(result.segments.length > 0);
    }
  }

  // test("shujian road to shanghai circuit", () => {
  // const network = createMetroNetwork(metroData.stations, metroData.edges);
  // const pick = createSeededPicker(20260820);
  // const selectedStations = [];
  // const seen = new Set();

  // while (selectedStations.length < 12) {
  //   const station = metroData.stations[pick(metroData.stations.length)];
  //   if (seen.has(station)) {
  //     continue;
  //   }
  //   seen.add(station);
  //   selectedStations.push(station);
  // }

  // for (let i = 0; i < selectedStations.length; i += 1) {
  //   for (let j = i + 1; j < selectedStations.length; j += 1) {
  //     const from = selectedStations[i];
  //     const to = selectedStations[j];
  //     const result = shortestPath(network, from, to);
  //     assert.ok(result, `Expected route between ${from} and ${to}`);
  //     assert.equal(result.stations[0], from);
  //     assert.equal(result.stations.at(-1), to);
  //     assert.ok(result.segments.length > 0);
  //   }
  // }
});
