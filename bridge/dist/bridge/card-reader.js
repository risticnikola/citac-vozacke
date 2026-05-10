"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CardReader = void 0;
// bridge/src/bridge/card-reader.ts
// Delegates all card I/O to the C++ binary via CppWrapper.
// The binary uses eVehicleRegistrationAPI.dll + Windows PC/SC stack — Node.js
// never touches the USB smart card reader directly.
const events_1 = require("events");
const cpp_wrapper_js_1 = require("./cpp-wrapper.js");
const parser_js_1 = require("./parser.js");
class CardReader extends events_1.EventEmitter {
    wrapper = null;
    async open(readerName) {
        this.wrapper = new cpp_wrapper_js_1.CppWrapper();
        await this.wrapper.start(readerName);
        this.wrapper.on('unsolicited', (msg) => {
            if (msg.type === 'card_inserted') {
                this.readCard().catch((err) => this.emit('error', err));
            }
        });
        this.wrapper.on('exit', (code) => this.emit('disconnect', code));
        this.wrapper.on('error', (err) => this.emit('error', err));
    }
    async readCard() {
        if (!this.wrapper)
            throw new Error('Reader not open');
        const raw = await this.wrapper.readCard();
        const cardType = (0, parser_js_1.mapCardType)(raw.cardType);
        const cardData = {
            cardType,
            cardSerial: raw.cardSerial,
            rawDump: raw.rawDump,
            parsedData: (0, parser_js_1.parseCardOutput)(raw),
        };
        this.emit('card', cardData);
        return cardData;
    }
    async close() {
        if (this.wrapper) {
            await this.wrapper.shutdown();
            this.wrapper = null;
        }
    }
    isOpen() {
        return this.wrapper !== null;
    }
}
exports.CardReader = CardReader;
//# sourceMappingURL=card-reader.js.map