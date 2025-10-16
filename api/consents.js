// api/consents.js
import { Pool } from "@neondatabase/serverless";
import { verifyToken } from "../utils/auth.js";

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
};

const nullIfEmpty = (v) => (v === "" || v === undefined ? null : v);
const toNum = (v) => (v === "" || v == null ? null : Number(v));
const toBool = (v) => String(v).toLowerCase() === "true";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  let user = null;

  if (req.method === "POST") {
    // 🔒 Verify Microsoft Entra JWT
    user = await verifyToken(req, res);
    if (!user) return; // 401 already sent
  }

  try {
    // ------------------------------------------------------------------------
    // POST: Insert/Update reservation, services, consent
    // ------------------------------------------------------------------------
    if (req.method === "POST") {
      const {
        reservation,
        products = [],
        fullName,
        termsText,
        termsVersion,
        signatureBase64,
        geoLocation,
        overwrite = false,
      } = req.body || {};

      const baseId = reservation?.baseId ?? reservation?.baseid ?? null;
      const reservationNo =
        reservation?.reservationId ?? reservation?.reservationid ?? null;
      const reservationName =
        reservation?.companyName ?? reservation?.reservationName ?? null;
      const customerAccountNumber =
        reservation?.customerAccountNumber ?? null;
      const tailNumber = reservation?.tailNumber ?? null;
      const status =
        reservation?.status ?? reservation?.reservationStatus ?? null;
      const fboName = reservation?.fboName ?? null;
      const resCreatedDate = reservation?.createdDate ?? null;
      const flightName = reservation?.flightName ?? null;
      const flightModel = reservation?.flightModel ?? null;
      const flightType = reservation?.flightType ?? null;

      if (!reservationNo) {
        return res
          .status(400)
          .json({ error: "reservation.reservationId is required" });
      }
      if (!fullName || !termsText || !termsVersion || !signatureBase64) {
        return res.status(400).json({
          error:
            "fullName, termsText, termsVersion, signatureBase64 are required",
        });
      }

      // convert base64 -> bytea
      const sigBytes = Buffer.from(
        signatureBase64.includes(",")
          ? signatureBase64.split(",")[1]
          : signatureBase64,
        "base64"
      );
      if (sigBytes.length > 2 * 1024 * 1024) {
        return res
          .status(413)
          .json({ error: "Signature too large (max 2MB)" });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // 1) Upsert reservation
        const resv = await client.query(
          `
          INSERT INTO public.reservations (
            base_id,
            reservation_no,
            reservation_name,
            customer_account_number,
            tail_number,
            status,
            est_arrival_at,
            act_arrival_at,
            est_departure_at,
            act_departure_at,
            fbo_name,
            res_created_date,
            flight_name,
            flight_model,
            flight_type,
            updated_at
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
          ON CONFLICT (reservation_no) DO UPDATE SET
            base_id = EXCLUDED.base_id,
            reservation_name = EXCLUDED.reservation_name,
            customer_account_number = EXCLUDED.customer_account_number,
            tail_number = EXCLUDED.tail_number,
            status = EXCLUDED.status,
            est_arrival_at = EXCLUDED.est_arrival_at,
            act_arrival_at = EXCLUDED.act_arrival_at,
            est_departure_at = EXCLUDED.est_departure_at,
            act_departure_at = EXCLUDED.act_departure_at,
            fbo_name = EXCLUDED.fbo_name,
            res_created_date = EXCLUDED.res_created_date,
            flight_name = EXCLUDED.flight_name,
            flight_model = EXCLUDED.flight_model,
            flight_type = EXCLUDED.flight_type,
            updated_at = now()
          RETURNING id
        `,
          [
            baseId,
            reservationNo,
            reservationName,
            customerAccountNumber,
            tailNumber,
            status,
            nullIfEmpty(reservation?.arrivalDetails?.estimatedArrivalTimeUTC),
            nullIfEmpty(reservation?.arrivalDetails?.actualArrivalTimeUTC),
            nullIfEmpty(reservation?.departureDetails?.estimatedDepartureTimeUTC),
            nullIfEmpty(reservation?.departureDetails?.actualDepartureTimeUTC),
            fboName,
            resCreatedDate,
            flightName,
            flightModel,
            flightType,
          ]
        );
        const reservation_uuid = resv.rows[0].id;

        // 2) Replace services
        await client.query(
          "DELETE FROM public.reservation_services WHERE reservation_id = $1",
          [reservation_uuid]
        );
        for (const p of products) {
          await client.query(
            `
            INSERT INTO public.reservation_services (
              reservation_id, product_id, product_name, product_status, quantity,
              service_date, subcase_id, for_arrival_or_departure, dsf_product_name,
              service_request_details, vendor_name, on_arrival, on_departure,
              phone_number, email_address, quoted_price, special_instruction_value,
              vendor_rep, crew_meal_count, pax_meal_count, crew_or_passenger, created_at
            )
            VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21, now()
            )
          `,
            [
              reservation_uuid,
              p.productID ?? null,
              p.productName,
              p.productStatus ?? null,
              toNum(p.quantity) ?? 1,
              nullIfEmpty(p.serviceDateUTC),
              p.subcaseId ?? null,
              p.forArrivalorDeparture ?? null,
              p.dsfProductName ?? null,
              p.serviceRequestDetails ?? null,
              p.vendorName ?? null,
              toBool(p.onArrival),
              toBool(p.onDeparture),
              p.phoneNumber ?? null,
              p.emailAddress ?? null,
              toNum(p.quotedPrice) ?? 0,
              p.specialInstructionValue ?? null,
              p.vendorRep ?? null,
              toNum(p.crewMealCount),
              toNum(p.paxMealCount),
              p.crewOrPassanger ?? null,
            ]
          );
        }

        // 3) Insert/Upsert consent (with hardcoded channel)
        let consentRow;
        if (overwrite) {
          const consent = await client.query(
            `
            INSERT INTO public.consents (
              reservation_id, full_name, terms_and_conditions, terms_version, geo_location, channel, signature_image, created_at
            )
            VALUES ($1,$2,$3,$4,$5,'Mobile App',$6, now())
            ON CONFLICT (reservation_id) DO UPDATE SET
              full_name = EXCLUDED.full_name,
              terms_and_conditions = EXCLUDED.terms_and_conditions,
              terms_version = EXCLUDED.terms_version,
              geo_location = EXCLUDED.geo_location,
              channel = 'Mobile App',
              signature_image = EXCLUDED.signature_image
            RETURNING id, created_at, terms_version, geo_location, channel
          `,
            [reservation_uuid, fullName, termsText, termsVersion, geoLocation, sigBytes]
          );
          consentRow = consent.rows[0];
        } else {
          try {
            const consent = await client.query(
              `
              INSERT INTO public.consents (
                reservation_id, full_name, terms_and_conditions, terms_version, geo_location, channel, signature_image
              )
              VALUES ($1,$2,$3,$4,$5,'Mobile App',$6)
              RETURNING id, created_at, terms_version, geo_location, channel
            `,
              [reservation_uuid, fullName, termsText, termsVersion, geoLocation, sigBytes]
            );
            consentRow = consent.rows[0];
          } catch (e) {
            if (e.code === "23505") {
              throw Object.assign(
                new Error("Consent already exists for this reservation. Use overwrite=true to replace."),
                { http: 409 }
              );
            }
            throw e;
          }
        }

        await client.query("COMMIT");

        return res.status(201).json({
          ok: true,
          reservationId: reservationNo,
          consent: {
            id: consentRow.id,
            termsVersion: consentRow.terms_version,
            geoLocation: consentRow.geo_location,
            channel: consentRow.channel,
            createdAt: consentRow.created_at,
          },
          user,
        });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }

    // ------------------------------------------------------------------------
    // GET: Fetch reservation, services, consent (with base mapping lookup)
    // ------------------------------------------------------------------------
    if (req.method === "GET") {
      const { reservationId, includeSignature } = req.query || {};
      if (!reservationId) {
        return res
          .status(400)
          .json({ error: "reservationId query param is required" });
      }

      const client = await pool.connect();
      try {
        const result = await client.query(
          `
          SELECT
            r.id                       AS reservation_uuid,
            r.base_id,
            r.reservation_no,
            r.reservation_name,
            r.customer_account_number,
            r.tail_number,
            r.status,
            r.reservation_type,
            r.created_at,
            r.est_arrival_at,
            r.act_arrival_at,
            r.est_departure_at,
            r.act_departure_at,
            r.fbo_name,
            r.res_created_date,
            r.flight_name,
            r.flight_model,
            r.flight_type,
            c.id                       AS consent_id,
            c.full_name,
            c.terms_version,
            c.terms_and_conditions,
            c.geo_location,
            c.channel,
            c.created_at               AS consent_created_at,
            ${includeSignature ? "encode(c.signature_image,'base64')" : "NULL"} AS signature,
            rs.id                      AS service_id,
            rs.product_id,
            rs.product_name,
            rs.product_status,
            rs.quantity,
            rs.service_date,
            rs.vendor_name,
            rs.quoted_price,
            rs.special_instruction_value,
            bm.company_code,
            bm.base_number,
            bm.iata,
            bm.icao,
            bm.region,
            bm.business_division,
            bm.base_description,
            bm.fbo_name                AS bm_fbo_name,
            bm.city,
            bm.state,
            bm.active,
            bm.currency_code,
            bm.default_units,
            bm.base_country,
            bm.base_time_zone
          FROM public.reservations r
          LEFT JOIN public.consents c ON c.reservation_id = r.id
          LEFT JOIN public.reservation_services rs ON rs.reservation_id = r.id
          LEFT JOIN public.base_mapping bm ON bm.base_id = r.base_id
          WHERE r.reservation_no = $1
          ORDER BY rs.created_at ASC
          `,
          [reservationId]
        );

        if (result.rows.length === 0) {
          return res
            .status(404)
            .json({ error: "Reservation or consent not found" });
        }

        const rows = result.rows;

        // --- reservation ---
        const reservation = {
          reservationId: rows[0].reservation_no,
          baseId: rows[0].base_id,
          reservationName: rows[0].reservation_name,
          customerAccountNumber: rows[0].customer_account_number,
          tailNumber: rows[0].tail_number,
          status: rows[0].status,
          reservationType: rows[0].reservation_type,
          createdAt: rows[0].created_at,
          estimatedArrival: rows[0].est_arrival_at,
          actualArrival: rows[0].act_arrival_at,
          estimatedDeparture: rows[0].est_departure_at,
          actualDeparture: rows[0].act_departure_at,
          fboName: rows[0].fbo_name,
          resCreatedDate: rows[0].res_created_date,
          flightName: rows[0].flight_name,
          flightModel: rows[0].flight_model,
          flightType: rows[0].flight_type,
        };

        // --- baseDetails from mapping ---
        const baseDetails = rows[0].company_code
          ? {
              companyCode: rows[0].company_code,
              baseNumber: rows[0].base_number,
              iata: rows[0].iata,
              icao: rows[0].icao,
              region: rows[0].region,
              businessDivision: rows[0].business_division,
              baseDescription: rows[0].base_description,
              fboName: rows[0].bm_fbo_name,
              city: rows[0].city,
              state: rows[0].state,
              active: rows[0].active,
              currencyCode: rows[0].currency_code,
              defaultUnits: rows[0].default_units,
              baseCountry: rows[0].base_country,
              baseTimeZone: rows[0].base_time_zone,
            }
          : null;

        // --- consent ---
        const consent = rows[0].consent_id
          ? {
              id: rows[0].consent_id,
              fullName: rows[0].full_name,
              termsVersion: rows[0].terms_version,
              termsAndConditions: rows[0].terms_and_conditions,
              geoLocation: rows[0].geo_location,
              channel: rows[0].channel,
              createdAt: rows[0].consent_created_at,
              signature: rows[0].signature,
            }
          : null;

        // --- services ---
        const services = [];
        for (const row of rows) {
          if (row.service_id) {
            services.push({
              id: row.service_id,
              productId: row.product_id,
              productName: row.product_name,
              productStatus: row.product_status,
              quantity: row.quantity,
              serviceDate: row.service_date,
              vendorName: row.vendor_name,
              quotedPrice: row.quoted_price,
              specialInstruction: row.special_instruction_value,
            });
          }
        }

        return res.status(200).json({
          reservation,
          baseDetails,
          services,
          consent,
        });
      } finally {
        client.release();
      }
    }

    res.setHeader("Allow", "GET,POST,OPTIONS");
    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (err) {
    const status = err.http || 500;
    console.error("consents API error", err);
    return res
      .status(status)
      .json({ error: err.message || "Server error" });
  }
}
