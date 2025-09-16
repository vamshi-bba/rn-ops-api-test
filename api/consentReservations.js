// api/consentReservations.js
import { neon } from "@neondatabase/serverless";
import { verifyToken } from "../utils/auth";

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
};

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET,OPTIONS");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // 🔒 Validate Microsoft Entra JWT
  const user = verifyToken(req, res);
  if (!user) return;

  try {
    const sql = neon(process.env.DATABASE_URL);

    const { searchText } = req.query || {};
    const likePattern = searchText ? `%${searchText}%` : null;

    const rows = await sql`
      SELECT
        r.id                       AS "reservationUUID",
        r.base_id                  AS "baseId",
        r.reservation_no           AS "reservationId",
        r.reservation_name         AS "reservationName",
        r.customer_account_number  AS "customerAccountNumber",
        r.tail_number              AS "tailNumber",
        r.status                   AS "status",
        r.created_at               AS "createdAt",
        r.est_arrival_at           AS "estimatedArrival",
        r.act_arrival_at           AS "actualArrival",
        r.est_departure_at         AS "estimatedDeparture",
        r.act_departure_at         AS "actualDeparture",
        c.id                       AS "consentId",
        c.full_name                AS "consentName",
        c.terms_version            AS "termsVersion",
        c.geo_location             AS "geoLocation",
        c.created_at               AS "consentCreatedAt"
      FROM public.reservations r
      LEFT JOIN public.consents c ON c.reservation_id = r.id
      ${
        likePattern
          ? sql`WHERE 
                r.reservation_no ILIKE ${likePattern}
             OR r.tail_number ILIKE ${likePattern}
             OR r.reservation_name ILIKE ${likePattern}
             OR c.full_name ILIKE ${likePattern}`
          : sql``
      }
      ORDER BY r.created_at DESC
      LIMIT 100
    `;

    const data = rows.map((row) => ({
      reservationId: row.reservationId,
      baseId: row.baseId,
      reservationName: row.reservationName,
      customerAccountNumber: row.customerAccountNumber,
      tailNumber: row.tailNumber,
      status: row.status,
      createdAt: row.createdAt,
      estimatedArrival: row.estimatedArrival,
      actualArrival: row.actualArrival,
      estimatedDeparture: row.estimatedDeparture,
      actualDeparture: row.actualDeparture,
      consent: row.consentId
        ? {
            id: row.consentId,
            name: row.consentName,
            termsVersion: row.termsVersion,
            geoLocation: row.geoLocation,
            createdAt: row.consentCreatedAt,
          }
        : null,
    }));

    return res.status(200).json({
      data,
      count: data.length,
      user, // optional: include Entra claims (remove in prod if not needed)
    });
  } catch (err) {
    console.error("consentReservations error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
