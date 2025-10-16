// api/fetchReservations.js
import { neon } from "@neondatabase/serverless";
import { verifyToken } from "../utils/auth.js";

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
};

// --- Utility to fetch Signet reservations ---
async function fetchFromSignet({ startDate, endDate, baseIds, officeLocation }) {
  const url = new URL(`${process.env.SIGNET_API_URL}/fbo/GetReservationCasesUsingBase`);
  url.searchParams.set("startDate", startDate);
  url.searchParams.set("endDate", endDate);
  url.searchParams.set("baseIds", baseIds); // e.g. "\"SNN\",\"P08\""
  if (officeLocation) url.searchParams.set("officeLocation", officeLocation);

  const resp = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${process.env.SIGNET_API_KEY}`, // adjust for real auth
      "Content-Type": "application/json",
    },
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(`Signet API error: ${resp.status} ${resp.statusText} - ${errorText}`);
  }
  return resp.json();
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET,OPTIONS");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // 🔒 Verify Microsoft Entra JWT
  const user = await verifyToken(req, res);
  if (!user) return; // verifyToken already sent a 401 response

  try {
    const sql = neon(process.env.DATABASE_URL);

    // --- Extract query params ---
    const { startDate, endDate, baseIds, officeLocation } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({
        error: "startDate and endDate are required query params",
      });
    }

    if (!baseIds && !officeLocation) {
      return res.status(400).json({
        error: "either baseIds or officeLocation must be provided",
      });
    }

    // --- 1) Fetch from Signet ---
    const signetResp = await fetchFromSignet({
      startDate, endDate, baseIds, officeLocation
    });

    const reservations = signetResp?.data || [];

    // --- 2) Look up consents in Postgres ---
    const ids = reservations.map((r) => r.reservationid);
    let consentRows = [];
    if (ids.length > 0) {
      consentRows = await sql`
        SELECT
          r.reservation_no        AS "reservationNo",
          c.full_name             AS "fullName",
          c.terms_version         AS "termsVersion",
          c.geo_location          AS "geoLocation",
          c.created_at            AS "createdAt",
          encode(c.signature_image,'base64') AS "signature"
        FROM reservations r
        JOIN consents c ON c.reservation_id = r.id
        WHERE r.reservation_no = ANY(${ids})
      `;
    }

    const consentMap = new Map();
    for (const row of consentRows) {
      consentMap.set(row.reservationNo, {
        name: row.fullName,
        termsVersion: row.termsVersion,
        geoLocation: row.geoLocation,
        createdAt: row.createdAt,
        signature: row.signature,
      });
    }

    // --- 3) Merge consent into reservation objects ---
    const data = reservations.map((r) => {
      const flight = r.flightDetails || {};
      const base = {
        baseId: r.baseid,
        reservationId: r.reservationid,
        reservationName: r.companyName,
        customerAccountNumber: r.customerAccountNumber,
        tailNumber: r.tailNumber,
        status: r.reservationStatus,
        arrivalDetails: r.arrivalDetails,
        departureDetails: r.departureDetails,
        products: r.products || [],
        fboName: r.fboName ?? null,
        resCreatedDate: r.createdDate ?? null,
        flightName: flight.name ?? null,
        flightModel: flight.model ?? null,
        flightType: flight.flightType ?? null,
      };
      const consent = consentMap.get(r.reservationid);
      if (consent) base.consent = consent;
      return base;
    });

    return res.status(200).json({
      data,
      user, // decoded JWT payload
    });
  } catch (err) {
    console.error("fetchReservations error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
