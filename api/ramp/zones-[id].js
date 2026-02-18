import { neon } from "@neondatabase/serverless";
import { verifyToken } from "../../utils/auth.js";

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,PATCH,DELETE,OPTIONS");
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
    const { id } = req.query || {};
    if (!id) return res.status(400).json({ error: "id is required" });

    if (req.method === "GET") {
      const rows = await sql`SELECT * FROM public.zones WHERE id = ${id} LIMIT 1`;
      if (!rows[0]) return res.status(404).json({ error: "Not found" });
      return res.status(200).json({ ok: true, data: rows[0] });
    }

    if (req.method === "PATCH") {
      const z = req.body || {};
      const rows = await sql`
        UPDATE public.zones SET
          zone_name = COALESCE(${z.zoneName ?? null}, zone_name),
          square_footage = COALESCE(${z.squareFootage ?? null}, square_footage),
          utilization_rate_pct = COALESCE(${z.utilizationRatePct ?? null}, utilization_rate_pct),
          lat_lon = COALESCE(${z.latLon ?? null}, lat_lon),
          total_units_incl_reserved = COALESCE(${z.totalUnitsInclReserved ?? null}, total_units_incl_reserved),
          reserved_units = COALESCE(${z.reservedUnits ?? null}, reserved_units),
          max_weight_mtow_lbs = COALESCE(${z.maxWeightMtowLbs ?? null}, max_weight_mtow_lbs),
          min_wingspan_ft = COALESCE(${z.minWingspanFt ?? null}, min_wingspan_ft),
          max_wingspan_ft = COALESCE(${z.maxWingspanFt ?? null}, max_wingspan_ft),
          max_height_ft = COALESCE(${z.maxHeightFt ?? null}, max_height_ft),
          min_length_ft = COALESCE(${z.minLengthFt ?? null}, min_length_ft),
          max_length_ft = COALESCE(${z.maxLengthFt ?? null}, max_length_ft),
          report_parking_use = COALESCE(${typeof z.reportParkingUse === "boolean" ? z.reportParkingUse : null}, report_parking_use),
          remote_parking_reason = COALESCE(${z.remoteParkingReason ?? null}, remote_parking_reason)
        WHERE id = ${id}
        RETURNING *
      `;
      if (!rows[0]) return res.status(404).json({ error: "Not found" });
      return res.status(200).json({ ok: true, data: rows[0] });
    }

    if (req.method === "DELETE") {
      const rows = await sql`DELETE FROM public.zones WHERE id = ${id} RETURNING id`;
      if (!rows[0]) return res.status(404).json({ error: "Not found" });
      return res.status(200).json({ ok: true, deletedId: rows[0].id });
    }

    res.setHeader("Allow", "GET,PATCH,DELETE,OPTIONS");
    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (err) {
    console.error("ramp/zones-[id] error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
