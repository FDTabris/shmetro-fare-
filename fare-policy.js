export const commuterPasses = [
  { rides: 45, price: 210 },
  { rides: 60, price: 270 },
  { rides: 90, price: 390 },
];

export const fareSchemes = {
  current: {
    name: "现行方案",
    description: "现行里程票价规则",
    bands: [
      { limit: 6, fare: 3 },
      { limit: 16, fare: 4 },
      { limit: 26, fare: 5 },
      { limit: 36, fare: 6 },
      { limit: 46, fare: 7 },
      { limit: 56, fare: 8 },
    ],
    longDistanceStep: 20,
    longDistanceBaseFare: 8,
  },
  scheme1: {
    name: "方案一",
    description: "起乘价不变，缩短起乘间距和中短距离加价间距，拉大长距离加价间距",
    bands: [
      { limit: 4, fare: 3 },
      { limit: 8, fare: 4 },
      { limit: 12, fare: 5 },
      { limit: 16, fare: 6 },
      { limit: 23, fare: 7 },
      { limit: 30, fare: 8 },
      { limit: 40, fare: 9 },
      { limit: 50, fare: 10 },
      { limit: 67, fare: 11 },
    ],
    longDistanceStep: 15,
    longDistanceBaseFare: 11,
  },
  scheme2: {
    name: "方案二",
    description: "提高起乘价，起乘间距不变，缩短中短距离加价间距，拉大长距离加价间距",
    bands: [
      { limit: 6, fare: 4 },
      { limit: 12, fare: 5 },
      { limit: 20, fare: 6 },
      { limit: 28, fare: 7 },
      { limit: 38, fare: 8 },
      { limit: 48, fare: 9 },
      { limit: 60, fare: 10 },
      { limit: 72, fare: 11 },
    ],
    longDistanceStep: 14,
    longDistanceBaseFare: 11,
  },
};

export function calculateFare(distanceKm, schemeKey = "current") {
  const scheme = fareSchemes[schemeKey] ?? fareSchemes.current;
  const bands = scheme.bands;

  if (distanceKm <= 0) {
    return bands[0].fare;
  }

  for (const band of bands) {
    if (distanceKm <= band.limit) {
      return band.fare;
    }
  }

  const lastFare = bands[bands.length - 1].fare;
  const stepCount = Math.ceil((distanceKm - bands[bands.length - 1].limit) / scheme.longDistanceStep);
  return lastFare + stepCount;
}

export function calculateFareWithMonthlyDiscount(distanceKm, schemeKey = "current", monthlySpentBeforeThisRide = 0) {
  const baseFare = calculateFare(distanceKm, schemeKey);
  const newTotal = monthlySpentBeforeThisRide + baseFare;

  if (monthlySpentBeforeThisRide >= 100) {
    return Number((baseFare * 0.9).toFixed(2));
  }

  if (newTotal > 100) {
    return baseFare;
  }

  return baseFare;
}

export function getNoPassMonthlyCost(oneWayFare, rideCount) {
  if (rideCount <= 0) {
    return 0;
  }

  if (rideCount <= 10) {
    return oneWayFare * rideCount;
  }

  return 100 + (rideCount - 10) * oneWayFare * 0.9;
}

export function getPassBreakEvenTrips(distanceKm, schemeKey = "current") {
  const oneWayFare = calculateFare(distanceKm, schemeKey);

  return commuterPasses.map((pass) => {
    const averageFarePerRide = pass.price / pass.rides;
    if (oneWayFare <= averageFarePerRide) {
      return {
        ...pass,
        oneWayFare,
        threshold: null,
        recommendation: "不建议购买次卡",
      };
    }

    for (let rides = 1; rides <= 365; rides += 1) {
      const noPassCost = getNoPassMonthlyCost(oneWayFare, rides);
      const passCheaper = pass.price <= noPassCost;
      if (passCheaper) {
        const threshold = Math.max(0, rides - 1);
        return {
          ...pass,
          oneWayFare,
          threshold,
          recommendation: `超过 ${threshold} 次时更划算`,
        };
      }
    }

    return {
      ...pass,
      oneWayFare,
      threshold: null,
      recommendation: "不建议购买次卡",
    };
  });
}

export function getUniquePassRecommendation(distanceKm) {
  const scheme1 = getPassBreakEvenTrips(distanceKm, "scheme1");
  const scheme2 = getPassBreakEvenTrips(distanceKm, "scheme2");
  const same =
    scheme1.length === scheme2.length &&
    scheme1.every((pass, index) => pass.threshold === scheme2[index].threshold);

  if (same) {
    return {
      same: true,
      passes: scheme1,
    };
  }

  return {
    same: false,
    scheme1,
    scheme2,
  };
}

export function getOptimalMonthlyPassCost(distanceKm, schemeKey = "scheme1", rideCount = 0) {
  if (!Number.isFinite(rideCount) || rideCount <= 0) {
    return 0;
  }

  const cappedRides = Math.min(90, Math.max(0, Math.round(rideCount)));
  const noPassCost = getCumulativeSingleTicketSpend(distanceKm, schemeKey, cappedRides);
  const passOptions = [
    { rides: 45, price: 210 },
    { rides: 60, price: 270 },
    { rides: 90, price: 390 },
  ];

  const bestPassCost = passOptions.reduce((best, pass) => {
    const coveredTrips = Math.min(cappedRides, pass.rides);
    const remainingTrips = cappedRides - coveredTrips;
    const remainingCost = remainingTrips === 0 ? 0 : getCumulativeSingleTicketSpend(distanceKm, schemeKey, remainingTrips);
    const total = pass.price + remainingCost;
    return Math.min(best, total);
  }, noPassCost);

  return Number(Math.min(noPassCost, bestPassCost).toFixed(2));
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
