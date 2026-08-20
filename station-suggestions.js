export function filterStationSuggestions(stations, query) {
  const normalizedQuery = (query ?? "").trim();

  if (!normalizedQuery) {
    return [...stations].slice(0, 8);
  }

  const lowerQuery = normalizedQuery.toLowerCase();
  const ranked = stations
    .map((station, index) => ({
      station,
      index,
      priority: station.toLowerCase().startsWith(lowerQuery) ? 0 : 1,
    }))
    .filter(({ station }) => station.toLowerCase().includes(lowerQuery))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map(({ station }) => station);

  return ranked.slice(0, 8);
}
