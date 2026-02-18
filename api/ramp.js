// api/ramp.js
import { neon } from "@neondatabase/serverless";
import { verifyToken } from "../utils/auth.js";

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
};

const AUTH_ENABLED = (process.env.AUTH_ENABLED ?? "false").toLowerCase() === "true";

const jsonError = (res, status, message, extra = {}) =>
  res.status(status).json({ error: message, ...extra });

async function requireAuth(req, res) {
  if (!AUTH_ENABLED) return { enabled: false, user: null };
  const user = await verifyToken(req, res);
  if (!user) return null; // verifyToken already responded
  return { enabled: true, user };
}

async function resolveRampId(sql, payload) {
  if (payload?.rampId) return payload.rampId;

  const { iata, baseId, rampName } = payload || {};
  if (!iata || !baseId || !rampName) return null;

  const rows = await sql`
    SELECT id
    FROM public.ramps
    WHERE iata = ${iata} AND base_id = ${baseId} AND ramp_name = ${rampName}
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

async function resolveZoneId(sql, payload) {
  if (payload?.zoneId) return payload.zoneId;

  const { iata, baseId, rampName, zoneName } = payload || {};
  if (!iata || !baseId || !rampName || !zoneName) return null;

  const rows = await sql`
    SELECT id
    FROM public.zones
    WHERE iata = ${iata}
      AND base_id = ${baseId}
      AND ramp_name = ${rampName}
      AND zone_name = ${zoneName}
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const auth = await requireAuth(req, res);
  if (AUTH_ENABLED && !auth) return; // unauthorized already handled

  const sql = neon(process.env.RAMP_DATABASE_URL);

  // Router inputs (POC-friendly)
  // resource: ramps | zones | spots
  // action: list | get | create | upload | update | delete
  const { resource, action = "list", id } = req.query || {};
  if (!resource) return jsonError(res, 400, "resource is required (ramps|zones|spots)");

  try {
    // =========================
    // RAMPS
    // =========================
    if (resource === "ramps") {
      if (req.method === "GET" && action === "list") {
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

      if (req.method === "GET" && action === "get") {
        if (!id) return jsonError(res, 400, "id is required");
        const rows = await sql`SELECT * FROM public.ramps WHERE id = ${id} LIMIT 1`;
        if (!rows[0]) return jsonError(res, 404, "Not found");
        return res.status(200).json({ ok: true, data: rows[0] });
      }

      if (req.method === "POST" && action === "create") {
        const r = req.body || {};
        for (const k of ["iata", "baseId", "sourceType", "rampName"]) {
          if (!r[k]) return jsonError(res, 400, `${k} is required`);
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

      if (req.method === "POST" && action === "upload") {
        const { mode = "upsert", items = [] } = req.body || {};
        if (!Array.isArray(items) || items.length === 0) return jsonError(res, 400, "items[] is required");

        const saved = [];
        for (const r of items) {
          for (const k of ["iata", "baseId", "sourceType", "rampName"]) {
            if (!r?.[k]) return jsonError(res, 400, `Missing ${k} in one of items`);
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
      }

      if (req.method === "PATCH" && action === "update") {
        if (!id) return jsonError(res, 400, "id is required");
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
        if (!rows[0]) return jsonError(res, 404, "Not found");
        return res.status(200).json({ ok: true, data: rows[0] });
      }

      if (req.method === "DELETE" && action === "delete") {
        if (!id) return jsonError(res, 400, "id is required");
        const rows = await sql`DELETE FROM public.ramps WHERE id = ${id} RETURNING id`;
        if (!rows[0]) return jsonError(res, 404, "Not found");
        return res.status(200).json({ ok: true, deletedId: rows[0].id });
      }

      return jsonError(res, 405, "Unsupported method/action for ramps");
    }

    // =========================
    // ZONES
    // =========================
    if (resource === "zones") {
      if (req.method === "GET" && action === "list") {
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

      if (req.method === "GET" && action === "get") {
        if (!id) return jsonError(res, 400, "id is required");
        const rows = await sql`SELECT * FROM public.zones WHERE id = ${id} LIMIT 1`;
        if (!rows[0]) return jsonError(res, 404, "Not found");
        return res.status(200).json({ ok: true, data: rows[0] });
      }

      if (req.method === "POST" && action === "create") {
        const z = req.body || {};
        if (!z.zoneName) return jsonError(res, 400, "zoneName is required");

        const rampId = await resolveRampId(sql, z);
        if (!rampId) return jsonError(res, 400, "Provide rampId OR (iata, baseId, rampName)");

        const parent = await sql`SELECT iata, base_id, ramp_name FROM public.ramps WHERE id = ${rampId} LIMIT 1`;
        if (!parent[0]) return jsonError(res, 404, "Ramp not found");

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
          RETURNING *
        `;
        return res.status(201).json({ ok: true, data: rows[0] });
      }

      if (req.method === "POST" && action === "upload") {
        const { mode = "upsert", items = [] } = req.body || {};
        if (!Array.isArray(items) || items.length === 0) return jsonError(res, 400, "items[] is required");

        const saved = [];
        for (const z of items) {
          if (!z?.zoneName) return jsonError(res, 400, "zoneName missing in one of items");

          const rampId = await resolveRampId(sql, z);
          if (!rampId) return jsonError(res, 400, "Provide rampId OR (iata, baseId, rampName) for each item");

          const parent = await sql`SELECT iata, base_id, ramp_name FROM public.ramps WHERE id = ${rampId} LIMIT 1`;
          if (!parent[0]) return jsonError(res, 404, "Ramp not found for one of items");

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
      }

      if (req.method === "PATCH" && action === "update") {
        if (!id) return jsonError(res, 400, "id is required");
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
        if (!rows[0]) return jsonError(res, 404, "Not found");
        return res.status(200).json({ ok: true, data: rows[0] });
      }

      if (req.method === "DELETE" && action === "delete") {
        if (!id) return jsonError(res, 400, "id is required");
        const rows = await sql`DELETE FROM public.zones WHERE id = ${id} RETURNING id`;
        if (!rows[0]) return jsonError(res, 404, "Not found");
        return res.status(200).json({ ok: true, deletedId: rows[0].id });
      }

      return jsonError(res, 405, "Unsupported method/action for zones");
    }

    // =========================
    // SPOTS
    // =========================
    if (resource === "spots") {
      if (req.method === "GET" && action === "list") {
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

      if (req.method === "GET" && action === "get") {
        if (!id) return jsonError(res, 400, "id is required");
        const rows = await sql`SELECT * FROM public.parking_spots WHERE id = ${id} LIMIT 1`;
        if (!rows[0]) return jsonError(res, 404, "Not found");
        return res.status(200).json({ ok: true, data: rows[0] });
      }

      if (req.method === "POST" && action === "create") {
        const s = req.body || {};
        if (!s.parkingSpotName) return jsonError(res, 400, "parkingSpotName is required");

        const zoneId = await resolveZoneId(sql, s);
        if (!zoneId) return jsonError(res, 400, "Provide zoneId OR (iata, baseId, rampName, zoneName)");

        const parent = await sql`SELECT iata, base_id, ramp_name, zone_name FROM public.zones WHERE id = ${zoneId} LIMIT 1`;
        if (!parent[0]) return jsonError(res, 404, "Zone not found");

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
          RETURNING *
        `;
        return res.status(201).json({ ok: true, data: rows[0] });
      }

      if (req.method === "POST" && action === "upload") {
        const { mode = "upsert", items = [] } = req.body || {};
        if (!Array.isArray(items) || items.length === 0) return jsonError(res, 400, "items[] is required");

        const saved = [];
        for (const s of items) {
          if (!s?.parkingSpotName) return jsonError(res, 400, "parkingSpotName missing in one of items");

          const zoneId = await resolveZoneId(sql, s);
          if (!zoneId) return jsonError(res, 400, "Provide zoneId OR (iata, baseId, rampName, zoneName) for each item");

          const parent = await sql`SELECT iata, base_id, ramp_name, zone_name FROM public.zones WHERE id = ${zoneId} LIMIT 1`;
          if (!parent[0]) return jsonError(res, 404, "Zone not found for one of items");

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
      }

      if (req.method === "PATCH" && action === "update") {
        if (!id) return jsonError(res, 400, "id is required");
        const s = req.body || {};

        const rows = await sql`
          UPDATE public.parking_spots SET
            parking_spot_name = COALESCE(${s.parkingSpotName ?? null}, parking_spot_name),
            classification = COALESCE(${s.classification ?? null}, classification),
            max_weight_mtow_lbs = COALESCE(${s.maxWeightMtowLbs ?? null}, max_weight_mtow_lbs),
            min_wingspan_ft = COALESCE(${s.minWingspanFt ?? null}, min_wingspan_ft),
            max_wingspan_ft = COALESCE(${s.maxWingspanFt ?? null}, max_wingspan_ft),
            max_height_ft = COALESCE(${s.maxHeightFt ?? null}, max_height_ft),
            min_length_ft = COALESCE(${s.minLengthFt ?? null}, min_length_ft),
            max_length_ft = COALESCE(${s.maxLengthFt ?? null}, max_length_ft),
            ops_status = COALESCE(${s.opsStatus ?? null}, ops_status),
            inactive_status_reason = COALESCE(${s.inactiveStatusReason ?? null}, inactive_status_reason)
          WHERE id = ${id}
          RETURNING *
        `;
        if (!rows[0]) return jsonError(res, 404, "Not found");
        return res.status(200).json({ ok: true, data: rows[0] });
      }

      if (req.method === "DELETE" && action === "delete") {
        if (!id) return jsonError(res, 400, "id is required");
        const rows = await sql`DELETE FROM public.parking_spots WHERE id = ${id} RETURNING id`;
        if (!rows[0]) return jsonError(res, 404, "Not found");
        return res.status(200).json({ ok: true, deletedId: rows[0].id });
      }

      return jsonError(res, 405, "Unsupported method/action for spots");
    }

    return jsonError(res, 400, "resource must be ramps|zones|spots");
  } catch (err) {
    console.error("api/ramp error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
