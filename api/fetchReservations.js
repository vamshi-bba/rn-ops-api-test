// api/fetchReservations.js
import { neon } from '@neondatabase/serverless';

const cors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*'); // tighten in prod
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET,OPTIONS');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    const { reservationId } = req.query; // optional filter: ?reservationId=R00101

    const rows = await sql`
      SELECT
        r.external_reservation_id AS "reservationId",
        r.reservation_no         AS "reservationNo",
        r.reservation_name       AS "reservationName",
        r.tail_number            AS "tailNumber",
        r.description            AS "description",
        r.status                 AS "status",
        r.reservation_type       AS "reservationType",
        r.created_at             AS "createdAt",
        r.est_arrival_at         AS "estimatedArrival",
        r.act_arrival_at         AS "actualArrival",
        r.est_departure_at       AS "estimatedDeparture",
        r.act_departure_at       AS "actualDeparture",
        c.full_name              AS "consentName",
        c.created_at             AS "consentCreatedAt",
        encode(c.signature_image,'base64') AS "consentSignature",
        sc.code                  AS "serviceCode",
        sc.name                  AS "serviceName",
        sc.kind                  AS "serviceType",
        rs.quantity              AS "serviceQty"
      FROM reservations r
      LEFT JOIN consents c ON c.reservation_id = r.id
      LEFT JOIN reservation_services rs ON rs.reservation_id = r.id
      LEFT JOIN service_catalog sc ON sc.id = rs.service_id
      ${reservationId ? sql`WHERE r.external_reservation_id = ${reservationId}` : sql``}
      ORDER BY r.created_at DESC, sc.code NULLS LAST
    `;

    // Group rows -> exact UI JSON
    const map = new Map();
    for (const row of rows) {
      if (!map.has(row.reservationId)) {
        const base = {
          reservationName: row.reservationName,
          tailNumber: row.tailNumber,
          description: row.description,
          status: row.status,
          reservationType: row.reservationType,
          reservationId: row.reservationId,
          reservationNo: row.reservationNo,
          createdAt: row.createdAt,
          estimatedArrival: row.estimatedArrival,
          actualArrival: row.actualArrival,
          estimatedDeparture: row.estimatedDeparture,
          actualDeparture: row.actualDeparture,
          services: [],
        };
        if (row.consentName || row.consentSignature) {
          base.consent = {
            name: row.consentName,
            createdAt: row.consentCreatedAt,
            signature: row.consentSignature || "",
          };
        }
        map.set(row.reservationId, base);
      }
      // Repeat services to match your sample JSON exactly
      if (row.serviceCode) {
        const qty = row.serviceQty || 1;
        const svc = { name: row.serviceName, code: row.serviceCode, type: row.serviceType };
        for (let i = 0; i < qty; i++) map.get(row.reservationId).services.push(svc);
      }
    }

    const data = Array.from(map.values());
    return res.status(200).json({ data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}
