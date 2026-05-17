# Mineski Procurement Database

A web-based procurement database viewer that loads, decrypts, and searches historical procurement orders. Built for project managers to quickly look up particulars and pricing for accurate client quotations.

## Features

- **Hybrid search** -- Powered by [Orama](https://github.com/oramasearch/orama) with BM25 full-text + vector/semantic search. Embeddings are computed client-side via the bundled transformer model (~25MB, cached in IndexedDB after first load). Queries like "camera" surface semantically related items (lens, tripod, projector) without a hardcoded synonyms dictionary.
- **Exact match toggle** -- A toggle beside the search bar switches to literal case-insensitive substring matching, useful for looking up specific request numbers or supplier names.
- **Search tabs** -- Filter results by All, Particulars, Suppliers, or Projects.
- **Encrypted database** -- AES-256-GCM encryption with PBKDF2-SHA256 key derivation (100,000 iterations). Database files are stored as `.enc` and decrypted client-side with a password.
- **Detail panel** -- Click any result to view full order details in a slide-animated side panel with grouped fields and hyperlinked attachments.
- **Status priority** -- Results at similar relevance scores are sorted by status: Approved > Under Review > Rejected > Recalled.
- **Theme support** -- System, light, and dark themes. Configurable default via `config.json`.
- **File encryption tool** -- Upload `.xlsx`/`.csv` files in the settings panel to encrypt them for deployment. Extracts HYPERLINK formulas and cell hyperlinks into separate URL columns.
- **Sticky search** -- The search area sticks to the top of the viewport while scrolling results.
- **Responsive design** -- Works on desktop and mobile.

## Setup

**Requirements:** Python 3.x, a modern web browser, an internet connection (for loading Orama from CDN on first page load).

1. Place your database file (`.enc`, `.csv`, or `.xlsx`) in the `data/` directory.
2. Update `config.json` with the database filename.
3. Generate SSL certificates (if `cert/` is empty):

```
openssl req -x509 -newkey rsa:2048 -keyout cert/key.pem -out cert/cert.pem -days 365 -nodes
```

4. Start the HTTPS dev server:

```
python server.py
```

5. Open `https://localhost:8098` in your browser (accept the self-signed certificate warning).

## Configuration

`config.json` fields:

| Key | Description |
|-----|-------------|
| `database` | Filename of the database in `data/` (e.g., `procurement.enc`, `procurement.csv`) |
| `debugKey` | Base64-encoded password for development auto-fill. Leave blank for production. |
| `appName` | Display name shown in the header and browser tab |
| `theme` | Default theme: `system`, `light`, or `dark` |

When `database` points to a `.enc` file, the app shows a password modal on load. If `debugKey` is set, the password field is auto-filled and auto-submitted. When `database` points to a `.csv` or `.xlsx` file, it is loaded directly without a password prompt.

## Data Preparation

### Using the Python tool (recommended)

Convert an `.xlsx` procurement file to an encrypted `.enc` file:

```
python tools/convert_and_encrypt.py --input procurement.xlsx --output data/procurement.enc --password YOUR_PASSWORD
```

This extracts HYPERLINK formulas into separate URL columns and encrypts the resulting CSV.

### Using the web interface

1. Open Settings (gear icon).
2. Under "Encrypt Database File", choose your `.xlsx` or `.csv` file.
3. Enter the encryption password.
4. Click "Encrypt & Download" and place the resulting `.enc` file in `data/`.

## Project Structure

```
├── cert/                  # SSL certificate and key for HTTPS dev server
├── css/styles.css         # Stylesheet with light/dark theme support
├── data/                  # Database files (.enc, .csv)
├── js/
│   ├── app.js             # Main application logic
│   ├── crypto.js          # AES-256-GCM encrypt/decrypt (Web Crypto API)
│   ├── search.js          # Orama hybrid search + exact substring fallback
│   ├── papaparse.min.js   # PapaParse CSV parser
│   └── xlsx.full.min.js   # SheetJS XLSX parser
├── tools/
│   └── convert_and_encrypt.py  # XLSX to encrypted CSV converter
├── config.json            # Application configuration
├── index.html             # Main page
├── server.py              # HTTPS development server (port 8098)
└── README.md
```

## Security Notes

- The `debugKey` in `config.json` is a base64-encoded password for development convenience. **Remove it before deploying** to production.
- The SSL certificate in `cert/` is self-signed for local development. Use a proper certificate for production.
- Database encryption uses AES-256-GCM with PBKDF2-SHA256 (100,000 iterations) for key derivation.
- Orama and its embeddings plugin are loaded from jsdelivr CDN via ESM imports. The transformer model (~25MB) is fetched once and cached in IndexedDB.
