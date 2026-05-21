import { getServer, getOnline, postNations } from './api.js';
import { cached } from './cache.js';

const TTL_SERVER = 30_000;
const TTL_ONLINE = 15_000;
const TTL_NATION = 60_000;

export async function fetchTopBarData(nationName) {
  const [server, online, nationRes] = await Promise.all([
    cached('/', TTL_SERVER, getServer),
    cached('/online', TTL_ONLINE, getOnline),
    cached(`/nations:${nationName.toLowerCase()}`, TTL_NATION, () => postNations([nationName])),
  ]);

  const nation = nationRes && nationRes[0];
  if (!nation) throw new Error(`Nation "${nationName}" not found`);

  // Intersect on UUID (immutable). Names can change via Mojang rename and silently break a name-based intersect.
  // Display the canonical name from /online, which is the live source of truth.
  const onlinePlayers = online?.players ?? [];
  const residents = nation.residents ?? [];
  const residentUuids = new Set(residents.map(r => r.uuid));
  const onlineResidents = onlinePlayers
    .filter(p => residentUuids.has(p.uuid))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    nation: { name: nation.name, totalResidents: nation.stats?.numResidents ?? residents.length },
    onlineResidents,
    voteParty: server.voteParty?.numRemaining ?? null,
    serverOnline: server.stats?.numOnlinePlayers ?? null,
  };
}
