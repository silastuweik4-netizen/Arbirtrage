import axios from 'axios';

// Example: Solend publishes unhealthy accounts via API
export async function monitorObligations(connection) {
  const { data } = await axios.get("https://api.solend.fi/v1/markets?scope=all");
  const candidates = [];

  for (const market of data) {
    for (const reserve of market.reserves) {
      if (reserve.healthRatio < 1) {
        candidates.push(reserve);
      }
    }
  }
  return candidates;
}
