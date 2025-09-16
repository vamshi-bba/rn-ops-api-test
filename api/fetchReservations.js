// api/fetchReservations.js
import { neon } from "@neondatabase/serverless";
import { verifyToken } from "../utils/auth";

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
};

// --- Utility to fetch Signet reservations ---
async function fetchFromSignet({ requestorId, companyAccountNumber, startDate, endDate }) {
  const url = new URL(`${process.env.SIGNET_API_URL}/ops/v1/dashboard/fbo-operations`);
  url.searchParams.set("requestor-id", requestorId);
  url.searchParams.set("company-account-number", companyAccountNumber);
  url.searchParams.set("startDate", startDate);
  url.searchParams.set("endDate", endDate);

  const resp = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${process.env.SIGNET_API_KEY}`, // adjust for real auth
      "Content-Type": "application/json",
    },
  });

  if (!resp.ok) {
    throw new Error(`Signet API error: ${resp.status} ${resp.statusText}`);
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
  const user = verifyToken(req, res);
  if (!user) return; // stop if invalid — verifyToken already sent response

  try {
    const sql = neon(process.env.DATABASE_URL);

    // --- Extract query params from request ---
    const { requestorId, companyAccountNumber, startDate, endDate } = req.query;
    if (!requestorId || !companyAccountNumber || !startDate || !endDate) {
      return res.status(400).json({
        error: "requestorId, companyAccountNumber, startDate, and endDate are required query params",
      });
    }

    // --- 1) Fetch from Signet ---
    const signetResp = await fetchFromSignet({
      requestorId,
      companyAccountNumber,
      startDate,
      endDate,
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
      };
      const consent = consentMap.get(r.reservationid);
      if (consent) base.consent = consent;
      return base;
    });

    return res.status(200).json({
      data,
      user,
    });
  } catch (err) {
    console.error("fetchReservations error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
