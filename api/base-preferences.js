// api/base-preferences.js
import { Pool } from "@neondatabase/serverless";
import { verifyToken } from "../utils/auth.js";

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
};

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  // 🔒 Validate JWT
  const user = await verifyToken(req, res);
  if (!user) return;

  const email = user?.preferred_username || user?.email;
  if (!email) {
    return res.status(400).json({ error: "User email not found in token" });
  }

  const client = await pool.connect();

  try {
    // ------------------------------------------------------------------------
    // GET: Fetch preferences for logged-in user
    // ------------------------------------------------------------------------
    if (req.method === "GET") {
      const result = await client.query(
        `SELECT email, base_preference, updated_at FROM public.base_email_preferences WHERE email = $1`,
        [email.toLowerCase()]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Email not found or not configured" });
      }

      const prefs = result.rows[0].base_preference
        ? result.rows[0].base_preference.split(",").map((x) => x.trim())
        : [];

      return res.status(200).json({
        email: result.rows[0].email,
        basePreferences: prefs,
        updatedAt: result.rows[0].updated_at,
      });
    }

    // ------------------------------------------------------------------------
    // POST: Update existing base_preference for the logged-in user
    // ------------------------------------------------------------------------
    if (req.method === "POST") {
      const { basePreferences } = req.body || {};

      if (!Array.isArray(basePreferences)) {
        return res.status(400).json({ error: "basePreferences must be an array" });
      }

      const csv = basePreferences.map((v) => v.trim()).join(",");

      const result = await client.query(
        `
        UPDATE public.base_email_preferences
        SET base_preference = $2, updated_at = now()
        WHERE email = $1
        RETURNING email, base_preference, updated_at
        `,
        [email.toLowerCase(), csv]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Email not found. Contact admin to add your email first." });
      }

      return res.status(200).json({
        ok: true,
        data: {
          email: result.rows[0].email,
          basePreferences: csv.split(",").filter(Boolean),
          updatedAt: result.rows[0].updated_at,
        },
      });
    }

    // ------------------------------------------------------------------------
    // Unsupported
    // ------------------------------------------------------------------------
    res.setHeader("Allow", "GET,POST,OPTIONS");
    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (err) {
    console.error("base-preferences error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
}
