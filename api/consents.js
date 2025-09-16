// api/consents.js
import { neon } from "@neondatabase/serverless";
import { verifyToken } from "../utils/auth.js";

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
};

const nullIfEmpty = (v) => (v === "" || v === undefined ? null : v);
const toNum = (v) => (v === "" || v == null ? null : Number(v));
const toBool = (v) => (String(v).toLowerCase() === "true");

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  // 🔒 Verify Microsoft Entra JWT
  const user = await verifyToken(req, res);
  if (!user) return; // verifyToken already sent a 401 response

  const sql = neon(process.env.DATABASE_URL);

  try {
    if (req.method === "POST") {
      const {
        reservation,      // full reservation object from Signet
        products = [],    // services array
        fullName,
        termsText,
        termsVersion,
        signatureBase64,
        geoLocation,
        overwrite = false,
      } = req.body || {};

      if (!reservation?.reservationId) {
        return res.status(400).json({ error: "reservation.reservationId is required" });
      }
      if (!fullName || !termsText || !termsVersion || !signatureBase64) {
        return res.status(400).json({
          error: "fullName, termsText, termsVersion, signatureBase64 are required",
        });
      }

      // convert base64 -> bytea
      const sigBytes = Buffer.from(signatureBase64.includes(",") ? signatureBase64.split(",")[1] : signatureBase64, "base64");
      if (sigBytes.length > 2 * 1024 * 1024) {
        return res.status(413).json({ error: "Signature too large (max 2MB)" });
      }

      // 🔒 Wrap everything in a transaction
      const result = await sql.begin(async (tx) => {
        // 1) Upsert reservation
        const [resv] = await tx`
          INSERT INTO public.reservations (
            external_reservation_id, base_id, company, customer_account_number,
            tail_number, reservation_status, est_arrival_at, act_arrival_at,
            est_departure_at, act_departure_at, updated_at
          )
          VALUES (
            ${reservation.reservationId},
            ${reservation.baseId},
            ${reservation.reservationName || null},
            ${reservation.customerAccountNumber || null},
            ${reservation.tailNumber || null},
            ${reservation.status},
            ${nullIfEmpty(reservation.arrivalDetails?.estimatedArrivalTimeUTC)},
            ${nullIfEmpty(reservation.arrivalDetails?.actualArrivalTimeUTC)},
            ${nullIfEmpty(reservation.departureDetails?.estimatedDepartureTimeUTC)},
            ${nullIfEmpty(reservation.departureDetails?.actualDepartureTimeUTC)},
            now()
          )
          ON CONFLICT (external_reservation_id) DO UPDATE SET
            base_id = EXCLUDED.base_id,
            company = EXCLUDED.company,
            customer_account_number = EXCLUDED.customer_account_number,
            tail_number = EXCLUDED.tail_number,
            reservation_status = EXCLUDED.reservation_status,
            est_arrival_at = EXCLUDED.est_arrival_at,
            act_arrival_at = EXCLUDED.act_arrival_at,
            est_departure_at = EXCLUDED.est_departure_at,
            act_departure_at = EXCLUDED.act_departure_at,
            updated_at = now()
          RETURNING id
        `;
        const reservation_uuid = resv.id;

        // 2) Replace services
        await tx`DELETE FROM public.reservation_services WHERE reservation_id = ${reservation_uuid}`;
        for (const p of products) {
          await tx`
            INSERT INTO public.reservation_services (
              reservation_id, product_id, product_name, product_status, quantity,
              service_date, subcase_id, for_arrival_or_departure, dsf_product_name,
              service_request_details, vendor_name, on_arrival, on_departure,
              phone_number, email_address, quoted_price, special_instruction_value,
              vendor_rep, crew_meal_count, pax_meal_count, crew_or_passenger, created_at
            ) VALUES (
              ${reservation_uuid}, ${p.productID}, ${p.productName}, ${p.productStatus},
              ${toNum(p.quantity) || 1},
              ${nullIfEmpty(p.serviceDateUTC)}, ${p.subcaseId || null}, ${p.forArrivalorDeparture || null},
              ${p.dsfProductName || null}, ${p.serviceRequestDetails || null}, ${p.vendorName || null},
              ${toBool(p.onArrival)}, ${toBool(p.onDeparture)},
              ${p.phoneNumber || null}, ${p.emailAddress || null},
              ${toNum(p.quotedPrice) || 0},
              ${p.specialInstructionValue || null}, ${p.vendorRep || null},
              ${toNum(p.crewMealCount)}, ${toNum(p.paxMealCount)},
              ${p.crewOrPassanger || null}, now()
            )
          `;
        }

        // 3) Insert/Upsert consent
        let consentRow;
        if (overwrite) {
          [consentRow] = await tx`
            INSERT INTO public.consents (
              reservation_id, full_name, terms_and_conditions, terms_version, geo_location, signature_image, updated_at
            )
            VALUES (
              ${reservation_uuid}, ${fullName}, ${termsText}, ${termsVersion}, ${geoLocation}, ${sigBytes}, now()
            )
            ON CONFLICT (reservation_id) DO UPDATE SET
              full_name = EXCLUDED.full_name,
              terms_and_conditions = EXCLUDED.terms_and_conditions,
              terms_version = EXCLUDED.terms_version,
              geo_location = EXCLUDED.geo_location,
              signature_image = EXCLUDED.signature_image,
              updated_at = now()
            RETURNING id, created_at, updated_at, terms_version, geo_location
          `;
        } else {
          try {
            [consentRow] = await tx`
              INSERT INTO public.consents (
                reservation_id, full_name, terms_and_conditions, terms_version, geo_location, signature_image
              )
              VALUES (
                ${reservation_uuid}, ${fullName}, ${termsText}, ${termsVersion}, ${geoLocation}, ${sigBytes}
              )
              RETURNING id, created_at, terms_version, geo_location
            `;
          } catch (e) {
            if (e.code === "23505") {
              throw Object.assign(new Error("Consent already exists for this reservation. Use overwrite=true to replace."), { http: 409 });
            }
            throw e;
          }
        }

        return { reservation_uuid, consentRow };
      });

      return res.status(201).json({
        ok: true,
        reservationId: reservation.reservationId,
        consent: {
          id: result.consentRow.id,
          termsVersion: result.consentRow.terms_version,
          geoLocation: result.consentRow.geo_location,
          createdAt: result.consentRow.created_at,
          updatedAt: result.consentRow.updated_at,
        },
        user, // decoded JWT payload
      });
    }

    // keep your GET for reading consents
    if (req.method === "GET") {
      const { reservationId, includeSignature } = req.query || {};
      if (!reservationId)
        return res.status(400).json({ error: "reservationId query param is required" });

      const rows = await sql`
        SELECT
          r.external_reservation_id AS "reservationId",
          c.id,
          c.full_name               AS "fullName",
          c.terms_version           AS "termsVersion",
          c.geo_location            AS "geoLocation",
          c.created_at              AS "createdAt",
          ${includeSignature ? sql`encode(c.signature_image,'base64')` : sql`NULL`} AS "signature"
        FROM public.consents c
        JOIN public.reservations r ON r.id = c.reservation_id
        WHERE r.external_reservation_id = ${reservationId}
        LIMIT 1
      `;

      if (rows.length === 0)
        return res.status(404).json({ error: "Consent not found" });

      return res.status(200).json({
        ...rows[0],
        user, // decoded JWT payload
      });
    }

    res.setHeader("Allow", "GET,POST,OPTIONS");
    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (err) {
    const status = err.http || 500;
    console.error("consents API error", err);
    return res.status(status).json({ error: err.message || "Server error" });
  }
}
