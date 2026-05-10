"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openReader = openReader;
exports.closeReader = closeReader;
exports.getActiveReaderName = getActiveReaderName;
exports.isReaderOpen = isReaderOpen;
// bridge/src/bridge/port-manager.ts
// Manages the active CardReader session. For USB PC/SC smart card readers the
// "port" is a PC/SC reader name (e.g. "ACS ACR122U 00") — the C++ binary
// enumerates available readers and accepts an optional name override.
const card_reader_js_1 = require("./card-reader.js");
let activeReader = null;
let activeReaderName = null;
/** Open the first available PC/SC reader (or a specific one by name). */
async function openReader(readerName) {
    if (activeReader) {
        throw new Error(`Reader already open${activeReaderName ? ': ' + activeReaderName : ''}. Close it first.`);
    }
    const reader = new card_reader_js_1.CardReader();
    await reader.open(readerName);
    activeReader = reader;
    activeReaderName = readerName ?? null;
    reader.on('disconnect', () => {
        activeReader = null;
        activeReaderName = null;
    });
    return reader;
}
async function closeReader() {
    if (activeReader) {
        await activeReader.close();
        activeReader = null;
        activeReaderName = null;
    }
}
function getActiveReaderName() {
    return activeReaderName;
}
function isReaderOpen() {
    return activeReader !== null;
}
//# sourceMappingURL=port-manager.js.map