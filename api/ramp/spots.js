import { neon } from "@neondatabase/serverless";
import { verifyToken } from "../../utils/auth.js";

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
};

async function resolveZoneId(sql, body) {
  if (body.zoneId) return body.zoneId;

  const { iata, baseId, rampName, zoneName } = body || {};
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

  const AUTH_ENABLED = (process.env.AUTH_ENABLED ?? "false").toLowerCase() === "true";
  if (AUTH_ENABLED) {
    const user = await verifyToken(req, res);
    if (!user) return;
  }

  const sql = neon(process.env.RAMP_DATABASE_URL);

  try {
    if (req.method === "GET") {
      const { zoneId, rampId, iata, baseId, rampName, zoneName, spotName, limit } = req.query || {};
      const lim = Math.min(Number(limit || 200), 1000);

      const rows = await sql`
        SELECT s.*
        FROM public.parking_spots s
        JOIN public.zones z ON z.id = s.zone_id
        WHERE (${zoneId ?? null}::uuid IS NULL OR s.zone_id = ${zoneId})
          AND (${rampId ?? null}::uuid IS NULL OR z.ramp_id = ${rampId})
          AND (${iata ?? null}::text IS NULL OR s.iata = ${iata})
          AND (${baseId ?? null}::text IS NULL OR s.base_id = ${baseId})
          AND (${rampName ?? null}::text IS NULL OR s.ramp_name ILIKE ${rampName})
          AND (${zoneName ?? null}::text IS NULL OR s.zone_name ILIKE ${zoneName})
          AND (${spotName ?? null}::text IS NULL OR s.parking_spot_name ILIKE ${spotName})
        ORDER BY s.iata, s.base_id, s.ramp_name, s.zone_name, s.parking_spot_name
        LIMIT ${lim}
      `;
      return res.status(200).json({ data: rows, count: rows.length });
    }

    if (req.method === "POST") {
      const s = req.body || {};
      if (!s.parkingSpotName) return res.status(400).json({ error: "parkingSpotName is required" });

      const zoneIdResolved = await resolveZoneId(sql, s);
      if (!zoneIdResolved) return res.status(400).json({ error: "Provide zoneId or (iata, baseId, rampName, zoneName) to resolve zone" });

      const parent = await sql`SELECT iata, base_id, ramp_name, zone_name FROM public.zones WHERE id = ${zoneIdResolved} LIMIT 1`;
      if (!parent[0]) return res.status(404).json({ error: "Zone not found" });

      const rows = await sql`
        INSERT INTO public.parking_spots (
          zone_id, iata, base_id, ramp_name, zone_name,
          parking_spot_name, classification,
          max_weight_mtow_lbs, min_wingspan_ft, max_wingspan_ft, max_height_ft,
          min_length_ft, max_length_ft,
          ops_status, inactive_status_reason
        )
        VALUES (
          ${zoneIdResolved}, ${parent[0].iata}, ${parent[0].base_id}, ${parent[0].ramp_name}, ${parent[0].zone_name},
          ${s.parkingSpotName}, ${s.classification ?? "NONE"},
          ${s.maxWeightMtowLbs ?? null}, ${s.minWingspanFt ?? null}, ${s.maxWingspanFt ?? null}, ${s.maxHeightFt ?? null},
          ${s.minLengthFt ?? null}, ${s.maxLengthFt ?? null},
          ${s.opsStatus ?? "ACTIVE"}, ${s.inactiveStatusReason ?? null}
        )
        RETURNING *
      `;

      return res.status(201).json({ ok: true, data: rows[0] });
    }

    res.setHeader("Allow", "GET,POST,OPTIONS");
    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (err) {
    console.error("ramp/spots error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
