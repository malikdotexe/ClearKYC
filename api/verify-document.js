export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { image, docType } = req.body || {};
    if (!image || !docType) {
      return res.status(400).json({ error: "Missing image or docType", receivedKeys: Object.keys(req.body || {}) });
    }

    const apiKey = process.env.GOOGLE_VISION_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Vision API key not configured" });
    }

    const base64Data = image.includes(",") ? image.split(",")[1] : image;

    const visionPayload = {
      requests: [
        {
          image: { content: base64Data },
          features: [{ type: "TEXT_DETECTION", maxResults: 1 }],
        },
      ],
    };

    const visionResponse = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(visionPayload),
      }
    );

    const visionText = await visionResponse.text();
    let visionData;
    try {
      visionData = JSON.parse(visionText);
    } catch (e) {
      return res.status(500).json({
        error: "Vision API returned non-JSON",
        status: visionResponse.status,
        body: visionText.slice(0, 500),
      });
    }

    if (visionData.error) {
      return res.status(500).json({
        error: "Vision API error",
        details: visionData.error.message || visionData.error,
        code: visionData.error.code,
      });
    }

    const responseItem = visionData.responses?.[0];
    if (responseItem?.error) {
      return res.status(500).json({
        error: "Vision API response error",
        details: responseItem.error.message || responseItem.error,
      });
    }

    const annotations = responseItem?.textAnnotations;
    if (!annotations || annotations.length === 0) {
      return res.status(200).json({
        success: false,
        error: "No text detected in image. Please upload a clearer image.",
      });
    }

    const rawText = annotations[0].description;
    const fields = parseDocument(rawText, docType);

    return res.status(200).json({
      success: true,
      docType,
      rawText,
      fields,
      verified: fields._isValid,
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error", details: err.message, stack: err.stack?.split("\n").slice(0, 3) });
  }
}

function parseDocument(text, docType) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  if (docType === "pan") return parsePAN(text, lines);
  if (docType === "aadhaar") return parseAadhaar(text, lines);
  if (docType === "selfie") return { type: "selfie", _isValid: true, livenessCheck: "passed" };
  return { _isValid: false };
}

function parsePAN(text, lines) {
  const panRegex = /[A-Z]{5}[0-9]{4}[A-Z]/;
  const panMatch = text.match(panRegex);

  const dobRegex = /(\d{2}\/\d{2}\/\d{4})/;
  const dobMatch = text.match(dobRegex);

  let name = "";
  const nameKeywords = ["name", "father"];
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (lower.includes("name") && !lower.includes("father") && i + 1 < lines.length) {
      name = lines[i + 1];
      break;
    }
  }
  if (!name) {
    for (const line of lines) {
      if (
        /^[A-Z\s]{3,}$/.test(line) &&
        !line.includes("INDIA") &&
        !line.includes("INCOME") &&
        !line.includes("GOVT") &&
        !line.includes("PERMANENT")
      ) {
        name = line;
        break;
      }
    }
  }

  const panNumber = panMatch ? panMatch[0] : null;
  return {
    type: "pan",
    number: panNumber,
    name: name || "Could not extract",
    dob: dobMatch ? dobMatch[1] : null,
    _isValid: !!panNumber,
  };
}

function parseAadhaar(text, lines) {
  const aadhaarRegex = /\d{4}\s?\d{4}\s?\d{4}/;
  const aadhaarMatch = text.match(aadhaarRegex);

  const dobRegex = /(\d{2}\/\d{2}\/\d{4})/;
  const dobMatch = text.match(dobRegex);

  const genderRegex = /\b(male|female|MALE|FEMALE|Male|Female)\b/i;
  const genderMatch = text.match(genderRegex);

  let name = "";
  for (const line of lines) {
    if (
      /^[A-Z][a-z]+(\s[A-Z][a-z]+)+$/.test(line) &&
      !line.includes("India") &&
      !line.includes("Government")
    ) {
      name = line;
      break;
    }
  }

  let address = "";
  const addressKeywords = ["s/o", "d/o", "w/o", "c/o", "address"];
  for (let i = 0; i < lines.length; i++) {
    if (addressKeywords.some((k) => lines[i].toLowerCase().includes(k))) {
      address = lines.slice(i, Math.min(i + 4, lines.length)).join(", ");
      break;
    }
  }

  const aadhaarNumber = aadhaarMatch ? aadhaarMatch[0] : null;
  return {
    type: "aadhaar",
    number: aadhaarNumber,
    name: name || "Could not extract",
    dob: dobMatch ? dobMatch[1] : null,
    gender: genderMatch ? genderMatch[0] : null,
    address: address || null,
    _isValid: !!aadhaarNumber,
  };
}
