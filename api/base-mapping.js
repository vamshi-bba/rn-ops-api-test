import { Pool } from "@neondatabase/serverless";

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
};

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET,OPTIONS");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT
        base_id,
        company_code,
        base_number,
        iata,
        icao,
        region,
        business_division,
        base_description,
        fbo_name,
        city,
        state,
        active,
        currency_code,
        default_units,
        base_country,
        base_time_zone
      FROM public.base_mapping
      ORDER BY base_id ASC
    `);

    return res.status(200).json({
      count: result.rowCount,
      bases: result.rows,
    });
  } catch (err) {
    console.error("base-mapping error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
}
