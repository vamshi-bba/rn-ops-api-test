import { neon } from "@neondatabase/serverless";
import { verifyToken } from "../../utils/auth.js";

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
};

async function resolveRampId(sql, body) {
  if (body.rampId) return body.rampId;

  const { iata, baseId, rampName } = body || {};
  if (!iata || !baseId || !rampName) return null;

  const rows = await sql`
    SELECT id FROM public.ramps
    WHERE iata = ${iata} AND base_id = ${baseId} AND ramp_name = ${rampName}
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
      const { rampId, iata, baseId, rampName, zoneName, limit } = req.query || {};
      const lim = Math.min(Number(limit || 200), 1000);

      const rows = await sql`
        SELECT *
        FROM public.zones
        WHERE (${rampId ?? null}::uuid IS NULL OR ramp_id = ${rampId})
          AND (${iata ?? null}::text IS NULL OR iata = ${iata})
          AND (${baseId ?? null}::text IS NULL OR base_id = ${baseId})
          AND (${rampName ?? null}::text IS NULL OR ramp_name ILIKE ${rampName})
          AND (${zoneName ?? null}::text IS NULL OR zone_name ILIKE ${zoneName})
        ORDER BY iata, base_id, ramp_name, zone_name
        LIMIT ${lim}
      `;
      return res.status(200).json({ data: rows, count: rows.length });
    }

    if (req.method === "POST") {
      const z = req.body || {};
      if (!z.zoneName) return res.status(400).json({ error: "zoneName is required" });

      const rampIdResolved = await resolveRampId(sql, z);
      if (!rampIdResolved) return res.status(400).json({ error: "Provide rampId or (iata, baseId, rampName) to resolve ramp" });

      const parent = await sql`SELECT iata, base_id, ramp_name FROM public.ramps WHERE id = ${rampIdResolved} LIMIT 1`;
      if (!parent[0]) return res.status(404).json({ error: "Ramp not found" });

      const rows = await sql`
        INSERT INTO public.zones (
          ramp_id, iata, base_id, ramp_name, zone_name,
          square_footage, utilization_rate_pct, lat_lon,
          total_units_incl_reserved, reserved_units,
          max_weight_mtow_lbs, min_wingspan_ft, max_wingspan_ft, max_height_ft,
          min_length_ft, max_length_ft,
          report_parking_use, remote_parking_reason
        )
        VALUES (
          ${rampIdResolved}, ${parent[0].iata}, ${parent[0].base_id}, ${parent[0].ramp_name}, ${z.zoneName},
          ${z.squareFootage ?? null}, ${z.utilizationRatePct ?? null}, ${z.latLon ?? null},
          ${z.totalUnitsInclReserved ?? null}, ${z.reservedUnits ?? null},
          ${z.maxWeightMtowLbs ?? null}, ${z.minWingspanFt ?? null}, ${z.maxWingspanFt ?? null}, ${z.maxHeightFt ?? null},
          ${z.minLengthFt ?? null}, ${z.maxLengthFt ?? null},
          ${z.reportParkingUse ?? false}, ${z.remoteParkingReason ?? null}
        )
        RETURNING *
      `;
      return res.status(201).json({ ok: true, data: rows[0] });
    }

    res.setHeader("Allow", "GET,POST,OPTIONS");
    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (err) {
    console.error("ramp/zones error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
