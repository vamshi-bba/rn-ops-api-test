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
      const rows = await sql`SELECT * FROM public.ramps WHERE id = ${id} LIMIT 1`;
      if (!rows[0]) return res.status(404).json({ error: "Not found" });
      return res.status(200).json({ ok: true, data: rows[0] });
    }

    if (req.method === "PATCH") {
      const r = req.body || {};
      const rows = await sql`
        UPDATE public.ramps SET
          iata = COALESCE(${r.iata ?? null}, iata),
          base_id = COALESCE(${r.baseId ?? null}, base_id),
          source_type = COALESCE(${r.sourceType ?? null}, source_type),
          ramp_name = COALESCE(${r.rampName ?? null}, ramp_name),
          square_footage = COALESCE(${r.squareFootage ?? null}, square_footage),
          lat_lon = COALESCE(${r.latLon ?? null}, lat_lon),
          total_units_incl_reserved = COALESCE(${r.totalUnitsInclReserved ?? null}, total_units_incl_reserved),
          reserved_units = COALESCE(${r.reservedUnits ?? null}, reserved_units),
          max_weight_mtow_lbs = COALESCE(${r.maxWeightMtowLbs ?? null}, max_weight_mtow_lbs),
          min_wingspan_ft = COALESCE(${r.minWingspanFt ?? null}, min_wingspan_ft),
          max_wingspan_ft = COALESCE(${r.maxWingspanFt ?? null}, max_wingspan_ft),
          max_height_ft = COALESCE(${r.maxHeightFt ?? null}, max_height_ft),
          min_length_ft = COALESCE(${r.minLengthFt ?? null}, min_length_ft),
          max_length_ft = COALESCE(${r.maxLengthFt ?? null}, max_length_ft),
          report_parking_use = COALESCE(${typeof r.reportParkingUse === "boolean" ? r.reportParkingUse : null}, report_parking_use),
          remote_parking_reason = COALESCE(${r.remoteParkingReason ?? null}, remote_parking_reason)
        WHERE id = ${id}
        RETURNING *
      `;
      if (!rows[0]) return res.status(404).json({ error: "Not found" });
      return res.status(200).json({ ok: true, data: rows[0] });
    }

    if (req.method === "DELETE") {
      const rows = await sql`DELETE FROM public.ramps WHERE id = ${id} RETURNING id`;
      if (!rows[0]) return res.status(404).json({ error: "Not found" });
      return res.status(200).json({ ok: true, deletedId: rows[0].id });
    }

    res.setHeader("Allow", "GET,PATCH,DELETE,OPTIONS");
    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (err) {
    console.error("ramp/ramps-[id] error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
