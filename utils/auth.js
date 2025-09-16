// utils/auth.js
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";

const client = jwksClient({
  jwksUri: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/discovery/v2.0/keys`,
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
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
          console.error("JWT verification failed:", err.message);
          res.status(401).json({
            error:
              err.name === "TokenExpiredError"
                ? "Token expired"
                : "Invalid or expired token",
          });
          resolve(null);
        } else {
          resolve(decoded);
        }
      }
    );
  });
}
