import { neon } from "@neondatabase/serverless";
import { verifyToken } from "../../utils/auth.js";

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
};

async function resolveRampId(sql, item) {
  if (item.rampId) return item.rampId;
  const { iata, baseId, rampName } = item || {};
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
    for (const z of items) {
      if (!z?.zoneName) return res.status(400).json({ error: "zoneName missing in one of items" });

      const rampId = await resolveRampId(sql, z);
      if (!rampId) return res.status(400).json({ error: "Provide rampId or (iata, baseId, rampName) for each item" });

      const parent = await sql`SELECT iata, base_id, ramp_name FROM public.ramps WHERE id = ${rampId} LIMIT 1`;
      if (!parent[0]) return res.status(404).json({ error: "Ramp not found for one of items" });

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
          ${rampId}, ${parent[0].iata}, ${parent[0].base_id}, ${parent[0].ramp_name}, ${z.zoneName},
          ${z.squareFootage ?? null}, ${z.utilizationRatePct ?? null}, ${z.latLon ?? null},
          ${z.totalUnitsInclReserved ?? null}, ${z.reservedUnits ?? null},
          ${z.maxWeightMtowLbs ?? null}, ${z.minWingspanFt ?? null}, ${z.maxWingspanFt ?? null}, ${z.maxHeightFt ?? null},
          ${z.minLengthFt ?? null}, ${z.maxLengthFt ?? null},
          ${z.reportParkingUse ?? false}, ${z.remoteParkingReason ?? null}
        )
        ${
          mode === "upsert"
            ? sql`ON CONFLICT (ramp_id, zone_name) DO UPDATE SET
                square_footage = EXCLUDED.square_footage,
                utilization_rate_pct = EXCLUDED.utilization_rate_pct,
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
                remote_parking_reason = EXCLUDED.remote_parking_reason,
                iata = EXCLUDED.iata,
                base_id = EXCLUDED.base_id,
                ramp_name = EXCLUDED.ramp_name`
            : sql``
        }
        RETURNING id, ramp_id, zone_name
      `;

      saved.push(rows[0]);
    }

    return res.status(200).json({ ok: true, count: saved.length, data: saved });
  } catch (err) {
    console.error("ramp/zones-upload error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
