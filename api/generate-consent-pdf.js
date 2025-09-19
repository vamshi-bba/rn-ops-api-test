import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

export default async function handler(req, res) {
  try {
    const data = req.body;

    const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: Arial, sans-serif; color: #111; margin: 0; padding: 24px; }
          .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #134C8D; padding-bottom: 8px; margin-bottom: 16px; }
          .logo { height: 40px; }
          h1 { font-size: 20px; color: #134C8D; margin: 0; }
          h2 { font-size: 16px; margin: 12px 0 4px; color: #00263D; }
          .section { margin-bottom: 16px; }
          .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; font-size: 13px; }
          .grid p { margin: 2px 0; }
          table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
          table th, table td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
          table th { background: #F4F6F8; font-weight: bold; }
          .terms { font-size: 11px; line-height: 1.5; border-top: 1px solid #ddd; padding-top: 8px; margin-top: 16px; }
          .signature { margin-top: 24px; }
          .signature img { border: 1px solid #ccc; height: 60px; }
          .footer { margin-top: 32px; font-size: 10px; color: #666; text-align: center; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Reservation Consent</h1>
          <img src="https://www.signatureaviation.com/content/dam/signatureaviation/SignatureAviation_Logo_White.png" class="logo" />
        </div>

        <div class="section">
          <h2>Reservation Details</h2>
          <div class="grid">
            <p><b>ID:</b> ${data.reservationId}</p>
            <p><b>Status:</b> ${data.status}</p>
            <p><b>Tail:</b> ${data.tailNumber}</p>
            <p><b>Name:</b> ${data.reservationName}</p>
          </div>
        </div>

        <div class="section">
          <h2>Customer Information</h2>
          <div class="grid">
            <p><b>Name:</b> ${data.customerName}</p>
            <p><b>FBO:</b> ${data.fboName}</p>
          </div>
        </div>

        <div class="section">
          <h2>Flight Information</h2>
          <div class="grid">
            <p><b>Type:</b> ${data.aircraftType}</p>
            <p><b>Estimated Arrival:</b> ${data.estimatedArrival}</p>
            <p><b>Actual Arrival:</b> ${data.actualArrival}</p>
            <p><b>Estimated Departure:</b> ${data.estimatedDeparture}</p>
            <p><b>Actual Departure:</b> ${data.actualDeparture}</p>
          </div>
        </div>

        <div class="section">
          <h2>Service Details</h2>
          <table>
            <thead>
              <tr><th>Product</th><th>Qty</th><th>Service Date</th><th>Quoted Price</th></tr>
            </thead>
            <tbody>
              ${data.services
                .map(
                  (s) =>
                    `<tr>
                      <td>${s.productName}</td>
                      <td>${s.quantity}</td>
                      <td>${s.serviceDate}</td>
                      <td>$${s.quotedPrice}</td>
                    </tr>`
                )
                .join("")}
              <tr>
                <td colspan="3" style="text-align:right"><b>Estimated Total</b></td>
                <td><b>$${data.services.reduce((sum, s) => sum + s.quotedPrice, 0).toFixed(2)}</b></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="terms">
          <h2>Terms & Conditions ${data.termsVersion}</h2>
          <p>${data.terms}</p>
        </div>

        <div class="signature">
          <h2>Customer Signature</h2>
          ${
            data.signatureBase64
              ? `<img src="data:image/png;base64,${data.signatureBase64}" />`
              : "<p>[Signature Not Provided]</p>"
          }
          <p><b>Name:</b> ${data.customerName}</p>
          <p><b>Date:</b> ${new Date().toLocaleDateString()}</p>
        </div>

        <div class="footer">
          <p>This electronic signature constitutes legal acceptance of the above terms.</p>
        </div>
      </body>
    </html>
    `;

    // Launch Chromium in serverless mode
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({ format: "A4", printBackground: true });
    await browser.close();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=consent.pdf");
    res.statusCode = 200;
    res.end(pdfBuffer);
  } catch (err) {
    console.error("PDF generation failed:", err);
    res.status(500).json({ error: "Failed to generate PDF" });
  }
}
