// api/consents.js
import { neon } from '@neondatabase/serverless';

const cors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sql = neon(process.env.DATABASE_URL);

  try {
    if (req.method === 'POST') {
      // Expecting JSON body
      const {
        reservationId,         // external id like "R00101"
        fullName,              // signer name
        termsText,             // full T&Cs text shown to the user
        termsVersion,          // e.g., "2025-08-27-v1"
        signatureBase64,       // raw base64, no "data:image/png;base64," prefix
        overwrite = false,     // if true, upsert; else 409 on duplicate
      } = req.body || {};

      // basic validation
      if (!reservationId || !fullName || !termsText || !termsVersion || !signatureBase64) {
        return res.status(400).json({ error: 'reservationId, fullName, termsText, termsVersion, signatureBase64 are required' });
      }

      // find the internal reservation UUID
      const ridRows = await sql`
        SELECT id FROM public.reservations
        WHERE external_reservation_id = ${reservationId}
        LIMIT 1
      `;
      if (ridRows.length === 0) return res.status(404).json({ error: 'Reservation not found' });
      const reservation_uuid = ridRows[0].id;

      // convert base64 -> bytea
      const sigBytes = Buffer.from(signatureBase64, 'base64');
      // keep payloads small (Vercel body limit ~5MB). Here: 2MB safety cap.
      if (sigBytes.length > 2 * 1024 * 1024) {
        return res.status(413).json({ error: 'Signature too large (max 2MB)' });
      }

      // insert (or upsert) consent
      let row;
      if (overwrite) {
        [row] = await sql`
          INSERT INTO public.consents
            (reservation_id, full_name, terms_and_conditions, terms_version, signature_image)
          VALUES
            (${reservation_uuid}, ${fullName}, ${termsText}, ${termsVersion}, ${sigBytes})
          ON CONFLICT (reservation_id) DO UPDATE SET
            full_name = EXCLUDED.full_name,
            terms_and_conditions = EXCLUDED.terms_and_conditions,
            terms_version = EXCLUDED.terms_version,
            signature_image = EXCLUDED.signature_image,
            created_at = now()
          RETURNING id, created_at, terms_version
        `;
      } else {
        try {
          [row] = await sql`
            INSERT INTO public.consents
              (reservation_id, full_name, terms_and_conditions, terms_version, signature_image)
            VALUES
              (${reservation_uuid}, ${fullName}, ${termsText}, ${termsVersion}, ${sigBytes})
            RETURNING id, created_at, terms_version
          `;
        } catch (e) {
          // unique index on (reservation_id) -> duplicate
          if (e.code === '23505') {
            return res.status(409).json({ error: 'Consent already exists for this reservation. Use overwrite=true to replace.' });
          }
          throw e;
        }
      }

      return res.status(201).json({
        ok: true,
        id: row.id,
        reservationId,
        termsVersion: row.terms_version,
        createdAt: row.created_at,
      });
    }

    if (req.method === 'GET') {
      // GET /api/consents?reservationId=R00101&includeSignature=true
      const { reservationId, includeSignature } = req.query || {};
      if (!reservationId) return res.status(400).json({ error: 'reservationId query param is required' });

      const rows = await sql`
        SELECT
          r.external_reservation_id AS "reservationId",
          c.id,
          c.full_name               AS "fullName",
          c.terms_version           AS "termsVersion",
          c.created_at              AS "createdAt",
          ${includeSignature ? sql`encode(c.signature_image,'base64')` : sql`NULL`} AS "signature"
        FROM public.consents c
        JOIN public.reservations r ON r.id = c.reservation_id
        WHERE r.external_reservation_id = ${reservationId}
        LIMIT 1
      `;

      if (rows.length === 0) return res.status(404).json({ error: 'Consent not found' });
      return res.status(200).json(rows[0]);
    }

    res.setHeader('Allow', 'GET,POST,OPTIONS');
    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}
