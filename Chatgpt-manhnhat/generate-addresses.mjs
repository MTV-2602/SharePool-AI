import { fakerEN_US, fakerEN_GB, fakerJA, fakerKO } from "@faker-js/faker";
import fs from "node:fs";

// Config
const RECORDS_PER_COUNTRY = Number.parseInt(process.argv[2] || "100", 10);
const OUTPUT_FILE = process.argv[3] || "survey_data.txt";
const DELIM = "|";

const HEADER = [
  "Name",
  "Country",
  "State/Province",
  "City",
  "Street Address",
  "Zip Code",
].join(DELIM);

// Regex rules per country
const ZIP_RE = {
  US: /^\d{5}$/,
  UK: /^(GIR 0AA|[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})$/i,
  JP: /^\d{3}-\d{4}$/,
  KR: /^\d{5}$/,
};

// Constrained regions to avoid country/city mismatch
const US_STATE = "California";
const US_CITIES = [
  "Los Angeles",
  "Hollywood",
  "Santa Monica",
  "Pasadena",
  "Burbank",
  "Glendale",
  "Long Beach",
];

const UK_STATE = "England";
const UK_CITIES = [
  "London",
  "City of London",
  "Canary Wharf",
  "Knightsbridge",
  "Mayfair",
  "Chelsea",
  "Westminster",
];

const JP_STATE = "Tokyo";
const JP_CITIES = [
  "Shinjuku-ku",
  "Shibuya-ku",
  "Minato-ku",
  "Chiyoda-ku",
  "Taito-ku",
  "Setagaya-ku",
  "Shinagawa-ku",
  "Bunkyo-ku",
  "Koto-ku",
  "Meguro-ku",
];

const KR_STATE = "Seoul";
const KR_CITIES = [
  "Gangnam-gu",
  "Seocho-gu",
  "Mapo-gu",
  "Yongsan-gu",
  "Jung-gu",
  "Jongno-gu",
  "Songpa-gu",
  "Gwangjin-gu",
  "Seodaemun-gu",
  "Dongjak-gu",
];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function normalizeZip(raw, code) {
  const text = String(raw || "").trim().toUpperCase();

  if (code === "US" || code === "KR") {
    const digits = text.replace(/\D/g, "");
    return digits.slice(0, 5);
  }

  if (code === "JP") {
    const digits = text.replace(/\D/g, "");
    if (digits.length >= 7) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}`;
    return text;
  }

  // UK: keep alphanumeric + space, then normalize spacing
  return text.replace(/\s+/g, " ").trim();
}

function isValidRecord(rec, code) {
  if (!rec.name || !rec.country || !rec.state || !rec.city || !rec.street || !rec.zip) {
    return false;
  }

  if (!ZIP_RE[code].test(rec.zip)) return false;

  if (code === "US") {
    return rec.country === "United States" && rec.state === US_STATE && US_CITIES.includes(rec.city);
  }
  if (code === "UK") {
    return rec.country === "United Kingdom" && rec.state === UK_STATE && UK_CITIES.includes(rec.city);
  }
  if (code === "JP") {
    return rec.country === "Japan" && rec.state === JP_STATE && JP_CITIES.includes(rec.city);
  }
  if (code === "KR") {
    return rec.country === "South Korea" && rec.state === KR_STATE && KR_CITIES.includes(rec.city);
  }

  return false;
}

function buildUS() {
  return {
    name: fakerEN_US.person.fullName(),
    country: "United States",
    state: US_STATE,
    city: pick(US_CITIES),
    street: fakerEN_US.location.streetAddress(),
    zip: normalizeZip(fakerEN_US.location.zipCode("#####"), "US"),
  };
}

function buildUK() {
  return {
    name: fakerEN_GB.person.fullName(),
    country: "United Kingdom",
    state: UK_STATE,
    city: pick(UK_CITIES),
    street: fakerEN_GB.location.streetAddress(),
    zip: normalizeZip(fakerEN_GB.location.zipCode(), "UK"),
  };
}

function buildJP() {
  // JA locale can output Japanese scripts; if you prefer Latin names, swap to fakerEN_US names.
  return {
    name: fakerJA.person.fullName(),
    country: "Japan",
    state: JP_STATE,
    city: pick(JP_CITIES),
    street: fakerJA.location.streetAddress(),
    zip: normalizeZip(fakerJA.location.zipCode("###-####"), "JP"),
  };
}

function buildKR() {
  return {
    name: fakerKO.person.fullName(),
    country: "South Korea",
    state: KR_STATE,
    city: pick(KR_CITIES),
    street: fakerKO.location.streetAddress(),
    zip: normalizeZip(fakerKO.location.zipCode("#####"), "KR"),
  };
}

function generateRows(code, count, builder, maxRetryPerRow = 30) {
  const rows = [];
  const seen = new Set();

  for (let i = 0; i < count; i++) {
    let candidate = null;
    let rowText = "";

    for (let attempt = 0; attempt < maxRetryPerRow; attempt++) {
      const rec = builder();
      const serialized = [rec.name, rec.country, rec.state, rec.city, rec.street, rec.zip].join(DELIM);
      if (isValidRecord(rec, code) && !seen.has(serialized)) {
        candidate = rec;
        rowText = serialized;
        seen.add(serialized);
        break;
      }
    }

    if (!candidate) {
      throw new Error(`Failed to generate valid ${code} record at row ${i + 1}`);
    }

    rows.push(rowText);
  }

  return rows;
}

function main() {
  const lines = [HEADER];

  lines.push(...generateRows("US", RECORDS_PER_COUNTRY, buildUS));
  lines.push(...generateRows("UK", RECORDS_PER_COUNTRY, buildUK));
  lines.push(...generateRows("JP", RECORDS_PER_COUNTRY, buildJP));
  lines.push(...generateRows("KR", RECORDS_PER_COUNTRY, buildKR));

  fs.writeFileSync(OUTPUT_FILE, lines.join("\n"), "utf8");

  const total = RECORDS_PER_COUNTRY * 4;
  console.log(`Records per country: ${RECORDS_PER_COUNTRY}`);
  console.log(`Generated ${total} valid address rows.`);
  console.log(`Saved file: ${OUTPUT_FILE}`);
}

main();
