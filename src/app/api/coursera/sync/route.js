import { NextResponse } from 'next/server';

// POST: Sync Coursera account data to Google Sheets (Supports both Web App script URL and Sheets API v4)
export async function POST(request) {
  try {
    const body = await request.json();
    const { spreadsheet_id, sheet_name, accounts, script_url } = body;

    const scriptUrl = script_url || process.env.COURSERA_SHEET_SCRIPT_URL;

    // Method 1: Google Apps Script Web App URL (Primary & simplest to config)
    if (scriptUrl) {
      // Format data as array of arrays (like legacy webhook) or array of objects depending on Apps Script script expectation
      // Legacy app sent array of arrays: [ [email, pass, course], ... ]
      const formattedData = (accounts || []).map(acc => [
        acc.email || '',
        acc.password || '',
        acc.courseCode || acc.status || ''
      ]);

      const res = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheetName: sheet_name || '',
          data: formattedData
        })
      });

      if (!res.ok) {
        throw new Error(`Google Apps Script returned HTTP ${res.status}`);
      }

      const responseText = await res.text();
      let result;
      try {
        result = JSON.parse(responseText);
      } catch {
        result = { success: true, raw: responseText };
      }

      return NextResponse.json({
        success: true,
        method: 'apps_script',
        result
      });
    }

    // Method 2: Google Sheets API v4 (Fallback)
    const sheetId = spreadsheet_id || process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    if (!sheetId) {
      return NextResponse.json({ error: 'No spreadsheet ID or script URL configured' }, { status: 400 });
    }

    const credJson = process.env.GOOGLE_SHEETS_CREDENTIALS;
    if (!credJson) {
      return NextResponse.json({ error: 'Google Sheets credentials not configured' }, { status: 500 });
    }

    const { google } = await import('googleapis');
    const credentials = JSON.parse(credJson);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const targetSheet = sheet_name || 'Coursera Accounts';

    const rows = (accounts || []).map(acc => [
      acc.email || '',
      acc.password || '',
      acc.courseCode || acc.status || 'active',
      acc.created_at || new Date().toISOString(),
    ]);

    const result = await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${targetSheet}!A:D`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows },
    });

    return NextResponse.json({
      success: true,
      method: 'sheets_api',
      updatedRows: result.data.updates?.updatedRows || 0,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
