declare module 'pdfmake' {
  import type { TDocumentDefinitions, TFontDictionary } from 'pdfmake/interfaces.js';
  class PdfPrinter {
    constructor(fontDescriptors: TFontDictionary);
    createPdfKitDocument(docDefinition: TDocumentDefinitions, options?: object): NodeJS.ReadableStream & { end(): void };
  }
  export = PdfPrinter;
}

declare module 'pdfmake/interfaces.js' {
  export interface TFontDictionary {
    [fontName: string]: { normal?: string; bold?: string; italics?: string; bolditalics?: string };
  }
  export interface TDocumentDefinitions {
    content: any;
    styles?: Record<string, any>;
    defaultStyle?: Record<string, any>;
    [key: string]: any;
  }
}
