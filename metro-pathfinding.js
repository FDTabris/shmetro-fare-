export function createMetroNetwork(stations, edges) {
  const adjacency = new Map(stations.map((station) => [station, []]));

  for (const edge of edges) {
    adjacency.get(edge.from)?.push(createDirectedEdge(edge.from, edge.to, edge));
    adjacency.get(edge.to)?.push(createDirectedEdge(edge.to, edge.from, edge));
  }

  return {
    stations: new Set(stations),
    adjacency,
  };
}

export function shortestPath(network, from, to) {
  if (!network.stations.has(from) || !network.stations.has(to)) {
    return null;
  }

  const distances = new Map();
  const previousByStation = new Map();
  const visited = new Set();
  const queue = new MinPriorityQueue();

  for (const station of network.stations) {
    distances.set(station, Number.POSITIVE_INFINITY);
  }

  distances.set(from, 0);
  queue.push(from, 0);

  while (!queue.isEmpty()) {
    const currentEntry = queue.pop();
    if (!currentEntry) {
      break;
    }

    const { node: currentStation, priority: currentDistance } = currentEntry;
    if (visited.has(currentStation)) {
      continue;
    }
    if (currentDistance !== distances.get(currentStation)) {
      continue;
    }

    visited.add(currentStation);
    if (currentStation === to) {
      break;
    }

    for (const edge of network.adjacency.get(currentStation) ?? []) {
      if (visited.has(edge.to)) {
        continue;
      }

      const nextDistance = currentDistance + edge.distanceKm;
      if (nextDistance >= distances.get(edge.to)) {
        continue;
      }

      distances.set(edge.to, nextDistance);
      previousByStation.set(edge.to, {
        previousStation: currentStation,
        edge,
      });
      queue.push(edge.to, nextDistance);
    }
  }

  if (!Number.isFinite(distances.get(to))) {
    return null;
  }

  const stations = [to];
  const segments = [];
  let cursor = to;

  while (cursor !== from) {
    const previous = previousByStation.get(cursor);
    if (!previous) {
      return null;
    }

    segments.push({
      from: previous.previousStation,
      to: cursor,
      lineId: previous.edge.lineId,
      distanceKm: previous.edge.distanceKm,
      distanceSource: previous.edge.distanceSource,
      distanceMarker: previous.edge.distanceMarker,
    });
    cursor = previous.previousStation;
    stations.push(cursor);
  }

  stations.reverse();
  segments.reverse();

  return {
    stations,
    segments,
    distanceKm: distances.get(to),
  };
}

function createDirectedEdge(from, to, edge) {
  return {
    from,
    to,
    lineId: edge.lineId,
    distanceKm: edge.distanceKm,
    distanceSource: edge.distanceSource,
    distanceMarker: edge.distanceMarker,
  };
}

class MinPriorityQueue {
  constructor(compare = (a, b) => a - b) {
    this.heap = [];
    this.compare = compare;
  }

  push(node, priority) {
    this.heap.push({ node, priority });
    this.bubbleUp(this.heap.length - 1);
  }

  pop() {
    const first = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0 && last) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return first;
  }

  isEmpty() {
    return this.heap.length === 0;
  }

  bubbleUp(index) {
    let current = index;
    while (current > 0) {
      const parent = Math.floor((current - 1) / 2);
      if (this.compare(this.heap[parent].priority, this.heap[current].priority) <= 0) {
        break;
      }
      [this.heap[parent], this.heap[current]] = [this.heap[current], this.heap[parent]];
      current = parent;
    }
  }

  bubbleDown(index) {
    let current = index;
    const length = this.heap.length;

    while (true) {
      const left = current * 2 + 1;
      const right = current * 2 + 2;
      let smallest = current;

      if (
        left < length &&
        this.compare(this.heap[left].priority, this.heap[smallest].priority) < 0
      ) {
        smallest = left;
      }
      if (
        right < length &&
        this.compare(this.heap[right].priority, this.heap[smallest].priority) < 0
      ) {
        smallest = right;
      }
      if (smallest === current) {
        break;
      }
      [this.heap[current], this.heap[smallest]] = [this.heap[smallest], this.heap[current]];
      current = smallest;
    }
  }
}
