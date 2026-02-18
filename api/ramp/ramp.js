import { neon } from "@neondatabase/serverless";
import { verifyToken } from "../../utils/auth.js";

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
};

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
      const { iata, baseId, rampName, limit } = req.query || {};
      const lim = Math.min(Number(limit || 200), 1000);

      const rows = await sql`
        SELECT *
        FROM public.ramps
        WHERE (${iata ?? null}::text IS NULL OR iata = ${iata})
          AND (${baseId ?? null}::text IS NULL OR base_id = ${baseId})
          AND (${rampName ?? null}::text IS NULL OR ramp_name ILIKE ${rampName})
        ORDER BY iata, base_id, ramp_name
        LIMIT ${lim}
      `;

      return res.status(200).json({ data: rows, count: rows.length });
    }

    if (req.method === "POST") {
      const r = req.body || {};
      for (const k of ["iata", "baseId", "sourceType", "rampName"]) {
        if (!r[k]) return res.status(400).json({ error: `${k} is required` });
      }

      const rows = await sql`
        INSERT INTO public.ramps (
          iata, base_id, source_type, ramp_name, square_footage, lat_lon,
          total_units_incl_reserved, reserved_units,
          max_weight_mtow_lbs, min_wingspan_ft, max_wingspan_ft, max_height_ft,
          min_length_ft, max_length_ft,
          report_parking_use, remote_parking_reason
        )
        VALUES (
          ${r.iata}, ${r.baseId}, ${r.sourceType}, ${r.rampName}, ${r.squareFootage ?? null}, ${r.latLon ?? null},
          ${r.totalUnitsInclReserved ?? null}, ${r.reservedUnits ?? null},
          ${r.maxWeightMtowLbs ?? null}, ${r.minWingspanFt ?? null}, ${r.maxWingspanFt ?? null}, ${r.maxHeightFt ?? null},
          ${r.minLengthFt ?? null}, ${r.maxLengthFt ?? null},
          ${r.reportParkingUse ?? false}, ${r.remoteParkingReason ?? null}
        )
        RETURNING *
      `;

      return res.status(201).json({ ok: true, data: rows[0] });
    }

    res.setHeader("Allow", "GET,POST,OPTIONS");
    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (err) {
    console.error("ramp/ramps error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
