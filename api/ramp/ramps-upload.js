import { neon } from "@neondatabase/serverless";
import { verifyToken } from "../../utils/auth.js";

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
};

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
    for (const r of items) {
      for (const k of ["iata", "baseId", "sourceType", "rampName"]) {
        if (!r?.[k]) return res.status(400).json({ error: `Missing ${k} in one of items` });
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
        ${
          mode === "upsert"
            ? sql`ON CONFLICT (iata, base_id, ramp_name) DO UPDATE SET
                source_type = EXCLUDED.source_type,
                square_footage = EXCLUDED.square_footage,
                lat_lon = EXCLUDED.lat_lon,
                total_units_incl_reserved = EXCLUDED.total_units_incl_reserved,
                reserved_units = EXCLUDED.reserved_units,
                max_weight_mtow_lbs = EXCLUDED.max_weight_mtow_lbs,
                min_wingspan_ft = EXCLUDED.min_wingspan_ft,
                max_wingspan_ft = EXCLUDED.max_wingspan_ft,
                max_height_ft = EXCLUDED.max_height_ft,
                min_length_ft = EXCLUDED.min_length_ft,
                max_length_ft = EXCLUDED.max_length_ft,
                report_parking_use = EXCLUDED.report_parking_use,
                remote_parking_reason = EXCLUDED.remote_parking_reason`
            : sql``
        }
        RETURNING id, iata, base_id, ramp_name
      `;

      saved.push(rows[0]);
    }

    return res.status(200).json({ ok: true, count: saved.length, data: saved });
  } catch (err) {
    console.error("ramp/ramps-upload error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
