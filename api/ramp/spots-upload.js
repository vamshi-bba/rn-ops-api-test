import { neon } from "@neondatabase/serverless";
import { verifyToken } from "../../utils/auth.js";

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
};

async function resolveZoneId(sql, item) {
  if (item.zoneId) return item.zoneId;

  const { iata, baseId, rampName, zoneName } = item || {};
  if (!iata || !baseId || !rampName || !zoneName) return null;

  const rows = await sql`
    SELECT id FROM public.zones
    WHERE iata = ${iata} AND base_id = ${baseId} AND ramp_name = ${rampName} AND zone_name = ${zoneName}
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST,OPTIONS");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const AUTH_ENABLED = (process.env.AUTH_ENABLED ?? "false").toLowerCase() === "true";
  if (AUTH_ENABLED) {
    const user = await verifyToken(req, res);
    if (!user) return;
  }

  try {
    const sql = neon(process.env.RAMP_DATABASE_URL);
    const { mode = "upsert", items = [] } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "items[] is required" });

    const saved = [];
    for (const s of items) {
      if (!s?.parkingSpotName) return res.status(400).json({ error: "parkingSpotName missing in one of items" });

      const zoneId = await resolveZoneId(sql, s);
      if (!zoneId) return res.status(400).json({ error: "Provide zoneId or (iata, baseId, rampName, zoneName) for each item" });

      const parent = await sql`SELECT iata, base_id, ramp_name, zone_name FROM public.zones WHERE id = ${zoneId} LIMIT 1`;
      if (!parent[0]) return res.status(404).json({ error: "Zone not found for one of items" });

      const rows = await sql`
        INSERT INTO public.parking_spots (
          zone_id, iata, base_id, ramp_name, zone_name,
          parking_spot_name, classification,
          max_weight_mtow_lbs, min_wingspan_ft, max_wingspan_ft, max_height_ft,
          min_length_ft, max_length_ft,
          ops_status, inactive_status_reason
        )
        VALUES (
          ${zoneId}, ${parent[0].iata}, ${parent[0].base_id}, ${parent[0].ramp_name}, ${parent[0].zone_name},
          ${s.parkingSpotName}, ${s.classification ?? "NONE"},
          ${s.maxWeightMtowLbs ?? null}, ${s.minWingspanFt ?? null}, ${s.maxWingspanFt ?? null}, ${s.maxHeightFt ?? null},
          ${s.minLengthFt ?? null}, ${s.maxLengthFt ?? null},
          ${s.opsStatus ?? "ACTIVE"}, ${s.inactiveStatusReason ?? null}
        )
        ${
          mode === "upsert"
            ? sql`ON CONFLICT (zone_id, parking_spot_name) DO UPDATE SET
                classification = EXCLUDED.classification,
                max_weight_mtow_lbs = EXCLUDED.max_weight_mtow_lbs,
                min_wingspan_ft = EXCLUDED.min_wingspan_ft,
                max_wingspan_ft = EXCLUDED.max_wingspan_ft,
                max_height_ft = EXCLUDED.max_height_ft,
                min_length_ft = EXCLUDED.min_length_ft,
                max_length_ft = EXCLUDED.max_length_ft,
                ops_status = EXCLUDED.ops_status,
                inactive_status_reason = EXCLUDED.inactive_status_reason,
                iata = EXCLUDED.iata,
                base_id = EXCLUDED.base_id,
                ramp_name = EXCLUDED.ramp_name,
                zone_name = EXCLUDED.zone_name`
            : sql``
        }
        RETURNING id, zone_id, parking_spot_name
      `;

      saved.push(rows[0]);
    }

    return res.status(200).json({ ok: true, count: saved.length, data: saved });
  } catch (err) {
    console.error("ramp/spots-upload error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
