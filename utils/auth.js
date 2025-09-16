// utils/auth.js
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";

const client = jwksClient({
  jwksUri: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/discovery/v2.0/keys`,
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      console.error("❌ JWKS key fetch error:", err);
      return callback(err);
    }
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
}

export async function verifyToken(req, res) {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return null;
  }

  const token = authHeader.split(" ")[1];

  // 🪵 Log decoded header/payload without verifying
  const decodedUnverified = jwt.decode(token, { complete: true });
  console.log("🔎 Decoded JWT (unverified):", JSON.stringify(decodedUnverified, null, 2));

  if (!decodedUnverified) {
    res.status(401).json({ error: "Invalid JWT format" });
    return null;
  }

  const { header, payload } = decodedUnverified;
  console.log("🔑 Token kid:", header.kid);
  console.log("📛 Token aud:", payload.aud);
  console.log("🏢 Token iss:", payload.iss);
  console.log("👤 Token sub:", payload.sub);
  console.log("⏰ Token exp:", new Date(payload.exp * 1000).toISOString());

  return new Promise((resolve) => {
    jwt.verify(
      token,
      getKey,
      {
        algorithms: ["RS256"],
        audience: process.env.AZURE_CLIENT_ID,
        issuer: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/v2.0`,
      },
      (err, decoded) => {
        if (err) {
          console.error("❌ JWT verification failed:", err.message);
          res.status(401).json({
            error:
              err.name === "TokenExpiredError"
                ? "Token expired"
                : "Invalid or expired token",
          });
          resolve(null);
        } else {
          console.log("✅ JWT verified successfully for user:", decoded.sub);
          resolve(decoded);
        }
      }
    );
  });
}
