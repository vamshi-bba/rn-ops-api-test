// api/admin/base-email.js
import { Pool } from "@neondatabase/serverless";

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-client-id, x-client-secret");
};

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const clientId = req.headers["x-client-id"];
  const clientSecret = req.headers["x-client-secret"];

  if (
    clientId !== process.env.ADMIN_CLIENT_ID ||
    clientSecret !== process.env.ADMIN_CLIENT_SECRET
  ) {
    return res.status(401).json({ error: "Unauthorized: Invalid client credentials" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST,OPTIONS");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { email } = req.body || {};
  if (!email) {
    return res.status(400).json({ error: "email is required" });
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `
      INSERT INTO public.base_email_preferences (email)
      VALUES ($1)
      ON CONFLICT (email) DO NOTHING
      RETURNING id, email, created_at
      `,
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(200).json({ message: "Email already exists" });
    }

    return res.status(201).json({
      ok: true,
      data: result.rows[0],
    });
  } catch (err) {
    console.error("admin/base-email error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
}
