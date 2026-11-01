const PASSWORD = "CHANGE_THIS_TO_A_LONG_RANDOM_PASSWORD";
const DATA_PREFIX = "_MMP_Data_";
const ACTIVE_REVISION_KEY = "MMP_ACTIVE_REVISION";
const ACTIVE_SHEET_KEY = "MMP_ACTIVE_SHEET";
const MAX_DATA_LENGTH = 5000000;
const HISTORY_LIMIT = 20;
const CHUNK_LENGTH = 40000;

function doPost(e) {
  try {
    const request = JSON.parse(e && e.postData && e.postData.contents || "{}");
    if (PASSWORD === "CHANGE_THIS_TO_A_LONG_RANDOM_PASSWORD" || PASSWORD.length < 12) {
      return jsonResponse({ ok: false, error: "no_password" });
    }
    if (typeof request.token !== "string" || request.token !== PASSWORD) {
      return jsonResponse({ ok: false, error: "unauthorized" });
    }

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) throw new Error("สคริปต์ต้องผูกกับ Google Sheets");
    const properties = PropertiesService.getScriptProperties();
    const activeRevision = Number(properties.getProperty(ACTIVE_REVISION_KEY) || 0);
    const activeSheet = properties.getProperty(ACTIVE_SHEET_KEY) || "";

    if (request.action === "info") {
      const tabs = spreadsheet.getSheets().map(function (sheet) {
        return {
          name: sheet.getName(),
          hidden: sheet.isSheetHidden(),
          rows: sheet.getLastRow()
        };
      });
      return jsonResponse({
        ok: true,
        book: spreadsheet.getName(),
        rev: activeRevision,
        tabs: tabs
      });
    }

    if (request.action === "load") {
      const sheet = activeSheet && spreadsheet.getSheetByName(activeSheet);
      return jsonResponse({
        ok: true,
        rev: activeRevision,
        data: sheet ? readData(sheet) : ""
      });
    }

    if (request.action !== "save") {
      return jsonResponse({ ok: false, error: "bad_action" });
    }

    if (typeof request.data !== "string" || request.data.length > MAX_DATA_LENGTH) {
      return jsonResponse({ ok: false, error: "bad_data" });
    }
    let data;
    try {
      data = JSON.parse(request.data);
    } catch (error) {
      return jsonResponse({ ok: false, error: "bad_data" });
    }
    if (!data || typeof data !== "object" || !data.months || !Array.isArray(data.expenses)) {
      return jsonResponse({ ok: false, error: "bad_data" });
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const currentRevision = Number(properties.getProperty(ACTIVE_REVISION_KEY) || 0);
      if (!request.force && Number(request.baseRev) !== currentRevision) {
        return jsonResponse({ ok: false, conflict: true, rev: currentRevision });
      }

      const nextRevision = currentRevision + 1;
      const sheetName = DATA_PREFIX + String(nextRevision).padStart(8, "0");
      let sheet = spreadsheet.getSheetByName(sheetName);
      if (!sheet) sheet = spreadsheet.insertSheet(sheetName);
      writeData(sheet, request.data);
      sheet.hideSheet();

      properties.setProperties({
        [ACTIVE_REVISION_KEY]: String(nextRevision),
        [ACTIVE_SHEET_KEY]: sheetName
      });

      let mirrorError = "";
      try {
        pruneHistory(spreadsheet, sheetName);
      } catch (error) {
        console.error(error);
        mirrorError = "บันทึกข้อมูลแล้ว แต่ลบประวัติเก่าบางรายการไม่สำเร็จ";
      }

      return jsonResponse({
        ok: true,
        rev: nextRevision,
        mirrorError: mirrorError
      });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    console.error(error);
    return jsonResponse({ ok: false, error: "server_error" });
  }
}

function jsonResponse(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function readData(sheet) {
  const lastRow = sheet.getLastRow();
  if (!lastRow) return "";
  return sheet.getRange(1, 1, lastRow, 1).getValues()
    .map(function (row) { return String(row[0] || ""); })
    .join("");
}

function writeData(sheet, data) {
  sheet.clearContents();
  const chunks = [];
  for (let offset = 0; offset < data.length;) {
    let end = Math.min(offset + CHUNK_LENGTH, data.length);
    const lastCode = data.charCodeAt(end - 1);
    if (end < data.length && lastCode >= 0xD800 && lastCode <= 0xDBFF) {
      const nextCode = data.charCodeAt(end);
      if (nextCode >= 0xDC00 && nextCode <= 0xDFFF) end--;
    }
    chunks.push([data.slice(offset, end)]);
    offset = end;
  }
  if (chunks.length) {
    const requiredRows = chunks.length;
    if (sheet.getMaxRows() < requiredRows) {
      sheet.insertRowsAfter(sheet.getMaxRows(), requiredRows - sheet.getMaxRows());
    }
    const range = sheet.getRange(1, 1, requiredRows, 1);
    range.setNumberFormat("@");
    range.setValues(chunks);
  }
}

function pruneHistory(spreadsheet, activeSheetName) {
  const history = spreadsheet.getSheets()
    .filter(function (sheet) { return sheet.getName().indexOf(DATA_PREFIX) === 0; })
    .sort(function (a, b) { return b.getName().localeCompare(a.getName()); });
  const keep = new Set(history.slice(0, HISTORY_LIMIT).map(function (sheet) {
    return sheet.getName();
  }));
  keep.add(activeSheetName);
  history.forEach(function (sheet) {
    if (!keep.has(sheet.getName())) spreadsheet.deleteSheet(sheet);
  });
}
